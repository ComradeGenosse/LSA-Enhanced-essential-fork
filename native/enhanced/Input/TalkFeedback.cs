using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Input
{
    public enum FeedbackKind { None, Starting, Recording, Transcribing, Thinking, Speaking, Error }

    // One immutable frame for the renderer. Built on the game fiber, read by RPH's
    // FrameRender, so a reader can never see a half-updated state.
    public sealed class FeedbackView
    {
        public static readonly FeedbackView Empty = new FeedbackView(FeedbackKind.None,null,false,0f);
        public readonly FeedbackKind Kind;
        public readonly string Text;
        public readonly bool ShowMeter;   // only while recording, and only with live level data
        public readonly float Level;      // 0..1 display level, smoothed
        public FeedbackView(FeedbackKind kind,string text,bool showMeter,float level) { Kind = kind; Text = text; ShowMeter = showMeter; Level = level; }
    }

    // The companion's voice_status reply: scalar phase and level codes only. Never
    // audio, text or names. Anything outside the allowlists is rejected whole.
    public sealed class VoiceStatus
    {
        static readonly Regex Code = new Regex("^[a-z][a-z0-9_]{0,47}$");
        static readonly HashSet<string> Phases = new HashSet<string> {"idle","recording","transcribing","thinking","speaking","done","error","unavailable"};
        public string Phase, Reason;
        public long Conv, PhaseMs, ConvMs;
        public double Level;            // 0..1 linear peak over the companion's short window
        public long LevelAgeMs = -1;    // age of the newest chunk; -1 when no chunk has arrived
        public static VoiceStatus Parse(string body)
        {
            if (string.IsNullOrEmpty(body) || body.Length > 1024) return null;
            try {
                var root = new JavaScriptSerializer {MaxJsonLength = 2048,RecursionLimit = 4}.DeserializeObject(body) as Dictionary<string,object>;
                if (root == null || !root.TryGetValue("v",out var version) || Number(version) != 1) return null;
                if (!root.TryGetValue("phase",out var rawPhase) || !(rawPhase is string phase) || !Phases.Contains(phase)) return null;
                var status = new VoiceStatus {Phase = phase};
                if (root.TryGetValue("reason",out var rawReason) && rawReason is string reason && Code.IsMatch(reason)) status.Reason = reason;
                status.Conv = Math.Max(0,(long)Number(Get(root,"conv")));
                status.PhaseMs = Math.Max(0,(long)Number(Get(root,"phaseMs")));
                status.ConvMs = Math.Max(0,(long)Number(Get(root,"convMs")));
                double level = Number(Get(root,"level"));
                status.Level = double.IsNaN(level) ? 0 : Math.Max(0,Math.Min(1,level));
                var age = Get(root,"levelAgeMs");
                status.LevelAgeMs = age == null ? -1 : (long)Math.Max(0,Number(age));
                return status;
            } catch { return null; }
        }
        static object Get(Dictionary<string,object> root,string key) => root.TryGetValue(key,out var value) ? value : null;
        static double Number(object value)
        {
            if (value is int i) return i;
            if (value is long l) return l;
            if (value is decimal m) return (double)m;
            if (value is double d) return d;
            return 0;
        }
    }

    public static class FeedbackText
    {
        public const string Ellipsis = "…";
        public static string Starting => "Starting microphone" + Ellipsis;
        public static string Transcribing => "Transcribing" + Ellipsis;
        public static string Talking(string recipient) => "Talking to: " + (recipient ?? "NPC");
        public static string Thinking(string recipient) => (recipient ?? "NPC") + " is thinking" + Ellipsis;
        public static string Speaking(string recipient) => (recipient ?? "NPC") + " is speaking" + Ellipsis;
        // Companion pipeline reason codes (turn terminal reasons and capture errors).
        public static string Failure(string reason,string recipient)
        {
            switch (reason) {
                case "stt_error": return "Couldn't transcribe your speech";
                case "no_audio": return "No microphone audio captured";
                case "input_overflow": return "Recording too long";
                case "model_error": case "invalid_decision": case "model_refusal": return (recipient ?? "NPC") + " couldn't respond";
                case "tts_error": return "Voice generation failed";
                case "provider_timeout": return "Request timed out";
                case "native_auth_rejected": return "Game rejected the speech";
                case "playback_ack_timeout": case "playback_error": return "Speech playback failed";
                case "playback_interrupted": return "Speech interrupted";
                case "disconnected": return "Companion disconnected";
                case "cancelled": return "Conversation cancelled";
                default: return "Conversation failed";
            }
        }
        // Native ptt_start refusal codes.
        public static string StartFailure(string reason)
        {
            switch (reason) {
                case "target_lost": return "Target lost";
                case "no_nearby_npc": return "No nearby NPC";
                case "target_changed": return "Target changed";
                case "selector_unavailable": return "Talk targeting unavailable";
                case "mic_busy": case "ptt_busy": return "Microphone busy";
                case "mic_state_unavailable": return "Microphone unavailable";
                case "input_busy": case "scripted_state": return "Can't talk right now";
                default: return "Couldn't start microphone";
            }
        }
    }

    // UX4 conversation feedback: the "starting / talking / transcribing / thinking /
    // speaking / error" line and the live microphone meter. Pure state, driven by
    // TalkTargetInput on the game fiber. It owns no microphone, no ped and no
    // timing of the talk path: it only reflects what the native commit result and
    // the companion's voice_status say actually happened.
    public sealed class TalkFeedback
    {
        public const long ErrorShowMs = 2500;
        public const long BindSlackMs = 150;       // clock jitter allowed between press and companion capture start
        public const long BindWaitMs = 4000;       // after release, wait this long for the companion to report our conversation
        public const long FollowMaxMs = 15 * 60 * 1000;
        public const long MeterStaleMs = 400, MeterHideMs = 1000;
        public const long PollRecordingMs = 66, PollFollowMs = 250;
        public const int FailureLimit = 3;
        const double AttackMs = 25.0, ReleaseMs = 140.0;
        const double FloorDb = -48.0, SpanDb = 42.0;   // -48 dBFS is empty, -6 dBFS is full

        FeedbackKind kind;
        string text, recipient;
        long pressAt, releasedAt, errorUntil, nextPollAt, meterAt, lastAdvance, boundConv;
        bool recorded, released, bound, meterOk, unavailable;
        int epoch, failures;
        double target, shown;
        volatile FeedbackView view = FeedbackView.Empty;

        public FeedbackView View => view;
        public int Epoch => epoch;
        public bool Active => kind != FeedbackKind.None || recorded;
        public bool MeterUnavailable => unavailable;

        // Display level 0..1 for a linear peak: a dB scale, because speech peaks sit far below full scale.
        public static float Scale(double peak)
        {
            if (double.IsNaN(peak) || peak <= 0) return 0f;
            double db = 20.0 * Math.Log10(Math.Max(peak,1e-5));
            return (float)Math.Max(0.0,Math.Min(1.0,(db - FloorDb) / SpanDb));
        }

        // A new hold: supersedes whatever the previous conversation was showing.
        public void Begin(long now)
        {
            Reset();
            kind = FeedbackKind.Starting; text = FeedbackText.Starting;
            pressAt = now; lastAdvance = now;
            Publish();
        }
        // The native commit result arrived while the key is still held.
        public void Recording(long now)
        {
            if (kind != FeedbackKind.Starting) return;
            kind = FeedbackKind.Recording; text = FeedbackText.Talking(recipient);
            recorded = true; nextPollAt = now; lastAdvance = now;
            Publish();
        }
        public void SetRecipient(string name)
        {
            recipient = string.IsNullOrEmpty(name) ? null : name;
            if (kind == FeedbackKind.Recording) { text = FeedbackText.Talking(recipient); Publish(); }
        }
        // The key was released, or the hold was aborted. Live levels stop at once.
        public void Released(long now)
        {
            if (kind == FeedbackKind.Starting) { Clear(); return; }
            if (kind != FeedbackKind.Recording) return;
            released = true; releasedAt = now; kind = FeedbackKind.None; text = null;
            meterOk = false; target = shown = 0;
            Publish();
        }
        // A start that was refused while the key was still held.
        public void Fail(long now,string message)
        {
            Reset();
            kind = FeedbackKind.Error; text = message; errorUntil = now + ErrorShowMs; lastAdvance = now;
            Publish();
        }
        public void Reset()
        {
            epoch++;
            kind = FeedbackKind.None; text = null; recipient = null;
            recorded = released = bound = meterOk = unavailable = false;
            failures = 0; boundConv = 0; target = shown = 0;
            Publish();
        }
        void Clear()
        {
            epoch++;
            kind = FeedbackKind.None; text = null;
            recorded = released = bound = meterOk = false;
            target = shown = 0;
            Publish();
        }

        public bool WantsPoll(long now) => !unavailable && recorded && now >= nextPollAt && kind != FeedbackKind.Error;
        public void PollIssued(long now) { nextPollAt = now + (kind == FeedbackKind.Recording ? PollRecordingMs : PollFollowMs); }

        // status == null is a failed poll (unreachable, malformed or rejected).
        public void OnReply(int replyEpoch,VoiceStatus status,long now)
        {
            if (replyEpoch != epoch || !recorded) return;
            if (status == null || status.Phase == "unavailable") {
                if (status != null || ++failures >= FailureLimit) { unavailable = true; meterOk = false; if (released) Clear(); else Publish(); }
                return;
            }
            failures = 0;
            if (!bound) {
                if (status.Phase == "idle" || status.Phase == "done") return;
                // The companion's conversation must have begun after our press, or it is somebody else's.
                if (now - status.ConvMs < pressAt - BindSlackMs) return;
                bound = true; boundConv = status.Conv;
            } else if (status.Conv != boundConv) {
                // A different conversation took over the companion: nothing of ours is left to show.
                if (released) Clear(); else { meterOk = false; Publish(); }
                return;
            }
            switch (status.Phase) {
                case "recording":
                    if (kind == FeedbackKind.Recording) {
                        meterOk = true; meterAt = now;
                        target = status.LevelAgeMs >= 0 && status.LevelAgeMs <= MeterStaleMs ? Scale(status.Level) : 0;
                    }
                    break;
                case "transcribing": if (released) Show(FeedbackKind.Transcribing,FeedbackText.Transcribing); break;
                case "thinking": if (released) Show(FeedbackKind.Thinking,FeedbackText.Thinking(recipient)); break;
                case "speaking": if (released) Show(FeedbackKind.Speaking,FeedbackText.Speaking(recipient)); break;
                case "error":
                    kind = FeedbackKind.Error; text = FeedbackText.Failure(status.Reason,recipient);
                    errorUntil = now + ErrorShowMs; meterOk = false; target = shown = 0;
                    Publish();
                    break;
                default: // done, idle
                    if (released || kind == FeedbackKind.None) Clear();
                    break;
            }
        }
        void Show(FeedbackKind next,string line)
        {
            if (kind == next && text == line) return;
            kind = next; text = line; Publish();
        }

        // Once per frame: expiry, staleness and level smoothing.
        public void Advance(long now)
        {
            long dt = Math.Max(0,Math.Min(100,now - lastAdvance)); lastAdvance = now;
            if (kind == FeedbackKind.Error && now >= errorUntil) { Clear(); return; }
            if (released && !bound && now - releasedAt > BindWaitMs) { Clear(); return; }
            if (recorded && now - pressAt > FollowMaxMs) { Clear(); return; }
            if (kind == FeedbackKind.Recording && meterOk) {
                if (now - meterAt > MeterHideMs) { meterOk = false; target = 0; }
                else if (now - meterAt > MeterStaleMs) target = 0;
            }
            if (kind == FeedbackKind.Recording) {
                double tau = target > shown ? AttackMs : ReleaseMs;
                shown += (target - shown) * (1.0 - Math.Exp(-dt / tau));
                if (shown < 0.002) shown = 0;
            } else shown = 0;
            Publish();
        }

        void Publish()
        {
            var next = kind == FeedbackKind.None ? FeedbackView.Empty
                : new FeedbackView(kind,text,kind == FeedbackKind.Recording && meterOk,kind == FeedbackKind.Recording ? (float)shown : 0f);
            var old = view;
            if (old.Kind == next.Kind && old.Text == next.Text && old.ShowMeter == next.ShowMeter && Math.Abs(old.Level - next.Level) < 0.001f) return;
            view = next;
        }
    }

    // Where the feedback sits: just below the screen center, in the same screen
    // space the talk-target brackets use, scaled by height so it stays small and
    // readable from 1080p to 4K.
    public struct FeedbackLayout
    {
        public float CenterX, TextY, TextSize, BarX, BarY, BarW, BarH, Border;
    }
    public static class FeedbackGeometry
    {
        public static float Scale(float screenH) => Math.Max(0.75f,Math.Min(3f,screenH / 1080f));
        public static bool TryLayout(float screenW,float screenH,out FeedbackLayout layout)
        {
            layout = default(FeedbackLayout);
            if (screenW < 320f || screenH < 240f) return false;
            float scale = Scale(screenH);
            layout.TextSize = 18f * scale;
            layout.BarW = 240f * scale; layout.BarH = 10f * scale; layout.Border = Math.Max(1f,scale);
            layout.CenterX = screenW * 0.5f;
            layout.BarX = layout.CenterX - layout.BarW * 0.5f;
            layout.BarY = screenH * 0.60f;
            layout.TextY = layout.BarY - layout.TextSize * 1.7f;
            return true;
        }
        // Rough text width, so the line can be centered without querying the font.
        public static float TextWidth(string text,float size) => string.IsNullOrEmpty(text) ? 0f : text.Length * size * 0.5f;
    }
}
