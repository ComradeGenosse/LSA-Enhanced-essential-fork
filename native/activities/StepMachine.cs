using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Activities
{
    public sealed class ShadowReceipt
    {
        public string ExecutionId, ActorKey, IncarnationId, Capability, EssentialName, Source, Reason, State;
        public uint RequestedGameMs, DispatchedGameMs;
        public int Sequence = 1, Attempt = 1, AcceptMs, HoldMaxMs, EvidenceDropped, LeaseEpoch;
        public bool Terminal, Mode;
        public readonly List<string> History = new List<string>();
        public readonly List<string> Evidence = new List<string>();
    }
    public sealed class StepMachine
    {
        readonly Dictionary<string, ShadowReceipt> active = new Dictionary<string, ShadowReceipt>();
        readonly List<ShadowReceipt> terminal = new List<ShadowReceipt>();
        readonly Dictionary<string, int> reflexTime = new Dictionary<string, int>();
        readonly HashSet<string> reflexActive = new HashSet<string>();
        readonly HashSet<string> reflexSeen = new HashSet<string>();
        readonly Func<string, string[]> namesFor;
        readonly Func<string, int> acceptFor;
        readonly Func<string, int> holdFor;
        readonly Func<string, bool> modeFor;
        string clientRun;
        long leaseAt = -1;
        int leaseTtl;
        bool companionSeen, accepting = true;
        public int StaleReceipts, Dispatches, Accepted, Failed, Superseded, TimedOut, Detached, LeaseExpiries, Rejected;
        public bool Accepting => accepting;
        public string ClientRun => clientRun;
        public StepMachine(Func<string, string[]> namesFor, Func<string, int> acceptFor, Func<string, int> holdFor, Func<string, bool> modeFor)
        {
            this.namesFor = namesFor ?? (_ => new string[0]);
            this.acceptFor = acceptFor ?? (_ => 2000);
            this.holdFor = holdFor ?? (_ => 0);
            this.modeFor = modeFor ?? (id => ActivityContracts.IsMode(id));
        }
        public IEnumerable<ShadowReceipt> All => active.Values.Concat(terminal);
        public ShadowReceipt ActiveFor(string actor) => actor != null && active.TryGetValue(actor, out var receipt) ? receipt : null;
        public int ActiveCount => active.Count;
        public void ClientHello(string run, long wallMs, int ttlMs)
        {
            if (!ActivityContracts.IsUuid(run) || ttlMs < 1 || ttlMs > ActivityContracts.LeaseTtlMs) return;
            if (clientRun != null && clientRun != run) Void("lease_lost");
            clientRun = run; companionSeen = true; accepting = true; leaseTtl = ttlMs; leaseAt = wallMs;
        }
        public void ClientLease(long wallMs, int ttlMs)
        {
            if (!companionSeen || !accepting || ttlMs < 1 || ttlMs > ActivityContracts.LeaseTtlMs) return;
            leaseTtl = ttlMs; leaseAt = wallMs;
        }
        public void ClientDisconnected(string reason)
        {
            Void(ActivityContracts.IsReason(reason) ? reason : "lease_lost");
            accepting = false;
            companionSeen = false;
            clientRun = null;
            leaseAt = -1;
            leaseTtl = 0;
        }
        public void Tick(uint gameMs, long wallMs)
        {
            if (companionSeen && accepting && leaseAt >= 0 && wallMs - leaseAt > leaseTtl) { LeaseExpiries++; Void("lease_lost"); accepting = false; }
            foreach (var receipt in active.Values.ToArray()) {
                if (receipt.State == "DISPATCHED" && ActivityContracts.UnsignedDue(gameMs, receipt.DispatchedGameMs, receipt.AcceptMs)) Finish(receipt, "TIMED_OUT", "accept_timeout", gameMs);
                else if (receipt.State == "HANDLER_ACCEPTED" && receipt.Mode && receipt.HoldMaxMs > 0 && ActivityContracts.UnsignedDue(gameMs, receipt.DispatchedGameMs, receipt.HoldMaxMs)) Finish(receipt, "TIMED_OUT", "hold_limit", gameMs);
            }
        }
        public void ClockReset() { Void("clock_reset"); }
        public void Void(string reason)
        {
            foreach (var receipt in active.Values.ToArray()) Finish(receipt, "DETACHED", reason, receipt.DispatchedGameMs);
        }
        public ShadowReceipt ObserveCommand(string actor, string incarnation, bool current, string operation, uint gameMs)
        {
            if (!ActivityContracts.IsUuid(actor) || !ActivityContracts.IsUuid(incarnation)) return null;
            if (!current) return Reject(actor, incarnation, operation == "follow" ? "follow_person" : "hold_position", "epoch_changed", gameMs);
            if (!accepting) return Reject(actor, incarnation, operation == "follow" ? "follow_person" : "hold_position", "lease_lost", gameMs);
            string capability = operation == "follow" ? "follow_person" : operation == "wait" ? "hold_position" : null;
            if (capability == null) { Supersede(actor, incarnation, "superseded_player", "p2_control", gameMs); return null; }
            Supersede(actor, incarnation, "superseded_player", "p2_control", gameMs);
            if (active.ContainsKey(actor)) return null;
            if (active.Count >= ActivityContracts.MaxActors) return Reject(actor, incarnation, capability, "activity_limit", gameMs);
            var names = namesFor(capability);
            var receipt = Begin(actor, incarnation, capability, names.Length == 0 ? capability : names[0], "p2_control", gameMs);
            Advance(receipt, "VALIDATED", gameMs);
            Advance(receipt, "DISPATCHED", gameMs);
            receipt.DispatchedGameMs = gameMs; Dispatches++;
            AddEvidence(receipt, "control_changed:p2_control");
            return receipt;
        }
        public void ObserveCallback(CallbackRecord record, bool modifiersIgnored)
        {
            if (record == null || !ActivityContracts.IsUuid(record.ActorKey) || !ActivityContracts.IsUuid(record.IncarnationId)) { StaleReceipts++; return; }
            var receipt = ActiveFor(record.ActorKey);
            if (receipt != null && receipt.IncarnationId != record.IncarnationId) { StaleReceipts++; return; }
            var capability = CapabilityFor(record.Name);
            var own = receipt != null && namesFor(receipt.Capability).Contains(record.Name);
            if (modifiersIgnored && (record.Phase == "before" || record.Phase == "after")) return;
            if (receipt == null) {
                if (capability == null || !accepting) return;
                if (active.Count >= ActivityContracts.MaxActors) { Rejected++; return; }
                receipt = Begin(record.ActorKey, record.IncarnationId, capability, record.Name, record.Source ?? "essential", record.GameMs);
                Advance(receipt, "VALIDATED", record.GameMs);
                Advance(receipt, "DISPATCHED", record.GameMs);
                receipt.DispatchedGameMs = record.GameMs; Dispatches++;
                own = true;
            } else if (!own) {
                Supersede(record.ActorKey, record.IncarnationId, "superseded_essential", "essential", record.GameMs);
                if (capability != null && accepting && !active.ContainsKey(record.ActorKey)) ObserveCallback(record, false);
                return;
            }
            if (!own || receipt.Terminal) return;
            if (record.Phase == "executed" && record.Succeeded == false) Finish(receipt, "FAILED", "handler_false", record.GameMs);
            else if (receipt.State == "DISPATCHED" && record.Phase == "executed" && record.Succeeded == true) { Advance(receipt, "HANDLER_ACCEPTED", record.GameMs); Accepted++; AddEvidence(receipt, "handler_result"); }
            else if (record.Phase == "before" || record.Phase == "after") AddEvidence(receipt, record.Phase == "before" ? "modifier_before" : "modifier_after");
        }
        public void ObserveReflex(string actor, string incarnation, bool activeReflex, int lastReflexTime, uint gameMs)
        {
            var key = actor ?? "";
            if (!reflexSeen.Contains(key)) { reflexSeen.Add(key); reflexTime[key] = lastReflexTime; if (activeReflex) reflexActive.Add(key); return; }
            var rising = activeReflex && !reflexActive.Contains(key);
            var advanced = reflexTime.TryGetValue(key, out var previous) && lastReflexTime > previous;
            reflexTime[key] = lastReflexTime;
            if (activeReflex) reflexActive.Add(key); else reflexActive.Remove(key);
            if (!rising && !advanced) return;
            var receipt = ActiveFor(actor);
            if (receipt == null) return;
            if (receipt.IncarnationId != incarnation) { StaleReceipts++; return; }
            Supersede(actor, incarnation, "superseded_reflex", "reflex", gameMs);
        }
        public void ObserveControlLost(string actor, string incarnation, uint gameMs)
        {
            var receipt = ActiveFor(actor);
            if (receipt == null) return;
            if (receipt.IncarnationId != incarnation) { StaleReceipts++; return; }
            Finish(receipt, "DETACHED", "control_released", gameMs);
        }
        public bool HasPhysicalCompletion => All.Any(item => item.State == "PHYSICALLY_COMPLETED" || item.History.Contains("PHYSICALLY_COMPLETED"));
        string CapabilityFor(string name)
        {
            foreach (var id in ActivityContracts.CapabilityIds) if (namesFor(id).Contains(name)) return id;
            return null;
        }
        ShadowReceipt Begin(string actor, string incarnation, string capability, string essential, string source, uint gameMs)
        {
            var receipt = new ShadowReceipt { ExecutionId = Guid.NewGuid().ToString("D"), ActorKey = actor, IncarnationId = incarnation, Capability = capability, EssentialName = essential, Source = source, State = "REQUESTED", RequestedGameMs = gameMs, AcceptMs = Math.Max(1, acceptFor(capability)), HoldMaxMs = holdFor(capability), Mode = modeFor(capability) };
            receipt.History.Add("REQUESTED");
            active[actor] = receipt;
            return receipt;
        }
        void Advance(ShadowReceipt receipt, string state, uint gameMs)
        {
            if (receipt.Terminal || state == "PHYSICALLY_COMPLETED") return;
            receipt.State = state; receipt.Sequence++; receipt.History.Add(state);
        }
        void Finish(ShadowReceipt receipt, string state, string reason, uint gameMs)
        {
            if (receipt.Terminal || state == "PHYSICALLY_COMPLETED" || !ActivityContracts.IsReason(reason)) return;
            receipt.State = state; receipt.Reason = reason; receipt.Terminal = true; receipt.Sequence++; receipt.History.Add(state);
            if (state == "FAILED") Failed++; else if (state == "SUPERSEDED") Superseded++; else if (state == "TIMED_OUT") TimedOut++; else if (state == "DETACHED") Detached++; else if (state == "REJECTED") Rejected++;
            active.Remove(receipt.ActorKey);
            terminal.Add(receipt);
            if (terminal.Count > 64) terminal.RemoveAt(0);
        }
        void Supersede(string actor, string incarnation, string reason, string detail, uint gameMs)
        {
            var receipt = ActiveFor(actor);
            if (receipt == null || receipt.IncarnationId != incarnation) return;
            AddEvidence(receipt, "external:" + detail);
            Finish(receipt, "SUPERSEDED", reason, gameMs);
        }
        ShadowReceipt Reject(string actor, string incarnation, string capability, string reason, uint gameMs)
        {
            var receipt = new ShadowReceipt { ExecutionId = Guid.NewGuid().ToString("D"), ActorKey = actor, IncarnationId = incarnation, Capability = capability, State = "REJECTED", Reason = reason, Terminal = true, RequestedGameMs = gameMs };
            receipt.History.Add("REQUESTED"); receipt.History.Add("REJECTED"); Rejected++;
            terminal.Add(receipt);
            return receipt;
        }
        static void AddEvidence(ShadowReceipt receipt, string evidence)
        {
            if (receipt.Evidence.Count >= ActivityContracts.EvidenceCap) { receipt.Evidence.RemoveAt(0); receipt.EvidenceDropped++; }
            receipt.Evidence.Add(evidence);
        }
    }
}
