using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Commands
{
    public sealed class CurrentNpc
    {
        public bool Present, Owned, Suspended, Human, Safe;
        public string PedId, EncounterId, OwnerAlias, Mode;
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
            npc.Mode = value.TryGetValue("mode",out var mode) && (mode as string == "follow" || mode as string == "wait") ? (string)mode : null;
            return npc;
        }
        static bool Flag(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is bool flag && flag;
        static long Long(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) ? item is int small ? small : item is long large ? large : 0 : 0;
        static string Text(Dictionary<string,object> value,string key,Regex pattern) => value.TryGetValue(key,out var item) && item is string text && pattern.IsMatch(text) ? text : null;
        static string Code(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is string text && Regex.IsMatch(text,"^[a-z][a-z0-9_]{0,63}$") ? text : null;
    }
}
