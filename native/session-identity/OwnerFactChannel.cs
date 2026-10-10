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

namespace LSA.SessionIdentity
{
    internal sealed class VerifyRequest
    {
        public string RequestId, PedId;
        public long Client;
    }
    // Factual IPC only. No sessions, actions, PCM, native turn allocation or disk.
    internal sealed class OwnerFactChannel : IDisposable
    {
        readonly string name, epoch;
        readonly string hostRunId;
        readonly int worldEpoch;
        readonly BlockingCollection<string> output = new BlockingCollection<string>(64);
        readonly ConcurrentQueue<VerifyRequest> requests = new ConcurrentQueue<VerifyRequest>();
        readonly CancellationTokenSource stopping = new CancellationTokenSource();
        NamedPipeServerStream pipe;
        int requestCount;
        long client;
        volatile bool connected;
        public OwnerFactChannel(string name, string epoch,string hostRunId=null,int worldEpoch=0) {
            if(hostRunId!=null && (!NativeIdentityEvidenceStore.Uuid(hostRunId) || worldEpoch<1) || hostRunId==null && worldEpoch!=0) throw new ArgumentException("invalid_host_context");
            this.name = name; this.epoch = epoch;this.hostRunId=hostRunId;this.worldEpoch=worldEpoch;
        }
        public void Start() { var thread = new Thread(Serve) { IsBackground = true, Name = "LSA identity facts" }; thread.Start(); }
        void Serve()
        {
            while (!stopping.IsCancellationRequested)
            {
                try
                {
                    var sid = WindowsIdentity.GetCurrent().User;
                    var security = new PipeSecurity();
                    security.SetAccessRuleProtection(true, false);
                    security.SetOwner(sid);
                    security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
                    pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security);
                    pipe.WaitForConnection();
                    var stream = pipe;
                    client++;
                    var greeting=new Dictionary<string,object>{{"schemaVersion",1},{"type","hello"},{"adapterEpoch",epoch},{"sourceNamespace","comrade.authored"}};
                    if(hostRunId!=null) {greeting["hostContextVersion"]=1;greeting["hostRunId"]=hostRunId;greeting["worldEpoch"]=worldEpoch;}
                    var hello = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(greeting) + "\n");
                    stream.Write(hello, 0, hello.Length); stream.Flush(); connected = true;
                    var writer = Task.Run(() => {
                        try { while (connected && ReferenceEquals(pipe, stream) && !stopping.IsCancellationRequested) {
                            if (output.TryTake(out var message, 100, stopping.Token)) {
                                var bytes = Encoding.UTF8.GetBytes(message + "\n"); stream.Write(bytes, 0, bytes.Length); stream.Flush();
                            }
                        } } catch { Disconnect(stream); }
                    });
                    try
                    {
                        while (connected && !stopping.IsCancellationRequested)
                        {
                            var bytes = new List<byte>(); int b;
                            while ((b = stream.ReadByte()) != -1 && b != 10) { if (bytes.Count >= 4096) throw new InvalidDataException(); bytes.Add((byte)b); }
                            if (b == -1) break;
                            var json = new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 8 };
                            var request = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(bytes.ToArray()));
                            if (request == null || request.Count != 4 || !request.ContainsKey("schemaVersion") || !request.ContainsKey("type") ||
                                !request.ContainsKey("requestId") || !request.ContainsKey("pedId") || !(request["schemaVersion"] is int version) || version != 1 ||
                                !Equals(request["type"], "verify") || !(request["requestId"] is string id) || !NativeIdentityEvidenceStore.Uuid(id) ||
                                !(request["pedId"] is string ped) || !NativeIdentityEvidenceStore.Key(ped)) throw new InvalidDataException();
                            if (Interlocked.Increment(ref requestCount) > 64) { Interlocked.Decrement(ref requestCount); throw new InvalidDataException(); }
                            requests.Enqueue(new VerifyRequest { RequestId = id, PedId = ped, Client = client });
                        }
                    }
                    finally { Disconnect(stream); writer.Wait(500); }
                }
                catch { Disconnect(); if (!stopping.IsCancellationRequested) stopping.Token.WaitHandle.WaitOne(100); }
            }
        }
        public bool TryTake(out VerifyRequest request)
        {
            while (requests.TryDequeue(out request)) {
                Interlocked.Decrement(ref requestCount);
                if (connected && request.Client == client) return true;
            }
            request = null; return false;
        }
        public void Reply(VerifyRequest request, string status, NativeIdentityClaim claim)
        {
            if (request.Client == client && connected) Send(new { schemaVersion = 1, type = "proof", adapterEpoch = epoch,
                requestId = request.RequestId, pedId = request.PedId, status, claim });
        }
        public void Revoke(string pedId, RegistrationToken token) => Send(new { schemaVersion = 1, type = "revoke", adapterEpoch = epoch,
            pedId, incarnationId = token.IncarnationId, claimRevision = token.Revision });
        public void Heartbeat() => Send(new { schemaVersion = 1, type = "heartbeat", adapterEpoch = epoch });
        void Send(object message)
        {
            if (!connected) return;
            var json = new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 8 }.Serialize(message);
            if (Encoding.UTF8.GetByteCount(json) > 4096 || !output.TryAdd(json)) {
                var expected = pipe; ThreadPool.QueueUserWorkItem(_ => Disconnect(expected));
            }
        }
        void Disconnect(NamedPipeServerStream expected = null) { if (expected != null && !ReferenceEquals(pipe, expected)) return; connected = false; try { pipe?.Dispose(); } catch {} while (output.TryTake(out _)) {} }
        public void Dispose() { stopping.Cancel(); Disconnect(); }
    }
}
