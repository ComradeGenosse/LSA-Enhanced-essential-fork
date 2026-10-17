using System;
using System.Collections.Generic;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace LSA.Reactions
{
    // Dedicated local pipe for cosmetic-reaction frames. It is deliberately NOT
    // shared with ACT, the intelligence stream or the P2 control pipe: a malformed
    // or dropped reaction frame can only ever cost a gesture. The pipe exists only
    // when reactions.mode is shadow/on, is reachable only by the current user, holds
    // one connection, and speaks first (hello) so the companion learns this host
    // run and world epoch and must echo them in every frame.
    //
    // Worker threads only frame, bound and queue bytes. Parsing against game state
    // happens in the executor on Core's Update.
    public sealed class ReactionChannel : IReactionTransport
    {
        const int MaxInbound = 8, MaxOutbound = 16;
        readonly object gate = new object();
        readonly Queue<KeyValuePair<string, long>> inbound = new Queue<KeyValuePair<string, long>>();
        readonly Queue<string> outbound = new Queue<string>();
        readonly string name, mode, hostRunId;
        readonly Func<int> worldEpoch;
        readonly Func<long> nowMs;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = ReactionFrameCodec.MaxFrameBytes * 2, RecursionLimit = 4 };
        NamedPipeServerStream pipe;
        volatile bool stopping, connected;

        public ReactionChannel(string name, string mode, string hostRunId, Func<int> worldEpoch, Func<long> nowMs)
        {
            this.name = name; this.mode = mode; this.hostRunId = hostRunId; this.worldEpoch = worldEpoch; this.nowMs = nowMs;
        }

        public void Start() { new Thread(Serve) { IsBackground = true, Name = "LSA reactions" }.Start(); }

        void Serve()
        {
            while (!stopping)
            {
                NamedPipeServerStream active = null;
                try
                {
                    var sid = WindowsIdentity.GetCurrent().User;
                    var acl = new PipeSecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(sid);
                    acl.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
                    active = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, acl);
                    lock (gate) { if (stopping) { active.Dispose(); return; } pipe = active; }
                    active.WaitForConnection();
                    string hello;
                    lock (gate) { inbound.Clear(); outbound.Clear(); hello = json.Serialize(ReactionFrameCodec.Hello(hostRunId, worldEpoch(), mode)); connected = true; }
                    Write(active, hello);
                    var reading = active;
                    new Thread(() => Read(reading)) { IsBackground = true, Name = "LSA reactions reader" }.Start();
                    while (!stopping && connected)
                    {
                        string frame = null;
                        lock (gate) { if (outbound.Count > 0) frame = outbound.Dequeue(); }
                        if (frame == null) { Thread.Sleep(20); continue; }
                        Write(active, frame);
                    }
                }
                catch { }
                finally
                {
                    lock (gate) { connected = false; inbound.Clear(); outbound.Clear(); if (ReferenceEquals(pipe, active)) pipe = null; }
                    try { active?.Dispose(); } catch { }
                }
                if (!stopping) Thread.Sleep(100);
            }
        }

        void Read(NamedPipeServerStream active)
        {
            try
            {
                var bytes = new List<byte>(ReactionFrameCodec.MaxFrameBytes);
                while (!stopping && active.IsConnected)
                {
                    int raw = active.ReadByte();
                    if (raw < 0) break;
                    if (raw == 10)
                    {
                        if (bytes.Count > 0 && bytes[bytes.Count - 1] == 13) bytes.RemoveAt(bytes.Count - 1);
                        var line = Encoding.UTF8.GetString(bytes.ToArray());
                        bytes.Clear();
                        if (line.Length == 0) continue;
                        lock (gate)
                        {
                            if (!connected || !ReferenceEquals(pipe, active)) return;
                            if (inbound.Count >= MaxInbound) inbound.Dequeue(); // newest wins; a stale gesture is worthless
                            inbound.Enqueue(new KeyValuePair<string, long>(line, nowMs()));
                        }
                    }
                    else
                    {
                        if (bytes.Count >= ReactionFrameCodec.MaxFrameBytes) throw new InvalidOperationException("frame_overflow");
                        bytes.Add((byte)raw);
                    }
                }
            }
            catch { }
            finally
            {
                lock (gate) { if (ReferenceEquals(pipe, active)) connected = false; }
                try { active.Dispose(); } catch { }
            }
        }

        static void Write(NamedPipeServerStream active, string message)
        {
            var bytes = Encoding.UTF8.GetBytes(message + "\n");
            active.Write(bytes, 0, bytes.Length);
            active.Flush();
        }

        public bool TryTakeFrame(out IDictionary<string, object> frame, out long receivedMs)
        {
            frame = null; receivedMs = 0;
            KeyValuePair<string, long> item;
            lock (gate)
            {
                if (!connected || inbound.Count == 0) return false;
                item = inbound.Dequeue();
            }
            receivedMs = item.Value;
            try { frame = json.DeserializeObject(item.Key) as Dictionary<string, object>; }
            catch { frame = null; }
            // A line that is not a JSON object is handed on as null-less "invalid":
            // an empty dictionary fails the exact-shape check in the codec.
            if (frame == null) frame = new Dictionary<string, object>();
            return true;
        }

        public bool Send(IDictionary<string, object> message)
        {
            var text = json.Serialize(message);
            lock (gate)
            {
                if (!connected || outbound.Count >= MaxOutbound) return false;
                outbound.Enqueue(text);
                return true;
            }
        }

        public void Drop()
        {
            NamedPipeServerStream retire;
            lock (gate) { connected = false; inbound.Clear(); outbound.Clear(); retire = pipe; }
            ThreadPool.QueueUserWorkItem(_ => { try { retire?.Dispose(); } catch { } });
        }

        public void Dispose()
        {
            stopping = true;
            Drop();
        }
    }
}
