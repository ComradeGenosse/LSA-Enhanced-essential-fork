using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace LSA.Activities
{
    public sealed class CapabilityRow
    {
        public string Id, Phase, Exposure, Path, EssentialName, Kind, Adapter, CancelPath;
        public int AcceptMs, EstablishMs, CompleteMs, HoldMaxMs;
        public bool Mode, Never;
        public readonly List<string> Probes = new List<string>();
        public readonly List<string> Sources = new List<string>();
        public readonly List<string> Priorities = new List<string>();
    }
    public sealed class CapabilityTable
    {
        public const string ResourceName = "LSA.Activities.activity-capabilities.v1.json";
        public const string ContractSha256 = "31ed6e6d47a7222929b3645401d6e046676ed7f21a65f5643a68e002a3ee6486";
        static readonly Dictionary<string, string[]> Observed = new Dictionary<string, string[]> {
            {"waithere", new[] {"WaitHere"}}, {"followtarget", new[] {"FollowTarget"}}, {"resumeactivity", new[] {"ResumeActivity"}},
            {"sitonground", new[] {"SitOnGround"}}, {"stopandfacetarget", new[] {"StopAndFaceTarget"}}, {"approachperson", new[] {"ApproachTarget"}},
            {"takecover", new[] {"TakeCover"}}, {"walkawayfromtarget", new[] {"WalkAwayFromTarget"}}, {"startdriving", new[] {"StartDriving"}}, {"exitvehicle", new[] {"ExitVehicle"}},
            // ACT3. Callback spellings follow the canonical method names. Q2 has to pin them: a spelling that never
            // matches makes the callback look foreign, which supersedes the step. It can never fake an acceptance.
            {"enterdriverseatoftargetvehicle", new[] {"EnterDriverSeatOfTargetVehicle"}}, {"entertargetvehicle", new[] {"EnterTargetVehicle"}}, {"enterbackoftargetvehicle", new[] {"EnterBackOfTargetVehicle"}},
            {"grabitem", new[] {"GrabItem"}}, {"clearhelditem", new[] {"ClearHeldItem"}}
        };
        readonly Dictionary<string, CapabilityRow> rows;
        readonly HashSet<string> excluded;
        readonly Dictionary<string, string> scenarios, items;
        CapabilityTable(Dictionary<string, CapabilityRow> rows, HashSet<string> excluded, Dictionary<string, string> scenarios, Dictionary<string, string> items) { this.rows = rows; this.excluded = excluded; this.scenarios = scenarios; this.items = items; }
        public static CapabilityTable LoadEmbedded()
        {
            using (var stream = typeof(CapabilityTable).Assembly.GetManifestResourceStream(ResourceName))
            using (var memory = new MemoryStream()) {
                if (stream == null) throw new InvalidDataException("activity_contract_missing");
                stream.CopyTo(memory); return Parse(memory.ToArray());
            }
        }
        public static CapabilityTable Parse(byte[] bytes)
        {
            string sha;
            using (var hash = SHA256.Create()) sha = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            if (sha != ContractSha256) throw new InvalidDataException("activity_contract_mismatch");
            var root = new JavaScriptSerializer { MaxJsonLength = 262144, RecursionLimit = 8 }.DeserializeObject(System.Text.Encoding.UTF8.GetString(bytes)) as Dictionary<string, object>;
            if (root == null || !(root["schemaVersion"] is int version) || version != ActivityContracts.Version || root["schema"] as string != "lsa.activity-capabilities") throw new InvalidDataException("activity_contract_invalid");
            var rows = new Dictionary<string, CapabilityRow>();
            var list = root["capabilities"] as object[] ?? throw new InvalidDataException("activity_contract_invalid");
            if (list.Length != ActivityContracts.CapabilityIds.Length) throw new InvalidDataException("activity_contract_invalid");
            for (var index = 0; index < list.Length; index++) {
                var item = list[index] as Dictionary<string, object> ?? throw new InvalidDataException("activity_contract_invalid");
                var id = item["id"] as string;
                if (id != ActivityContracts.CapabilityIds[index] || !item.ContainsKey("phase") || !item.ContainsKey("exposure")) throw new InvalidDataException("activity_contract_invalid");
                var execution = item["execution"] as Dictionary<string, object> ?? throw new InvalidDataException("activity_contract_invalid");
                var cancel = item["cancel"] as Dictionary<string, object> ?? throw new InvalidDataException("activity_contract_invalid");
                var timeouts = item["timeouts"] as Dictionary<string, object> ?? throw new InvalidDataException("activity_contract_invalid");
                var row = new CapabilityRow { Id = id, Phase = item["phase"] as string, Exposure = item["exposure"] as string, Path = execution["path"] as string, EssentialName = execution["essentialName"] as string, Kind = item["kind"] as string, Adapter = item["adapter"] as string, CancelPath = cancel["path"] as string, AcceptMs = Convert.ToInt32(timeouts["acceptMs"]), EstablishMs = timeouts["establishMaxMs"] == null ? 0 : Convert.ToInt32(timeouts["establishMaxMs"]), CompleteMs = timeouts["completeMaxMs"] == null ? 0 : Convert.ToInt32(timeouts["completeMaxMs"]), HoldMaxMs = timeouts["holdMaxMs"] == null ? 0 : Convert.ToInt32(timeouts["holdMaxMs"]), Mode = ActivityContracts.IsMode(id), Never = item["phase"] as string == "never" || item["exposure"] as string == "excluded" };
                foreach (var probe in (item["probes"] as object[]) ?? new object[0]) row.Probes.Add(probe as string);
                foreach (var source in (item["allowedSources"] as object[]) ?? new object[0]) row.Sources.Add(source as string);
                foreach (var priority in (item["allowedPriority"] as object[]) ?? new object[0]) row.Priorities.Add(priority as string);
                if (row.Phase == null || row.Path == null) throw new InvalidDataException("activity_contract_invalid");
                rows.Add(id, row);
            }
            var excluded = new HashSet<string>();
            foreach (var item in (root["excluded"] as object[]) ?? throw new InvalidDataException("activity_contract_invalid")) {
                var entry = item as Dictionary<string, object> ?? throw new InvalidDataException("activity_contract_invalid");
                var id = entry["id"] as string;
                if (string.IsNullOrEmpty(id) || entry["reason"] as string != "excluded_family" || rows.ContainsKey(id)) throw new InvalidDataException("activity_contract_invalid");
                excluded.Add(id);
            }
            if (excluded.Count != 18) throw new InvalidDataException("activity_contract_invalid");
            var enums = root["enums"] as Dictionary<string, object> ?? throw new InvalidDataException("activity_contract_invalid");
            return new CapabilityTable(rows, excluded, ClosedMap(enums, "scenarioMap"), ClosedMap(enums, "itemMap"));
        }
        static Dictionary<string, string> ClosedMap(Dictionary<string, object> enums, string key)
        {
            var map = new Dictionary<string, string>();
            var source = enums.ContainsKey(key) ? enums[key] as Dictionary<string, object> : null;
            if (source == null) throw new InvalidDataException("activity_contract_invalid");
            foreach (var pair in source) { var value = pair.Value as string; if (string.IsNullOrEmpty(value)) throw new InvalidDataException("activity_contract_invalid"); map[pair.Key] = value; }
            return map;
        }
        // Closed contract maps. Unknown keys map to null and never reach Essential.
        public string ScenarioName(string key) => key != null && scenarios.TryGetValue(key, out var name) ? name : null;
        public string ItemName(string key) => key != null && items.TryGetValue(key, out var name) ? name : null;
        public CapabilityRow Get(string id) => id != null && rows.TryGetValue(id, out var row) ? row : null;
        // Callback names for one exact queue command token (the seat variants must not accept each other).
        public string[] NamesForToken(string token)
        {
            if (string.IsNullOrEmpty(token)) return new string[0];
            var names = new List<string> { token };
            if (Observed.TryGetValue(token, out var extra)) names.AddRange(extra);
            return names.Distinct().ToArray();
        }
        public string[] NamesFor(string id)
        {
            var row = Get(id);
            if (row == null || string.IsNullOrEmpty(row.EssentialName)) return new string[0];
            var names = new List<string>();
            foreach (var token in row.EssentialName.Split('|')) {
                if (token.Contains(".")) continue;
                names.Add(token);
                if (Observed.TryGetValue(token, out var extra)) names.AddRange(extra);
            }
            return names.Distinct().ToArray();
        }
        public bool Enabled(string id, string mode, IDictionary<string, bool> hello, ICollection<string> requested, ICollection<string> probes, string source, string priority)
        {
            var row = Get(id);
            if (row == null || row.Never || row.Phase == "never" || row.Exposure == "excluded" || excluded.Contains(id) || row.Sources.Count == 0 || row.Priorities.Count == 0 || row.Path == "none") return false;
            if (mode != "on" || hello == null || !hello.TryGetValue(id, out var allowed) || !allowed || requested == null || !requested.Contains(id)) return false;
            if (row.Probes.Any(probe => probes == null || !probes.Contains(probe))) return false;
            if (source != null && !row.Sources.Contains(source)) return false;
            if (priority != null && !row.Priorities.Contains(priority)) return false;
            return true;
        }
    }
}
