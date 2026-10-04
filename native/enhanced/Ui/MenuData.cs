using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;

namespace LSA.Enhanced.Ui
{
    // Companion data for the native menu: the character roster and names for the
    // current encounter. Requests run off the game fiber; parsing happens there
    // too, and results are applied on the loader fiber in Pump().
    public sealed class MenuData
    {
        // The companion's store holds at most 8 MiB of profiles; the list adds a
        // runtime status to each.
        public const int ListBodyBytes = 9 * 1024 * 1024, DescribeBodyBytes = 16384, RequestTimeoutMs = 10000, DescribeRefreshMs = 5000;
        readonly ICompanion companion;
        readonly IClock clock;
        readonly Action<Action> worker;
        readonly ConcurrentQueue<Action> applied = new ConcurrentQueue<Action>();
        bool listInFlight, describeInFlight, probeInFlight;
        string describeKey, pendingKey;
        long describeAt;
        // worker runs JSON parsing off the game fiber (the thread pool by default).
        public MenuData(ICompanion companion,IClock clock,Action<Action> worker = null)
        {
            this.companion = companion; this.clock = clock;
            this.worker = worker ?? (work => ThreadPool.QueueUserWorkItem(_ => work()));
        }
        public List<CharacterRow> Characters {get;private set;}
        public string CharactersError {get;private set;}
        public bool CompanionReachable {get;private set;} = true;
        public Describe Describe {get;private set;}
        public string DescribeKey => describeKey;
        public int Version {get;private set;}
        public void RequestCharacters()
        {
            if (listInFlight) return;
            listInFlight = true;
            companion.Post("{\"action\":\"list\"}",ListBodyBytes,RequestTimeoutMs,reply => {
                List<CharacterRow> rows = reply != null && reply.Ok ? CharacterList.Parse(reply.Body) : null;
                string error = reply == null ? "companion_unavailable" : reply.Ok ? rows == null ? "invalid_result" : null : reply.Error ?? "companion_unavailable";
                applied.Enqueue(() => {
                    listInFlight = false; CompanionReachable = reply != null && (reply.Ok || reply.Status != 0);
                    if (rows != null) Characters = rows;
                    CharactersError = error; Version++;
                });
            });
        }
        // Names for the NPC the snapshot reports; refreshed when it changes.
        public void RequestDescribe(string encounterId,string ownerAlias,bool force = false)
        {
            string key = (encounterId ?? "") + "|" + (ownerAlias ?? "");
            long now = clock.Monotonic;
            if (encounterId == null && ownerAlias == null) { if (describeKey != key) { describeKey = key; Describe = null; Version++; } return; }
            if (describeInFlight || !force && key == describeKey && now - describeAt < DescribeRefreshMs) return;
            describeInFlight = true; pendingKey = key; describeAt = now;
            var body = new Dictionary<string,object> {{"action","current_describe"},{"encounterId",encounterId},{"ownerAlias",ownerAlias}};
            companion.Post(new JavaScriptSerializer().Serialize(body),DescribeBodyBytes,RequestTimeoutMs,reply => {
                var parsed = reply != null && reply.Ok ? Describe.Parse(reply.Body) : null;
                applied.Enqueue(() => {
                    describeInFlight = false; CompanionReachable = reply != null && (reply.Ok || reply.Status != 0);
                    describeKey = pendingKey; Describe = parsed; Version++;
                });
            });
        }
        // The describe entry for this exact NPC, or null while it is loading or stale.
        public Describe DescribeFor(string encounterId,string ownerAlias) => describeKey == (encounterId ?? "") + "|" + (ownerAlias ?? "") ? Describe : null;
        // Cheap reachability check: an id-less describe answers {"kind":"unknown"}.
        // Older companions answer 400 invalid_editor_action, which is reachable too.
        public void Probe()
        {
            if (probeInFlight) return;
            probeInFlight = true;
            companion.Post("{\"action\":\"current_describe\"}",DescribeBodyBytes,RequestTimeoutMs,reply => applied.Enqueue(() => {
                probeInFlight = false; bool reachable = reply != null && (reply.Ok || reply.Status != 0);
                if (reachable != CompanionReachable) { CompanionReachable = reachable; Version++; }
            }));
        }
        // Replace one row with the profile an edit returned, so the next edit uses
        // the new revision without waiting for a full roster refresh. Parsing runs
        // on the worker; anything that cannot be applied reloads the roster.
        public void ApplyReply(string body)
        {
            worker(() => {
                var row = ParseProfileReply(body);
                applied.Enqueue(() => { if (row == null || !Replace(row)) RequestCharacters(); });
            });
        }
        public CharacterRow ApplyProfile(string body)
        {
            var row = ParseProfileReply(body);
            if (row != null) Replace(row);
            return row;
        }
        static CharacterRow ParseProfileReply(string body)
        {
            try {
                var value = new JavaScriptSerializer {MaxJsonLength = 4 * 1024 * 1024,RecursionLimit = 12}.DeserializeObject(body ?? "") as Dictionary<string,object>;
                if (value != null && value.TryGetValue("profile",out var inner) && inner is Dictionary<string,object> profile) value = profile; // memory replies wrap the profile
                return CharacterList.ParseProfile(value);
            } catch { return null; }
        }
        bool Replace(CharacterRow row)
        {
            int index = Characters == null ? -1 : Characters.FindIndex(item => item.CharacterId == row.CharacterId);
            if (index < 0) return false;
            row.RuntimeStatus = Characters[index].RuntimeStatus; Characters[index] = row; Version++;
            return true;
        }
        public void Pump() { while (applied.TryDequeue(out var action)) action(); }
    }
}
