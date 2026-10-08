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
        readonly string hostRunId;
        readonly Func<int> worldEpoch;
        int clientSequence, serverSequence, observedWorldEpoch;
        long nextDiagnosticsAt;
        string lastDiagnostics;
        public StepMachine Machine { get; }
        public StepRunner Runner { get; }
        public string NativeRun => nativeRun;
        public string AdapterEpoch => adapterEpoch;
        public bool ClientReady { get; private set; }
        public int SequenceGaps { get; private set; }
        public bool Closed { get; private set; } = true;

        public ActivitySession(CapabilityTable table, StepRunner runner = null,string hostRunId=null,Func<int> worldEpoch=null)
        {
            if (table == null) throw new ArgumentNullException(nameof(table));
            if((hostRunId==null)!=(worldEpoch==null) || hostRunId!=null && (!ActivityContracts.IsUuid(hostRunId) || worldEpoch()<1)) throw new ArgumentException("invalid_host_context");
            this.hostRunId=hostRunId;this.worldEpoch=worldEpoch;observedWorldEpoch=worldEpoch?.Invoke() ?? 0;
            nativeRun = Guid.NewGuid().ToString("D");
            adapterEpoch = Guid.NewGuid().ToString("D");
            Runner = runner;
            Machine = new StepMachine(table.NamesFor, id => table.Get(id)?.AcceptMs ?? 2000, id => table.Get(id)?.HoldMaxMs ?? 0, id => table.Get(id)?.Mode ?? ActivityContracts.IsMode(id));
        }

        public string ServerHello()
        {
            var capabilities = new Dictionary<string, bool>();
            foreach (var id in ActivityContracts.CapabilityIds) capabilities[id] = Runner != null && Runner.Advertises(id);
            var hello=new Dictionary<string, object> {
                {"version",1},{"type","hello"},{"nativeRun",nativeRun},{"adapterEpoch",adapterEpoch},
                {"contractSha256",CapabilityTable.ContractSha256},{"capabilities",capabilities},{"limits",Limits()}
            };
            if(hostRunId!=null) {hello["hostContextVersion"]=1;hello["hostRunId"]=hostRunId;hello["worldEpoch"]=worldEpoch();}
            return Encode(hello);
        }

        // Called only by the P2/update owner after the transport worker reports a
        // new connection. A new connection is a fresh sequence space.
        public void OpenTransport()
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (ClientReady || Machine.ActiveCount > 0) Machine.ClientDisconnected("lease_lost");
            Runner?.ClientDisconnected(this, "lease_lost", now);
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
            if (Closed && !ClientReady && Machine.ActiveCount == 0 && (Runner == null || Runner.ActiveCount == 0)) return;
            Closed = true;
            ClientReady = false;
            clientSequence = 0;
            outbound.Clear();
            var closedReason = ActivityContracts.IsReason(reason) ? reason : "lease_lost";
            Machine.ClientDisconnected(closedReason);
            Runner?.ClientDisconnected(this, closedReason, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }

        public bool AcceptClient(string frame)
        {
            if (Closed || frame == null || Encoding.UTF8.GetByteCount(frame) > ActivityContracts.FrameBytes) return false;
            Dictionary<string, object> value;
            try { value = json.DeserializeObject(frame) as Dictionary<string, object>; }
            catch { Close("lease_lost"); return false; }

            if (value != null && value.ContainsKey("type") && value["type"] as string == "hello") {
                if (ClientReady || !ActivityContracts.HelloClient(value, CapabilityTable.ContractSha256) ||
                    (hostRunId==null ? value.ContainsKey("hostRunId") : !value.ContainsKey("hostRunId") || !Equals(value["hostRunId"],hostRunId) || (int)value["worldEpoch"]!=worldEpoch())) { Close("lease_lost"); return false; }
                Machine.ClientHello(value["clientRun"] as string, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ActivityContracts.LeaseTtlMs);
                Runner?.ClientHello();
                clientSequence = 1;
                ClientReady = true;
                return true;
            }

            if (!ClientReady || value == null || !(value.ContainsKey("sequence") && value["sequence"] is int sequence)) { Close("lease_lost"); return false; }
            if (sequence != clientSequence) { SequenceGaps++; Close("lease_lost"); return false; }
            if (ActivityContracts.Lease(value, clientSequence)) {
                if (!Machine.Accepting) { Close("lease_lost"); return false; }
                clientSequence++;
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var ttl = Convert.ToInt32(value["leaseTtlMs"]);
                Machine.ClientLease(now, ttl);
                Runner?.Lease(now, ttl);
                return true;
            }
            // ACT1 stays shadow-only. ACT2 execution frames are accepted only
            // after the native side independently validates the exact closed frame.
            if (Runner == null || !ActivityContracts.ExecutionFrame(value, clientSequence) || !Runner.Accept(this, value)) { Close("lease_lost"); return false; }
            clientSequence++;
            return true;
        }

        public void Reply(Dictionary<string, object> fields)
        {
            if (!ClientReady || Closed || fields == null) return;
            fields["version"] = 1;
            fields["sequence"] = ++serverSequence;
            Publish(fields);
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
            if (Runner != null) {
                fields["activities"] = Runner.ActiveCount;
                fields["executions"] = Runner.ActiveCount;
                fields["anchors"] = Runner.Places.Count;
                fields["dispatches"] = Runner.Dispatches;
                fields["accepted"] = Runner.Accepted;
                fields["established"] = Runner.Established;
                fields["completed"] = Runner.Completed;
                fields["failed"] = Runner.Failed;
                fields["superseded"] = Runner.Superseded;
                fields["timedOut"] = Runner.TimedOut;
                fields["detached"] = Runner.Detached;
                fields["staleReceipts"] = Runner.StaleReceipts;
                fields["leaseExpiries"] = Runner.LeaseExpiries;
            } else {
                fields["activities"] = Machine.ActiveCount;
                fields["executions"] = Machine.ActiveCount;
                fields["dispatches"] = Machine.Dispatches;
                fields["accepted"] = Machine.Accepted;
                fields["failed"] = Machine.Failed;
                fields["superseded"] = Machine.Superseded;
                fields["timedOut"] = Machine.TimedOut;
                fields["detached"] = Machine.Detached;
                fields["staleReceipts"] = Machine.StaleReceipts;
                fields["leaseExpiries"] = Machine.LeaseExpiries;
            }
            fields["callbackDropped"] = Math.Max(0, callbackDropped);
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
        public void WorldChanged(int epoch,string reason)
        {
            if(worldEpoch==null || epoch!=worldEpoch() || epoch<observedWorldEpoch || (reason!="clock_regression" && reason!="host_reload" && reason!="timeline_change")) throw new ArgumentException("invalid_world_reset");
            if(epoch==observedWorldEpoch) return;
            observedWorldEpoch=epoch;
            bool notify=ClientReady && !Closed;
            Close("clock_reset");
            if(notify) outbound.Enqueue(Encode(new {version=1,type="world_epoch",sequence=++serverSequence,epoch,reason}));
        }

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
        volatile string serverHello;
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
        public void RefreshHello() {serverHello=session.ServerHello();}

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
