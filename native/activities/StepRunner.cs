using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace LSA.Activities
{
    public sealed class LiveExecution
    {
        public string ExecutionId, ActivityId, StepId, EncounterId, IncarnationId, LeaseId, Capability, EssentialName, Adapter, OnLeaseLoss, State, Reason, OwnName, PlaceRef;
        public int Attempt = 1, Sequence = 1, LeaseEpoch, EvidenceDropped;
        public uint RequestedGameMs, DispatchedGameMs, AcceptedGameMs, EstablishedGameMs;
        public int AcceptMs, EstablishMs, CompleteMs, HoldMaxMs;
        public bool Terminal, Handler;
        public string ModeHealth;
        public long FarSince = -1, LastReceiptWall;
        public readonly List<Dictionary<string, object>> Evidence = new List<Dictionary<string, object>>();
    }

    public sealed class ActivityView
    {
        public bool Present;
        public string Intent, Capability, Step, Status, Reason;
    }

    // Owner-fiber execution. It never advances a plan and never calls a task native.
    public sealed class StepRunner
    {
        static readonly HashSet<string> Act2 = new HashSet<string> { "hold_position", "follow_person", "resume_ambient", "sit_on_ground" };
        readonly CapabilityTable table;
        readonly Dictionary<string, LiveExecution> active = new Dictionary<string, LiveExecution>();
        readonly Dictionary<string, int> leaseEpoch = new Dictionary<string, int>();
        readonly Dictionary<string, string> leaseId = new Dictionary<string, string>();
        readonly Dictionary<string, string> incarnation = new Dictionary<string, string>();
        readonly List<ActivityView> history = new List<ActivityView>();
        readonly PlaceTable places = new PlaceTable();
        long leaseAt = -1;
        int leaseTtl;
        bool leased, requiresHello = true;
        public int StaleReceipts, Dispatches, Accepted, Established, Completed, Failed, Superseded, TimedOut, Detached, LeaseExpiries;
        public IActivityWorld World { get; set; }
        public ActivitySession Session { get; set; }
        public PlaceTable Places => places;
        public bool HasPhysicalCompletion { get; private set; }
        public StepRunner(CapabilityTable table) { this.table = table ?? throw new ArgumentNullException(nameof(table)); }
        public bool Advertises(string id) => Act2.Contains(id);
        public int ActiveCount => active.Count;
        public bool Tracks(string encounterId) => encounterId != null && leaseId.ContainsKey(encounterId);
        public LiveExecution Active(string encounterId) => encounterId != null && active.TryGetValue(encounterId, out var execution) ? execution : null;

        public void Bind(IActivityWorld world) { World = world; }
        public void ClientHello() { requiresHello = false; leased = false; leaseAt = -1; leaseTtl = 0; }
        public void Lease(long wallMs, int ttlMs) { if (requiresHello || ttlMs < 1 || ttlMs > ActivityContracts.LeaseTtlMs) return; leased = true; leaseTtl = ttlMs; leaseAt = wallMs; }
        public void ClientDisconnected(ActivitySession session, string reason, long wallMs)
        {
            var game = World?.GameTime ?? 0;
            ApplyLeaseLoss(session, ActivityContracts.IsReason(reason) ? reason : "lease_lost", game, wallMs);
            leaseId.Clear(); incarnation.Clear(); places.Clear();
        }

        public bool Accept(ActivitySession session, IDictionary<string, object> frame)
        {
            var type = frame.ContainsKey("type") ? frame["type"] as string : null;
            if (type == "actor.acquire") return Acquire(session, frame);
            if (type == "actor.release") return Release(session, frame);
            if (type == "anchor.resolve") return Resolve(session, frame);
            if (type == "step.preflight") return Preflight(session, frame);
            if (type == "step.begin") return Begin(session, frame);
            if (type == "step.cancel") return Cancel(session, frame);
            if (type == "step.query") return Query(session, frame);
            return false;
        }

        public void Tick(uint gameMs, long wallMs)
        {
            if (leased && leaseAt >= 0 && wallMs - leaseAt > leaseTtl) {
                LeaseExpiries++;
                ApplyLeaseLoss(Session, "lease_lost", gameMs, wallMs);
            }
            foreach (var execution in active.Values.ToArray()) Advance(execution, gameMs, wallMs);
        }

        void ApplyLeaseLoss(ActivitySession session, string reason, uint gameMs, long wallMs)
        {
            leased = false; requiresHello = true; leaseAt = -1; leaseTtl = 0;
            foreach (var execution in active.Values.ToArray()) {
                var stop = execution.OnLeaseLoss == "cancel_if_current";
                if (stop) TryStop(execution, true);
                Finish(session, execution, stop ? "CANCELLED" : "DETACHED", reason, gameMs, wallMs);
            }
        }

        public void OnCallback(string encounterId, string incarnationId, string name, string phase, bool? succeeded, uint gameMs, long wallMs)
        {
            var execution = Active(encounterId);
            if (execution == null || execution.Terminal) return;
            if (execution.IncarnationId != incarnationId) { StaleReceipts++; return; }
            var own = table.NamesFor(execution.Capability).Contains(name ?? "");
            if (!own) { try { World?.NoteForeign(execution.EncounterId); } catch { } AddEvidence(execution, "control_changed", "weak", gameMs, "externalCommand", "essential"); Finish(Session, execution, "SUPERSEDED", "superseded_essential", gameMs, wallMs); return; }
            if (phase == "executed" && succeeded == false) Finish(Session, execution, "FAILED", "handler_false", gameMs, wallMs);
            else if (phase == "executed" && succeeded == true && execution.State == "DISPATCHED") { execution.Handler = true; execution.AcceptedGameMs = gameMs; Accepted++; AdvanceState(Session, execution, "HANDLER_ACCEPTED", gameMs, wallMs); }
        }

        public void Preempt(string encounterId, string incarnationId, string operation, uint gameMs, long wallMs, ActivitySession session)
        {
            var execution = Active(encounterId);
            if (execution == null) return;
            if (execution.IncarnationId != incarnationId) { StaleReceipts++; return; }
            Bump(encounterId);
            try { World?.EndOwnership(encounterId, true); } catch { }
            AddEvidence(execution, "control_changed", "weak", gameMs, "externalCommand", "p2_control");
            Finish(session, execution, "SUPERSEDED", "superseded_player", gameMs, wallMs);
            PublishLease(session, encounterId, "p2_control");
            if (operation == "dismiss" || operation == "release" || operation == "despawn") Retire(encounterId, incarnationId, gameMs, wallMs, session);
        }

        public void Retire(string encounterId, string incarnationId, uint gameMs, long wallMs, ActivitySession session)
        {
            places.Retire(incarnationId);
            var execution = Active(encounterId);
            if (execution == null) return;
            if (incarnationId != null && execution.IncarnationId != incarnationId) { StaleReceipts++; return; }
            Finish(session, execution, "DETACHED", "actor_retired", gameMs, wallMs);
            PublishLease(session, encounterId, "retired");
        }

        public void ClockReset(ActivitySession session)
        {
            places.Clear();
            foreach (var execution in active.Values.ToArray()) Finish(session, execution, "CANCELLED", "clock_reset", execution.DispatchedGameMs, 0);
        }

        public ActivityView View(string encounterId)
        {
            var execution = Active(encounterId);
            if (execution == null) return new ActivityView();
            return new ActivityView { Present = true, Capability = execution.Capability, Step = execution.Capability, Status = StatusOf(execution), Reason = execution.Reason, Intent = IntentOf(execution.Capability) };
        }

        public IReadOnlyList<ActivityView> History => history;

        bool Acquire(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = frame.ContainsKey("requestId") ? frame["requestId"] as string : null;
            var alias = frame.ContainsKey("ownerAlias") ? frame["ownerAlias"] as string : null;
            var token = frame.ContainsKey("ownershipToken") ? frame["ownershipToken"] as string : null;
            var lease = frame.ContainsKey("leaseId") ? frame["leaseId"] as string : null;
            if (!ActivityContracts.IsUuid(request) || !ActivityContracts.IsUuid(token) || !ActivityContracts.IsUuid(lease) || World == null) return Nack(session, request, "actor_unavailable");
            if (!leased) return Nack(session, request, "lease_lost");
            if (!World.TryAcquire(alias, token, out var encounter, out var incarnation, out var reason)) return Nack(session, request, reason ?? "actor_unavailable");
            if (!leaseEpoch.ContainsKey(encounter)) leaseEpoch[encounter] = 1;
            leaseId[encounter] = lease;
            this.incarnation[encounter] = incarnation;
            Reply(session, new Dictionary<string, object> {{"type","actor.acquired"},{"requestId",request},{"encounterId",encounter},{"incarnationId",incarnation},{"leaseEpoch",leaseEpoch[encounter]}});
            return true;
        }

        bool Release(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = Text(frame, "requestId");
            var encounter = Text(frame, "encounterId");
            var suppliedLease = Text(frame, "leaseId");
            if (!ActivityContracts.IsUuid(request) || encounter == null) return false;
            if (!leaseId.TryGetValue(encounter, out var held) || held != suppliedLease) return Nack(session, request, "lease_lost");
            try { World?.EndOwnership(encounter, false); } catch { }
            if (incarnation.TryGetValue(encounter, out var retired)) places.Retire(retired);
            Bump(encounter); leaseId.Remove(encounter); incarnation.Remove(encounter);
            Reply(session, new Dictionary<string, object> {{"type","ack"},{"requestId",request}});
            return true;
        }

        bool Resolve(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = frame.ContainsKey("requestId") ? frame["requestId"] as string : null;
            var encounter = frame.ContainsKey("encounterId") ? frame["encounterId"] as string : null;
            var refs = frame.ContainsKey("refs") ? frame["refs"] as object[] : null;
            if (!ActivityContracts.IsUuid(request) || refs == null || World == null) return false;
            if (!LeaseMatches(frame, encounter)) return Nack(session, request, "lease_lost");
            var results = new List<Dictionary<string, object>>();
            foreach (var item in refs) {
                var pair = item as Dictionary<string, object>;
                var role = pair != null && pair.ContainsKey("role") ? pair["role"] as string : null;
                var slot = pair != null && pair.ContainsKey("slot") ? pair["slot"] as Dictionary<string, object> : null;
                var kind = slot != null && slot.ContainsKey("kind") ? slot["kind"] as string : null;
                if (kind == "place") kind = "here";
                var hit = World.Resolve(encounter, role, kind);
                if (hit.Ok && kind == "here" && !places.TryGet(hit.Ref, out _)) {
                    if (!places.TryAdd(new PlaceAnchor { PlaceRef = hit.Ref, Kind = "here", Label = hit.Label, IncarnationId = incarnation.ContainsKey(encounter) ? incarnation[encounter] : null, X = hit.X, Y = hit.Y, Z = hit.Z })) hit = new AnchorResult { Reason = "budget_exhausted" };
                }
                results.Add(new Dictionary<string, object> {{"role", role ?? "actor"},{"ref", hit.Ok ? (object)hit.Ref : null},{"reason", hit.Ok ? null : hit.Reason ?? "place_unresolved"},{"label", hit.Label},{"distanceBand", hit.Band}});
            }
            Reply(session, new Dictionary<string, object> {{"type","anchor.resolved"},{"requestId",request},{"results",results.ToArray()}});
            return true;
        }

        bool Preflight(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = frame.ContainsKey("requestId") ? frame["requestId"] as string : null;
            var encounter = frame.ContainsKey("encounterId") ? frame["encounterId"] as string : null;
            var capability = frame.ContainsKey("capability") ? frame["capability"] as string : null;
            if (!ActivityContracts.IsUuid(request) || !Advertises(capability) || World == null) return Nack(session, request, "capability_unavailable");
            if (!leased || !LeaseMatches(frame, encounter)) return Nack(session, request, "lease_lost");
            if (capability == "follow_person") {
                var target = TargetRef(frame);
                if (!ActivityContracts.IsUuid(target) || !World.AnchorLive(target)) return Nack(session, request, "target_retired");
            }
            if (capability == "hold_position") {
                var placeRef = PlaceRef(frame);
                if (!places.TryGet(placeRef, out var place)) return Nack(session, request, "place_unresolved");
                var sample = World.Sample(encounter);
                if (Distance(sample, place) > 6.0) return Nack(session, request, "target_out_of_range");
            }
            var result = World.Preflight(encounter, capability);
            var verdicts = new List<Dictionary<string, object>>();
            if (frame.ContainsKey("preconditions") && frame["preconditions"] is object[] list) foreach (var item in list) if (item is string id) verdicts.Add(new Dictionary<string, object> {{"id",id},{"verdict", result.Ok || result.Already ? "satisfied" : "violated"}});
            Reply(session, new Dictionary<string, object> {{"type","step.preflighted"},{"requestId",request},{"verdicts",verdicts.ToArray()},{"alreadySatisfied",result.Already},{"reason",result.Already || result.Ok ? null : result.Reason ?? "capability_unavailable"}});
            return true;
        }

        bool Begin(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = Text(frame, "requestId");
            var executionId = Text(frame, "executionId");
            var encounter = Text(frame, "encounterId");
            var capability = Text(frame, "capability");
            var incarnationId = incarnation.ContainsKey(encounter ?? "") ? incarnation[encounter] : null;
            var epoch = frame.ContainsKey("leaseEpoch") ? Convert.ToInt32(frame["leaseEpoch"], CultureInfo.InvariantCulture) : -1;
            if (!ActivityContracts.IsUuid(request) || !ActivityContracts.IsUuid(executionId) || !Advertises(capability)) return Nack(session, request, "capability_unavailable");
            if (!leased) return Nack(session, request, "lease_lost");
            if (World == null || incarnationId == null || !World.SameIncarnation(encounter, incarnationId)) return Nack(session, request, "epoch_changed");
            if (!leaseId.TryGetValue(encounter, out var held) || held != Text(frame, "leaseId") || !leaseEpoch.TryGetValue(encounter, out var current) || current != epoch) return Nack(session, request, "lease_lost");
            if (active.ContainsKey(encounter)) return Nack(session, request, "activity_busy");
            if (active.Count >= ActivityContracts.MaxActors) return Nack(session, request, "activity_limit");
            var row = table.Get(capability);
            var execution = new LiveExecution {
                ExecutionId = executionId, ActivityId = Text(frame, "activityId"), StepId = Text(frame, "stepId"), EncounterId = encounter,
                IncarnationId = incarnationId, LeaseId = held, Capability = capability, EssentialName = row?.EssentialName, Adapter = row?.Kind == "finite_then_mode" ? "resume_ambient" : AdapterOf(capability),
                OnLeaseLoss = Text(frame, "onLeaseLoss") ?? "cancel_if_current", State = "REQUESTED", Attempt = Convert.ToInt32(frame["attempt"], CultureInfo.InvariantCulture),
                LeaseEpoch = epoch, RequestedGameMs = World.GameTime, AcceptMs = row?.AcceptMs ?? 2000, EstablishMs = row == null ? 5000 : EstablishOf(row), HoldMaxMs = row?.HoldMaxMs ?? 0, CompleteMs = CompleteOf(capability),
                PlaceRef = PlaceRef(frame)
            };
            if (capability == "hold_position") {
                if (!places.TryGet(execution.PlaceRef, out var place)) return Nack(session, request, "place_unresolved");
                var sample = World.Sample(encounter);
                if (Distance(sample, place) > 6.0) return Nack(session, request, "target_out_of_range");
            }
            execution.OwnName = execution.EssentialName;
            var game = World.GameTime;
            try { World.BeginOwnership(encounter); }
            catch { return Nack(session, request, "handler_exception"); }
            active[encounter] = execution;
            bool dispatched;
            try { dispatched = World.Dispatch(encounter, capability, TargetRef(frame)); }
            catch { dispatched = false; }
            if (!dispatched) { Finish(session, execution, "FAILED", "handler_exception", game, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); return Nack(session, request, "handler_exception"); }
            execution.DispatchedGameMs = game; Dispatches++;
            AdvanceState(session, execution, "VALIDATED", game, 0);
            AdvanceState(session, execution, "DISPATCHED", game, 0);
            AddEvidence(execution, "queue_submitted", "weak", game, null, null);
            Reply(session, new Dictionary<string, object> {{"type","ack"},{"requestId",request}});
            return true;
        }

        bool Cancel(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = Text(frame, "requestId");
            var executionId = Text(frame, "executionId");
            var mode = Text(frame, "mode");
            var execution = active.Values.FirstOrDefault(item => item.ExecutionId == executionId);
            if (execution == null) { if (ActivityContracts.IsUuid(request)) Reply(session, new Dictionary<string, object> {{"type","ack"},{"requestId",request}}); return true; }
            var stop = mode == "cancel_if_current";
            try { World?.Cancel(execution.EncounterId, execution.Capability, stop); } catch { }
            Finish(session, execution, stop ? "CANCELLED" : "DETACHED", stop ? "cancelled_by_player" : "cancelled_by_engine", World?.GameTime ?? execution.DispatchedGameMs, 0);
            if (ActivityContracts.IsUuid(request)) Reply(session, new Dictionary<string, object> {{"type","ack"},{"requestId",request}});
            return true;
        }

        bool Query(ActivitySession session, IDictionary<string, object> frame)
        {
            var request = Text(frame, "requestId");
            var ids = frame.ContainsKey("executionIds") ? frame["executionIds"] as object[] : new object[0];
            var receipts = new List<Dictionary<string, object>>();
            foreach (var id in ids ?? new object[0]) {
                var live = active.Values.FirstOrDefault(item => item.ExecutionId == id as string);
                if (live != null) receipts.Add(Receipt(session, live, World?.GameTime ?? 0));
            }
            Reply(session, new Dictionary<string, object> {{"type","receipts"},{"requestId",request},{"receipts",receipts.ToArray()}});
            return ActivityContracts.IsUuid(request);
        }

        void Advance(LiveExecution execution, uint gameMs, long wallMs)
        {
            if (execution.Terminal || World == null) return;
            if (!World.SameIncarnation(execution.EncounterId, execution.IncarnationId)) { Finish(Session, execution, "DETACHED", "actor_retired", gameMs, wallMs); return; }
            ModeSample sample;
            try { sample = World.Sample(execution.EncounterId); } catch { return; }
            if (sample.Dead || !sample.Alive) { Finish(Session, execution, "FAILED", "actor_dead", gameMs, wallMs); return; }
            if (sample.Injured) { Finish(Session, execution, "FAILED", "actor_injured", gameMs, wallMs); return; }
            if (sample.Scripted) { TryStop(execution, true); Finish(Session, execution, "CANCELLED", "scripted_state", gameMs, wallMs); return; }
            if (sample.Directed) { TryStop(execution, true); Finish(Session, execution, "CANCELLED", "directed_interaction", gameMs, wallMs); return; }
            if (sample.Reflex) { Finish(Session, execution, "SUPERSEDED", "superseded_reflex", gameMs, wallMs); return; }
            if (execution.Capability == "follow_person" && !sample.TargetValid) { Finish(Session, execution, "FAILED", "target_retired", gameMs, wallMs); return; }
            if (execution.Capability == "follow_person") {
                if (sample.DistanceBand == "far") { if (execution.FarSince < 0) execution.FarSince = wallMs; else if (wallMs - execution.FarSince >= 5000) { Finish(Session, execution, "FAILED", "target_out_of_range", gameMs, wallMs); return; } }
                else execution.FarSince = -1;
            }
            if (execution.Capability == "hold_position") {
                if (!places.TryGet(execution.PlaceRef, out var place)) { Finish(Session, execution, "FAILED", "place_unresolved", gameMs, wallMs); return; }
                var displacement = Distance(sample, place);
                if (displacement > 6.0) { Finish(Session, execution, "FAILED", "target_out_of_range", gameMs, wallMs); return; }
            }
            if (execution.State == "DISPATCHED" && ActivityContracts.UnsignedDue(gameMs, execution.DispatchedGameMs, execution.AcceptMs)) { Finish(Session, execution, "TIMED_OUT", "accept_timeout", gameMs, wallMs); return; }
            if (!execution.Handler) return;
            var verdict = CompletionAdapters.Evaluate(execution.Adapter, sample);
            if (execution.State == "HANDLER_ACCEPTED" && ActivityContracts.UnsignedDue(gameMs, execution.DispatchedGameMs, execution.EstablishMs) && verdict == "not_yet") { Finish(Session, execution, "TIMED_OUT", "establish_timeout", gameMs, wallMs); return; }
            if (verdict == "completed") { HasPhysicalCompletion = true; Completed++; execution.EstablishedGameMs = gameMs; AddEvidence(execution, "mode_flag", "strong", gameMs, null, null); Finish(Session, execution, "PHYSICALLY_COMPLETED", null, gameMs, wallMs); return; }
            if (verdict == "lost" && execution.State == "MODE_ESTABLISHED") { execution.ModeHealth = "lost"; Publish(Session, execution, gameMs, wallMs); Finish(Session, execution, "FAILED", "no_progress", gameMs, wallMs); return; }
            if (verdict == "established" && execution.State != "MODE_ESTABLISHED") { execution.ModeHealth = "healthy"; execution.EstablishedGameMs = gameMs; Established++; AddEvidence(execution, "mode_flag", "medium", gameMs, null, null); AdvanceState(Session, execution, "MODE_ESTABLISHED", gameMs, wallMs); }
            if (execution.State == "MODE_ESTABLISHED" && execution.HoldMaxMs > 0 && ActivityContracts.UnsignedDue(gameMs, execution.DispatchedGameMs, execution.HoldMaxMs)) Finish(Session, execution, "TIMED_OUT", "hold_limit", gameMs, wallMs);
            if (execution.CompleteMs > 0 && execution.State == "MODE_ESTABLISHED" && execution.Capability == "resume_ambient" && ActivityContracts.UnsignedDue(gameMs, execution.DispatchedGameMs, execution.CompleteMs)) Finish(Session, execution, "TIMED_OUT", "complete_timeout", gameMs, wallMs);
        }

        void TryStop(LiveExecution execution, bool stop) { try { World?.Cancel(execution.EncounterId, execution.Capability, stop); } catch { } }

        void Finish(ActivitySession session, LiveExecution execution, string state, string reason, uint gameMs, long wallMs)
        {
            if (execution.Terminal) return;
            if (state == "PHYSICALLY_COMPLETED" && Act2.Contains(execution.Capability) && execution.Capability != "resume_ambient") return;
            execution.State = state; execution.Reason = reason; execution.Terminal = true; execution.Sequence++;
            if (state == "FAILED") Failed++; else if (state == "SUPERSEDED") Superseded++; else if (state == "TIMED_OUT") TimedOut++; else if (state == "DETACHED" || state == "CANCELLED") Detached++;
            active.Remove(execution.EncounterId);
            var view = new ActivityView { Present = false, Capability = execution.Capability, Step = execution.Capability, Status = StatusOf(execution), Reason = reason, Intent = IntentOf(execution.Capability) };
            history.Add(view); if (history.Count > 8) history.RemoveAt(0);
            try { World?.EndOwnership(execution.EncounterId, false); } catch { }
            Publish(session, execution, gameMs, wallMs);
        }

        void AdvanceState(ActivitySession session, LiveExecution execution, string state, uint gameMs, long wallMs)
        {
            if (execution.Terminal || state == "PHYSICALLY_COMPLETED") return;
            execution.State = state; execution.Sequence++;
            Publish(session, execution, gameMs, wallMs);
        }

        void Publish(ActivitySession session, LiveExecution execution, uint gameMs, long wallMs)
        {
            if (session == null || !execution.Terminal && wallMs > 0 && wallMs - execution.LastReceiptWall < 250) return;
            execution.LastReceiptWall = wallMs;
            session.Reply(new Dictionary<string, object> {{"type","receipt"},{"receipt",Receipt(session, execution, gameMs)}});
        }

        Dictionary<string, object> Receipt(ActivitySession session, LiveExecution execution, uint gameMs)
        {
            var terminal = execution.Terminal;
            return new Dictionary<string, object> {
                {"receiptVersion",1},{"executionId",execution.ExecutionId},{"activityId",execution.ActivityId ?? execution.ExecutionId},{"stepId",execution.StepId ?? execution.ExecutionId},
                {"attempt",execution.Attempt},{"actorEncounterId",execution.EncounterId},{"capability",execution.Capability},
                {"essential", new Dictionary<string, object> {{"path","queue"},{"name",execution.EssentialName}}},
                {"targets", new object[0]},
                {"epochs", new Dictionary<string, object> {{"nativeRun",session?.NativeRun ?? execution.ExecutionId},{"adapterEpoch",session?.AdapterEpoch ?? execution.ExecutionId},{"leaseEpoch",execution.LeaseEpoch}}},
                {"state",execution.State},{"modeHealth", execution.State == "MODE_ESTABLISHED" ? (object)(execution.ModeHealth ?? "healthy") : null},
                {"predicate", execution.State == "PHYSICALLY_COMPLETED" ? "satisfied" : execution.State == "MODE_ESTABLISHED" ? "not_yet" : "unknown"},
                {"reason", terminal && execution.State != "PHYSICALLY_COMPLETED" ? execution.Reason : null},
                {"handlerResult", execution.Handler ? (object)true : null},
                {"milestones", new Dictionary<string, object> {{"requestedGameMs",(long)execution.RequestedGameMs},{"validatedGameMs",(long)execution.DispatchedGameMs},{"dispatchedGameMs",(long)execution.DispatchedGameMs},{"acceptedGameMs",execution.Handler ? (object)(long)execution.AcceptedGameMs : null},{"establishedGameMs",execution.EstablishedGameMs > 0 ? (object)(long)execution.EstablishedGameMs : null},{"completedGameMs",execution.State == "PHYSICALLY_COMPLETED" ? (object)(long)gameMs : null},{"terminalGameMs",terminal ? (object)(long)gameMs : null}}},
                {"evidence",execution.Evidence.ToArray()},{"evidenceDropped",execution.EvidenceDropped},{"sequence",Math.Max(1,execution.Sequence)}
            };
        }

        static void AddEvidence(LiveExecution execution, string kind, string strength, uint gameMs, string detailKey, string detailValue)
        {
            if (execution.Evidence.Count >= ActivityContracts.EvidenceCap) { execution.Evidence.RemoveAt(0); execution.EvidenceDropped++; }
            object detail = detailKey == null ? null : new Dictionary<string, object> {{detailKey, detailValue}};
            execution.Evidence.Add(new Dictionary<string, object> {{"kind",kind},{"strength",strength},{"gameMs",(long)gameMs},{"detail",detail}});
        }

        void Bump(string encounter) { leaseEpoch[encounter] = leaseEpoch.TryGetValue(encounter, out var epoch) ? epoch + 1 : 2; }
        void PublishLease(ActivitySession session, string encounter, string reason)
        {
            if (session == null || !leaseEpoch.ContainsKey(encounter)) return;
            session.Reply(new Dictionary<string, object> {{"type","lease.changed"},{"encounterId",encounter},{"leaseEpoch",leaseEpoch[encounter]},{"reason",reason}});
        }
        bool Nack(ActivitySession session, string request, string reason) { if (ActivityContracts.IsUuid(request)) Reply(session, new Dictionary<string, object> {{"type","nack"},{"requestId",request},{"reason",reason}}); return true; }
        static void Reply(ActivitySession session, Dictionary<string, object> fields) => session?.Reply(fields);
        static string Text(IDictionary<string, object> frame, string key) => frame.ContainsKey(key) ? frame[key] as string : null;
        bool LeaseMatches(IDictionary<string, object> frame, string encounter)
        {
            return leased && encounter != null && leaseId.TryGetValue(encounter, out var held) && held == Text(frame, "leaseId");
        }
        static string TargetRef(IDictionary<string, object> frame)
        {
            if (!(frame.ContainsKey("args") && frame["args"] is Dictionary<string, object> args) || !(args.ContainsKey("target") && args["target"] is Dictionary<string, object> target)) return null;
            return target.ContainsKey("captureRef") ? target["captureRef"] as string : null;
        }
        static string PlaceRef(IDictionary<string, object> frame)
        {
            if (!(frame.ContainsKey("args") && frame["args"] is Dictionary<string, object> args) || !(args.ContainsKey("place") && args["place"] is Dictionary<string, object> place)) return null;
            return place.ContainsKey("placeRef") ? place["placeRef"] as string : null;
        }
        static double Distance(ModeSample sample, PlaceAnchor place)
        {
            var dx = sample.X - place.X; var dy = sample.Y - place.Y; var dz = sample.Z - place.Z;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
        static string AdapterOf(string capability) => capability == "hold_position" ? "hold_mode" : capability == "follow_person" ? "follow_mode" : capability == "sit_on_ground" ? "pose_mode" : "resume_ambient";
        static int EstablishOf(CapabilityRow row) => row.Id == "follow_person" ? 8000 : row.Id == "sit_on_ground" ? 6000 : row.Id == "resume_ambient" ? 10000 : 5000;
        static int CompleteOf(string capability) => capability == "resume_ambient" ? 45000 : 0;
        static string IntentOf(string capability) => capability == "follow_person" ? "accompany" : capability == "resume_ambient" ? "resume_previous" : capability == "sit_on_ground" ? "sit_here" : "hold_position";
        static string StatusOf(LiveExecution execution)
        {
            if (!execution.Terminal) return execution.State == "MODE_ESTABLISHED" ? "running" : "running";
            if (execution.State == "PHYSICALLY_COMPLETED") return "completed";
            if (execution.State == "CANCELLED") return "cancelled";
            if (execution.State == "SUPERSEDED") return "superseded";
            if (execution.State == "TIMED_OUT") return "failed";
            if (execution.State == "DETACHED") return "abandoned";
            return "failed";
        }
    }
}
