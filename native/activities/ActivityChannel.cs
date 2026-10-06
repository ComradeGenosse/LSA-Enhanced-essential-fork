using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace LSA.Activities
{
    public sealed class ActivitySession
    {
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = ActivityContracts.FrameBytes, RecursionLimit = 8 };
        readonly Queue<string> outbound = new Queue<string>();
        readonly string nativeRun, adapterEpoch;
        int clientSequence, serverSequence;
        long nextDiagnosticsAt;
        string lastDiagnostics;
        public StepMachine Machine { get; }
        public bool ClientReady { get; private set; }
        public int SequenceGaps { get; private set; }
        public bool Closed { get; private set; } = true;

        public ActivitySession(CapabilityTable table)
        {
            if (table == null) throw new ArgumentNullException(nameof(table));
            nativeRun = Guid.NewGuid().ToString("D");
            adapterEpoch = Guid.NewGuid().ToString("D");
            Machine = new StepMachine(table.NamesFor, id => table.Get(id)?.AcceptMs ?? 2000, id => table.Get(id)?.HoldMaxMs ?? 0, id => table.Get(id)?.Mode ?? ActivityContracts.IsMode(id));
        }

        public string ServerHello()
        {
            var capabilities = new Dictionary<string, bool>();
            foreach (var id in ActivityContracts.CapabilityIds) capabilities[id] = false;
            return Encode(new Dictionary<string, object> {
                {"version",1},{"type","hello"},{"nativeRun",nativeRun},{"adapterEpoch",adapterEpoch},
                {"contractSha256",CapabilityTable.ContractSha256},{"capabilities",capabilities},{"limits",Limits()}
            });
        }

        // Called only by the P2/update owner after the transport worker reports a
        // new connection. A new connection is a fresh sequence space.
        public void OpenTransport()
        {
            if (ClientReady || Machine.ActiveCount > 0) Machine.ClientDisconnected("lease_lost");
            ClientReady = false;
            Closed = false;
            clientSequence = 0;
            serverSequence = 0;
            nextDiagnosticsAt = 0;
            lastDiagnostics = null;
            outbound.Clear();
        }

        // Called only by the P2/update owner. Transport loss never permanently
        // poisons the ACT session; a later hello may establish a new client run.
        public void Close(string reason)
        {
            if (Closed && !ClientReady && Machine.ActiveCount == 0) return;
            Closed = true;
            ClientReady = false;
            clientSequence = 0;
            outbound.Clear();
            Machine.ClientDisconnected(ActivityContracts.IsReason(reason) ? reason : "lease_lost");
        }

        public bool AcceptClient(string frame)
        {
            if (Closed || frame == null || Encoding.UTF8.GetByteCount(frame) > ActivityContracts.FrameBytes) return false;
            Dictionary<string, object> value;
            try { value = json.Deserialize<Dictionary<string, object>>(frame); }
            catch { Close("lease_lost"); return false; }

            if (value != null && value.ContainsKey("type") && value["type"] as string == "hello") {
                if (ClientReady || !ActivityContracts.HelloClient(value, CapabilityTable.ContractSha256)) { Close("lease_lost"); return false; }
                Machine.ClientHello(value["clientRun"] as string, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ActivityContracts.LeaseTtlMs);
                clientSequence = 1;
                ClientReady = true;
                return true;
            }

            if (!ClientReady || value == null || !(value.ContainsKey("sequence") && value["sequence"] is int sequence)) { Close("lease_lost"); return false; }
            if (sequence != clientSequence) { SequenceGaps++; Close("lease_lost"); return false; }
            if (!ActivityContracts.Lease(value, clientSequence)) { Close("lease_lost"); return false; }
            clientSequence++;
            Machine.ClientLease(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Convert.ToInt32(value["leaseTtlMs"]));
            return true;
        }

        public void PublishActorFacts(Dictionary<string, object> fields)
        {
            if (!ClientReady || Closed) return;
            var frame = new Dictionary<string, object>(fields) {{"version", 1}, {"type", "actor.facts"}, {"sequence", ++serverSequence}};
            try { if (!ActivityContracts.ActorFacts(frame)) { serverSequence--; return; } }
            catch { serverSequence--; return; }
            Publish(frame);
        }

        public void PublishDiagnosticsIfChanged(int callbackDropped, int breakerTrips, long wallMs, bool force = false)
        {
            if (!ClientReady || Closed) return;
            var fields = DiagnosticFields(callbackDropped, breakerTrips);
            var signature = DiagnosticSignature(fields);
            if (!force && signature == lastDiagnostics) return;
            if (!force && wallMs < nextDiagnosticsAt) return;
            lastDiagnostics = signature;
            nextDiagnosticsAt = wallMs + 250; // advertised receiptsPerSecond = 4
            fields["version"] = 1;
            fields["type"] = "diagnostics";
            fields["sequence"] = ++serverSequence;
            Publish(fields);
        }

        Dictionary<string, object> DiagnosticFields(int callbackDropped, int breakerTrips)
        {
            var fields = new Dictionary<string, object>();
            foreach (var key in ActivityContracts.DiagnosticKeys) fields[key] = 0;
            fields["activities"] = Machine.ActiveCount;
            fields["executions"] = Machine.ActiveCount;
            fields["dispatches"] = Machine.Dispatches;
            fields["accepted"] = Machine.Accepted;
            fields["failed"] = Machine.Failed;
            fields["superseded"] = Machine.Superseded;
            fields["timedOut"] = Machine.TimedOut;
            fields["detached"] = Machine.Detached;
            fields["staleReceipts"] = Machine.StaleReceipts;
            fields["callbackDropped"] = Math.Max(0, callbackDropped);
            fields["leaseExpiries"] = Machine.LeaseExpiries;
            fields["breakerTrips"] = Math.Max(0, breakerTrips);
            return fields;
        }

        static string DiagnosticSignature(Dictionary<string, object> fields)
        {
            var text = new StringBuilder();
            foreach (var key in ActivityContracts.DiagnosticKeys) text.Append(key).Append('=').Append(fields[key]).Append(';');
            return text.ToString();
        }

        public Dictionary<string, object> DiagnosticObject(int callbackDropped = 0, int breakerTrips = 0)
        {
            var frame = DiagnosticFields(callbackDropped, breakerTrips);
            frame["version"] = 1;
            frame["type"] = "diagnostics";
            frame["sequence"] = ++serverSequence;
            return frame;
        }

        public void Publish(object frame)
        {
            if (Closed) return;
            var text = Encode(frame);
            if (Encoding.UTF8.GetByteCount(text) > ActivityContracts.FrameBytes || outbound.Count >= ActivityContracts.NativeQueue) { Close("lease_lost"); return; }
            outbound.Enqueue(text);
        }

        public string TakeOutbound() => outbound.Count == 0 ? null : outbound.Dequeue();

        static Dictionary<string, object> Limits() => new Dictionary<string, object> {
            {"characters",4},{"anchors",32},{"pendingPerActor",1},{"callbackRing",ActivityContracts.CallbackRing},
            {"frameBytes",ActivityContracts.FrameBytes},{"nativeQueue",ActivityContracts.NativeQueue},
            {"companionQueue",ActivityContracts.CompanionQueue},{"receiptsPerSecond",4},{"factsPerSecond",2}
        };

        string Encode(object value) => json.Serialize(value);
    }

    // The worker thread is transport-only. It never calls ActivitySession,
    // StepMachine, touches a Ped/NpcState, or changes ACT receipt state.
    public sealed class ActivityChannel : IDisposable
    {
        sealed class Inbound
        {
            public int Connection;
            public string Frame;
            public bool Opened, Closed;
        }
        sealed class Outbound
        {
            public int Connection;
            public string Frame;
        }

        readonly string name;
        readonly ActivitySession session;
        readonly string serverHello;
        readonly object gate = new object();
        readonly Queue<Inbound> inbound = new Queue<Inbound>();
        readonly Queue<Outbound> outbound = new Queue<Outbound>();
        volatile bool stopping;
        NamedPipeServerStream pipe;
        int nextConnection, activeConnection, ownerConnection;

        public ActivityChannel(string name, ActivitySession session)
        {
            this.name = name;
            this.session = session ?? throw new ArgumentNullException(nameof(session));
            serverHello = session.ServerHello();
        }

        public void Start() { new Thread(Serve) { IsBackground = true, Name = "LSA activities shadow" }.Start(); }

        // Owner-fiber pump. This is the only path from transport frames into the
        // session/state machine.
        public void Pump(long wallMs, int callbackDropped = 0, int breakerTrips = 0)
        {
            for (var count = 0; count < ActivityContracts.CompanionQueue; count++) {
                Inbound item;
                lock (gate) {
                    if (inbound.Count == 0) break;
                    item = inbound.Dequeue();
                }
                if (item.Opened) {
                    ownerConnection = item.Connection;
                    session.OpenTransport();
                    continue;
                }
                if (item.Closed) {
                    if (item.Connection == ownerConnection) {
                        session.Close("lease_lost");
                        ownerConnection = 0;
                    }
                    continue;
                }
                if (item.Connection != ownerConnection) continue;
                if (!session.AcceptClient(item.Frame)) DropConnection(item.Connection);
            }
            session.PublishDiagnosticsIfChanged(callbackDropped, breakerTrips, wallMs);
            Flush();
        }

        // Owner-fiber only: move already-validated session output to the transport
        // queue. The worker merely writes these opaque bounded strings.
        public void Flush()
        {
            while (true) {
                var frame = session.TakeOutbound();
                if (frame == null) break;
                int connection;
                lock (gate) connection = ownerConnection;
                if (connection == 0 || !QueueOutbound(connection, frame)) {
                    session.Close("lease_lost");
                    if (connection != 0) DropConnection(connection);
                    break;
                }
            }
        }

        bool QueueOutbound(int connection, string frame)
        {
            if (frame == null || Encoding.UTF8.GetByteCount(frame) > ActivityContracts.FrameBytes) return false;
            lock (gate) {
                if (connection != activeConnection || outbound.Count >= ActivityContracts.NativeQueue) return false;
                outbound.Enqueue(new Outbound { Connection = connection, Frame = frame });
                return true;
            }
        }

        bool QueueInbound(Inbound item)
        {
            lock (gate) {
                if (inbound.Count >= ActivityContracts.CompanionQueue) return false;
                inbound.Enqueue(item);
                return true;
            }
        }

        void DropConnection(int connection)
        {
            NamedPipeServerStream retire = null;
            lock (gate) if (activeConnection == connection) retire = pipe;
            try { retire?.Dispose(); } catch { }
        }

        void FlushTransport(Stream stream, int connection)
        {
            while (true) {
                Outbound item = null;
                lock (gate) {
                    while (outbound.Count > 0 && outbound.Peek().Connection != connection) outbound.Dequeue();
                    if (outbound.Count > 0) item = outbound.Dequeue();
                }
                if (item == null) return;
                Write(stream, item.Frame);
            }
        }

        void Serve()
        {
            var json = new JavaScriptSerializer { MaxJsonLength = ActivityContracts.FrameBytes, RecursionLimit = 8 };
            while (!stopping) {
                NamedPipeServerStream active = null;
                int connection = 0;
                try {
                    var sid = WindowsIdentity.GetCurrent().User;
                    var acl = new PipeSecurity();
                    acl.SetAccessRuleProtection(true, false);
                    acl.SetOwner(sid);
                    acl.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
                    active = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, ActivityContracts.FrameBytes, ActivityContracts.FrameBytes, acl);
                    lock (gate) {
                        if (stopping) { active.Dispose(); return; }
                        pipe = active;
                    }
                    active.WaitForConnection();
                    connection = Interlocked.Increment(ref nextConnection);
                    lock (gate) {
                        activeConnection = connection;
                        outbound.Clear();
                    }
                    if (!QueueInbound(new Inbound { Connection = connection, Opened = true })) throw new InvalidDataException();
                    Write(active, serverHello);

                    using (var reader = new StreamReader(active, Encoding.UTF8, false, 1024, true)) {
                        while (!stopping && active.IsConnected) {
                            FlushTransport(active, connection);
                            var read = reader.ReadLineAsync();
                            while (!read.Wait(10)) {
                                if (stopping || !active.IsConnected) break;
                                FlushTransport(active, connection);
                            }
                            if (stopping || !active.IsConnected) break;
                            var line = read.Result;
                            if (line == null) break;
                            if (Encoding.UTF8.GetByteCount(line) > ActivityContracts.FrameBytes) throw new InvalidDataException();
                            try {
                                var parsed = json.Deserialize<Dictionary<string, object>>(line);
                                if (parsed == null || !(parsed.ContainsKey("type") && parsed["type"] is string)) throw new InvalidDataException();
                            } catch { throw new InvalidDataException(); }
                            if (!QueueInbound(new Inbound { Connection = connection, Frame = line })) throw new InvalidDataException();
                            FlushTransport(active, connection);
                        }
                    }
                } catch { }
                finally {
                    if (connection != 0) QueueInbound(new Inbound { Connection = connection, Closed = true });
                    lock (gate) {
                        if (activeConnection == connection) activeConnection = 0;
                        if (ReferenceEquals(pipe, active)) pipe = null;
                    }
                    try { active?.Dispose(); } catch { }
                }
                if (!stopping) Thread.Sleep(100);
            }
        }

        static void Write(Stream stream, string message)
        {
            var bytes = Encoding.UTF8.GetBytes(message + "\n");
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        public void Dispose()
        {
            stopping = true;
            NamedPipeServerStream retire;
            lock (gate) { retire = pipe; pipe = null; }
            try { retire?.Dispose(); } catch { }
        }
    }
}
