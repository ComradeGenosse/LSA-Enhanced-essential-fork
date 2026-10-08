using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using LSA.Activities;
using LosSantosAlive.NPC;
using Rage;
using Rage.Native;

namespace LSA.PromotedCharacters
{
    // Observation only. P2 and Essential remain the only callers of NPC actions.
    public sealed partial class PromotedCharactersIntegration : IActionStateModifier
    {
        ActivitySession activitySession;
        ActivityChannel activityChannel;
        StepRunner activityRunner;
        partial void BindActivityWorld(StepRunner runner);
        readonly SupersessionMonitor activityRing = new SupersessionMonitor();
        readonly Queue<long> activityFaultAt = new Queue<long>();
        bool activityDisabled, activityEscape, activityContainedFault;
        int activityFaults, activityBreakerTrips;
        long activityBreakerUntil;
        readonly Dictionary<string, string> activityFacts = new Dictionary<string, string>();
        readonly Dictionary<string, long> activityFactAt = new Dictionary<string, long>();

        internal bool ActivityDisabled => activityDisabled;
        internal int ActivityFaults => activityFaults;
        internal int ActivityBreakerTrips => activityBreakerTrips;
        internal ActivitySession ActivitySession => activitySession;

        internal void EnableActivityShadow(string pipeName)
        {
            if (activitySession != null || pipeName == null || !Regex.IsMatch(pipeName, "^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException("invalid_activity_pipe");
            var table = CapabilityTable.LoadEmbedded();
            activitySession = new ActivitySession(table,null,Host.HostRunId,()=>Host.WorldEpoch);
            activityChannel = new ActivityChannel(pipeName, activitySession);
            activityChannel.Start();
        }

        internal void EnableActivityExecution(string pipeName)
        {
            if (activitySession != null || pipeName == null || !Regex.IsMatch(pipeName, "^[A-Za-z0-9_.-]{1,80}$")) throw new ArgumentException("invalid_activity_pipe");
            var table = CapabilityTable.LoadEmbedded();
            activityRunner = new StepRunner(table);
            BindActivityWorld(activityRunner);
            activitySession = new ActivitySession(table, activityRunner,Host.HostRunId,()=>Host.WorldEpoch);
            activityRunner.Session = activitySession;
            activityChannel = new ActivityChannel(pipeName, activitySession);
            activityChannel.Start();
        }

        internal void InjectActivityFault(bool escape) { activityEscape = escape; activityContainedFault = !escape; }

        // P2 control operations run on the owner/update fiber, so opening the
        // shadow receipt here is safe. ACT still does not dispatch anything.
        void NoteActivityCommand(Encounter encounter, string operation)
        {
            if (activitySession == null || activityDisabled || encounter?.Registration == null) return;
            try {
                var game = unchecked((uint)Game.GameTime);
                var wall = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (activityRunner != null) activityRunner.Preempt(encounter.Id, encounter.Registration.IncarnationId, operation, game, wall, activitySession);
                else activitySession.Machine.ObserveCommand(encounter.Id, encounter.Registration.IncarnationId, SameIncarnation(encounter), operation, game);
            } catch { DisableActivity(); }
        }

        void ActivityClockReset(string reason)
        {
            try { activitySession?.Machine.ClockReset(); activityRunner?.ClockReset(activitySession); activitySession?.WorldChanged(Host.WorldEpoch,reason);activityChannel?.RefreshHello();activityChannel?.Flush(); }
            catch { DisableActivity(); }
        }

        void ActivityShutdown()
        {
            try { activitySession?.Machine.ClientDisconnected("control_released"); } catch { }
            try { activityRunner?.ClientDisconnected(activitySession, "control_released", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); } catch { }
            try { activityChannel?.Dispose(); } catch { }
            activityChannel = null;
        }

        void ActivityTick(long gameNow)
        {
            if (activitySession == null || activityDisabled) return;
            var wall = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var game = unchecked((uint)gameNow);
            try {
                if (activityEscape) { activityEscape = false; throw new InvalidOperationException("activity_escape"); }
                try {
                    // Pipe frames become session/receipt state only here, on the
                    // same owner fiber as every other StepMachine mutation.
                    activityChannel?.Pump(wall, activityRing.Dropped, activityBreakerTrips);
                    activitySession.Machine.Tick(game, wall);
                    activityRunner?.Tick(game, wall);

                    if (wall >= activityBreakerUntil) {
                        if (activityContainedFault) { activityContainedFault = false; throw new InvalidOperationException("activity_contained"); }
                        DrainActivityRing();
                        SampleActivityFacts(game);
                    }
                } catch {
                    RecordActivityFault(wall);
                }

                // Receipt counters are live diagnostics, not a one-time startup
                // snapshot. The session rate-limits them to four per second.
                activitySession.PublishDiagnosticsIfChanged(activityRing.Dropped, activityBreakerTrips, wall);
                activityChannel?.Flush();
            } catch {
                DisableActivity();
            }
        }

        void RecordActivityFault(long now)
        {
            activityFaults++;
            activityFaultAt.Enqueue(now);
            while (activityFaultAt.Count > 0 && now - activityFaultAt.Peek() > 60000) activityFaultAt.Dequeue();
            if (activityFaultAt.Count < 3) return;
            activityFaultAt.Clear();
            activityBreakerUntil = now + 60000;
            activityBreakerTrips++;
            try { Game.LogTrivial("[ACT] breaker_tripped"); } catch { }
        }

        void DrainActivityRing()
        {
            // If any callback was dropped, modifier before/after evidence from
            // this batch is incomplete; preserve handler callbacks but do not use
            // modifier phases to infer supersession.
            var overflowed = activityRing.Overflowing;
            CallbackRecord record;
            while ((record = activityRing.Drain()) != null) {
                try {
                    var ped = record.PedReference as Ped;
                    if (ped == null || !ped.Exists() || !encounters.TryGetValue(ped.Handle.ToString(), out var encounter) ||
                        encounter.Registration == null || !SameIncarnation(encounter) || !ReferenceEquals(encounter.Ped, ped)) {
                        activitySession.Machine.StaleReceipts++;
                        continue;
                    }
                    record.ActorKey = encounter.Id;
                    record.IncarnationId = encounter.Registration.IncarnationId;
                    if (record.Phase == "control_lost") {
                        if (activityRunner != null) activityRunner.Retire(record.ActorKey, record.IncarnationId, record.GameMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), activitySession);
                        else activitySession.Machine.ObserveControlLost(record.ActorKey, record.IncarnationId, record.GameMs);
                        continue;
                    }
                    if (activityRunner != null) activityRunner.OnCallback(record.ActorKey, record.IncarnationId, record.Name, record.Phase, record.Succeeded, record.GameMs, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    else activitySession.Machine.ObserveCallback(record, overflowed);
                } catch {
                    activitySession.Machine.StaleReceipts++;
                }
            }
        }

        // Callback-only path: capture the ped reference, callback payload and
        // source-time game tick. Do not inspect encounter dictionaries, identity,
        // NpcState, or natives here.
        void PushActivity(Ped ped, string name, string phase, bool? succeeded)
        {
            if (activitySession == null || activityDisabled || ped == null) return;
            try {
                activityRing.Push(new CallbackRecord {
                    PedReference = ped,
                    Name = name ?? "",
                    Phase = phase,
                    Succeeded = succeeded,
                    Source = "essential",
                    GameMs = unchecked((uint)Game.GameTime)
                });
            } catch { }
        }

        void SampleActivityFacts(uint game)
        {
            foreach (var encounter in encounters.Values) {
                if (encounter.Registration == null || (activityRunner != null ? !activityRunner.Tracks(encounter.Id) : activitySession.Machine.ActiveFor(encounter.Id) == null)) continue;
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (activityFactAt.TryGetValue(encounter.Id, out var at) && now - at < 500) continue;
                NpcState state = null;
                bool scripted = false, inVehicle = false, injured = false;
                try { state = NpcStateStore.TryGetState(encounter.Ped); } catch { }
                try { scripted = Scripted(); } catch { }
                try { injured = NativeFunction.CallByName<bool>("IS_PED_INJURED", encounter.Ped); } catch { }
                try { inVehicle = NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE", encounter.Ped, false); } catch { }
                var band = "far";
                try {
                    var player = Game.LocalPlayer.Character;
                    if (player != null) {
                        double dx = encounter.Ped.Position.X - player.Position.X;
                        double dy = encounter.Ped.Position.Y - player.Position.Y;
                        double dz = encounter.Ped.Position.Z - player.Position.Z;
                        var distance = Math.Sqrt(dx * dx + dy * dy + dz * dz);
                        band = distance <= 3 ? "at" : distance <= 15 ? "near" : distance <= 50 ? "medium" : "far";
                    }
                } catch { }
                var signature = string.Join(",", Alive(encounter), injured, state?.InDirectedInteraction == true, encounter.Suspended, state?.HasActiveReflex == true, scripted, inVehicle, band);
                if (activityFacts.TryGetValue(encounter.Id, out var previous) && previous == signature) continue;
                activityFacts[encounter.Id] = signature;
                activityFactAt[encounter.Id] = now;
                try { activitySession.Machine.ObserveReflex(encounter.Id, encounter.Registration.IncarnationId, state?.HasActiveReflex == true, state?.LastReflexTime ?? 0, game); } catch { }
                activitySession.PublishActorFacts(new Dictionary<string, object> {
                    {"encounterId",encounter.Id},{"alive",Alive(encounter)},{"injured",injured},{"scripted",scripted},{"suspended",encounter.Suspended},
                    {"inDirectedInteraction",state?.InDirectedInteraction == true},{"reflexActive",state?.HasActiveReflex == true},{"inVehicle",inVehicle},
                    {"isDriver",false},{"controlIntent",state?.StayUnderLsaControl == true},{"stateRegistered",state != null},{"distanceBand",band},{"gameMs",(long)game}
                });
            }
        }

        static bool SameIncarnation(Encounter encounter) => encounter?.Ped != null && encounter.Registration != null && encounter.Ped.MemoryAddress == encounter.Address;

        void DisableActivity()
        {
            activityDisabled = true;
            try { activitySession?.Machine.ClientDisconnected("lease_lost"); } catch { }
            try { activityRunner?.ClientDisconnected(activitySession, "lease_lost", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); } catch { }
            try { activityChannel?.Dispose(); } catch { }
        }

        public void ApplyActionState(Ped ped, NpcState state, string commandName, ActionStateModifierPhase phase)
        {
            PushActivity(ped, commandName, phase == ActionStateModifierPhase.BeforeCoreStateRule ? "before" : "after", null);
        }
    }
}
