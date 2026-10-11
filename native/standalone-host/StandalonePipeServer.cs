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
    // Phase 2 transport skeleton. This service does not permit actor or audio
    // effects: only bounded health and an owner-fiber-authorized snapshot.
    // The API is deliberately disjoint from every Essential named pipe.
    internal sealed class StandalonePipeServer : IDisposable
    {
        public const string PipeName = "LSA.Standalone.Phase2.v1";
        private const int MaxFrameBytes = 8192;
        private const int MaxPendingOwnerQueries = 32;
        private readonly Guid hostRunId;
        private readonly Func<int> worldEpoch;
        private readonly ConcurrentQueue<OwnerQuery> requests = new ConcurrentQueue<OwnerQuery>();
        private readonly CancellationTokenSource stopping = new CancellationTokenSource();
        private readonly object pipeLock = new object();
        private readonly UTF8Encoding utf8 = new UTF8Encoding(false, true);
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MaxFrameBytes, RecursionLimit = 8 };
        private Thread worker;
        private NamedPipeServerStream active;
        private int pendingCount;

        private sealed class OwnerQuery
        {
            public int Epoch;
            public readonly TaskCompletionSource<int> Completion =
                new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        public StandalonePipeServer(Guid run, Func<int> epoch)
        {
            if (run == Guid.Empty || epoch == null || epoch() < 1) throw new ArgumentException("invalid_host");
            hostRunId = run; worldEpoch = epoch;
        }

        public void Start()
        {
            if (worker != null) throw new InvalidOperationException("already_running");
            worker = new Thread(Serve) { Name = "LSA standalone named pipe", IsBackground = true };
            worker.Start();
        }

        public void DrainOwnerRequests(NativeAuthority authority, int budget)
        {
            if (authority == null || budget < 0 || budget > 32) throw new ArgumentException("invalid_budget");
            for (int n = 0; n < budget && requests.TryDequeue(out var request); n++)
            {
                Interlocked.Decrement(ref pendingCount);
                // TrackedActors requires the true owner fiber; this is the only
                // location where a transport query calls production core state.
                if (stopping.IsCancellationRequested || request.Epoch != authority.WorldEpoch)
                    request.Completion.TrySetResult(-1);
                else
                    request.Completion.TrySetResult(authority.TrackedActors);
            }
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
                    security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
                    pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 8192, 8192, security);
                    lock (pipeLock) { if (stopping.IsCancellationRequested) break; active = pipe; }
                    pipe.WaitForConnectionAsync(stopping.Token).GetAwaiter().GetResult();
                    if (!stopping.IsCancellationRequested) ServeClient(pipe);
                }
                catch (Exception) { if (!stopping.IsCancellationRequested) Thread.Sleep(100); }
                finally
                {
                    lock (pipeLock) { if (ReferenceEquals(active, pipe)) active = null; }
                    try { pipe?.Dispose(); } catch {}
                }
            }
        }

        private void ServeClient(NamedPipeServerStream pipe)
        {
            // A stuck peer cannot monopolize the one-client authority channel.
            using (var watchdog = new Timer(_ => { try { pipe.Dispose(); } catch {} },
                null, 7000, Timeout.Infinite))
            {
                Guid connection = Guid.NewGuid();
                int epoch = worldEpoch();
                int outboundSeq = 0;
                int inboundSeq = 1;
                Send(pipe, Envelope("host.hello", connection, epoch, outboundSeq));
                Dictionary<string, object> hello = Receive(pipe);
                if (!Valid(hello, "client.hello", connection, epoch, inboundSeq, false))
                    return;
                Send(pipe, Envelope("host.ready", connection, epoch, ++outboundSeq));
                while (!stopping.IsCancellationRequested)
                {
                    watchdog.Change(7000, Timeout.Infinite);
                    var request = Receive(pipe);
                    if (worldEpoch() != epoch || inboundSeq == int.MaxValue || outboundSeq == int.MaxValue ||
                        !Valid(request, null, connection, epoch, ++inboundSeq, true))
                        return;
                    string requestId = (string)request["requestId"];
                    string type = (string)request["type"];
                    var response = Envelope(
                        type == "health.ping" ? "health.pong" :
                        type == "host.snapshot" ? "host.snapshot.result" : "request.rejected",
                        connection, epoch, ++outboundSeq);
                    response["requestId"] = requestId;
                    if (type == "health.ping")
                        response["status"] = "ok";
                    else if (type == "host.snapshot")
                    {
                        if (Interlocked.Increment(ref pendingCount) > MaxPendingOwnerQueries)
                        {
                            Interlocked.Decrement(ref pendingCount);
                            return; // Queue overflow invalidates this connection.
                        }
                        var ownerQuery = new OwnerQuery { Epoch = epoch };
                        requests.Enqueue(ownerQuery);
                        if (!ownerQuery.Completion.Task.Wait(1500) || ownerQuery.Completion.Task.Result < 0)
                            return; // Stale world/owner unavailable; no synthetic snapshot.
                        response["status"] = "ok";
                        response["trackedActors"] = ownerQuery.Completion.Task.Result;
                    }
                    else
                        response["status"] = "unsupported"; // No actor effects in Phase 2 bootstrap.
                    if (worldEpoch() != epoch) return;
                    Send(pipe, response);
                }
            }
        }

        private Dictionary<string, object> Envelope(string type, Guid transport, int epoch, int seq)
        {
            return new Dictionary<string, object>
            {
                {"v", 1}, {"type", type}, {"hostRunId", hostRunId.ToString("D")},
                {"worldEpoch", epoch}, {"transportId", transport.ToString("D")}, {"seq", seq}
            };
        }

        private bool Valid(Dictionary<string, object> value, string expectedType,
            Guid transport, int epoch, int seq, bool withRequestId)
        {
            if (value == null || value.Count != (withRequestId ? 7 : 6) ||
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
            if (!withRequestId) return true;
            return value.TryGetValue("requestId", out var request) &&
                request is string && Guid.TryParseExact((string)request, "D", out _);
        }

        private Dictionary<string, object> Receive(Stream stream)
        {
            byte[] header = Exact(stream, 4);
            uint length = BitConverter.ToUInt32(header, 0);
            if (length == 0 || length > MaxFrameBytes) throw new InvalidDataException("invalid_frame_length");
            string value = utf8.GetString(Exact(stream, (int)length));
            var result = json.Deserialize<Dictionary<string, object>>(value);
            if (result == null) throw new InvalidDataException("invalid_json");
            return result;
        }

        private void Send(Stream stream, object value)
        {
            byte[] data = utf8.GetBytes(json.Serialize(value));
            if (data.Length == 0 || data.Length > MaxFrameBytes) throw new InvalidDataException("invalid_frame_length");
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
            while (requests.TryDequeue(out var request))
            {
                Interlocked.Decrement(ref pendingCount);
                request.Completion.TrySetResult(-1);
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
