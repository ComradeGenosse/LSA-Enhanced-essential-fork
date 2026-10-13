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
        internal int PendingBytes;
        internal int ForwardedBytes;
        internal int MarkedSegments;
        internal int MarkedBytes;
        internal readonly List<int> SegmentEndBytes = new List<int>();
        internal int LastPhysicalPlayedBytes;
        internal int LastLipPresentedBytes;
        internal int LastPhysicalCompletedSegments;
        internal bool PhysicalFailed;
        internal bool OutputStarted;
        internal bool OutputSealed;
        public int BufferedBytes { get { return Bytes; } }
        public int QueuedBytes { get { return PendingBytes; } }
        public int ForwardedNotPlayedBytes { get { return ForwardedBytes; } }
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
    /// Explicitly non-audible test output. Validates and accounts bounded PCM
    /// on the native owner fiber, then releases queue credit without retaining
    /// samples. This is NOT IPhysicalAudioOutput: it can never supply a driver,
    /// playback-completed or lip-sync receipt. NativeAuthority is rechecked on
    /// every call; the native registry still owns its stream/lease lifecycle.
    /// </summary>
    public sealed class DiagnosticPcmOutput : IAudioOutput
    {
        private sealed class State
        {
            internal OwnershipLease Lease;
            internal int Bytes;
            internal uint Checksum = 2166136261;
        }
        private readonly NativeAuthority authority;
        private readonly Dictionary<Guid, State> streams = new Dictionary<Guid, State>();
        public int ActiveStreams { get { return streams.Count; } }

        public DiagnosticPcmOutput(NativeAuthority authority)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
        }

        public bool TryBegin(OwnershipLease lease, Guid stream, int rate, out string reason)
        {
            reason = "diagnostic_escrow_rejected";
            if (lease == null || lease.Kind != LeaseKind.Audio ||
                !authority.IsLeaseCurrent(lease) || stream == Guid.Empty ||
                rate != NativeAudioRegistry.Rate || streams.ContainsKey(stream) ||
                streams.Count >= NativeAudioRegistry.MaxStreams) return false;
            streams.Add(stream, new State { Lease = lease });
            reason = "diagnostic_escrow_started_not_played";
            return true;
        }

        public bool TryPush(OwnershipLease lease, Guid stream, byte[] pcm, out string reason)
        {
            reason = "diagnostic_escrow_rejected";
            State current;
            if (lease == null || lease.Kind != LeaseKind.Audio ||
                !authority.IsLeaseCurrent(lease) ||
                !streams.TryGetValue(stream, out current) ||
                !current.Lease.SameClaim(lease) ||
                pcm == null || pcm.Length < 2 || pcm.Length > NativeAudioRegistry.MaxChunkBytes ||
                (pcm.Length & 1) != 0 ||
                current.Bytes > NativeAudioRegistry.MaxStreamBytes - pcm.Length) return false;
            // Account every validated byte, but never retain PCM or touch devices.
            unchecked
            {
                foreach (byte value in pcm)
                    current.Checksum = (current.Checksum ^ value) * 16777619;
            }
            current.Bytes += pcm.Length;
            reason = "diagnostic_pcm_validated_not_played";
            return true;
        }

        public bool TryStop(Guid stream, string reason)
        {
            return streams.Remove(stream);
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
        public const int MaxChunks = 480; // 30s maximum, not a 30s RAM allocation
        public const int MaxStreamBytes = 1440000; // 30s @ 24k mono PCM16
        public const int MaxPendingBytes = 192000; // only 4s may queue per actor
        public const int MaxStreams = 4;
        private readonly NativeAuthority authority;
        private readonly NativeTurnRegistry turns;
        private readonly IAudioOutput output;
        private readonly ILipSyncPresenter lip;
        private readonly Dictionary<Guid, NativeAudioTicket> streams =
            new Dictionary<Guid, NativeAudioTicket>();

        public NativeAudioRegistry(NativeAuthority authority, NativeTurnRegistry turns,
            IAudioOutput output = null, ILipSyncPresenter lip = null)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
            this.turns = turns ?? throw new ArgumentNullException(nameof(turns));
            // Null means NO output backend, not a silent sink. Queue eventually
            // backpressures. Never discard accepted PCM to fake progress.
            this.output = output;
            if (lip != null && !(output is IPhysicalAudioOutput))
                throw new ArgumentException("lip_requires_physical_output");
            this.lip = lip;
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
            // Segment mode can only enqueue PCM for an already admitted,
            // not-yet-marked native text segment. A malicious/stale producer
            // cannot put extra bytes between speech segments or after final.
            reason = "segment_not_authorized";
            if (stream.Turn.StagedReply == null &&
                stream.MarkedSegments >= stream.Turn.SpeechSegments.Count)
                return false;
            reason = "bad_pcm_chunk";
            if (pcm == null || pcm.Length < 2 || pcm.Length > MaxChunkBytes ||
                (pcm.Length & 1) != 0) return false;
            reason = "audio_out_of_order";
            if (chunkIndex != stream.NextIndex) return false;
            reason = "audio_backpressure";
            if (stream.NextIndex >= MaxChunks || stream.Bytes > MaxStreamBytes - pcm.Length ||
                stream.PendingBytes > MaxPendingBytes - pcm.Length)
                return false;
            var copy = new byte[pcm.Length];
            Buffer.BlockCopy(pcm, 0, copy, 0, pcm.Length);
            stream.Chunks.Add(copy);
            stream.NextIndex++;
            stream.Bytes += copy.Length;
            stream.PendingBytes += copy.Length;
            reason = "buffered_not_played";
            return true;
        }

        // Each speech segment's PCM boundary must be acknowledged in order
        // before the next segment is permitted. A marker can only follow
        // actual native-accepted bytes and current source-time speech text.
        public bool TryMarkSegment(string streamId, string audioLeaseId, string generation,
            string turnId, string actorId, int segmentIndex, int cumulativeBytes,
            out string reason)
        {
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out var stream, out reason)) return false;
            reason = "segment_audio_invalid";
            if (stream.Sealed || stream.Turn.StagedReply != null ||
                segmentIndex != stream.MarkedSegments || cumulativeBytes <= stream.MarkedBytes ||
                cumulativeBytes != stream.Bytes ||
                !turns.IsSpeechSegmentCurrent(stream.Turn, segmentIndex)) return false;
            stream.MarkedBytes = cumulativeBytes;
            stream.SegmentEndBytes.Add(cumulativeBytes);
            stream.MarkedSegments++;
            reason = "segment_audio_buffered_not_played";
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
                totalBytes != stream.Bytes ||
                (stream.Turn.StagedReply == null &&
                    (!stream.Turn.SpeechFinal ||
                     stream.MarkedSegments != stream.Turn.SpeechSegments.Count ||
                     stream.MarkedBytes != stream.Bytes))) return false;
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


        // Queue credits require an explicit native IAudioOutput accepting exact bytes.
        // The diagnostic validator is non-audible; device playback, lip-sync and
        // completion still require separate IPhysicalAudioOutput receipts.
        public int DrainOnOwner(int maxChunks)
        {
            if (maxChunks < 0 || maxChunks > 64)
                throw new ArgumentOutOfRangeException(nameof(maxChunks));
            Sweep();
            if (output == null || maxChunks == 0) return 0;
            int forwarded = 0;
            foreach (NativeAudioTicket stream in new List<NativeAudioTicket>(streams.Values))
            {
                if (forwarded >= maxChunks) break;
                if (!authority.IsLeaseCurrent(stream.Lease) ||
                    !turns.IsStagedPermitCurrent(stream.Turn))
                { Retire(stream); continue; }
                if (!stream.OutputStarted)
                {
                    bool accepted = false;
                    try
                    {
                        accepted = output.TryBegin(stream.Lease, stream.StreamId,
                            stream.SampleRate, out _);
                    }
                    catch { }
                    if (!accepted) continue;
                    stream.OutputStarted = true;
                }
                while (stream.Chunks.Count > 0 && forwarded < maxChunks)
                {
                    if (!authority.IsLeaseCurrent(stream.Lease) ||
                        !turns.IsStagedPermitCurrent(stream.Turn))
                    { Retire(stream); break; }
                    byte[] front = stream.Chunks[0];
                    bool accepted = false;
                    try
                    {
                        accepted = output.TryPush(stream.Lease, stream.StreamId,
                            front, out _);
                    }
                    catch { }
                    if (!accepted) break; // device rejected; no credit minting
                    stream.Chunks.RemoveAt(0);
                    stream.PendingBytes -= front.Length;
                    stream.ForwardedBytes += front.Length;
                    forwarded++;
                }
                // Source EOS and device EOS are different events. Seal output
                // only after every source byte has reached this physical sink.
                var physical = output as IPhysicalAudioOutput;
                if (!stream.Retired && physical != null && stream.Sealed &&
                    !stream.OutputSealed && stream.ForwardedBytes == stream.Bytes)
                {
                    try
                    {
                        if (physical.TrySeal(stream.Lease, stream.StreamId,
                            stream.Bytes, out _))
                            stream.OutputSealed = true;
                    }
                    catch { } // no receipt on an unknown outcome
                }
            }
            return forwarded;
        }

        public bool TryStatus(string streamId, string audioLeaseId, string generation,
            string turnId, string actorId, out int queuedBytes,
            out int acceptedBytes, out int forwardedBytes, out bool sealedStream)
        {
            queuedBytes = acceptedBytes = forwardedBytes = 0;
            sealedStream = false;
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out var stream, out _)) return false;
            queuedBytes = stream.PendingBytes;
            acceptedBytes = stream.Bytes;
            forwardedBytes = stream.ForwardedBytes;
            sealedStream = stream.Sealed;
            return true;
        }

        // Native-exclusive projection from the physical device into exact
        // admitted PCM segment boundaries. These are monotonic observations,
        // NOT conversation-history mutations or claims that a listener heard.
        public bool TryPhysicalProgress(string streamId, string audioLeaseId,
            string generation, string turnId, string actorId,
            out AudioPlaybackSnapshot snapshot, out int completedSegments,
            out int markedSegments, out bool finalSegments)
        {
            snapshot = null;
            completedSegments = markedSegments = 0;
            finalSegments = false;
            NativeAudioTicket stream;
            string reason;
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out stream, out reason)) return false;
            var physical = output as IPhysicalAudioOutput;
            if (physical == null || !stream.OutputStarted) return false;
            try
            {
                AudioPlaybackSnapshot value;
                if (!physical.TryRead(stream.Lease, stream.StreamId, out value) ||
                    value == null || value.PlayedSourceBytes < 0 ||
                    value.PlayedSourceBytes < stream.LastPhysicalPlayedBytes ||
                    value.PlayedSourceBytes > stream.ForwardedBytes ||
                    value.SubmittedSourceBytes != stream.ForwardedBytes ||
                    value.MouthLevel < 0 || value.MouthLevel > 100 ||
                    (value.State != "authorized" && value.State != "device_accepted" &&
                     value.State != "playback_started" &&
                     value.State != "playback_completed" && value.State != "failed") ||
                    (value.State == "authorized" && value.PlayedSourceBytes != 0) ||
                    (value.State == "device_accepted" && value.PlayedSourceBytes != 0) ||
                    (value.State == "playback_started" && value.PlayedSourceBytes == 0) ||
                    (value.State == "playback_completed" &&
                      (!stream.Sealed || !stream.OutputSealed ||
                       value.PlayedSourceBytes != stream.Bytes)) ||
                    (stream.PhysicalFailed && value.State != "failed"))
                    return false;

                // Legacy full-answer PCM becomes one segment ONLY after EOS.
                // Streaming has explicit native-validated monotonic boundaries.
                bool legacy = stream.Turn.StagedReply != null;
                markedSegments = legacy ? (stream.Sealed ? 1 : 0) :
                    stream.SegmentEndBytes.Count;
                if (legacy)
                    completedSegments = stream.Sealed &&
                        value.PlayedSourceBytes >= stream.Bytes ? 1 : 0;
                else
                    foreach (int boundary in stream.SegmentEndBytes)
                    {
                        if (boundary > value.PlayedSourceBytes) break;
                        completedSegments++;
                    }
                if (completedSegments < stream.LastPhysicalCompletedSegments ||
                    completedSegments > markedSegments) return false;
                // Only a confirmed native final turn and native source EOS
                // permits finalSegments, never mere device acceptance.
                finalSegments = stream.Sealed &&
                    (legacy || stream.Turn.SpeechFinal);
                if (value.State == "playback_completed" &&
                    (!finalSegments || completedSegments != markedSegments))
                    return false;
                stream.LastPhysicalPlayedBytes = value.PlayedSourceBytes;
                stream.LastPhysicalCompletedSegments = completedSegments;
                if (value.State == "failed") stream.PhysicalFailed = true;
                snapshot = value;
                return true;
            }
            catch { return false; }
        }

        // Retained for native callers that only need output lifecycle, not
        // the exact segment-prefix proof.
        public bool TryPhysicalStatus(string streamId, string audioLeaseId,
            string generation, string turnId, string actorId,
            out AudioPlaybackSnapshot snapshot)
        {
            int completed, marked; bool final;
            return TryPhysicalProgress(streamId, audioLeaseId, generation,
                turnId, actorId, out snapshot, out completed, out marked, out final);
        }

        // S3 presentation: only device-progress-backed PCM energy may cue
        // a game-facing facial effect. Never use TTS-time / queued bytes.
        // No device, no presenter, no current actor, no advancing actual
        // playback, and no non-silent envelope => NO facial side effect.
        public int PumpLipSyncOnOwner(int budget)
        {
            if (budget < 0 || budget > MaxStreams)
                throw new ArgumentOutOfRangeException(nameof(budget));
            Sweep();
            if (budget == 0 || lip == null || !(output is IPhysicalAudioOutput))
                return 0;
            int cues = 0, visited = 0;
            foreach (NativeAudioTicket stream in new List<NativeAudioTicket>(streams.Values))
            {
                if (visited++ >= budget) break;
                if (stream.Retired || !stream.OutputStarted) continue;
                AudioPlaybackSnapshot snapshot;
                int completed, marked; bool final;
                if (!TryPhysicalProgress(stream.StreamId.ToString("D"),
                    stream.AudioLeaseId.ToString("D"), stream.AudioGeneration,
                    stream.TurnId.ToString("D"), stream.ActorIncarnationId.ToString("D"),
                    out snapshot, out completed, out marked, out final)) continue;
                if (snapshot.PlayedSourceBytes <= stream.LastLipPresentedBytes ||
                    snapshot.State != "playback_started" ||
                    snapshot.MouthLevel < 12) continue;
                stream.LastLipPresentedBytes = snapshot.PlayedSourceBytes;
                try
                {
                    // Presenter MUST re-check current native actor/lease,
                    // combat arbitration and its own rate cap.
                    if (lip.TryPulse(stream.Lease, stream.StreamId,
                        snapshot.MouthLevel)) cues++;
                }
                catch { } // no guessed mouth motion on exception
            }
            return cues;
        }

        // One-shot, exact native device-completion acknowledgment. This only
        // releases native output resources; it does NOT commit conversation
        // history or assert that any in-world observer heard the words.
        public bool TryAcknowledgePlayback(string streamId, string audioLeaseId,
            string generation, string turnId, string actorId)
        {
            AudioPlaybackSnapshot value;
            int completed, marked; bool final;
            if (!TryPhysicalProgress(streamId, audioLeaseId, generation,
                turnId, actorId, out value, out completed, out marked, out final) ||
                value.State != "playback_completed" || !final ||
                marked < 1 || completed != marked) return false;
            NativeAudioTicket stream;
            string reason;
            if (!TryCurrent(streamId, audioLeaseId, generation, turnId, actorId,
                out stream, out reason)) return false;
            Retire(stream);
            return true;
        }

        private void Retire(NativeAudioTicket stream)
        {
            if (stream.Retired) return;
            stream.Retired = true;
            streams.Remove(stream.StreamId);
            // Forget only: stale/recycled entities must NEVER be modified
            // during cleanup, even if this stream previously animated them.
            try { lip?.Forget(stream.StreamId); } catch { }
            // Drop all raw PCM on cancel, shutdown, actor invalidation, or
            // transport reset; there is no durable audio file.
            stream.Chunks.Clear();
            stream.PendingBytes = 0;
            if (stream.OutputStarted && output != null)
            {
                try { output.TryStop(stream.StreamId, "native_retired"); } catch {}
            }
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
