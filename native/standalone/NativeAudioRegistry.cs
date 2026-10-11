using System;
using System.Collections.Generic;
using System.Globalization;

namespace LSA.Standalone
{
    // Exact physical actor + exact staged text turn authorizes a new audio lease.
    // Never confuses byte receipt, buffering, or EOS with audible playback.
    public sealed class NativeAudioTicket
    {
        public readonly Guid StreamId;
        public readonly Guid TurnId;
        public readonly Guid ActorIncarnationId;
        public readonly Guid AudioLeaseId;
        public readonly string AudioGeneration;
        public readonly int SampleRate;
        internal readonly OwnershipLease Lease;
        internal readonly NativeTurnPermit Turn;
        internal readonly List<byte[]> Chunks = new List<byte[]>();
        internal int NextIndex;
        internal int Bytes;
        public int BufferedBytes { get { return Bytes; } }
        public int BufferedChunks { get { return NextIndex; } }
        public int RetainedChunks { get { return Chunks.Count; } }
        public bool IsSealed { get { return Sealed; } }
        internal bool Sealed;
        internal bool Retired;
        internal NativeAudioTicket(NativeTurnPermit turn, OwnershipLease lease, int sampleRate)
        {
            StreamId = Guid.NewGuid();
            TurnId = turn.TurnId;
            ActorIncarnationId = turn.ActorIncarnationId;
            AudioLeaseId = lease.LeaseId;
            AudioGeneration = lease.Generation.ToString(CultureInfo.InvariantCulture);
            SampleRate = sampleRate;
            Lease = lease;
            Turn = turn;
        }
    }

    /// <summary>
    /// Phase 4 audio escrow: validated PCM16LE mono bytes, bounded in memory,
    /// zero playback side effects. Every operation must execute on the native
    /// owner's game fiber. Only an actual device callback in a future adapter
    /// can promote a sealed stream to a playback-completed receipt.
    /// </summary>
    public sealed class NativeAudioRegistry
    {
        public const int Rate = 24000;
        public const int MaxChunkBytes = 3000;
        public const int MaxChunks = 64;
        public const int MaxStreamBytes = 192000; // 4s @ 24k mono PCM16
        public const int MaxStreams = 4;
        private readonly NativeAuthority authority;
        private readonly NativeTurnRegistry turns;
        private readonly Dictionary<Guid, NativeAudioTicket> streams =
            new Dictionary<Guid, NativeAudioTicket>();

        public NativeAudioRegistry(NativeAuthority authority, NativeTurnRegistry turns)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
            this.turns = turns ?? throw new ArgumentNullException(nameof(turns));
        }

        public bool TryOpen(string turnId, string actorId, string conversationLeaseId,
            string generation, int sampleRate, out NativeAudioTicket ticket, out string reason)
        {
            ticket = null;
            reason = "invalid_audio_format";
            if (sampleRate != Rate) return false;
            Sweep();
            reason = "audio_capacity";
            if (streams.Count >= MaxStreams) return false;
            NativeTurnPermit turn;
            if (!turns.TryGetStagedPermit(turnId, conversationLeaseId, generation, actorId,
                out turn))
            { reason = "stale_or_unstaged_turn"; return false; }
            foreach (NativeAudioTicket old in streams.Values)
                if (old.Turn.TurnId == turn.TurnId)
                { reason = "duplicate_audio_open"; return false; }
            OwnershipLease lease;
            if (!authority.TryAcquire(turn.Lease.Actor, LeaseKind.Audio, "standalone-pcm",
                60000, out lease, out reason))
                return false;
            ticket = new NativeAudioTicket(turn, lease, Rate);
            streams.Add(ticket.StreamId, ticket);
            reason = "audio_authorized_not_playing";
            return true;
        }

        private bool TryCurrent(string streamId, string audioLeaseId, string generation,
            string turnId, string actorId, out NativeAudioTicket ticket, out string reason)
        {
            ticket = null;
            reason = "stale_audio";
            if (!Guid.TryParseExact(streamId, "D", out var sid) ||
                !streams.TryGetValue(sid, out ticket) || ticket.Retired ||
                ticket.AudioLeaseId.ToString("D") != audioLeaseId ||
                ticket.AudioGeneration != generation ||
                ticket.TurnId.ToString("D") != turnId ||
                ticket.ActorIncarnationId.ToString("D") != actorId)
                return false;
            if (!authority.IsLeaseCurrent(ticket.Lease) ||
                !turns.IsStagedPermitCurrent(ticket.Turn))
            {
                Retire(ticket);
                reason = "audio_lease_expired";
                return false;
            }
            reason = "current";
            return true;
        }

        public bool TryAppend(string streamId, string audioLeaseId, string generation,
            string turnId, string actorId, int chunkIndex, byte[] pcm,
            out string reason)
        {
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out var stream, out reason)) return false;
            reason = "audio_sealed";
            if (stream.Sealed) return false;
            reason = "bad_pcm_chunk";
            if (pcm == null || pcm.Length < 2 || pcm.Length > MaxChunkBytes ||
                (pcm.Length & 1) != 0) return false;
            reason = "audio_out_of_order";
            if (chunkIndex != stream.NextIndex) return false;
            reason = "audio_backpressure";
            if (stream.NextIndex >= MaxChunks || stream.Bytes > MaxStreamBytes - pcm.Length)
                return false;
            var copy = new byte[pcm.Length];
            Buffer.BlockCopy(pcm, 0, copy, 0, pcm.Length);
            stream.Chunks.Add(copy);
            stream.NextIndex++;
            stream.Bytes += copy.Length;
            reason = "buffered_not_played";
            return true;
        }

        public bool TrySeal(string streamId, string audioLeaseId, string generation,
            string turnId, string actorId, int chunkCount, int totalBytes, out string reason)
        {
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out var stream, out reason)) return false;
            reason = "audio_already_sealed";
            if (stream.Sealed) return false;
            reason = "audio_incomplete";
            if (chunkCount < 1 || chunkCount != stream.NextIndex ||
                totalBytes != stream.Bytes) return false;
            stream.Sealed = true;
            // No IAudioOutput/device has accepted these buffers yet.
            reason = "sealed_not_played";
            return true;
        }

        public bool TryCancel(string streamId, string audioLeaseId, string generation,
            string turnId, string actorId)
        {
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out var stream, out _)) return false;
            Retire(stream);
            return true;
        }

        private void Retire(NativeAudioTicket stream)
        {
            if (stream.Retired) return;
            stream.Retired = true;
            streams.Remove(stream.StreamId);
            // Drop all raw PCM on cancel, shutdown, actor invalidation, or
            // transport reset; there is no durable audio file.
            stream.Chunks.Clear();
            authority.TryRelease(stream.Lease);
        }

        public void Sweep()
        {
            foreach (NativeAudioTicket stream in new List<NativeAudioTicket>(streams.Values))
                if (!authority.IsLeaseCurrent(stream.Lease) ||
                    !turns.IsStagedPermitCurrent(stream.Turn)) Retire(stream);
        }

        public void RetireAll()
        {
            foreach (NativeAudioTicket stream in new List<NativeAudioTicket>(streams.Values))
                Retire(stream);
        }
    }
}
