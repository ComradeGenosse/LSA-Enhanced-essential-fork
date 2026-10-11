using System;
using System.Collections.Generic;
using System.Globalization;

namespace LSA.Standalone
{
    /// <summary>
    /// A native-issued proposal. Node can acknowledge it, but cannot issue a
    /// new physical actor or create its lease. Use decimal text for generation:
    /// JS Number does not preserve all Int64 values.
    /// </summary>
    public sealed class NativeTurnPermit
    {
        public readonly Guid TurnId;
        public readonly Guid ConversationId;
        public readonly int TurnOrdinal;
        public readonly Guid SessionNonce;
        public readonly Guid ActorIncarnationId;
        public readonly Guid HostRunId;
        public readonly int WorldEpoch;
        public readonly string Source;
        public readonly Guid LeaseId;
        public readonly string Generation;
        public readonly string PlayerText; // null unless source is native player_text
        public string StagedReply { get; private set; } // NOT playback/history confirmation
        internal readonly OwnershipLease Lease;
        internal bool Confirmed;
        internal bool Retired;

        internal NativeTurnPermit(Guid id, Guid nonce, string source, OwnershipLease lease, string playerText, Guid conversationId, int turnOrdinal)
        {
            TurnId = id;
            ConversationId = conversationId;
            TurnOrdinal = turnOrdinal;
            SessionNonce = nonce;
            ActorIncarnationId = lease.Actor.IncarnationId;
            HostRunId = lease.Actor.HostRunId;
            WorldEpoch = lease.Actor.WorldEpoch;
            Source = source;
            PlayerText = playerText;
            LeaseId = lease.LeaseId;
            Generation = lease.Generation.ToString(CultureInfo.InvariantCulture);
            Lease = lease;
        }

        internal bool StageReply(string text)
        {
            if (!Confirmed || Retired || StagedReply != null) return false;
            StagedReply = text; // prevalidated; no game effect here
            return true;
        }
    }

    /// <summary>
    /// Owner-fiber-only native turn gate. Phase 2 cannot speak or perform tasks;
    /// phase 3 sources may issue permits after physical player targeting.
    /// Every exact wire tuple is checked against Phase 1 authority before use.
    /// </summary>
    public sealed class NativeTurnRegistry
    {
        private const int MaxTurns = 16;
        private const int MaxSessions = 16;
        private sealed class Conversation
        {
            public readonly Guid Id = Guid.NewGuid();
            public int Ordinal;
        }
        private readonly Dictionary<Guid, Conversation> sessions =
            new Dictionary<Guid, Conversation>();
        private readonly NativeAuthority authority;
        private readonly Dictionary<Guid, NativeTurnPermit> live =
            new Dictionary<Guid, NativeTurnPermit>();

        public NativeTurnRegistry(NativeAuthority authority)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
        }

        public bool TryIssue(ActorRef actor, string nativeSource, long ttlMs,
            out NativeTurnPermit permit, out string reason)
        {
            return IssueCore(actor, nativeSource, null, ttlMs, out permit, out reason);
        }

        // The text is supplied by a validated native input source on the
        // owner fiber; no corresponding Node operation can mint text or actor.
        public bool TryIssueTyped(ActorRef actor, string playerText, long ttlMs,
            out NativeTurnPermit permit, out string reason)
        {
            if (!ValidText(playerText, 1024))
            {
                permit = null;
                reason = "invalid_native_text";
                return false;
            }
            return IssueCore(actor, "player_text", playerText, ttlMs, out permit, out reason);
        }

        private static bool ValidText(string text, int maxLength)
        {
            if (string.IsNullOrWhiteSpace(text) || text.Length > maxLength) return false;
            foreach (char ch in text)
                if (char.IsControl(ch) && ch != '\n' && ch != '\t') return false;
            return true;
        }

        private bool IssueCore(ActorRef actor, string nativeSource, string playerText,
            long ttlMs, out NativeTurnPermit permit, out string reason)
        {
            permit = null;
            reason = "invalid_native_source";
            if (nativeSource != "player_text" && nativeSource != "player_mic" &&
                nativeSource != "special_event")
                return false;
            Sweep();
            if (live.Count >= MaxTurns) { reason = "turn_capacity"; return false; }
            OwnershipLease lease;
            if (!authority.TryAcquire(actor, LeaseKind.Conversation, "standalone-native-turn",
                ttlMs, out lease, out reason)) return false;
            Guid actorId = lease.Actor.IncarnationId;
            if (!sessions.TryGetValue(actorId, out var session))
            {
                if (sessions.Count >= MaxSessions)
                {
                    authority.TryRelease(lease);
                    reason = "session_capacity";
                    return false;
                }
                session = new Conversation();
                sessions.Add(actorId, session);
            }
            if (session.Ordinal == int.MaxValue)
            {
                authority.TryRelease(lease);
                reason = "session_ordinal_exhausted";
                return false;
            }
            permit = new NativeTurnPermit(Guid.NewGuid(), Guid.NewGuid(),
                nativeSource, lease, playerText, session.Id, ++session.Ordinal);
            live.Add(permit.TurnId, permit);
            reason = "offered";
            return true;
        }

        // Called only on a fresh physical player input to discard an older
        // reply that never played. This is NOT completion/history commit.
        // Never interrupts a provider turn that has not yet staged a reply.
        public int DiscardStagedForActor(ActorRef actor)
        {
            if (actor == null) return 0;
            int discarded = 0;
            foreach (NativeTurnPermit permit in new List<NativeTurnPermit>(live.Values))
            {
                if (permit.StagedReply != null && permit.Lease.Actor.Equals(actor))
                {
                    Retire(permit);
                    discarded++;
                }
            }
            return discarded;
        }

        public bool TryRetireOfferedPermit(NativeTurnPermit permit)
        {
            if (permit == null || permit.Retired || permit.Confirmed ||
                !live.TryGetValue(permit.TurnId, out var stored) ||
                !ReferenceEquals(stored, permit)) return false;
            Retire(permit);
            return true;
        }

        public bool IsOfferedPermitCurrent(NativeTurnPermit permit)
        {
            if (permit == null || permit.Retired || permit.Confirmed ||
                !live.TryGetValue(permit.TurnId, out var stored) ||
                !ReferenceEquals(stored, permit)) return false;
            if (!authority.IsLeaseCurrent(permit.Lease))
            {
                Retire(permit);
                return false;
            }
            return true;
        }

        public bool TryConfirm(string turnId, string sessionNonce, string actorIncarnationId,
            string leaseId, string generation, string source, out string reason)
        {
            reason = "invalid_ticket";
            NativeTurnPermit permit;
            if (!Guid.TryParseExact(turnId, "D", out var id) ||
                !live.TryGetValue(id, out permit) ||
                permit.Retired || permit.Confirmed ||
                sessionNonce != permit.SessionNonce.ToString("D") ||
                actorIncarnationId != permit.ActorIncarnationId.ToString("D") ||
                leaseId != permit.LeaseId.ToString("D") ||
                generation != permit.Generation || source != permit.Source)
                return false;
            if (!authority.IsLeaseCurrent(permit.Lease))
            {
                Retire(permit);
                reason = "expired_or_retired";
                return false;
            }
            permit.Confirmed = true;
            reason = "confirmed";
            return true;
        }

        public bool IsCurrent(string turnId, string leaseId, string generation, string actorIncarnationId)
        {
            if (!Guid.TryParseExact(turnId, "D", out var id) ||
                !live.TryGetValue(id, out var permit) ||
                !permit.Confirmed || permit.Retired ||
                leaseId != permit.LeaseId.ToString("D") ||
                generation != permit.Generation ||
                actorIncarnationId != permit.ActorIncarnationId.ToString("D"))
                return false;
            if (!authority.IsLeaseCurrent(permit.Lease))
            {
                Retire(permit);
                return false;
            }
            return true;
        }

        // Accept AI text for future audio adaptation, but never treat it as
        // playback success. Idempotency is deliberately reject-on-replay.
        public bool TryStageReply(string turnId, string leaseId, string generation,
            string actorIncarnationId, string replyText, out string reason)
        {
            reason = "stale_turn";
            if (!ValidText(replyText, 2048))
            {
                reason = "invalid_reply";
                return false;
            }
            if (!IsCurrent(turnId, leaseId, generation, actorIncarnationId))
                return false;
            NativeTurnPermit permit = live[Guid.Parse(turnId)];
            if (!permit.StageReply(replyText))
            {
                reason = "reply_already_staged";
                return false;
            }
            reason = "staged_not_played";
            return true;
        }

        public bool TryCancel(string turnId, string leaseId, string generation, string actorIncarnationId)
        {
            if (!IsCurrent(turnId, leaseId, generation, actorIncarnationId))
                return false;
            var permit = live[Guid.Parse(turnId)];
            Retire(permit);
            return true;
        }

        private void Retire(NativeTurnPermit permit)
        {
            if (permit.Retired) return;
            permit.Retired = true;
            live.Remove(permit.TurnId);
            authority.TryRelease(permit.Lease);
        }

        public void Sweep()
        {
            var snapshot = new List<NativeTurnPermit>(live.Values);
            foreach (NativeTurnPermit permit in snapshot)
                if (!authority.IsLeaseCurrent(permit.Lease)) Retire(permit);
        }

        // Invalidates all outstanding conversations before a transport restart,
        // a native world reset, or shutdown. Never resumes an old permit.
        public void RetireAll()
        {
            foreach (NativeTurnPermit permit in new List<NativeTurnPermit>(live.Values))
                Retire(permit);
            sessions.Clear(); // world/transport changed; never link new owner to old identity
        }
    }
}
