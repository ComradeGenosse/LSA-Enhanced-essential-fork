using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace LSA.SessionIdentity
{
    public sealed class NativeIdentityClaim
    {
        public int schemaVersion = 1;
        public int sourceContractVersion = 1;
        public string worldProfileId;
        public string sourceNamespace = "comrade.authored";
        public string sourceKey;
        public string adapterEpoch;
        public string incarnationId;
        public long claimRevision;
        public long observationSequence;
        public long observedGameTime;
    }

    public sealed class RegistrationToken
    {
        public string IncarnationId { get; internal set; }
        internal string PedId, WorldProfileId, SourceKey, Epoch;
        internal long Revision;
        internal bool Conflicted;
        internal Func<bool> Valid;
    }

    // The owner API/game fiber is the only mutation authority. The pipe worker
    // queues questions; it never touches a Ped or this dictionary.
    public sealed class NativeIdentityEvidenceStore
    {
        public const int MaxRegistrations = 64;
        readonly Dictionary<string, RegistrationToken> registrations = new Dictionary<string, RegistrationToken>(StringComparer.Ordinal);
        readonly int ownerThread;
        readonly Func<bool> authorizedContext;
        long revision, observation;
        public string AdapterEpoch { get; } = Guid.NewGuid().ToString("D");
        public event Action<string, RegistrationToken> Revoked;
        internal bool IsOnOwnerThread => Thread.CurrentThread.ManagedThreadId == ownerThread;
        // Production supplies RAGE's active-fiber check. The default keeps the
        // store's standalone/test use restricted to its creating thread.
        public NativeIdentityEvidenceStore(Func<bool> authorizedGameFiber = null)
        {
            ownerThread = Thread.CurrentThread.ManagedThreadId;
            authorizedContext = authorizedGameFiber ?? (() => Thread.CurrentThread.ManagedThreadId == ownerThread);
        }
        void AssertOwner() { if (!authorizedContext()) throw new InvalidOperationException("Authorized game fiber required."); }
        public static bool Key(string value) => value != null && value.Length > 0 && value.Length <= 128 && value.Trim() == value &&
            System.Text.Encoding.UTF8.GetByteCount(value) <= 256 && !value.Any(c => c < 32 || c == 127);
        public static bool Uuid(string value) => Guid.TryParseExact(value, "D", out var id) && id.ToString("D") == value && value[14] == '4' && "89ab".Contains(value[19]);
        public RegistrationToken Register(string pedId, string sourceKey, string worldProfileId, Func<bool> valid)
        {
            AssertOwner();
            if (!Key(pedId) || !Key(sourceKey) || !Uuid(worldProfileId) || valid == null || !valid()) throw new ArgumentException("Invalid explicit owner registration.");
            if (registrations.ContainsKey(pedId)) throw new InvalidOperationException("Retire the previous ped association before registering again.");
            if (registrations.Count >= MaxRegistrations) throw new InvalidOperationException("Explicit roster is full.");
            var token = new RegistrationToken { PedId = pedId, SourceKey = sourceKey, WorldProfileId = worldProfileId,
                Epoch = AdapterEpoch, IncarnationId = Guid.NewGuid().ToString("D"), Revision = ++revision, Valid = valid };
            registrations.Add(pedId, token);
            // Simultaneous aliases invalidate existing proof too, without stealing.
            var duplicates = registrations.Values.Where(t => t.WorldProfileId == worldProfileId && t.SourceKey == sourceKey).ToArray();
            if (duplicates.Length > 1) foreach (var duplicate in duplicates) { duplicate.Conflicted = true; Revoked?.Invoke(duplicate.PedId, duplicate); }
            return token;
        }
        public bool Retire(RegistrationToken token)
        {
            AssertOwner();
            if (token == null || token.Epoch != AdapterEpoch || !registrations.TryGetValue(token.PedId, out var current) || !ReferenceEquals(current, token)) return false;
            registrations.Remove(token.PedId); Revoked?.Invoke(token.PedId, token); return true;
        }
        public string TryResolveCurrent(string pedId, long gameTime, out NativeIdentityClaim claim)
        {
            AssertOwner(); claim = null;
            if (!registrations.TryGetValue(pedId, out var token)) return "absent";
            bool valid; try { valid = token.Valid(); } catch { valid = false; }
            if (!valid) { Retire(token); return "absent"; }
            if (token.Conflicted || registrations.Values.Count(t => t.WorldProfileId == token.WorldProfileId && t.SourceKey == token.SourceKey) != 1) return "conflict";
            claim = new NativeIdentityClaim { worldProfileId = token.WorldProfileId, sourceKey = token.SourceKey,
                adapterEpoch = AdapterEpoch, incarnationId = token.IncarnationId, claimRevision = token.Revision,
                observationSequence = ++observation, observedGameTime = gameTime };
            return "active";
        }
        public void ValidateActive()
        {
            AssertOwner();
            foreach (var token in registrations.Values.ToArray()) { bool valid; try { valid = token.Valid(); } catch { valid = false; } if (!valid) Retire(token); }
        }
        public void Clear() { AssertOwner(); foreach (var token in registrations.Values.ToArray()) Retire(token); }
    }
}
