using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.PromotedCharacters
{
    internal sealed class LocalCommand
    {
        public string Id, Command, Source, Phrase, ExpectedEncounterId, ExpectedSelectionId;
        public long ExpiresAtUtc;
        public int PttGeneration, MaxCandidates, CycleWindowMs, SelectionTimeoutMs;
        public float RadiusMeters, RetentionRadiusMeters;
        public bool SelectFirst, Indicator, HasLimits;
    }
    // UX phase 1 bridge from the loader into PromotedCharactersIntegration.Update.
    // Callers on any thread only parse, admit and enqueue CommandEnvelope v1 strings;
    // every game read and Essential call happens later on Core's Update fiber.
    // Results are delivered once, kept for 30 s, and capped in count and size.
    internal sealed class LocalCommandQueue
    {
        public const int MaxEnvelopeChars = 8192, MaxResultChars = 16384, Capacity = 16, ResultCapacity = 64, MaxPhraseChars = 120;
        public const long ResultRetentionMs = 30000, MaxLifetimeMs = 5000, IssueSkewMs = 1000;
        public static readonly string[] Commands = {"current.inspect","npc.ask","gates.read","talk.select_first","talk.select_next","talk.ptt_start","talk.ptt_stop","talk.clear","talk.inspect"};
        static readonly HashSet<string> Sources = new HashSet<string> {"console","chord","menu","studio","talk_input"};
        static readonly string[] EnvelopeFields = {"v","id","command","target","args","source","issuedAtUtc","expiresAtUtc"};
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        static readonly Regex Code = new Regex("^[a-z][a-z0-9_]{0,63}$");
        sealed class Completed { public string Json; public long ExpiresAtUtc; }
        readonly object gate = new object();
        readonly string epoch = Guid.NewGuid().ToString("D");
        readonly OperationAdmission admission;
        readonly Queue<LocalCommand> pending = new Queue<LocalCommand>();
        readonly Dictionary<string,Completed> results = new Dictionary<string,Completed>();
        readonly Queue<string> resultOrder = new Queue<string>();
        bool closed;
        // Admission is the production P2 rule set (UUID, freshness, 256-entry
        // de-duplication) with a queue-local epoch: the loader never sees P2's.
        public LocalCommandQueue() { admission = new OperationAdmission(epoch,epoch,Commands); }
        public int PendingCount { get { lock (gate) return pending.Count; } }
        public static bool IsUuid(string value) => value != null && Uuid.IsMatch(value);

        public string Submit(string envelope,long nowUtc)
        {
            if (envelope == null) return "invalid_envelope";
            if (envelope.Length > MaxEnvelopeChars) return "envelope_too_large";
            string reason = Parse(envelope,nowUtc,out var command);
            if (reason != null) return reason;
            lock (gate)
            {
                if (closed) return "native_unavailable";
                if (pending.Count >= Capacity) return "queue_full";
                if (!admission.Admit(command.Id,epoch,epoch,command.Command,command.ExpiresAtUtc,nowUtc)) return "duplicate_request";
                pending.Enqueue(command);
            }
            return "accepted";
        }
        public bool TryTake(long nowUtc,out LocalCommand command)
        {
            lock (gate)
            {
                while (pending.Count > 0)
                {
                    var next = pending.Dequeue();
                    // Commands need a ticking game. Expired ones complete instead of queueing.
                    if (NativeSafetyPolicy.Fresh(next.Command,next.ExpiresAtUtc,nowUtc)) { command = next; return true; }
                    StoreLocked(next,"native_stale",null,nowUtc);
                }
            }
            command = null; return false;
        }
        public void Complete(LocalCommand command,string reason,object result,long nowUtc)
        {
            if (command == null) return;
            lock (gate) StoreLocked(command,reason,result,nowUtc);
        }
        public string TryTakeResult(string id,long nowUtc)
        {
            if (!IsUuid(id)) return null;
            lock (gate)
            {
                PruneLocked(nowUtc);
                if (!results.TryGetValue(id,out var completed)) return null;
                results.Remove(id); return completed.Json;
            }
        }
        // A world reset invalidates every expectation the loader captured.
        public void CancelPending(string reason,long nowUtc) { lock (gate) while (pending.Count > 0) StoreLocked(pending.Dequeue(),reason,null,nowUtc); }
        public void Close(string reason,long nowUtc) { lock (gate) { closed = true; while (pending.Count > 0) StoreLocked(pending.Dequeue(),reason,null,nowUtc); } }

        void StoreLocked(LocalCommand command,string reason,object result,long nowUtc)
        {
            if (results.ContainsKey(command.Id)) return; // first completion wins
            if (reason != null && !Code.IsMatch(reason)) reason = "native_operation_failed";
            var json = new JavaScriptSerializer {MaxJsonLength = MaxResultChars * 4,RecursionLimit = 8};
            string text;
            try { text = json.Serialize(Envelope(command,reason,reason == null ? result : null)); } catch { text = null; }
            if (text == null || text.Length > MaxResultChars) text = json.Serialize(Envelope(command,"native_result_limit",null));
            results.Add(command.Id,new Completed {Json = text,ExpiresAtUtc = nowUtc + ResultRetentionMs});
            resultOrder.Enqueue(command.Id);
            PruneLocked(nowUtc);
        }
        static object Envelope(LocalCommand command,string reason,object result) =>
            new {v = 1,id = command.Id,command = command.Command,status = reason == null ? "ok" : "failed",reason,result};
        void PruneLocked(long nowUtc)
        {
            while (resultOrder.Count > 0)
            {
                string head = resultOrder.Peek();
                if (results.TryGetValue(head,out var completed) && completed.ExpiresAtUtc > nowUtc && results.Count <= ResultCapacity) break;
                resultOrder.Dequeue(); results.Remove(head);
            }
        }

        static string Parse(string envelope,long nowUtc,out LocalCommand command)
        {
            command = null;
            Dictionary<string,object> value;
            try { value = new JavaScriptSerializer {MaxJsonLength = MaxEnvelopeChars * 2,RecursionLimit = 6}.DeserializeObject(envelope) as Dictionary<string,object>; }
            catch { return "invalid_envelope"; }
            if (!Exact(value,EnvelopeFields) || !(value["v"] is int version) || version != 1) return "invalid_envelope";
            if (!(value["id"] is string id) || !IsUuid(id) || !(value["source"] is string source) || !Sources.Contains(source)) return "invalid_envelope";
            if (!(value["command"] is string name) || Array.IndexOf(Commands,name) < 0) return "unsupported_command";
            if (!Integer(value["issuedAtUtc"],out long issued) || !Integer(value["expiresAtUtc"],out long expires)) return "invalid_envelope";
            if (issued > expires || expires - issued > MaxLifetimeMs || issued > nowUtc + IssueSkewMs || !NativeSafetyPolicy.Fresh(name,expires,nowUtc)) return "native_stale";
            var target = value["target"] as Dictionary<string,object>;
            var args = value["args"] as Dictionary<string,object>;
            if (target == null || !(target.TryGetValue("kind",out var kindValue) && kindValue is string kind)) return "invalid_target";
            if (args == null) return "invalid_arguments";
            if (name.StartsWith("talk.",StringComparison.Ordinal)) return ParseTalk(name,source,id,expires,kind,target,args,out command);
            string encounterId = null, phrase = null;
            if (name == "npc.ask")
            {
                // The executor rejects target_changed unless the NPC the player saw
                // is still Essential's current NPC when Update runs the request.
                var expect = Exact(target,"kind","expect") ? target["expect"] as Dictionary<string,object> : null;
                if (kind != "current" || !Exact(expect,"encounterId") || !IsUuid(encounterId = expect["encounterId"] as string)) return "invalid_target";
                if (!Exact(args,"phrase") || !Phrase(phrase = args["phrase"] as string)) return "invalid_arguments";
            }
            else
            {
                // Read-only commands take no expectation and no arguments.
                if (target.Count != 1 || kind != (name == "gates.read" ? "none" : "current")) return "invalid_target";
                if (args.Count != 0) return "invalid_arguments";
            }
            command = new LocalCommand {Id = id,Command = name,Source = source,ExpiresAtUtc = expires,ExpectedEncounterId = encounterId,Phrase = phrase};
            return null;
        }
        // Phrases come from the player's own settings or console input: 1-120
        // characters, not blank, no control characters or unpaired surrogates.
        // net481's JavaScriptSerializer rewrites an unpaired surrogate to U+FFFD
        // before this runs, so that replacement is rejected too.
        public static bool Phrase(string phrase)
        {
            if (phrase == null || phrase.Length < 1 || phrase.Length > MaxPhraseChars || phrase.Trim().Length == 0) return false;
            for (int index = 0; index < phrase.Length; index++)
            {
                char c = phrase[index];
                if (char.IsControl(c) || c == '\uFFFD') return false;
                if (char.IsHighSurrogate(c)) { if (index + 1 >= phrase.Length || !char.IsLowSurrogate(phrase[index + 1])) return false; index++; }
                else if (char.IsLowSurrogate(c)) return false;
            }
            return true;
        }
        static string ParseTalk(string name,string source,string id,long expires,string kind,Dictionary<string,object> target,Dictionary<string,object> args,out LocalCommand command)
        {
            command = null;
            if (source != "talk_input" || kind != "talk") return source != "talk_input" ? "invalid_envelope" : "invalid_target";
            var parsed = new LocalCommand {Id = id,Command = name,Source = source,ExpiresAtUtc = expires};
            switch (name) {
                case "talk.select_first":
                case "talk.select_next":
                    if (target.Count != 1) return "invalid_target";
                    if (!Exact(args,"radiusMeters","retentionRadiusMeters","maxCandidates","cycleWindowMs","selectionTimeoutMs","indicator") || !ReadLimits(args,parsed)) return "invalid_arguments";
                    break;
                case "talk.inspect":
                case "talk.clear":
                    if (target.Count != 1) return "invalid_target";
                    if (args.Count != 0) return "invalid_arguments";
                    break;
                case "talk.ptt_stop":
                    if (target.Count != 1) return "invalid_target";
                    if (!Exact(args,"generation") || !Generation(args["generation"],out int stopGeneration)) return "invalid_arguments";
                    parsed.PttGeneration = stopGeneration;
                    break;
                case "talk.ptt_start":
                    string start = ReadStart(target,args,parsed);
                    if (start != null) return start;
                    break;
                default: return "unsupported_command";
            }
            command = parsed;
            return null;
        }
        static string ReadStart(Dictionary<string,object> target,Dictionary<string,object> args,LocalCommand command)
        {
            if (!Exact(args,"generation","selectFirst","radiusMeters","retentionRadiusMeters","maxCandidates","cycleWindowMs","selectionTimeoutMs","indicator")) return "invalid_arguments";
            if (!(args["selectFirst"] is bool selectFirst) || !Generation(args["generation"],out int generation) || !ReadLimits(args,command)) return "invalid_arguments";
            command.SelectFirst = selectFirst; command.PttGeneration = generation;
            if (selectFirst) return target.Count == 1 ? null : "invalid_target";
            var expect = target.TryGetValue("expect",out var expectValue) ? expectValue as Dictionary<string,object> : null;
            if (target.Count != 2 || expect == null || !expect.TryGetValue("selectionId",out var selection) || !IsUuid(selection as string)) return "invalid_target";
            command.ExpectedSelectionId = (string)selection;
            if (expect.Count == 1) return null;
            if (expect.Count == 2 && expect.TryGetValue("encounterId",out var encounter) && IsUuid(encounter as string)) { command.ExpectedEncounterId = (string)encounter; return null; }
            return "invalid_target";
        }
        static bool ReadLimits(Dictionary<string,object> args,LocalCommand command)
        {
            if (!args.ContainsKey("radiusMeters")) return false;
            if (!Real(args["radiusMeters"],out float radius) || !Real(args["retentionRadiusMeters"],out float retention) || !Whole(args["maxCandidates"],out int max) || !Whole(args["cycleWindowMs"],out int cycle) || !Whole(args["selectionTimeoutMs"],out int timeout)) return false;
            if (!(args["indicator"] is bool indicator) || !TalkTargetOptions.Valid(radius,retention,max,cycle,timeout)) return false;
            command.RadiusMeters = radius; command.RetentionRadiusMeters = retention; command.MaxCandidates = max; command.CycleWindowMs = cycle; command.SelectionTimeoutMs = timeout; command.Indicator = indicator; command.HasLimits = true;
            return true;
        }
        static bool Generation(object value,out int generation) => Whole(value,out generation) && generation >= 1 && generation <= 1000000;
        static bool Whole(object value,out int result)
        {
            if (value is int number) { result = number; return true; }
            if (value is long wide && wide >= int.MinValue && wide <= int.MaxValue) { result = (int)wide; return true; }
            result = 0; return false;
        }
        static bool Real(object value,out float result)
        {
            switch (value) {
                case int number: result = number; return true;
                case long number: result = number; return true;
                case decimal number: result = (float)number; return true;
                case double number: result = (float)number; return true;
                default: result = 0f; return false;
            }
        }
        static bool Exact(Dictionary<string,object> value,params string[] fields)
        {
            if (value == null || value.Count != fields.Length) return false;
            foreach (var field in fields) if (!value.ContainsKey(field)) return false;
            return true;
        }
        static bool Integer(object value,out long result)
        {
            if (value is int small) { result = small; return true; }
            if (value is long large) { result = large; return true; }
            result = 0; return false;
        }
    }
}
