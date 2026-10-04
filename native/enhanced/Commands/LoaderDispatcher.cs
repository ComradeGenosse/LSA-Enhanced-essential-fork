using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;

namespace LSA.Enhanced.Commands
{
    public sealed class CommandArgs
    {
        public string CharacterId, MemoryId, Text, Value, Phrase;
        public long ExpectedRevision;
        public bool Flag;
        // Invoked on the loader fiber with (reason or null, response body or null).
        public Action<string,string> OnDone;
    }
    // Maps catalog commands to their single executor: Essential's keys through the
    // relay, ordinary-NPC asks through the runtime bridge, and character
    // management through the companion. It never decides eligibility for the
    // executor and never touches a ped; results are polled on the loader fiber.
    public sealed class LoaderDispatcher
    {
        public const int BridgeTimeoutMs = 6000, CompanionTimeoutMs = 10000, SummonTimeoutMs = 70000, ProfileBodyBytes = 1024 * 1024, RecentLimit = 10;
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
        static readonly string[] Relationships = {"associate","friend","trusted","strained","neutral"}, Availability = {"available","dead","retired"};
        sealed class Job { public string Key,CommandId,Class,Kind,SuccessText; public long Deadline; public Action<string,string> OnDone; }
        readonly CommandCatalog catalog;
        readonly INativeBridge bridge;
        readonly ICompanion companion;
        readonly IHud hud;
        readonly EssentialKeyRelay relay;
        readonly IClock clock;
        readonly List<Job> jobs = new List<Job>();
        readonly ConcurrentQueue<KeyValuePair<string,CompanionReply>> replies = new ConcurrentQueue<KeyValuePair<string,CompanionReply>>();
        readonly Dictionary<string,long> lastAt = new Dictionary<string,long>();
        readonly Queue<string> recent = new Queue<string>();
        public LoaderDispatcher(CommandCatalog catalog,INativeBridge bridge,ICompanion companion,IHud hud,EssentialKeyRelay relay,IClock clock)
        {
            this.catalog = catalog; this.bridge = bridge; this.companion = companion; this.hud = hud; this.relay = relay; this.clock = clock;
        }
        public Func<EnhancedSettings> Settings = () => null;
        public Func<EssentialBindings> Essential = EssentialBindings.Unavailable;
        public bool InterceptEssentialInput {get;set;}
        public int InterceptMarkKey {get;set;}
        public int InterceptTextKey {get;set;}
        public IUiController Ui;
        public CommandCatalog Catalog => catalog;
        public IReadOnlyList<string> RecentReasons => recent.ToList();
        public int Outstanding => jobs.Count;
        public bool Busy(string commandClass) => jobs.Any(job => job.Class == commandClass);

        public string Dispatch(string commandId,string source,CommandArgs args = null)
        {
            var info = catalog.Get(commandId);
            var settings = Settings();
            if (info == null || settings == null) return Reject(commandId ?? "unknown","unsupported_command",args,false);
            long now = clock.Monotonic;
            // Key relays and menu toggles behave like the player's own key presses.
            // Gesture repeats inside the cooldown are dropped; menu selections are
            // explicit and limited only by one outstanding job per class.
            if (info.Executor != "relay" && info.Executor != "ui") {
                if (source == "chord" && lastAt.TryGetValue(info.Id,out long last) && now - last < settings.CommandCooldownMs) return Reject(info.Id,"cooldown",args,false);
                if (Busy(info.Class)) return Reject(info.Id,"command_busy",args,true);
                lastAt[info.Id] = now;
            }
            switch (info.Executor) {
                case "relay": return Relay(info,settings,args,now);
                case "ui": return ToggleUi(info,args);
                case "loader": return Current(info,source,settings,args);
                case "bridge": return Ask(info,source,args?.Phrase,info.Hud,args,true);
                case "companion": return Companion(info,args);
                default: return Reject(info.Id,"unsupported_command",args,false);
            }
        }
        string Relay(CommandInfo info,EnhancedSettings settings,CommandArgs args,long now)
        {
            var essential = Essential() ?? EssentialBindings.Unavailable();
            var key = info.Id == CommandCatalog.EssentialMark ? essential.Mark : info.Id == CommandCatalog.EssentialText ? essential.Text : null;
            bool intercepted = InterceptEssentialInput && key != null && (key.Vk == InterceptMarkKey || key.Vk == InterceptTextKey);
            string reason = intercepted
                ? key?.State == EssentialKeyState.Bound && (bridge as IEssentialInputBridge)?.PulseInput(key.Vk) == true ? null : "native_operation_failed"
                : relay.Pulse(key,settings.RelayPulseMs,now);
            if (reason != null) return Reject(info.Id,reason,args,true);
            Record(info.Id,null); args?.OnDone?.Invoke(null,null); return null;
        }
        string ToggleUi(CommandInfo info,CommandArgs args)
        {
            if (Ui == null || !Ui.Available) return Reject(info.Id,"menu_unavailable",args,true);
            Ui.Toggle(info.Id == CommandCatalog.UiQuickMenu ? "current" : "main");
            Record(info.Id,null); return null;
        }
        // Current-NPC commands: P2 control for an owned character, otherwise an ask
        // through Essential's own typed turn, otherwise "promote first".
        string Current(CommandInfo info,string source,EnhancedSettings settings,CommandArgs args)
        {
            var npc = CurrentNpc(out string reason);
            if (npc == null) return Reject(info.Id,reason,args,true);
            string operation = info.Id.Substring(info.Id.IndexOf('.') + 1);
            // The companion refuses with target_changed if Essential's current NPC is
            // no longer the one the player saw.
            if (npc.Owned) return StartCompanion(info,Json(new Dictionary<string,object> {{"action","control_current"},{"operation",operation},{"expectedEncounterId",npc.EncounterId}}),CompanionTimeoutMs,0,info.Hud,args);
            string phrase = settings.OrdinaryNpc == "ask" ? settings.Phrase(info.Phrase) : null;
            if (string.IsNullOrEmpty(phrase)) return Reject(info.Id,"promote_first",args,true);
            return StartAsk(info,source,npc.EncounterId,phrase,info.AskHud ?? info.Hud,args);
        }
        CurrentNpc CurrentNpc(out string reason)
        {
            var snapshot = NativeSnapshot.Parse(bridge.Snapshot());
            if (snapshot == null || !snapshot.Fresh(clock.Utc,InputGates.SnapshotMaxAgeMs)) { bridge.RequestSnapshots(1500); reason = "native_unavailable"; return null; }
            if (snapshot.Current == null || !snapshot.Current.Present) { reason = "no_current_npc"; return null; }
            reason = null; return snapshot.Current;
        }
        string Ask(CommandInfo info,string source,string phrase,string successText,CommandArgs args,bool validate)
        {
            if (validate && !EnhancedSettings.ValidPhrase(phrase)) return Reject(info.Id,"invalid_text",args,true);
            var npc = CurrentNpc(out string reason);
            if (npc == null) return Reject(info.Id,reason,args,true);
            return StartAsk(info,source,npc.EncounterId,phrase,successText,args);
        }
        string StartAsk(CommandInfo info,string source,string encounterId,string phrase,string successText,CommandArgs args)
        {
            string id = CommandEnvelope.NewId();
            string reply = bridge.Submit(CommandEnvelope.Build(id,CommandCatalog.NpcAsk,source,clock.Utc,encounterId,phrase));
            if (reply != "accepted") return Reject(info.Id,reply ?? "native_unavailable",args,true);
            jobs.Add(new Job {Key = id,CommandId = info.Id,Class = info.Class,Kind = "bridge",SuccessText = successText,Deadline = clock.Monotonic + BridgeTimeoutMs,OnDone = args?.OnDone});
            return null;
        }
        string Companion(CommandInfo info,CommandArgs args)
        {
            if (info.Id == CommandCatalog.CurrentPromote) {
                var npc = CurrentNpc(out string reason);
                if (npc == null) return Reject(info.Id,reason,args,true);
                return StartCompanion(info,Json(new Dictionary<string,object> {{"action","promote"},{"expectedEncounterId",npc.EncounterId}}),CompanionTimeoutMs,0,info.Hud,args);
            }
            string id = args?.CharacterId;
            if (id == null || !Uuid.IsMatch(id)) return Reject(info.Id,"character_missing",args,true);
            switch (info.Id) {
                case CommandCatalog.CharacterSummon: case CommandCatalog.CharacterFollow: case CommandCatalog.CharacterWait: case CommandCatalog.CharacterDismiss: case CommandCatalog.CharacterDespawn: {
                    string operation = info.Id.Substring(info.Id.IndexOf('.') + 1);
                    return StartCompanion(info,Json(new Dictionary<string,object> {{"action","control"},{"characterId",id},{"operation",operation}}),operation == "summon" ? SummonTimeoutMs : CompanionTimeoutMs,0,info.Hud,args);
                }
                case CommandCatalog.CharacterRename:
                    if (!ValidText(args.Text,80)) return Reject(info.Id,"invalid_text",args,true);
                    return Edit(info,args,new Dictionary<string,object> {{"name",args.Text.Trim()}});
                case CommandCatalog.CharacterRelationship:
                    if (Array.IndexOf(Relationships,args.Value) < 0 || args.Text != null && args.Text.Length > 600) return Reject(info.Id,"invalid_profile_edit",args,true);
                    return Edit(info,args,new Dictionary<string,object> {{"relationship",new Dictionary<string,object> {{"state",args.Value},{"description",args.Text ?? ""}}}});
                case CommandCatalog.CharacterAvailability:
                    if (Array.IndexOf(Availability,args.Value) < 0) return Reject(info.Id,"invalid_profile_edit",args,true);
                    return Edit(info,args,new Dictionary<string,object> {{"status",args.Value}});
                case CommandCatalog.CharacterMemorySelect:
                    if (args.MemoryId == null || !Uuid.IsMatch(args.MemoryId)) return Reject(info.Id,"memory_missing",args,true);
                    return StartCompanion(info,Json(new Dictionary<string,object> {{"action","memory"},{"characterId",id},{"operation","edit"},{"memoryId",args.MemoryId},{"expectedRevision",args.ExpectedRevision},
                        {"patch",new Dictionary<string,object> {{"selectedForContext",args.Flag}}}}),CompanionTimeoutMs,ProfileBodyBytes,info.Hud,args);
                case CommandCatalog.CharacterMemoryAdd:
                    if (!ValidText(args.Text,1200)) return Reject(info.Id,"invalid_text",args,true);
                    return StartCompanion(info,Json(new Dictionary<string,object> {{"action","memory"},{"characterId",id},{"operation","create"},{"expectedRevision",args.ExpectedRevision},
                        {"patch",new Dictionary<string,object> {{"text",args.Text.Trim()},{"selectedForContext",false}}}}),CompanionTimeoutMs,ProfileBodyBytes,info.Hud,args);
                default: return Reject(info.Id,"unsupported_command",args,false);
            }
        }
        string Edit(CommandInfo info,CommandArgs args,Dictionary<string,object> patch) =>
            StartCompanion(info,Json(new Dictionary<string,object> {{"action","edit"},{"characterId",args.CharacterId},{"expectedRevision",args.ExpectedRevision},{"patch",patch}}),CompanionTimeoutMs,ProfileBodyBytes,info.Hud,args);
        string StartCompanion(CommandInfo info,string body,int timeoutMs,int maxBodyBytes,string successText,CommandArgs args)
        {
            string key = Guid.NewGuid().ToString("N");
            jobs.Add(new Job {Key = key,CommandId = info.Id,Class = info.Class,Kind = "companion",SuccessText = successText,Deadline = clock.Monotonic + timeoutMs + 2000,OnDone = args?.OnDone});
            companion.Post(body,maxBodyBytes,timeoutMs,reply => replies.Enqueue(new KeyValuePair<string,CompanionReply>(key,reply)));
            return null;
        }
        public void Update()
        {
            long now = clock.Monotonic;
            relay.Update(now);
            while (replies.TryDequeue(out var pair)) {
                var job = jobs.FirstOrDefault(item => item.Key == pair.Key);
                if (job == null) continue; // already timed out
                Complete(job,pair.Value != null && pair.Value.Ok ? null : pair.Value?.Error ?? "companion_unavailable",pair.Value?.Body);
            }
            foreach (var job in jobs.ToArray()) {
                if (job.Kind == "bridge") {
                    string text = bridge.TryTakeResult(job.Key);
                    if (text != null) { Complete(job,BridgeReason(text),null); continue; }
                    if (now > job.Deadline) Complete(job,"native_stale",null);
                } else if (now > job.Deadline) Complete(job,"companion_unavailable",null);
            }
        }
        static string BridgeReason(string text)
        {
            try {
                var reply = new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 8}.DeserializeObject(text) as Dictionary<string,object>;
                if (reply != null && reply.TryGetValue("status",out var status) && status as string == "ok") return null;
                return reply != null && reply.TryGetValue("reason",out var code) && code is string reason && Regex.IsMatch(reason,"^[a-z][a-z0-9_]{0,63}$") ? reason : "native_operation_failed";
            } catch { return "native_operation_failed"; }
        }
        void Complete(Job job,string reason,string body)
        {
            jobs.Remove(job); Record(job.CommandId,reason);
            hud.Show(reason == null ? job.SuccessText : catalog.Describe(reason));
            try { job.OnDone?.Invoke(reason,body); } catch { }
        }
        string Reject(string commandId,string reason,CommandArgs args,bool show)
        {
            Record(commandId,reason);
            if (show) hud.Show(catalog.Describe(reason));
            try { args?.OnDone?.Invoke(reason,null); } catch { }
            return reason;
        }
        void Record(string commandId,string reason)
        {
            if (reason == null || reason == "cooldown") return;
            recent.Enqueue(commandId + ": " + reason);
            while (recent.Count > RecentLimit) recent.Dequeue();
        }
        static bool ValidText(string text,int max)
        {
            if (text == null) return false;
            string trimmed = text.Trim();
            return trimmed.Length > 0 && trimmed.Length <= max && !trimmed.Any(char.IsControl);
        }
        static string Json(Dictionary<string,object> value) => new JavaScriptSerializer().Serialize(value);
        public void ReleaseKeys() => relay.ReleaseAll();
        // Shutdown: complete nothing further, release any synthesized key.
        public void Stop() { jobs.Clear(); relay.ReleaseAll(); }
    }
}
