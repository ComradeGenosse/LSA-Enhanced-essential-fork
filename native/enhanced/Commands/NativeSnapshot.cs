using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Commands
{
    public sealed class CurrentNpc
    {
        public bool Present, Owned, Suspended, Human, Safe;
        public string PedId, EncounterId, OwnerAlias, Mode, ActivityIntent, ActivityStep, ActivityStatus, ActivityReason;
        public bool ActivityPresent;
    }
    public sealed class TalkTargetInfo
    {
        public bool Present, PttCommitted;
        public string SelectionId, EncounterId, PedId, Indicator, Reason;
        public int CycleIndex, CycleCount;
        public long ExpiresInMs;
    }
    public sealed class SnapshotGates
    {
        public bool TextInputOpen, ControlsMenuOpen, Cutscene, PlayerSwitch, Mission, Online, Loading, InputFree, Scripted;
    }
    // The runtime's JSON snapshot ({v, seq, builtAtUtc, current, gates, reason}),
    // parsed defensively. Values are for display and expectations only; every
    // command is re-validated by its executor on Essential's fiber.
    public sealed class NativeSnapshot
    {
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        static readonly Regex Alias = new Regex("^promoted\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        public long Sequence, BuiltAtUtc;
        public CurrentNpc Current;
        public TalkTargetInfo TalkTarget;
        public SnapshotGates Gates;
        public string Reason;
        public bool Fresh(long utcNow,long maxAgeMs) => utcNow - BuiltAtUtc <= maxAgeMs && BuiltAtUtc - utcNow <= 1000;
        public static NativeSnapshot Parse(string json)
        {
            if (string.IsNullOrEmpty(json) || json.Length > 16384) return null;
            try {
                var root = new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 6}.DeserializeObject(json) as Dictionary<string,object>;
                if (root == null || !(root.TryGetValue("v",out var version) && version is int number && number == 1)) return null;
                var snapshot = new NativeSnapshot {Sequence = Long(root,"seq"),BuiltAtUtc = Long(root,"builtAtUtc"),Reason = Code(root,"reason")};
                snapshot.Current = ParseCurrent(root.TryGetValue("current",out var current) ? current as Dictionary<string,object> : null);
                snapshot.TalkTarget = ParseTalk(root.TryGetValue("talkTarget",out var talkValue) ? talkValue as Dictionary<string,object> : null);
                if (root.TryGetValue("gates",out var gatesValue) && gatesValue is Dictionary<string,object> gates)
                    snapshot.Gates = new SnapshotGates {TextInputOpen = Flag(gates,"textInputOpen"),ControlsMenuOpen = Flag(gates,"controlsMenuOpen"),Cutscene = Flag(gates,"cutscene"),
                        PlayerSwitch = Flag(gates,"playerSwitch"),Mission = Flag(gates,"mission"),Online = Flag(gates,"online"),Loading = Flag(gates,"loading"),InputFree = Flag(gates,"inputFree"),Scripted = Flag(gates,"scripted")};
                return snapshot;
            } catch { return null; }
        }
        // Also parses a current.inspect result object.
        public static CurrentNpc ParseCurrent(Dictionary<string,object> value)
        {
            if (value == null) return null;
            var npc = new CurrentNpc {Present = Flag(value,"present")};
            if (!npc.Present) return npc;
            npc.EncounterId = Text(value,"encounterId",Uuid);
            if (npc.EncounterId == null) return null;
            npc.PedId = Text(value,"pedId",new Regex("^[0-9]{1,12}$"));
            npc.OwnerAlias = Text(value,"ownerAlias",Alias);
            npc.Owned = Flag(value,"owned") && npc.OwnerAlias != null;
            npc.Suspended = Flag(value,"suspended"); npc.Human = Flag(value,"human"); npc.Safe = Flag(value,"safe");
            npc.Mode = value.TryGetValue("mode",out var mode) && (mode as string == "follow" || mode as string == "wait" || mode as string == "activity" || mode as string == "idle") ? (string)mode : null;
            if (value.TryGetValue("activity",out var activity) && activity is Dictionary<string,object> row && Flag(row,"present")) {
                npc.ActivityPresent = true;
                npc.ActivityIntent = Token(row,"intent"); npc.ActivityStep = Token(row,"step"); npc.ActivityStatus = Token(row,"status"); npc.ActivityReason = Token(row,"reason");
            }
            return npc;
        }
        static TalkTargetInfo ParseTalk(Dictionary<string,object> value)
        {
            if (value == null) return null;
            var info = new TalkTargetInfo {Present = Flag(value,"present"),Indicator = Known(Code(value,"indicator"),"ready","unavailable","off"),Reason = Code(value,"reason")};
            if (!info.Present) return info;
            info.SelectionId = Text(value,"selectionId",Uuid);
            if (info.SelectionId == null) return null;
            info.EncounterId = Text(value,"encounterId",Uuid);
            info.PedId = Text(value,"pedId",new Regex("^[0-9]{1,12}$"));
            info.PttCommitted = Flag(value,"pttCommitted");
            info.CycleIndex = (int)Long(value,"cycleIndex");
            info.CycleCount = (int)Long(value,"cycleCount");
            info.ExpiresInMs = Long(value,"expiresInMs");
            if (info.CycleIndex < 1 || info.CycleCount < info.CycleIndex || info.CycleCount > 16 || info.ExpiresInMs < 0 || info.ExpiresInMs > 60000) return null;
            return info;
        }
        static string Known(string value,params string[] allowed) => value != null && Array.IndexOf(allowed,value) >= 0 ? value : null;
        static bool Flag(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is bool flag && flag;
        static long Long(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) ? item is int small ? small : item is long large ? large : 0 : 0;
        static string Text(Dictionary<string,object> value,string key,Regex pattern) => value.TryGetValue(key,out var item) && item is string text && pattern.IsMatch(text) ? text : null;
        static string Code(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is string text && Regex.IsMatch(text,"^[a-z][a-z0-9_]{0,63}$") ? text : null;
        static string Token(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is string text && Regex.IsMatch(text,"^[a-z][a-z0-9_]{0,47}$") ? text : null;
    }
}
