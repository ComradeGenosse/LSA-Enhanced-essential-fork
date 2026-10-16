using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;

// UX4 live microphone meter and conversation status. These drive the real
// TalkTargetInput with a scripted companion; no audio, game or timer is involved.
static partial class Program
{
    const string Ellipsis = "…";
    sealed class FeedbackRig
    {
        public readonly TalkRig Rig;
        public readonly FakeCompanion Voice = new FakeCompanion();
        public readonly FakeCompanion Names = new FakeCompanion();
        public long ConvStart;
        public FeedbackRig(bool attachVoice = true)
        {
            Rig = new TalkRig();
            Rig.Current = FakeBridge.Owned;
            Rig.Bridge.InspectCurrent = () => Rig.Current();
            Rig.Refresh();
            Rig.Talk.AttachCompanion(Names);
            if (attachVoice) Rig.Talk.AttachVoiceStatus(Voice);
        }
        public FeedbackView View => Rig.Talk.Feedback;
        public List<string> Commands => Rig.Bridge.Submitted.Select(item => (string)((Dictionary<string,object>)Json.DeserializeObject(item))["command"]).ToList();
        // Key held past the hold threshold: ptt_start is submitted, no result yet.
        public void Hold() { Rig.Press(); Rig.Elapse(220); ConvStart = Rig.Clock.Monotonic; }
        public void Commit(object start = null) { Rig.Reply(Rig.LastId(),start ?? PromotedStart()); Rig.Frame(1); }
        public void Release() { Rig.Keys.Down.Remove(F10); Rig.Frame(1); }
        public void Finished() { Rig.Reply(Rig.LastId(),new Dictionary<string,object>()); Rig.Frame(1); } // ptt_stop result
        string Body(string phase,long conv,double level,long levelAge,string reason,long? convMs)
        {
            long age = convMs ?? Math.Max(0,Rig.Clock.Monotonic - ConvStart);
            return Json.Serialize(new Dictionary<string,object> {{"v",1},{"conv",conv},{"phase",phase},{"reason",reason},{"phaseMs",50},{"convMs",age},{"level",level},{"levelAgeMs",levelAge < 0 ? null : (object)levelAge}});
        }
        // Frames until the next voice_status request is out (the poll interval), then answer it.
        public void Answer(string phase,long conv = 1,double level = 0,long levelAge = 20,string reason = null,long? convMs = null)
        {
            for (int index = 0; index < 40 && Voice.Pending == 0; index++) Rig.Frame(1);
            Check(Voice.Pending > 0,"a voice_status request was due");
            Voice.Reply(true,body: Body(phase,conv,level,levelAge,reason,convMs));
            Rig.Frame(1);
        }
        // A live companion: answers every request as it falls due, for ms of game time.
        public void Feed(double level,int ms,long levelAge = 20,string phase = "recording",long conv = 1)
        {
            for (int elapsed = 0; elapsed < ms; elapsed += 10) {
                if (Voice.Pending > 0) Voice.Reply(true,body: Body(phase,conv,level,levelAge,null,null));
                Rig.Frame(1);
            }
        }
        public void Settle(int frames = 20) => Rig.Frame(frames);
        public void Quiet(int ms) { for (int index = 0; index < ms / 10; index++) Rig.Frame(1); }
    }
    static void FeedbackTests()
    {
        ScaleParseAndTextTests();
        RecordingLifecycleTests();
        MeterSamplesTests();
        RapidAndSupersededTests();
        MissingLevelDataTests();
        PipelineAndTerminalTests();
    }

    static void ScaleParseAndTextTests()
    {
        Check(TalkFeedback.Scale(0) == 0f && TalkFeedback.Scale(double.NaN) == 0f && TalkFeedback.Scale(-1) == 0f,"no signal is an empty bar");
        Check(TalkFeedback.Scale(1.0) == 1f && TalkFeedback.Scale(0.5) > 0.99f,"full-scale peaks fill the bar");
        Check(Math.Abs(TalkFeedback.Scale(0.1) - 0.667f) < 0.01f && TalkFeedback.Scale(0.01) < TalkFeedback.Scale(0.1) && TalkFeedback.Scale(0.001) < TalkFeedback.Scale(0.01),"the bar is a dB scale: quieter speech reads lower, in order");
        Check(TalkFeedback.Scale(0.001) == 0f || TalkFeedback.Scale(0.001) < 0.1f,"room noise stays near the floor");

        var ok = VoiceStatus.Parse("{\"v\":1,\"conv\":3,\"phase\":\"recording\",\"reason\":null,\"phaseMs\":40,\"convMs\":90,\"level\":0.25,\"levelAgeMs\":20}");
        Check(ok != null && ok.Phase == "recording" && ok.Conv == 3 && ok.ConvMs == 90 && Math.Abs(ok.Level - 0.25) < 1e-9 && ok.LevelAgeMs == 20 && ok.Reason == null,"a well-formed status parses");
        Check(VoiceStatus.Parse("{\"v\":1,\"phase\":\"idle\",\"conv\":0,\"level\":0,\"levelAgeMs\":null}").LevelAgeMs == -1,"no chunk yet is not a zero-age signal");
        Check(VoiceStatus.Parse("{\"v\":1,\"phase\":\"error\",\"reason\":\"stt_error\",\"conv\":1}").Reason == "stt_error","a bounded reason code is kept");
        Check(VoiceStatus.Parse("{\"v\":1,\"phase\":\"error\",\"reason\":\"Not A Code\\nx\",\"conv\":1}").Reason == null,"an unbounded reason is dropped");
        Check(VoiceStatus.Parse("{\"v\":1,\"phase\":\"recording\",\"level\":9}").Level == 1.0 && VoiceStatus.Parse("{\"v\":1,\"phase\":\"recording\",\"level\":-3}").Level == 0.0,"levels are clamped");
        foreach (var bad in new[] {null,"","{not json","[]","{\"v\":2,\"phase\":\"idle\"}","{\"phase\":\"idle\"}","{\"v\":1,\"phase\":\"bogus\"}","{\"v\":1,\"phase\":7}","{\"v\":1}","\"idle\"",new string('x',2000)})
            Check(VoiceStatus.Parse(bad) == null,"a malformed status is rejected whole: " + (bad == null ? "null" : bad.Length > 40 ? "long" : bad));

        Check(FeedbackText.Failure("stt_error","Nathan") == "Couldn't transcribe your speech" && FeedbackText.Failure("model_error","Nathan") == "Nathan couldn't respond" && FeedbackText.Failure("provider_timeout",null) == "Request timed out","pipeline failures read as plain reasons");
        Check(FeedbackText.Failure("whatever",null) == "Conversation failed" && FeedbackText.Failure(null,null) == "Conversation failed","an unknown reason is still a meaningful, bounded line");
        Check(FeedbackText.StartFailure("mic_busy") == "Microphone busy" && FeedbackText.StartFailure("target_lost") == "Target lost" && FeedbackText.StartFailure(null) == "Couldn't start microphone","start refusals map to plain reasons");

        bool hdOk = FeedbackGeometry.TryLayout(1920,1080,out var hd), uhdOk = FeedbackGeometry.TryLayout(3840,2160,out var uhd);
        Check(hdOk && uhdOk,"layout exists at 1080p and 4K");
        Check(Math.Abs(uhd.BarW - hd.BarW * 2f) < 0.01f && Math.Abs(uhd.TextSize - hd.TextSize * 2f) < 0.01f,"the meter scales with screen height so it stays readable at 4K");
        Check(hd.BarW / 1920f < 0.15f && uhd.BarW / 3840f < 0.15f && hd.BarX > 0 && hd.BarX + hd.BarW < 1920 && hd.TextY > 0 && hd.TextY < hd.BarY,"the meter is small, on screen and under its label");
        FeedbackLayout none;
        Check(!FeedbackGeometry.TryLayout(0,0,out none) && !FeedbackGeometry.TryLayout(100,100,out none),"no layout without a usable screen");
    }

    static void RecordingLifecycleTests()
    {
        var f = new FeedbackRig();
        f.Rig.Press();
        Check(f.View.Kind == FeedbackKind.None,"a press alone shows nothing: it may still be a tap");
        f.Rig.Elapse(100);
        Check(f.View.Kind == FeedbackKind.None && f.Voice.Bodies.Count == 0,"holding below the threshold is not recording");
        f.Rig.Elapse(120); f.ConvStart = f.Rig.Clock.Monotonic;
        Check(f.Rig.Talk.State == "start_pending" && f.View.Kind == FeedbackKind.Starting && f.View.Text == "Starting microphone" + Ellipsis && !f.View.ShowMeter,"past the hold threshold the line says the microphone is starting, with no meter");
        Check(f.Commands.Contains("talk.ptt_start") && f.Voice.Bodies.Count == 0,"the microphone start is already submitted and no status request exists yet: the meter never delays it");
        f.Commit();
        Check(f.Rig.Talk.State == "talking" && f.View.Kind == FeedbackKind.Recording && f.View.Text == "Talking to: Promoted NPC" && !f.View.ShowMeter,"committed: the recipient is shown, but no bar until real audio is reported");
        Check(f.Voice.Pending == 1 && f.Voice.Last["action"] as string == "voice_status" && f.Voice.Timeouts[0] <= 1000,"one short voice_status request, made off the talk path");
        f.Answer("recording",level: 0.1);
        Check(f.View.ShowMeter && f.View.Kind == FeedbackKind.Recording,"the bar appears once the companion reports the recording");
        Check(f.Voice.Pending <= 1,"only one request is ever in flight");

        f.Rig.Keys.Down.Remove(F10); f.Rig.Frame(1);
        Check(f.View.Kind == FeedbackKind.None && !f.View.ShowMeter && f.View.Level == 0f,"live levels stop the moment recording stops");
        Check(f.Commands.Last() == "talk.ptt_stop" && f.Rig.Talk.State == "idle","the stop is submitted exactly as before");
        // A reply for the recording that was already in flight cannot bring the bar back.
        if (f.Voice.Pending > 0) { f.Voice.Reply(true,body: "{\"v\":1,\"conv\":1,\"phase\":\"recording\",\"convMs\":300,\"level\":0.9,\"levelAgeMs\":10}"); f.Rig.Frame(1); }
        Check(!f.View.ShowMeter && f.View.Kind == FeedbackKind.None,"a late recording status after release shows no meter");
        var starts = f.Commands.Count(command => command == "talk.ptt_start");
        Check(starts == 1 && f.Commands.Count(command => command == "talk.ptt_stop") == 1,"one start and one stop for one conversation");
    }

    static void MeterSamplesTests()
    {
        var f = new FeedbackRig();
        f.Hold(); f.Commit();
        f.Feed(0,300);
        Check(f.View.ShowMeter && f.View.Level == 0f,"real silence is a visible, empty bar");
        f.Answer("recording",level: 0.1,levelAge: 20);
        float after1 = f.View.Level;
        f.Feed(0.1,300);
        Check(after1 > 0f && after1 < f.View.Level && Math.Abs(f.View.Level - 0.667f) < 0.03f,"the bar rises toward the measured level instead of jumping: " + after1 + " -> " + f.View.Level);
        float mid = f.View.Level;
        f.Feed(0.01,60);
        Check(f.View.Level < mid && f.View.Level > TalkFeedback.Scale(0.01) + 0.03f,"it falls gradually, so it doesn't flicker: " + mid + " -> " + f.View.Level);
        f.Feed(0.01,600);
        Check(Math.Abs(f.View.Level - TalkFeedback.Scale(0.01)) < 0.03f,"and settles on the new level");
        f.Feed(0.3,300);
        float loud = f.View.Level;
        f.Feed(0.03,600);
        Check(loud > f.View.Level && loud > 0.85f,"louder speech reads higher than quieter speech");

        f.Feed(0.5,600,levelAge: 900);
        Check(f.View.ShowMeter && f.View.Level < 0.02f,"a stale level (no new chunks) decays to empty: no signal is never faked");
        f.Feed(0.5,600,levelAge: -1);
        Check(f.View.ShowMeter && f.View.Level < 0.005f,"recording but no chunk yet reads empty");
        f.Feed(0.1,300);
        Check(f.View.Level > 0.5f,"it recovers when audio resumes");

        // The bar's source is only the companion reply: the key state alone never moves it.
        var idle = new FeedbackRig();
        idle.Hold(); idle.Commit(); idle.Quiet(300);
        Check(idle.View.Kind == FeedbackKind.Recording && idle.View.Level == 0f && !idle.View.ShowMeter,"holding the key without any level data never shows or moves the bar");
        // Replies that stop coming (slow or hung companion) hide the bar rather than freezing it.
        var hung = new FeedbackRig();
        hung.Hold(); hung.Commit(); hung.Feed(0.2,300);
        Check(hung.View.ShowMeter && hung.View.Level > 0.5f,"the bar follows replies");
        hung.Quiet(1300);
        Check(hung.View.Kind == FeedbackKind.Recording && !hung.View.ShowMeter,"replies that stop arriving hide the bar instead of freezing it");
    }

    static void RapidAndSupersededTests()
    {
        // Taps never flash anything and never touch the companion.
        var taps = new FeedbackRig();
        for (int index = 0; index < 4; index++) {
            taps.Rig.Press(); taps.Rig.Elapse(60); taps.Rig.Keys.Down.Remove(F10); taps.Rig.Frame(2);
            Check(taps.View.Kind == FeedbackKind.None,"a tap leaves no indicator");
        }
        Check(taps.Voice.Bodies.Count == 0 && !taps.Commands.Contains("talk.ptt_start"),"taps start no microphone and no polling");

        // Released before the native commit result: nothing to follow, and a late start stays invisible.
        var early = new FeedbackRig();
        early.Hold();
        Check(early.View.Kind == FeedbackKind.Starting,"starting is shown while the commit is pending");
        early.Release();
        Check(early.View.Kind == FeedbackKind.None,"releasing before the commit clears 'starting' at once");
        early.Rig.Reply(early.Rig.Bridge.Submitted.Select(item => (Dictionary<string,object>)Json.DeserializeObject(item)).First(item => (string)item["command"] == "talk.ptt_start")["id"] as string,StartedReply("promoted","owner_verified"));
        early.Rig.Frame(3); early.Quiet(500);
        Check(early.View.Kind == FeedbackKind.None && early.Voice.Bodies.Count == 0,"a start that lost the race is never shown or followed");

        // A refused start shows its reason briefly, then clears.
        var changed = new FeedbackRig();
        changed.Hold();
        changed.Rig.Reply(changed.Rig.LastId(),null,"target_changed"); changed.Rig.Frame(1);
        Check(changed.View.Kind == FeedbackKind.Error && changed.View.Text == "Target changed" && !changed.View.ShowMeter,"a target change during the start is reported with its reason");
        changed.Quiet(2400);
        Check(changed.View.Kind == FeedbackKind.Error,"the error stays long enough to read");
        changed.Quiet(300);
        Check(changed.View.Kind == FeedbackKind.None && changed.Voice.Bodies.Count == 0,"and then clears without ever polling");
        var busy = new FeedbackRig();
        busy.Hold(); busy.Rig.Reply(busy.Rig.LastId(),null,"mic_busy"); busy.Rig.Frame(1);
        Check(busy.View.Text == "Microphone busy","a busy microphone says so");

        // A new press supersedes a conversation that is still being processed.
        var f = new FeedbackRig();
        f.Hold(); f.Commit(); f.Answer("recording",level: 0.1);
        f.Release(); f.Finished();
        f.Answer("transcribing");
        Check(f.View.Kind == FeedbackKind.Transcribing && f.View.Text == "Transcribing" + Ellipsis,"the first conversation is being transcribed");
        for (int index = 0; index < 40 && f.Voice.Pending == 0; index++) f.Rig.Frame(1); // an old-epoch request is in flight
        Check(f.Voice.Pending == 1,"a status request for the first conversation is outstanding");
        f.Rig.Press(); f.Rig.Elapse(220);
        Check(f.View.Kind == FeedbackKind.Starting && f.View.Text == "Starting microphone" + Ellipsis,"the new press replaces the old processing line at once");
        long newStart = f.Rig.Clock.Monotonic;
        f.Voice.Reply(true,body: "{\"v\":1,\"conv\":1,\"phase\":\"speaking\",\"convMs\":900,\"level\":0,\"levelAgeMs\":null}"); f.Rig.Frame(1);
        Check(f.View.Kind == FeedbackKind.Starting,"a reply that belongs to the superseded conversation is ignored");
        f.ConvStart = newStart; f.Commit();
        f.Answer("speaking",conv: 1,convMs: 5000); // the old conversation is still speaking in the companion
        Check(f.View.Kind == FeedbackKind.Recording && !f.View.ShowMeter,"an older conversation's phases are never shown for the new press");
        f.Answer("recording",conv: 2,level: 0.1);
        Check(f.View.Kind == FeedbackKind.Recording && f.View.ShowMeter,"the new conversation is bound once the companion starts it");
        f.Answer("recording",conv: 3,level: 0.1);
        Check(!f.View.ShowMeter,"another conversation taking over the companion hides the meter");

        // Clearing the target hides everything and stops polling.
        var cleared = new FeedbackRig();
        cleared.Hold(); cleared.Commit(); cleared.Answer("recording",level: 0.1); cleared.Release(); cleared.Finished();
        cleared.Answer("thinking");
        Check(cleared.View.Kind == FeedbackKind.Thinking,"thinking is shown");
        cleared.Rig.Talk.Clear("manual"); cleared.Rig.Frame(1);
        int polls = cleared.Voice.Bodies.Count;
        cleared.Quiet(600);
        Check(cleared.View.Kind == FeedbackKind.None && cleared.Voice.Bodies.Count == polls,"clearing the talk target clears the indicator and stops polling");
        var disabled = new FeedbackRig();
        disabled.Hold(); disabled.Commit(); disabled.Rig.Talk.Stop(); disabled.Rig.Frame(1);
        Check(disabled.View.Kind == FeedbackKind.None && !disabled.Rig.Talk.Feedback.ShowMeter,"stopping the input hides the indicator");
    }

    static void MissingLevelDataTests()
    {
        // The same presses with and without any voice companion produce the same native commands.
        var plain = new FeedbackRig(attachVoice: false);
        plain.Hold(); plain.Commit();
        Check(plain.View.Kind == FeedbackKind.Recording && plain.View.Text == "Talking to: Promoted NPC" && !plain.View.ShowMeter,"without a status source the label still shows and the meter stays off");
        plain.Quiet(300);
        plain.Release();
        Check(plain.View.Kind == FeedbackKind.None && plain.Commands.SequenceEqual(new[] {"talk.ptt_start","talk.ptt_stop"}) && plain.Voice.Bodies.Count == 0,"with the meter unavailable, the conversation commands are unchanged");
        plain.Quiet(5000);
        Check(plain.View.Kind == FeedbackKind.None && !plain.Rig.Talk.Feedback.ShowMeter,"nothing lingers after release");

        var withMeter = new FeedbackRig();
        withMeter.Hold(); withMeter.Commit(); withMeter.Release();
        Check(withMeter.Commands.Take(2).SequenceEqual(plain.Commands),"the meter adds no native command and changes none");

        // Unreachable companion: three failures turn the meter off, the talk goes on.
        var down = new FeedbackRig();
        down.Hold(); down.Commit();
        for (int attempt = 0; attempt < 3; attempt++) {
            for (int index = 0; index < 40 && down.Voice.Pending == 0; index++) down.Rig.Frame(1);
            Check(down.Voice.Pending == 1,"poll attempt " + attempt);
            down.Voice.Unreachable(); down.Rig.Frame(1);
        }
        Check(down.Rig.Talk.State == "talking" && down.View.Kind == FeedbackKind.Recording && !down.View.ShowMeter,"the label stays, the meter is off");
        down.Quiet(800);
        Check(down.Voice.Pending == 0 && down.Voice.Bodies.Count == 3,"after the failure limit it stops asking for this press");
        down.Release();
        Check(down.Commands.Last() == "talk.ptt_stop" && down.View.Kind == FeedbackKind.None && down.Rig.Talk.State == "idle","release and stop are unaffected");
        // The next press tries again.
        down.Finished();
        down.Hold(); down.Commit();
        Check(down.Voice.Pending == 1 || down.Voice.Bodies.Count == 4,"a new press probes the companion again");

        // Garbage, rejections and the explicit 'unavailable' phase all disable the meter without touching the talk.
        foreach (var body in new[] {"{not json","{\"v\":1,\"phase\":\"bogus\"}","{\"v\":9,\"phase\":\"idle\"}","[]"}) {
            var odd = new FeedbackRig();
            odd.Hold(); odd.Commit();
            for (int attempt = 0; attempt < 3; attempt++) {
                for (int index = 0; index < 40 && odd.Voice.Pending == 0; index++) odd.Rig.Frame(1);
                odd.Voice.Reply(true,body: body); odd.Rig.Frame(1);
            }
            Check(!odd.View.ShowMeter && odd.Rig.Talk.State == "talking","an unusable status never shows a meter: " + body);
        }
        var rejected = new FeedbackRig();
        rejected.Hold(); rejected.Commit();
        for (int attempt = 0; attempt < 3; attempt++) {
            for (int index = 0; index < 40 && rejected.Voice.Pending == 0; index++) rejected.Rig.Frame(1);
            rejected.Voice.Reply(false,"invalid_editor_action"); rejected.Rig.Frame(1);
        }
        Check(rejected.Voice.Pending == 0 && !rejected.View.ShowMeter && rejected.Rig.Talk.State == "talking","a companion that rejects the action disables the meter only");
        var old = new FeedbackRig();
        old.Hold(); old.Commit();
        for (int index = 0; index < 40 && old.Voice.Pending == 0; index++) old.Rig.Frame(1);
        old.Voice.Reply(true,body: "{\"v\":1,\"phase\":\"unavailable\"}"); old.Rig.Frame(1); old.Quiet(500);
        Check(old.Voice.Bodies.Count == 1 && !old.View.ShowMeter && old.View.Kind == FeedbackKind.Recording,"a companion without the tracker is asked once");
        old.Release();
        Check(old.View.Kind == FeedbackKind.None,"and the release clears the line, with nothing to follow");
    }

    static void PipelineAndTerminalTests()
    {
        // Success: every line follows a status the companion actually sent.
        var f = new FeedbackRig();
        var seen = new List<string>();
        void Note() { if (f.View.Kind != FeedbackKind.None && (seen.Count == 0 || seen.Last() != f.View.Text)) seen.Add(f.View.Text); }
        f.Hold(); Note(); f.Commit(); Note();
        f.Answer("recording",level: 0.1); Note();
        f.Release(); Note(); f.Finished();
        f.Quiet(150); Note();
        Check(f.View.Kind == FeedbackKind.None,"after release nothing claims a stage the companion hasn't reported");
        f.Answer("transcribing"); Note();
        Check(f.View.Kind == FeedbackKind.Transcribing && f.View.Text == "Transcribing" + Ellipsis && !f.View.ShowMeter,"transcribing, no meter");
        f.Answer("thinking"); Note();
        Check(f.View.Kind == FeedbackKind.Thinking && f.View.Text == "Promoted NPC is thinking" + Ellipsis,"thinking follows an accepted transcript");
        f.Quiet(600); Note();
        Check(f.View.Kind == FeedbackKind.Thinking && !seen.Any(line => line.Contains("speaking")),"it never says speaking before playback started");
        f.Answer("speaking"); Note();
        Check(f.View.Kind == FeedbackKind.Speaking && f.View.Text == "Promoted NPC is speaking" + Ellipsis,"speaking once playback began");
        f.Answer("done"); Note();
        Check(f.View.Kind == FeedbackKind.None,"a finished conversation clears the line");
        int polls = f.Voice.Bodies.Count;
        f.Quiet(1000);
        Check(f.Voice.Bodies.Count == polls,"and polling stops");
        Check(seen.SequenceEqual(new[] {"Starting microphone" + Ellipsis,"Talking to: Promoted NPC","Transcribing" + Ellipsis,"Promoted NPC is thinking" + Ellipsis,"Promoted NPC is speaking" + Ellipsis}),"the whole conversation read in order: " + string.Join(" > ",seen));

        // A verified name replaces the generic label in the overlay too.
        var named = new FeedbackRig();
        named.Hold(); named.Commit();
        named.Names.Reply(true,body: Described("Nathan")); named.Rig.Frame(1);
        Check(named.View.Text == "Talking to: Nathan","the overlay shows the verified recipient name");
        named.Answer("recording",level: 0.1); named.Release(); named.Finished();
        named.Answer("transcribing"); named.Answer("thinking");
        Check(named.View.Text == "Nathan is thinking" + Ellipsis,"status lines use the verified name");
        named.Answer("speaking");
        Check(named.View.Text == "Nathan is speaking" + Ellipsis,"including while speaking");

        // Failures show a bounded reason briefly and clear.
        foreach (var pair in new[] {("stt_error","Couldn't transcribe your speech"),("provider_timeout","Request timed out"),("cancelled","Conversation cancelled"),("model_error","Promoted NPC couldn't respond"),("tts_error","Voice generation failed"),("something_new","Conversation failed")}) {
            var bad = new FeedbackRig();
            bad.Hold(); bad.Commit(); bad.Answer("recording",level: 0.1); bad.Release(); bad.Finished();
            bad.Answer("transcribing");
            bad.Answer("error",reason: pair.Item1);
            Check(bad.View.Kind == FeedbackKind.Error && bad.View.Text == pair.Item2 && !bad.View.ShowMeter,"failure " + pair.Item1 + " reads: " + bad.View.Text);
            int before = bad.Voice.Bodies.Count;
            bad.Quiet(2400);
            Check(bad.View.Kind == FeedbackKind.Error && bad.Voice.Bodies.Count == before,"the error stays readable and stops polling");
            bad.Quiet(300);
            Check(bad.View.Kind == FeedbackKind.None,"then it clears");
        }
        var hostile = new FeedbackRig();
        hostile.Hold(); hostile.Commit(); hostile.Answer("recording"); hostile.Release(); hostile.Finished();
        hostile.Answer("error",reason: "~r~Evil");
        Check(hostile.View.Text == "Conversation failed","a reason outside the code format is never displayed");

        // Cancelled by the player or superseded elsewhere.
        var gone = new FeedbackRig();
        gone.Hold(); gone.Commit(); gone.Answer("recording"); gone.Release(); gone.Finished();
        gone.Answer("thinking");
        gone.Answer("idle");
        Check(gone.View.Kind == FeedbackKind.None,"an idle companion means nothing is left to show");
        var taken = new FeedbackRig();
        taken.Hold(); taken.Commit(); taken.Answer("recording"); taken.Release(); taken.Finished();
        taken.Answer("thinking");
        taken.Answer("recording",conv: 2,convMs: 30);
        Check(taken.View.Kind == FeedbackKind.None,"a newer conversation in the companion clears the old processing line");

        // Never reported: nothing is shown and nothing lingers.
        var silent = new FeedbackRig();
        silent.Hold(); silent.Commit(); silent.Release(); silent.Finished();
        for (int index = 0; index < 10; index++) { if (silent.Voice.Pending > 0) silent.Voice.Reply(true,body: "{\"v\":1,\"conv\":0,\"phase\":\"idle\",\"convMs\":0,\"level\":0,\"levelAgeMs\":null}"); silent.Quiet(450); }
        Check(silent.View.Kind == FeedbackKind.None && !silent.Rig.Talk.Feedback.ShowMeter,"if the companion never reports this conversation, no stage is claimed");
        var stale = new FeedbackRig();
        stale.Hold(); stale.Commit(); stale.Release(); stale.Finished();
        stale.Answer("thinking",conv: 7,convMs: 60000);
        Check(stale.View.Kind == FeedbackKind.None,"a conversation that began before this press is never shown as this one");
        stale.Quiet(4500);
        Check(stale.View.Kind == FeedbackKind.None,"and the follow window ends");
    }
}
