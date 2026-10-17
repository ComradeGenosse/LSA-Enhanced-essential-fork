using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace LSA.Reactions
{
    // Exact identity of one Essential playback: ped + turn + generation.
    // A start or end for any other tuple never touches this one.
    public sealed class PlaybackKey : IEquatable<PlaybackKey>
    {
        public readonly string PedId, TurnId;
        public readonly long GenerationId;
        public PlaybackKey(string pedId, string turnId, long generationId) { PedId = pedId; TurnId = turnId; GenerationId = generationId; }
        public bool Equals(PlaybackKey other) => other != null && PedId == other.PedId && TurnId == other.TurnId && GenerationId == other.GenerationId;
        public override bool Equals(object obj) => Equals(obj as PlaybackKey);
        public override int GetHashCode() { unchecked { return (((PedId ?? "").GetHashCode() * 31) + (TurnId ?? "").GetHashCode()) * 31 + GenerationId.GetHashCode(); } }
        public override string ToString() => PedId + "/" + TurnId + "/" + GenerationId;
    }

    public sealed class ReactionFrame
    {
        public string FrameId, HostRunId, Reaction;
        public int WorldEpoch;
        public PlaybackKey Key;
    }

    // Pure validation/encoding of the reaction pipe vocabulary. The pipe layer
    // deserializes JSON; this class only judges the decoded shape, so it runs
    // identically in the offline tests.
    public static class ReactionFrameCodec
    {
        public const int Version = 1, MaxFrameBytes = 1024;
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.Compiled);
        static readonly Regex Identity = new Regex("^[A-Za-z0-9_.:-]{1,128}$", RegexOptions.Compiled);
        static readonly Regex ReasonCode = new Regex("^[a-z0-9_:]{1,48}$", RegexOptions.Compiled);

        static bool Exact(IDictionary<string, object> value, params string[] keys) =>
            value != null && value.Count == keys.Length && keys.All(value.ContainsKey);
        static bool SafeInteger(object value, long min, long max) =>
            (value is int || value is long) && Convert.ToInt64(value) >= min && Convert.ToInt64(value) <= max;

        public static bool TryParse(IDictionary<string, object> value, out ReactionFrame frame, out string reason)
        {
            frame = null; reason = "frame_invalid";
            try
            {
                if (!Exact(value, "version", "type", "frameId", "hostRunId", "worldEpoch", "tuple", "reaction")) return false;
                if (!SafeInteger(value["version"], Version, Version) || !(value["type"] is string type) || type != "reaction") return false;
                if (!(value["frameId"] is string frameId) || !Uuid.IsMatch(frameId)) return false;
                if (!(value["hostRunId"] is string host) || !Uuid.IsMatch(host)) return false;
                if (!SafeInteger(value["worldEpoch"], 1, int.MaxValue)) return false;
                var tuple = value["tuple"] as IDictionary<string, object>;
                if (!Exact(tuple, "pedId", "turnId", "generationId")) return false;
                if (!(tuple["pedId"] is string pedId) || !Identity.IsMatch(pedId)) return false;
                if (!(tuple["turnId"] is string turnId) || !Identity.IsMatch(turnId)) return false;
                if (!SafeInteger(tuple["generationId"], 0, 9007199254740991L)) return false;
                if (!(value["reaction"] is string name)) return false;
                if (!ReactionCatalog.IsKnown(name)) { reason = "unknown_reaction"; return false; }
                frame = new ReactionFrame
                {
                    FrameId = frameId, HostRunId = host, WorldEpoch = Convert.ToInt32(value["worldEpoch"]), Reaction = name,
                    Key = new PlaybackKey(pedId, turnId, Convert.ToInt64(tuple["generationId"])),
                };
                reason = null;
                return true;
            }
            catch { frame = null; reason = "frame_invalid"; return false; }
        }

        public static Dictionary<string, object> Hello(string hostRunId, int worldEpoch, string mode) =>
            new Dictionary<string, object>
            {
                { "version", Version }, { "type", "hello" }, { "reactionVersion", 1 },
                { "hostRunId", hostRunId }, { "worldEpoch", worldEpoch }, { "mode", mode },
            };

        public static Dictionary<string, object> Ack(ReactionFrame frame, string status, string reason) =>
            new Dictionary<string, object>
            {
                { "version", Version }, { "type", "reaction.ack" }, { "frameId", frame.FrameId }, { "reaction", frame.Reaction },
                { "status", status }, { "reason", reason != null && ReasonCode.IsMatch(reason) ? reason : "unspecified" },
            };
    }
}
