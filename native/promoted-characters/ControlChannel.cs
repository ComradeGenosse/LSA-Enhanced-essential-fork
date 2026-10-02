using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace LSA.PromotedCharacters
{
    internal sealed class ControlRequest
    {
        public string RequestId, Operation;
        public Dictionary<string,object> Args;
        public long ExpiresAtUtc;
        public volatile bool Cancelled;
        public object Result;
        public string Reason;
        public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
    }
    // This separate, explicitly installed player-control pipe never extends the
    // P1 factual channel. Worker threads only parse/queue; all ped work is on Update.
    internal sealed class ControlChannel : IDisposable
    {
        readonly string name, epoch, world;
        readonly OperationAdmission admission;
        readonly ConcurrentQueue<ControlRequest> requests = new ConcurrentQueue<ControlRequest>();
        readonly CancellationTokenSource stopping = new CancellationTokenSource();
        NamedPipeServerStream pipe;
        int count;
        public ControlChannel(string name, string epoch, string world) { this.name = name; this.epoch = epoch; this.world = world; admission = new OperationAdmission(epoch,world); }
        public void Start() { new Thread(Serve) { IsBackground = true, Name = "LSA player character controls" }.Start(); }
        static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        void Serve()
        {
            var json = new JavaScriptSerializer { MaxJsonLength = 32768, RecursionLimit = 12 };
            while (!stopping.IsCancellationRequested)
            {
                ControlRequest request = null;
                try
                {
                    var sid = WindowsIdentity.GetCurrent().User;
                    var security = new PipeSecurity(); security.SetAccessRuleProtection(true,false); security.SetOwner(sid);
                    security.AddAccessRule(new PipeAccessRule(sid,PipeAccessRights.FullControl,AccessControlType.Allow));
                    pipe = new NamedPipeServerStream(name,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,4096,security);
                    pipe.WaitForConnectionAsync(stopping.Token).GetAwaiter().GetResult(); var stream = pipe;
                    // A local client cannot hold the sole slot indefinitely.
                    using (var watchdog = new Timer(_ => { try { stream.Dispose(); } catch {} },null,5000,Timeout.Infinite))
                    {
                        Write(stream,json,new {version = 1,type = "hello",worldProfileId = world,ownerEpoch = epoch});
                        var bytes = new List<byte>(); int b;
                        while ((b = stream.ReadByte()) != -1 && b != 10) { if (bytes.Count >= 16384) throw new InvalidDataException(); bytes.Add((byte)b); }
                        if (b == -1) throw new InvalidDataException();
                        var frame = json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes.ToArray()));
                        if (frame == null || frame.Count != 7 || !(frame["version"] is int version) || version != 1 || !(frame["requestId"] is string id) || !(frame["ownerEpoch"] is string suppliedEpoch) || !(frame["worldProfileId"] is string suppliedWorld) || !(frame["operation"] is string operation) || !(frame["args"] is Dictionary<string,object> args)) throw new InvalidDataException();
                        long expiry = Convert.ToInt64(frame["expiresAtUtc"]);
                        if (!admission.Admit(id,suppliedEpoch,suppliedWorld,expiry,Now) || !new HashSet<string>{"capture","register","inspect","spawn","follow","wait","dismiss","despawn","release","roster"}.Contains(operation)) throw new InvalidDataException();
                        if (Interlocked.Increment(ref count) > 16) { Interlocked.Decrement(ref count); throw new InvalidDataException(); }
                        request = new ControlRequest { RequestId = id, Operation = operation, Args = args, ExpiresAtUtc = expiry };
                        requests.Enqueue(request);
                        if (!request.Done.Wait(Math.Max(1,(int)Math.Min(3000,expiry - Now)),stopping.Token)) { request.Cancelled = true; throw new TimeoutException(); }
                        Write(stream,json,new {version = 1,requestId = id,status = request.Reason == null ? "ok" : "failed",result = request.Result,reason = request.Reason});
                    }
                }
                catch { if (request != null) request.Cancelled = true; if (!stopping.IsCancellationRequested) Thread.Sleep(100); }
                finally { try { pipe?.Dispose(); } catch {} }
            }
        }
        static void Write(Stream stream, JavaScriptSerializer json, object value)
        {
            var bytes = Encoding.UTF8.GetBytes(json.Serialize(value) + "\n"); if (bytes.Length > 32768) throw new InvalidDataException(); stream.Write(bytes,0,bytes.Length); stream.Flush();
        }
        public bool TryTake(out ControlRequest request)
        {
            while (requests.TryDequeue(out request)) { Interlocked.Decrement(ref count); if (!request.Cancelled && NativeSafetyPolicy.Fresh(request.ExpiresAtUtc,Now)) return true; request.Reason = "native_stale"; request.Done.Set(); }
            request = null; return false;
        }
        public void Dispose() { stopping.Cancel(); try { pipe?.Dispose(); } catch {} while (requests.TryDequeue(out var request)) { request.Cancelled = true; request.Done.Set(); } }
    }
}
