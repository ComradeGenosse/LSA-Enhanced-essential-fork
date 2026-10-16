using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Settings;
using LSA.Enhanced.Ui;

namespace LSA.Enhanced.Input
{
    // Loader-side tap/hold for the talk-target key. It never owns a Ped and never
    // synthesizes Essential's TalkKey. When configured on Essential's own TalkKey,
    // a separate native lease suppresses Essential's duplicate physical poll while
    // UX4 reads the same real key and owns exact-Ped mic start/stop.
    public sealed class TalkTargetInput
    {
        const int StopRetryLimit = 8;
        // How long the generic "Promoted NPC" notice waits for the companion name, and
        // how long a late name may still replace it. A name never delays the mic.
        const int NameWaitMs = 400, NameLifetimeMs = 3000, NameRequestTimeoutMs = 1500;
        static readonly Regex Alias = new Regex("^promoted\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\z");
        // Conservative display set: letters, digits, space and a few name marks. Anything else
        // (including GTA's ~ text codes) falls back to the generic label.
        static readonly Regex DisplayName = new Regex("^[\\p{L}\\p{N}][\\p{L}\\p{N} .'\u2019_-]{0,39}\\z");
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        readonly IKeySource keys;
        readonly IGameState game;
        readonly INativeBridge bridge;
        readonly IClock clock;
        readonly IHud hud;
        readonly Action<string> log;
        readonly JavaScriptSerializer json = new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 6};
        readonly ConcurrentQueue<KeyValuePair<PendingName,Describe>> nameReplies = new ConcurrentQueue<KeyValuePair<PendingName,Describe>>();
        // UX4 conversation feedback (status line and live mic meter). Display only: it reads
        // the native commit result and the companion's voice_status, and never gates,
        // delays or changes the talk path above.
        readonly TalkFeedback feedback = new TalkFeedback();
        readonly ConcurrentQueue<VoiceReply> voiceReplies = new ConcurrentQueue<VoiceReply>();
        const string VoiceStatusBody = "{\"action\":\"voice_status\"}";
        const int VoiceReplyBytes = 512, VoiceTimeoutMs = 800, VoiceStuckMs = 3000;
        ICompanion voiceCompanion;
        int voiceInFlight;
        long voiceInFlightAt;
        sealed class VoiceReply { public int Epoch; public VoiceStatus Status; }
        PendingName name;
        EnhancedSettings settings;
        string state = "idle", selectionId, encounterId, selectId, startId, stopId;
        int generation, pressGeneration, stopRetries, stoppedGeneration;
        long pressAt, cycleUntil, selectionExpiresAt, nextInterest, stopDeadline, nextTalkLeaseRefresh;
        bool enabled, waitRelease, haveSession, startQueued, stopQueued, stopNeeded, sharedEssentialTalk, startExplicit;
        public TalkTargetInput(IKeySource keys,IGameState game,INativeBridge bridge,IClock clock,IHud hud,Action<string> log,Func<NativeSnapshot> snapshot,Func<bool> menuOpen)
        {
            this.keys = keys; this.game = game; this.bridge = bridge; this.clock = clock; this.hud = hud; this.log = log ?? (_ => { });
            Snapshot = snapshot ?? (() => null); MenuOpen = menuOpen ?? (() => false);
        }
        public Func<NativeSnapshot> Snapshot {get;set;}
        public Func<bool> MenuOpen {get;set;}
        // Asks the companion for the profile name of a native-verified promoted owner
        // alias. done may run on any thread and receives null on any failure. Unset
        // keeps the generic labels.
        public Action<string,string,Action<Describe>> NameResolver {get;set;}
        public void AttachCompanion(ICompanion companion)
        {
            NameResolver = companion == null ? (Action<string,string,Action<Describe>>)null : (encounter,alias,done) => {
                var body = new Dictionary<string,object> {{"action","current_describe"},{"encounterId",encounter},{"ownerAlias",alias}};
                companion.Post(new JavaScriptSerializer().Serialize(body),MenuData.DescribeBodyBytes,NameRequestTimeoutMs,reply => done(reply != null && reply.Ok ? Describe.Parse(reply.Body) : null));
            };
        }
        // Without a companion the status line still shows the native stages; the meter
        // and the transcribing/thinking/speaking states stay off.
        public void AttachVoiceStatus(ICompanion companion) { voiceCompanion = companion; }
        public FeedbackView Feedback => feedback.View;
        public string State => state;
        public string Conflict {get;private set;}
        public bool Enabled => enabled;
        public bool NeedsFrame => enabled || sharedEssentialTalk || state != "idle" || stopNeeded || feedback.Active;
        public string DisplayState
        {
            get {
                if (Conflict != null) return "Paused";
                if (!enabled) return "Off";
                switch (state) {
                    case "pending": return "Selecting";
                    case "start_pending": return "Commit pending";
                    case "talking": return "Talking";
                    default: return "On";
                }
            }
        }
        public void Apply(EnhancedSettings next,EssentialBindings essential)
        {
            bool active = state == "pending" || state == "start_pending" || state == "talking" || stopNeeded;
            DropName();
            settings = next;
            Conflict = null;
            if (active) Finish("settings");
            ReleaseSharedTalk();
            if (next == null || !next.TalkEnabled || next.TalkKeyCode == 0) { enabled = false; state = "idle"; waitRelease = true; haveSession = false; selectionId = encounterId = null; selectionExpiresAt = cycleUntil = 0; feedback.Reset(); return; }

            var matches = essential?.All.Where(item => item.State == EssentialKeyState.Bound && item.Vk == next.TalkKeyCode).ToArray();
            var other = matches?.FirstOrDefault(item => item.Setting != "TalkKey");
            if (other != null) {
                enabled = false; state = "suspended";
                Conflict = PhysicalKeys.Name(next.TalkKeyCode) + " is also Essential's " + other.Setting;
                log("[UX4] talk_target suspended reason=key_conflict");
                waitRelease = true; return;
            }

            sharedEssentialTalk = matches != null && matches.Any(item => item.Setting == "TalkKey");
            if (sharedEssentialTalk && !AcquireSharedTalk(clock.Monotonic)) {
                enabled = false; state = "suspended";
                Conflict = "Essential Talk interception unavailable";
                log("[UX4] talk_target suspended reason=talk_interception_unavailable");
                waitRelease = true; return;
            }

            enabled = true; state = "idle";
            waitRelease = keys.IsDown(next.TalkKeyCode);
            log("[UX4] talk_target input=ready key=" + PhysicalKeys.Name(next.TalkKeyCode) + " mode=" + (sharedEssentialTalk ? "shared_essential" : "neutral"));
        }
        public void Tick()
        {
            try { TickCore(); }
            finally { UpdateFeedback(); }
        }
        void TickCore()
        {
            Poll();
            if (stopNeeded && !stopQueued) SubmitStop();
            long now = clock.Monotonic;

            if (sharedEssentialTalk && now >= nextTalkLeaseRefresh) {
                if (!AcquireSharedTalk(now)) {
                    if (enabled) Abort("talk_interception",Down());
                    enabled = false; state = "suspended"; Conflict = "Essential Talk interception unavailable";
                    log("[UX4] talk_target suspended reason=talk_interception_unavailable");
                    return;
                }
                if (!enabled) {
                    enabled = true; state = "idle"; Conflict = null; waitRelease = Down();
                    log("[UX4] talk_target interception=recovered");
                }
            }

            if (!enabled) return;
            bool down = Down();
            if (now >= nextInterest) { bridge.RequestSnapshots(1500); nextInterest = now + 1000; }
            if (waitRelease) { if (!down) waitRelease = false; else return; }
            string block = Blocked();
            if (block != null) { Abort(block,down); return; }
            switch (state) {
                case "idle":
                    if (down && !stopNeeded && !stopQueued) { state = "pending"; pressAt = now; }
                    break;
                case "pending":
                    if (!down) { Tap(); state = "idle"; }
                    else if (now - pressAt >= settings.TalkHoldMs) BeginHold(now);
                    break;
                case "start_pending":
                case "talking":
                    if (!down) Finish("release");
                    break;
            }
        }
        public void Clear(string reason)
        {
            DropName();
            Finish(reason ?? "manual");
            haveSession = false; selectionId = encounterId = null; cycleUntil = selectionExpiresAt = 0;
            Submit("talk.clear",0,false);
            state = "idle"; waitRelease = enabled && Down();
            feedback.Reset();
        }
        public void Stop() { DropName(); enabled = false; Finish("shutdown"); ReleaseSharedTalk(); haveSession = false; selectionId = encounterId = null; state = "idle"; feedback.Reset(); }
        public void Cancel(string reason) { Abort(reason ?? "tick",Down()); }

        bool AcquireSharedTalk(long now)
        {
            if (!sharedEssentialTalk) return true;
            bool leased = (bridge as IEssentialInputBridge)?.LeaseTalkInput(settings?.TalkKeyCode ?? 0) == true;
            nextTalkLeaseRefresh = now + (leased ? 250 : 1000);
            return leased;
        }

        void ReleaseSharedTalk()
        {
            if (sharedEssentialTalk) {
                try { (bridge as IEssentialInputBridge)?.ReleaseTalkInput(); } catch { }
            }
            sharedEssentialTalk = false;
            nextTalkLeaseRefresh = 0;
        }

        void BeginHold(long now)
        {
            pressGeneration = ++generation;
            if (generation > 1000000) generation = pressGeneration = 1;
            if (stopNeeded || stopQueued) { state = "idle"; waitRelease = true; return; }
            startQueued = false; stopRetries = 0;
            bool explicitTarget = haveSession && selectionId != null && now < selectionExpiresAt;
            startExplicit = explicitTarget;
            string id = Submit("talk.ptt_start",pressGeneration,!explicitTarget);
            if (id == null) { state = "idle"; waitRelease = true; hud.Show(bridge.Available ? "Talk targeting unavailable" : "LSA native host is unavailable"); feedback.Fail(now,bridge.Available ? "Talk targeting unavailable" : "LSA native host is unavailable"); return; }
            startId = id; startQueued = true; state = "start_pending";
            feedback.Begin(now);
        }
        void Tap()
        {
            bool cycle = haveSession && clock.Monotonic < cycleUntil;
            haveSession = true;
            selectId = Submit(cycle ? "talk.select_next" : "talk.select_first",0,false);
        }
        string Submit(string command,int pttGeneration,bool selectFirst)
        {
            if (settings == null) return null;
            string id = CommandEnvelope.NewId();
            string expectedSelection = command == "talk.ptt_start" && !selectFirst ? selectionId : null;
            string expectedEncounter = expectedSelection != null ? encounterId : null;
            string reply = bridge.Submit(Build(id,command,expectedSelection,expectedEncounter,pttGeneration,selectFirst));
            if (reply != "accepted") { if (command == "talk.ptt_start") log("[UX4] talk_ptt commit=rejected reason=" + (reply ?? "native_unavailable")); return null; }
            return id;
        }
        void Finish(string reason)
        {
            DropName();
            feedback.Released(clock.Monotonic);
            if (state == "pending") { state = "idle"; waitRelease = true; return; }
            if ((startQueued || state == "talking" || state == "start_pending") && !stopNeeded) {
                stopNeeded = true; stoppedGeneration = pressGeneration; stopRetries = 0; SubmitStop();
                log("[UX4] talk_ptt end reason=" + reason);
            }
            state = "idle"; waitRelease = true;
        }
        void Abort(string reason,bool down)
        {
            if (state == "pending") { state = "idle"; waitRelease = down; return; }
            if (state == "start_pending" || state == "talking" || stopNeeded) Finish(reason);
            else waitRelease = down;
        }
        void SubmitStop()
        {
            if (!stopNeeded || settings == null || pressGeneration == 0) { stopNeeded = false; return; }
            if (stopRetries >= StopRetryLimit) { stopNeeded = false; stopQueued = false; log("[UX4] talk_ptt end reason=stop_abandoned generation=" + pressGeneration); return; }
            stopRetries++;
            string id = Submit("talk.ptt_stop",pressGeneration,false);
            if (id == null) { stopQueued = false; stopDeadline = clock.Monotonic + 250; return; }
            stopId = id; stopQueued = true; stopDeadline = clock.Monotonic + 4500;
        }
        void Poll()
        {
            PollSelect();
            PollStart();
            PollName();
            PollStop();
            if (stopNeeded && !stopQueued && clock.Monotonic >= stopDeadline) SubmitStop();
        }
        void PollSelect()
        {
            if (selectId == null) return;
            var result = Take(selectId);
            if (result == null) return;
            selectId = null;
            if (result.Status != "ok" || result.Body == null || !(result.Body.TryGetValue("present",out var present) && present is bool selected && selected)) {
                haveSession = false; selectionId = encounterId = null;
                string reason = result.Body != null && result.Body.TryGetValue("reason",out var code) ? code as string : result.Reason;
                if (reason == "no_nearby_npc") hud.Show("No nearby NPC");
                else if (reason == "selector_unavailable") hud.Show("Talk targeting unavailable");
                return;
            }
            string id = result.Body.TryGetValue("selectionId",out var selection) ? selection as string : null;
            if (id == null || !Uuid.IsMatch(id)) { haveSession = false; return; }
            selectionId = id; haveSession = true;
            encounterId = result.Body.TryGetValue("encounterId",out var encounter) && encounter is string text && Uuid.IsMatch(text) ? text : null;
            cycleUntil = clock.Monotonic + (settings?.TalkCycleWindowMs ?? 1500);
            selectionExpiresAt = clock.Monotonic + (settings?.TalkSelectionTimeoutMs ?? 8000);
            int index = Number(result.Body,"cycleIndex"), count = Number(result.Body,"cycleCount");
            if (index > 0 && count > 0) hud.Show("Target " + index + "/" + count + PreviewSuffix(RecipientKind(result.Body)));
        }
        void PollStart()
        {
            if (startId == null) return;
            var result = Take(startId);
            if (result == null) return;
            startId = null;
            bool started = result.Status == "ok" && result.Body != null && result.Body.TryGetValue("started",out var flag) && flag is bool yes && yes;
            if (started) {
                if (startExplicit) {
                    if (result.Body.TryGetValue("selectionId",out var selection) && selection is string id && Uuid.IsMatch(id)) {
                        selectionId = id; haveSession = true;
                        selectionExpiresAt = clock.Monotonic + (settings?.TalkSelectionTimeoutMs ?? 8000);
                    }
                    if (result.Body.TryGetValue("encounterId",out var encounter) && encounter is string text && Uuid.IsMatch(text)) encounterId = text;
                } else {
                    haveSession = false; selectionId = encounterId = null; cycleUntil = selectionExpiresAt = 0;
                }
                name = null; // a previous generation's pending name can never apply to this commit
                long latency = clock.Monotonic - pressAt;
                if (latency >= 0 && latency < 10000) log("[UX4] talk_ptt begin latencyMs=" + latency);
                if (state == "start_pending" && Down() && !stopNeeded) { state = "talking"; AnnounceRecipient(result.Body); feedback.Recording(clock.Monotonic); }
                else if (stoppedGeneration != pressGeneration) Finish("late_start");
                return;
            }
            startQueued = false;
            string reason = result.Reason ?? (result.Body != null && result.Body.TryGetValue("reason",out var code) ? code as string : null);
            if (reason == "target_lost" || reason == "no_nearby_npc") { haveSession = false; selectionId = encounterId = null; hud.Show(reason == "no_nearby_npc" ? "No nearby NPC" : "Target lost"); }
            else if (reason == "target_changed") { haveSession = false; selectionId = encounterId = null; hud.Show("Target changed"); }
            else if (reason == "selector_unavailable") hud.Show("Talk targeting unavailable");
            if (state == "start_pending") { state = "idle"; waitRelease = true; feedback.Fail(clock.Monotonic,FeedbackText.StartFailure(reason)); }
        }
        // One notice per committed start, from the native result for the exact ped
        // the mic was opened on. A start that was released, rejected, lost or
        // taken over never reaches here. The kind is display-only: it is matched
        // against a fixed allowlist. A promoted recipient may be upgraded to the
        // profile name by PollName, but only after the native-verified owner alias
        // resolves to exactly one companion profile and the live snapshot agrees.
        void AnnounceRecipient(Dictionary<string,object> body)
        {
            string kind = RecipientKind(body);
            if (kind == null) return;
            string evidence = body.TryGetValue("recipientEvidence",out var code) ? code as string : null;
            log("[UX4] talk_ptt recipient kind=" + kind + (evidence != null && Regex.IsMatch(evidence,"^[a-z][a-z0-9_]{0,31}$") ? " evidence=" + evidence : ""));
            // The overlay label never waits on the name lookup: it starts generic and may upgrade once.
            feedback.SetRecipient(GenericName(kind));
            if (kind == "promoted" && BeginNameLookup(body)) return;
            ShowGeneric(kind);
        }
        static string GenericName(string kind) => kind == "promoted" ? "Promoted NPC" : kind == "ambient" ? "Nearby NPC" : "NPC";
        void ShowGeneric(string kind) =>
            hud.Show(kind == "promoted" ? "Talking to: Promoted NPC" : kind == "ambient" ? "Talking to: Nearby NPC" : "Talking to: NPC (identity unavailable)");
        // True when a lookup is in flight; the generic notice then waits up to NameWaitMs.
        bool BeginNameLookup(Dictionary<string,object> body)
        {
            var resolver = NameResolver;
            string alias = body.TryGetValue("recipientAlias",out var rawAlias) ? rawAlias as string : null;
            string encounter = body.TryGetValue("encounterId",out var rawEncounter) ? rawEncounter as string : null;
            string pedId = body.TryGetValue("pedId",out var rawPed) ? rawPed as string : null;
            if (resolver == null || alias == null || !Alias.IsMatch(alias) || encounter == null || !Uuid.IsMatch(encounter)
                || pedId == null || !Regex.IsMatch(pedId,@"^[0-9]{1,12}$")) return false;
            long now = clock.Monotonic;
            var pending = new PendingName {Generation = pressGeneration,Encounter = encounter,Alias = alias,PedId = pedId,GenericAt = now + NameWaitMs,ExpiresAt = now + NameLifetimeMs};
            try { resolver(encounter,alias,reply => nameReplies.Enqueue(new KeyValuePair<PendingName,Describe>(pending,reply))); }
            catch { return false; }
            name = pending;
            return true;
        }
        // Do not trust a cached registration: P1 may retire ownership during
        // the companion name lookup. Verify once against native current.inspect
        // AFTER the name resolves, on Core's fiber, without touching the mic.
        void PollName()
        {
            while (nameReplies.TryDequeue(out var item))
                if (ReferenceEquals(item.Key,name)) { name.Replied = true; name.Reply = item.Value; }
            if (name == null) return;
            long now = clock.Monotonic;
            if (state != "talking" || stopNeeded || name.Generation != pressGeneration || now >= name.ExpiresAt) { DropName(); return; }
            string display = name.Replied ? DisplayOf(name.Reply) : null;
            if (display != null && !name.InspectStarted) {
                name.InspectStarted = true;
                try {
                    string id = CommandEnvelope.NewId();
                    name.InspectId = bridge.Submit(CommandEnvelope.Build(id,"current.inspect","talk_input",clock.Utc)) == "accepted" ? id : null;
                } catch { name.InspectId = null; }
                if (name.InspectId == null) { name.Reply = null; display = null; }
            }
            if (display != null && name.InspectId != null) {
                var result = Take(name.InspectId);
                if (result != null) {
                    name.InspectId = null;
                    if (result.Status == "ok" && CurrentOwnerAgrees(name,result.Body)) {
                        hud.Show("Talking to: " + display);
                        feedback.SetRecipient(display);
                        log("[UX4] talk_ptt recipient_name outcome=shown");
                        name = null;
                        return;
                    }
                    // An unverified, changed or revoked owner is a final denial.
                    name.Reply = null;
                    display = null;
                }
            }
            bool unusable = name.Replied && display == null;
            if (!name.GenericShown && (unusable || now >= name.GenericAt)) {
                name.GenericShown = true;
                ShowGeneric("promoted");
                log("[UX4] talk_ptt recipient_name outcome=" + (unusable ? "unavailable" : "unconfirmed"));
            }
            if (unusable) name = null;
        }
        // The companion must say: this exact alias is one promoted profile with a valid
        // CharacterId and a plain display name.
        static string DisplayOf(Describe reply)
        {
            if (reply == null || reply.Kind != "promoted" || reply.CharacterId == null || reply.Name == null) return null;
            string text = reply.Name.Trim();
            return DisplayName.IsMatch(text) ? text : null;
        }
        // A fresh native current.inspect, not a cached HUD snapshot. ownerVerified
        // is a P1 TryResolveCurrent result tied to this exact P2 encounter.
        static bool CurrentOwnerAgrees(PendingName pending,Dictionary<string,object> body)
        {
            if (body == null) return false;
            bool Has(string key) => body.TryGetValue(key,out var value) && value is bool flag && flag;
            string Field(string key) => body.TryGetValue(key,out var value) ? value as string : null;
            return Has("present") && Has("owned") && Has("ownerVerified") && !Has("suspended")
                && Field("encounterId") == pending.Encounter && Field("ownerAlias") == pending.Alias
                && Field("pedId") == pending.PedId;
        }
        void DropName()
        {
            name = null;
            while (nameReplies.TryDequeue(out _)) { }
        }
        sealed class PendingName
        {
            public int Generation;
            public string Encounter, Alias, PedId, InspectId;
            public long GenericAt, ExpiresAt;
            public bool Replied, GenericShown, InspectStarted;
            public Describe Reply;
        }
        // null when the native reply carries no recipient field (older native);
        // any value outside the allowlist is shown as the generic unknown notice.
        static string RecipientKind(Dictionary<string,object> body)
        {
            if (body == null || !body.TryGetValue("recipientKind",out var raw) || raw == null) return null;
            string kind = raw as string;
            return kind == "promoted" || kind == "ambient" ? kind : "unknown";
        }
        static string PreviewSuffix(string kind) => kind == "promoted" ? " - Promoted NPC" : kind == "ambient" ? " - Nearby NPC" : "";
        void PollStop()
        {
            if (stopId == null) return;
            var result = Take(stopId);
            if (result == null) return;
            stopId = null; stopQueued = false;
            if (result.Status == "ok") { stopNeeded = false; return; }
            stopDeadline = clock.Monotonic + 250;
        }
        sealed class Reply { public string Status, Reason; public Dictionary<string,object> Body; }
        Reply Take(string id)
        {
            string text = bridge.TryTakeResult(id);
            if (text == null) return null;
            try {
                var root = json.DeserializeObject(text) as Dictionary<string,object>;
                if (root == null) return new Reply {Status = "failed",Reason = "native_operation_failed"};
                return new Reply {Status = root.TryGetValue("status",out var status) ? status as string : null,Reason = root.TryGetValue("reason",out var reason) ? reason as string : null,Body = root.TryGetValue("result",out var result) ? result as Dictionary<string,object> : null};
            } catch { return new Reply {Status = "failed",Reason = "native_operation_failed"}; }
        }
        static int Number(Dictionary<string,object> value,string key)
        {
            if (value == null || !value.TryGetValue(key,out var item)) return 0;
            if (item is int number) return number;
            if (item is long wide) return (int)wide;
            if (item is decimal precise) return (int)precise;
            return 0;
        }
        string Build(string id,string command,string expectedSelectionId,string expectedEncounterId,int generation,bool selectFirst)
        {
            var target = new Dictionary<string,object> {{"kind","talk"}};
            if (expectedSelectionId != null) {
                var expect = new Dictionary<string,object> {{"selectionId",expectedSelectionId}};
                if (expectedEncounterId != null) expect["encounterId"] = expectedEncounterId;
                target["expect"] = expect;
            }
            var args = new Dictionary<string,object>();
            if (command == "talk.ptt_stop") args["generation"] = generation;
            else if (command != "talk.clear" && command != "talk.inspect") {
                if (command == "talk.ptt_start") { args["generation"] = generation; args["selectFirst"] = selectFirst; }
                args["radiusMeters"] = (double)settings.TalkRadiusMeters;
                args["retentionRadiusMeters"] = (double)settings.TalkRetentionRadiusMeters;
                args["maxCandidates"] = settings.TalkMaxCandidates;
                args["cycleWindowMs"] = settings.TalkCycleWindowMs;
                args["selectionTimeoutMs"] = settings.TalkSelectionTimeoutMs;
                args["indicator"] = settings.TalkIndicator;
            }
            return new JavaScriptSerializer().Serialize(new Dictionary<string,object> {{"v",1},{"id",id},{"command",command},{"target",target},{"args",args},{"source","talk_input"},{"issuedAtUtc",clock.Utc},{"expiresAtUtc",clock.Utc + CommandEnvelope.LifetimeMs}});
        }
        // Runs at the end of every tick (including early returns), off the talk path.
        // Replies arrive on thread-pool threads and are only queued there.
        void UpdateFeedback()
        {
            try {
                long now = clock.Monotonic;
                while (voiceReplies.TryDequeue(out var reply)) feedback.OnReply(reply.Epoch,reply.Status,now);
                feedback.Advance(now);
                RequestVoiceStatus(now);
            } catch { try { feedback.Reset(); } catch { } }
        }
        void RequestVoiceStatus(long now)
        {
            var companion = voiceCompanion;
            if (companion == null || !feedback.WantsPoll(now)) return;
            if (Volatile.Read(ref voiceInFlight) != 0 && now - voiceInFlightAt < VoiceStuckMs) return;
            Interlocked.Exchange(ref voiceInFlight,1); voiceInFlightAt = now;
            int epoch = feedback.Epoch;
            feedback.PollIssued(now);
            try {
                companion.Post(VoiceStatusBody,VoiceReplyBytes,VoiceTimeoutMs,reply => {
                    Interlocked.Exchange(ref voiceInFlight,0);
                    voiceReplies.Enqueue(new VoiceReply {Epoch = epoch,Status = reply != null && reply.Ok ? VoiceStatus.Parse(reply.Body) : null});
                });
            } catch {
                Interlocked.Exchange(ref voiceInFlight,0);
                voiceReplies.Enqueue(new VoiceReply {Epoch = epoch,Status = null});
            }
        }
        string Blocked()
        {
            if (!keys.GameHasFocus()) return "focus";
            if (MenuOpen()) return "menu";
            return InputGates.Closed(true,game,false,Snapshot(),clock.Utc);
        }
        bool Down() => settings != null && keys.IsDown(settings.TalkKeyCode);
    }
}
