using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.Standalone;

namespace LSA.Standalone.RageHost
{
    /// <summary>
    /// Native-owned, single-client, SID-restricted duplex transport. The IPC worker
    /// parses bytes only. All lease minting/confirmation/cancellation and game reads
    /// are routed through DrainOwnerRequests on the single native owner fiber.
    /// </summary>
    internal sealed class StandalonePipeServer : IDisposable
    {
        public const string PipeName = "LSA.Standalone.Phase2.v1";
        private const int MaxFrameBytes = 8192;
        private const int MaxQueued = 32;
        private readonly Guid hostRunId;
        private readonly Func<int> worldEpoch;
        private readonly ConcurrentQueue<OwnerQuery> requests = new ConcurrentQueue<OwnerQuery>();
        private readonly ConcurrentQueue<NativeTurnPermit> pendingOffers = new ConcurrentQueue<NativeTurnPermit>();
        private readonly CancellationTokenSource stopping = new CancellationTokenSource();
        private readonly object pipeLock = new object();
        private readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
        private readonly JavaScriptSerializer json = new JavaScriptSerializer
            { MaxJsonLength = MaxFrameBytes, RecursionLimit = 8 };
        private Thread worker;
        private NamedPipeServerStream active;
        private int pendingCount, resetSignal, resetApplied;

        private sealed class OwnerQuery
        {
            public int Epoch;
            public int ResetGeneration;
            public string Type;
            public Dictionary<string, object> Frame;
            public readonly TaskCompletionSource<Dictionary<string, object>> Completion =
                new TaskCompletionSource<Dictionary<string, object>>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
        }

        public StandalonePipeServer(Guid run, Func<int> epoch)
        {
            if (run == Guid.Empty || epoch == null || epoch() < 1)
                throw new ArgumentException("invalid_host");
            hostRunId = run;
            worldEpoch = epoch;
        }

        public void Start()
        {
            if (worker != null) throw new InvalidOperationException("already_running");
            worker = new Thread(Serve) { Name = "LSA standalone named pipe", IsBackground = true };
            worker.Start();
        }

        // Native events only. Do not call on an IPC worker; phase 3 game sources
        // can offer exact, native-issued conversation permits.
        public bool Offer(NativeTurnPermit permit)
        {
            if (permit == null || permit.HostRunId != hostRunId ||
                permit.WorldEpoch != worldEpoch() || pendingOffers.Count >= 16 ||
                stopping.IsCancellationRequested) return false;
            pendingOffers.Enqueue(permit);
            return true;
        }

        public void DrainOwnerRequests(NativeAuthority authority, NativeTurnRegistry turns, NativeAudioRegistry audio, int budget)
        {
            if (authority == null || turns == null || audio == null || budget < 0 || budget > 32)
                throw new ArgumentException("invalid_owner_dispatch");
            int signal = Volatile.Read(ref resetSignal);
            if (signal != resetApplied)
            {
                audio.RetireAll();
                turns.RetireAll();
                while (pendingOffers.TryDequeue(out _)) { }
                resetApplied = signal;
            }
            turns.Sweep();
            audio.Sweep();
            for (int n = 0; n < budget && requests.TryDequeue(out var req); n++)
            {
                Interlocked.Decrement(ref pendingCount);
                var reply = new Dictionary<string, object> { { "status", "rejected" } };
                if (stopping.IsCancellationRequested || req.Epoch != authority.WorldEpoch ||
                    req.ResetGeneration != Volatile.Read(ref resetSignal))
                    reply["status"] = "stale_connection";
                else if (req.Type == "host.snapshot")
                {
                    reply["status"] = "ok";
                    reply["trackedActors"] = authority.TrackedActors;
                }
                else if (req.Type == "turn.next")
                {
                    // A server-selected offer is never a Node-minted actor.
                    if (pendingOffers.TryDequeue(out var offer))
                    {
                        if (offer.WorldEpoch == authority.WorldEpoch &&
                            turns.IsOfferedPermitCurrent(offer))
                        {
                            reply["status"] = "ok";
                            reply["turnId"] = offer.TurnId.ToString("D");
                            reply["conversationId"] = offer.ConversationId.ToString("D");
                            reply["turnOrdinal"] = offer.TurnOrdinal;
                            reply["sessionNonce"] = offer.SessionNonce.ToString("D");
                            reply["actorIncarnationId"] = offer.ActorIncarnationId.ToString("D");
                            reply["leaseId"] = offer.LeaseId.ToString("D");
                            reply["generation"] = offer.Generation;
                            reply["source"] = offer.Source;
                            if (offer.Source == "player_text" && offer.PlayerText != null)
                                reply["playerText"] = offer.PlayerText;
                        }
                        else reply["status"] = "offer_retired";
                    }
                    else reply["status"] = "none";
                }
                else if (req.Type == "turn.confirm")
                {
                    string reason;
                    bool accepted = turns.TryConfirm(Claim(req.Frame, "turnId"),
                        Claim(req.Frame, "sessionNonce"), Claim(req.Frame, "actorIncarnationId"),
                        Claim(req.Frame, "leaseId"), Claim(req.Frame, "generation"),
                        Claim(req.Frame, "source"), out reason);
                    reply["status"] = accepted ? "ok" : reason;
                }
                else if (req.Type == "turn.segment")
                {
                    string reason;
                    bool staged = turns.TryStageSpeechSegment(Claim(req.Frame, "turnId"),
                        Claim(req.Frame, "leaseId"), Claim(req.Frame, "generation"),
                        Claim(req.Frame, "actorIncarnationId"), ClaimInt(req.Frame, "segmentIndex"),
                        Claim(req.Frame, "segmentText"), out reason);
                    reply["status"] = staged ? "segment_staged_not_played" : reason;
                }
                else if (req.Type == "turn.segments.end")
                {
                    string reason;
                    bool finished = turns.TryFinishSpeechSegments(Claim(req.Frame, "turnId"),
                        Claim(req.Frame, "leaseId"), Claim(req.Frame, "generation"),
                        Claim(req.Frame, "actorIncarnationId"), ClaimInt(req.Frame, "segmentCount"),
                        out reason);
                    reply["status"] = finished ? "segments_final_not_played" : reason;
                }
                else if (req.Type == "turn.reply")
                {
                    string reason;
                    bool staged = turns.TryStageReply(Claim(req.Frame, "turnId"),
                        Claim(req.Frame, "leaseId"), Claim(req.Frame, "generation"),
                        Claim(req.Frame, "actorIncarnationId"),
                        Claim(req.Frame, "replyText"), out reason);
                    reply["status"] = staged ? "staged_not_played" : reason;
                }
                else if (req.Type == "audio.open")
                {
                    NativeAudioTicket ticket;
                    string reason;
                    bool opened = audio.TryOpen(Claim(req.Frame, "turnId"),
                        Claim(req.Frame, "actorIncarnationId"),
                        Claim(req.Frame, "leaseId"), Claim(req.Frame, "generation"),
                        ClaimInt(req.Frame, "sampleRate"), out ticket, out reason);
                    reply["status"] = opened ? "audio_authorized_not_playing" : reason;
                    if (opened)
                    {
                        reply["streamId"] = ticket.StreamId.ToString("D");
                        reply["audioLeaseId"] = ticket.AudioLeaseId.ToString("D");
                        reply["audioGeneration"] = ticket.AudioGeneration;
                        reply["sampleRate"] = ticket.SampleRate;
                    }
                }
                else if (req.Type == "audio.chunk")
                {
                    string reason = "invalid_pcm";
                    string encoded = Claim(req.Frame, "pcmBase64");
                    byte[] bytes = null;
                    if (encoded != null && encoded.Length <= 4000)
                    {
                        try
                        {
                            bytes = Convert.FromBase64String(encoded);
                            if (Convert.ToBase64String(bytes) != encoded) bytes = null;
                        }
                        catch (FormatException) { }
                    }
                    bool accepted = bytes != null && audio.TryAppend(Claim(req.Frame, "streamId"),
                        Claim(req.Frame, "audioLeaseId"), Claim(req.Frame, "audioGeneration"),
                        Claim(req.Frame, "turnId"), Claim(req.Frame, "actorIncarnationId"),
                        ClaimInt(req.Frame, "chunkIndex"), bytes, out reason);
                    reply["status"] = accepted ? "buffered_not_played" : reason;
                }
                else if (req.Type == "audio.status")
                {
                    int queued, accepted, forwarded;
                    bool sealedAudio;
                    bool valid = audio.TryStatus(Claim(req.Frame, "streamId"),
                        Claim(req.Frame, "audioLeaseId"), Claim(req.Frame, "audioGeneration"),
                        Claim(req.Frame, "turnId"), Claim(req.Frame, "actorIncarnationId"),
                        out queued, out accepted, out forwarded, out sealedAudio);
                    reply["status"] = valid ? "not_played" : "stale_audio";
                    if (valid)
                    {
                        reply["queuedBytes"] = queued;
                        reply["acceptedBytes"] = accepted;
                        reply["forwardedBytes"] = forwarded;
                        reply["creditsBytes"] = NativeAudioRegistry.MaxPendingBytes - queued;
                        reply["sealed"] = sealedAudio;
                    }
                }
                else if (req.Type == "audio.segment")
                {
                    string reason;
                    bool marked = audio.TryMarkSegment(Claim(req.Frame, "streamId"),
                        Claim(req.Frame, "audioLeaseId"), Claim(req.Frame, "audioGeneration"),
                        Claim(req.Frame, "turnId"), Claim(req.Frame, "actorIncarnationId"),
                        ClaimInt(req.Frame, "segmentIndex"), ClaimInt(req.Frame, "totalBytes"),
                        out reason);
                    reply["status"] = marked ? "segment_audio_buffered_not_played" : reason;
                }
                else if (req.Type == "audio.end")
                {
                    string reason;
                    bool sealedStream = audio.TrySeal(Claim(req.Frame, "streamId"),
                        Claim(req.Frame, "audioLeaseId"), Claim(req.Frame, "audioGeneration"),
                        Claim(req.Frame, "turnId"), Claim(req.Frame, "actorIncarnationId"),
                        ClaimInt(req.Frame, "chunkCount"), ClaimInt(req.Frame, "totalBytes"),
                        out reason);
                    reply["status"] = sealedStream ? "sealed_not_played" : reason;
                }
                else if (req.Type == "audio.cancel")
                {
                    bool cancelled = audio.TryCancel(Claim(req.Frame, "streamId"),
                        Claim(req.Frame, "audioLeaseId"), Claim(req.Frame, "audioGeneration"),
                        Claim(req.Frame, "turnId"), Claim(req.Frame, "actorIncarnationId"));
                    reply["status"] = cancelled ? "ok" : "stale_audio";
                }
                else if (req.Type == "turn.cancel")
                {
                    bool cancelled = turns.TryCancel(Claim(req.Frame, "turnId"),
                        Claim(req.Frame, "leaseId"), Claim(req.Frame, "generation"),
                        Claim(req.Frame, "actorIncarnationId"));
                    reply["status"] = cancelled ? "ok" : "stale_turn";
                }
                req.Completion.TrySetResult(reply);
            }
        }

        private static string Claim(Dictionary<string, object> value, string key)
        {
            return value.TryGetValue(key, out var raw) && raw is string ? (string)raw : null;
        }

        private static int ClaimInt(Dictionary<string, object> value, string key)
        {
            return value.TryGetValue(key, out var raw) && raw is int ? (int)raw : -1;
        }

        private void Serve()
        {
            while (!stopping.IsCancellationRequested)
            {
                NamedPipeServerStream pipe = null;
                try
                {
                    var sid = WindowsIdentity.GetCurrent().User;
                    var security = new PipeSecurity();
                    security.SetAccessRuleProtection(true, false);
                    security.SetOwner(sid);
                    security.AddAccessRule(new PipeAccessRule(sid,
                        PipeAccessRights.FullControl, AccessControlType.Allow));
                    pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 8192, 8192, security);
                    lock (pipeLock) { if (stopping.IsCancellationRequested) break; active = pipe; }
                    pipe.WaitForConnectionAsync(stopping.Token).GetAwaiter().GetResult();
                    if (!stopping.IsCancellationRequested) ServeClient(pipe);
                }
                catch { if (!stopping.IsCancellationRequested) Thread.Sleep(100); }
                finally
                {
                    // This guarantees old connection-owned native permits are
                    // retired before the next owner-fiber dispatch, not replayed.
                    Interlocked.Increment(ref resetSignal);
                    lock (pipeLock) { if (ReferenceEquals(active, pipe)) active = null; }
                    try { pipe?.Dispose(); } catch {}
                }
            }
        }

        private void ServeClient(NamedPipeServerStream pipe)
        {
            using (var watchdog = new Timer(_ => { try { pipe.Dispose(); } catch {} },
                null, 7000, Timeout.Infinite))
            {
                Guid transport = Guid.NewGuid();
                int epoch = worldEpoch();
                int nextOutbound = 0;
                int nextInbound = 1;
                int generation = Volatile.Read(ref resetSignal);
                Send(pipe, Envelope("host.hello", transport, epoch, nextOutbound));
                var hello = Receive(pipe);
                if (!Valid(hello, "client.hello", transport, epoch, nextInbound, false))
                    return;
                Send(pipe, Envelope("host.ready", transport, epoch, ++nextOutbound));
                while (!stopping.IsCancellationRequested)
                {
                    watchdog.Change(7000, Timeout.Infinite);
                    var frame = Receive(pipe);
                    if (worldEpoch() != epoch || generation != Volatile.Read(ref resetSignal) ||
                        nextInbound == int.MaxValue || nextOutbound == int.MaxValue ||
                        !Valid(frame, null, transport, epoch, ++nextInbound, true))
                        return;
                    string type = (string)frame["type"];
                    string requestId = (string)frame["requestId"];
                    string responseType = type == "health.ping" ? "health.pong" :
                        type == "host.snapshot" ? "host.snapshot.result" :
                        type == "turn.next" ? "turn.next.result" :
                        type == "turn.confirm" ? "turn.confirm.result" :
                        type == "turn.cancel" ? "turn.cancel.result" :
                        type == "turn.reply" ? "turn.reply.result" :
                        type == "turn.segment" ? "turn.segment.result" :
                        type == "turn.segments.end" ? "turn.segments.end.result" :
                        type == "audio.open" ? "audio.open.result" :
                        type == "audio.chunk" ? "audio.chunk.result" :
                        type == "audio.status" ? "audio.status.result" :
                        type == "audio.end" ? "audio.end.result" :
                        type == "audio.segment" ? "audio.segment.result" :
                        type == "audio.cancel" ? "audio.cancel.result" : "request.rejected";
                    var payload = new Dictionary<string, object>();
                    if (type == "health.ping")
                        payload["status"] = "ok";
                    else if (type == "host.snapshot" || type == "turn.next" ||
                             type == "turn.confirm" || type == "turn.cancel" ||
                             type == "turn.reply" || type == "turn.segment" ||
                             type == "turn.segments.end" || type == "audio.segment" ||
                             type == "audio.open" || type == "audio.chunk" ||
                             type == "audio.end" || type == "audio.cancel" ||
                             type == "audio.status")
                    {
                        if (!ValidCommandFields(type, frame)) return;
                        if (Interlocked.Increment(ref pendingCount) > MaxQueued)
                        {
                            Interlocked.Decrement(ref pendingCount);
                            return;
                        }
                        var query = new OwnerQuery {
                            Epoch = epoch, ResetGeneration = generation,
                            Type = type, Frame = frame
                        };
                        requests.Enqueue(query);
                        if (!query.Completion.Task.Wait(1500)) return;
                        payload = query.Completion.Task.Result;
                    }
                    else payload["status"] = "unsupported";
                    if (worldEpoch() != epoch || generation != Volatile.Read(ref resetSignal))
                        return;
                    var response = Envelope(responseType, transport, epoch, ++nextOutbound);
                    response["requestId"] = requestId;
                    foreach (var field in payload) response[field.Key] = field.Value;
                    Send(pipe, response);
                }
            }
        }

        private static bool ValidCommandFields(string type, Dictionary<string, object> frame)
        {
            int count = type == "turn.confirm" ? 13 :
                type == "turn.cancel" ? 11 : type == "turn.reply" ? 12 :
                type == "turn.segment" ? 13 :
                type == "turn.segments.end" ? 12 :
                type == "audio.open" || type == "audio.cancel" ||
                type == "audio.status" ? 12 :
                type == "audio.chunk" || type == "audio.end" ||
                type == "audio.segment" ? 14 : 7;
            if (frame.Count != count) return false;
            if (type == "turn.confirm")
                return Fields(frame, "turnId", "sessionNonce", "actorIncarnationId",
                    "leaseId", "generation", "source");
            if (type == "turn.segment")
                return Fields(frame, "turnId", "actorIncarnationId", "leaseId", "generation") &&
                    IntField(frame, "segmentIndex", 0, NativeTurnRegistry.MaxSpeechSegments - 1) &&
                    frame.TryGetValue("segmentText", out var segment) && segment is string &&
                    ((string)segment).Length > 0 && ((string)segment).Length <= 500;
            if (type == "turn.segments.end")
                return Fields(frame, "turnId", "actorIncarnationId", "leaseId", "generation") &&
                    IntField(frame, "segmentCount", 1, NativeTurnRegistry.MaxSpeechSegments);
            if (type == "turn.reply")
                return Fields(frame, "turnId", "actorIncarnationId",
                    "leaseId", "generation") &&
                    frame.TryGetValue("replyText", out var reply) &&
                    reply is string && ((string)reply).Length > 0 &&
                    ((string)reply).Length <= 2048;
            if (type == "turn.cancel")
                return Fields(frame, "turnId", "actorIncarnationId", "leaseId", "generation");
            if (type == "audio.open")
                return Fields(frame, "turnId", "actorIncarnationId", "leaseId", "generation") &&
                    IntField(frame, "sampleRate", NativeAudioRegistry.Rate,
                        NativeAudioRegistry.Rate);
            if (type == "audio.cancel" || type == "audio.status")
                return Fields(frame, "streamId", "audioLeaseId", "audioGeneration",
                    "turnId", "actorIncarnationId");
            if (type == "audio.chunk")
                return Fields(frame, "streamId", "audioLeaseId", "audioGeneration",
                        "turnId", "actorIncarnationId") &&
                    IntField(frame, "chunkIndex", 0, NativeAudioRegistry.MaxChunks - 1) &&
                    frame.TryGetValue("pcmBase64", out var pcm) && pcm is string &&
                    ((string)pcm).Length > 0 && ((string)pcm).Length <= 4000;
            if (type == "audio.segment")
                return Fields(frame, "streamId", "audioLeaseId", "audioGeneration",
                        "turnId", "actorIncarnationId") &&
                    IntField(frame, "segmentIndex", 0, NativeTurnRegistry.MaxSpeechSegments - 1) &&
                    IntField(frame, "totalBytes", 2, NativeAudioRegistry.MaxStreamBytes);
            if (type == "audio.end")
                return Fields(frame, "streamId", "audioLeaseId", "audioGeneration",
                        "turnId", "actorIncarnationId") &&
                    IntField(frame, "chunkCount", 1, NativeAudioRegistry.MaxChunks) &&
                    IntField(frame, "totalBytes", 2, NativeAudioRegistry.MaxStreamBytes);
            return true;
        }

        private static bool IntField(Dictionary<string, object> frame,
            string key, int min, int max)
        {
            return frame.TryGetValue(key, out var raw) &&
                raw is int && (int)raw >= min && (int)raw <= max;
        }

        private static bool Fields(Dictionary<string, object> frame, params string[] names)
        {
            foreach (string name in names)
                if (!frame.TryGetValue(name, out var raw) || !(raw is string) ||
                    ((string)raw).Length == 0 || ((string)raw).Length > 80)
                    return false;
            return true;
        }

        private Dictionary<string, object> Envelope(string type, Guid transport, int epoch, int seq)
        {
            return new Dictionary<string, object> {
                {"v", 1}, {"type", type}, {"hostRunId", hostRunId.ToString("D")},
                {"worldEpoch", epoch}, {"transportId", transport.ToString("D")}, {"seq", seq}
            };
        }

        private bool Valid(Dictionary<string, object> value, string expectedType,
            Guid transport, int epoch, int seq, bool withRequestId)
        {
            if (value == null || value.Count < (withRequestId ? 7 : 6) ||
                !value.TryGetValue("v", out var version) || !(version is int) || (int)version != 1 ||
                !value.TryGetValue("type", out var kind) || !(kind is string) ||
                (expectedType != null && (string)kind != expectedType) ||
                !value.TryGetValue("hostRunId", out var run) || !(run is string) ||
                (string)run != hostRunId.ToString("D") ||
                !value.TryGetValue("worldEpoch", out var world) || !(world is int) || (int)world != epoch ||
                !value.TryGetValue("transportId", out var id) || !(id is string) ||
                (string)id != transport.ToString("D") ||
                !value.TryGetValue("seq", out var actual) || !(actual is int) || (int)actual != seq)
                return false;
            if (!withRequestId) return value.Count == 6;
            if (!value.TryGetValue("requestId", out var request) ||
                !(request is string) || !Guid.TryParseExact((string)request, "D", out _))
                return false;
            string type = (string)kind;
            // Unknown requests get a bounded reject, but cannot smuggle additional
            // ambiguous identity or actor claims.
            return type == "turn.confirm" ? value.Count == 13 :
                type == "turn.cancel" ? value.Count == 11 :
                type == "turn.reply" || type == "turn.segments.end" ? value.Count == 12 :
                type == "turn.segment" ? value.Count == 13 :
                type == "audio.open" || type == "audio.cancel" ||
                type == "audio.status" ? value.Count == 12 :
                type == "audio.chunk" || type == "audio.end" ||
                type == "audio.segment" ? value.Count == 14 :
                value.Count == 7;
        }

        private Dictionary<string, object> Receive(Stream stream)
        {
            byte[] header = Exact(stream, 4);
            uint length = BitConverter.ToUInt32(header, 0);
            if (length == 0 || length > MaxFrameBytes)
                throw new InvalidDataException("invalid_frame_length");
            string value = utf8.GetString(Exact(stream, (int)length));
            var result = json.Deserialize<Dictionary<string, object>>(value);
            if (result == null) throw new InvalidDataException("invalid_json");
            return result;
        }

        private void Send(Stream stream, object value)
        {
            byte[] data = utf8.GetBytes(json.Serialize(value));
            if (data.Length == 0 || data.Length > MaxFrameBytes)
                throw new InvalidDataException("invalid_frame_length");
            byte[] header = BitConverter.GetBytes((uint)data.Length);
            stream.Write(header, 0, 4);
            stream.Write(data, 0, data.Length);
            stream.Flush();
        }

        private static byte[] Exact(Stream stream, int length)
        {
            var bytes = new byte[length];
            for (int offset = 0; offset < length;)
            {
                int read = stream.Read(bytes, offset, length - offset);
                if (read <= 0) throw new EndOfStreamException();
                offset += read;
            }
            return bytes;
        }

        public void StopAdmission()
        {
            if (stopping.IsCancellationRequested) return;
            stopping.Cancel();
            lock (pipeLock) { try { active?.Dispose(); } catch {} }
            while (requests.TryDequeue(out var req))
            {
                Interlocked.Decrement(ref pendingCount);
                req.Completion.TrySetResult(new Dictionary<string, object>
                    { { "status", "native_stopping" } });
            }
        }

        public void Dispose()
        {
            StopAdmission();
            if (worker != null && Thread.CurrentThread != worker) worker.Join(1500);
            stopping.Dispose();
        }
    }
}
