using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using LosSantosAlive.NPC;
using Rage;
using Rage.Native;

namespace LSA.PromotedCharacters
{
    // UX phase 1 executor for loader commands (LocalCommandQueue) and the read-only
    // "current" pipe op. It runs only inside Update on Core's fiber and shares the
    // P2 per-tick budget. It adds no lifecycle, ownership, identity or task path:
    // asks use Essential's own typed-turn entry, InputController.SendTextPrompt.
    public sealed partial class PromotedCharactersIntegration
    {
        const int SnapshotIntervalMs = 250, MaxSnapshotInterestMs = 10000, AskCooldownMs = 3000, AskHistoryLimit = 64;
        readonly LocalCommandQueue local = new LocalCommandQueue();
        readonly Dictionary<string,long> lastAskAtUtc = new Dictionary<string,long>();
        long snapshotInterestUntilUtc, nextSnapshotAtUtc, snapshotSequence;
        string snapshot;
        bool bridgeFailureLogged;

        // Loader-facing entry points (any thread): they never touch game state.
        internal string SubmitLocal(string envelope) => IsReady ? local.Submit(envelope,Now) : "native_unavailable";
        internal string TakeLocalResult(string id) => local.TryTakeResult(id,Now);
        internal string LocalSnapshot() => Volatile.Read(ref snapshot);
        internal void RequestLocalSnapshots(int forMs)
        {
            long until = Now + Math.Max(0,Math.Min(MaxSnapshotInterestMs,forMs)), seen;
            // Interest only extends, so one client cannot end another's window.
            while ((seen = Interlocked.Read(ref snapshotInterestUntilUtc)) < until && Interlocked.CompareExchange(ref snapshotInterestUntilUtc,until,seen) != seen) { }
        }

        // Called from Update after pipe requests, with the remaining shared budget.
        // The optional bridge can never take P2 down: failures stop here.
        void ServeLocal(int budget)
        {
            try {
                for (; budget > 0 && local.TryTake(Now,out var command); budget--) Execute(command);
                RefreshSnapshot();
            } catch { if (!bridgeFailureLogged) { bridgeFailureLogged = true; LSA.Intelligence.IntelligenceIntegration.LogStatus("[UX] bridge_update_failed"); } }
        }
        void Execute(LocalCommand command)
        {
            object result = null; string reason = null;
            try { result = Run(command); }
            catch (InvalidOperationException error) { reason = Regex.IsMatch(error.Message,"^[a-z][a-z0-9_]{0,63}$") ? error.Message : "native_operation_failed"; }
            catch { reason = "native_operation_failed"; }
            // A failed command completes as a result; it never reaches Update's
            // outer handler, so it cannot shut down P2.
            try { local.Complete(command,reason,result,Now); } catch { }
        }
        object Run(LocalCommand command)
        {
            switch (command.Command)
            {
                case "current.inspect": return CurrentView();
                case "gates.read": return Gates();
                case "npc.ask": return Ask(command);
                default: throw new InvalidOperationException("unsupported_command");
            }
        }
        static Ped CurrentPed() => NpcTargeting.GetPlayerConversationPed() ?? NpcTargeting.GetCurrentSpeakerPed();
        // Read-only: no capture ticket, ownership, task or session. The encounter
        // id is the same P2 handle-bound id EnrichActor already gives every actor.
        object CurrentView()
        {
            var ped = CurrentPed();
            if (ped == null || !ped.Exists() || ped.IsDead || ped == Game.LocalPlayer.Character) return new {present = false};
            var encounter = EncounterFor(ped);
            bool owned = encounter.Registration != null;
            return new {present = true,pedId = ped.Handle.ToString(),encounterId = encounter.Id,ownerAlias = owned ? encounter.OwnerAlias : null,owned,
                suspended = owned && encounter.Suspended,mode = owned ? encounter.Mode : null,
                human = LosSantosAlive.NPC.NpcTargeting.IsValidHumanPed(ped),safe = Safe(encounter,!owned)};
        }
        static object Gates()
        {
            bool textInput = LosSantosAlive.Input.TextInputService.IsOpen,controlsMenu = LosSantosAlive.Core.LsaControlsMenu.BlocksLsaInput;
            bool cutscene = NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE") || NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING");
            bool playerSwitch = NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS"),mission = NativeFunction.CallByName<bool>("GET_MISSION_FLAG");
            bool online = NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE"),loading = Game.IsLoading;
            return new {textInputOpen = textInput,controlsMenuOpen = controlsMenu,cutscene,playerSwitch,mission,online,loading,
                inputFree = !textInput && !controlsMenu,scripted = cutscene || playerSwitch || mission || online || loading};
        }
        object Ask(LocalCommand command)
        {
            // Never start a turn over Essential's own text input or controls menu,
            // nor in scripted, loading or online states.
            if (LosSantosAlive.Input.TextInputService.IsOpen || LosSantosAlive.Core.LsaControlsMenu.BlocksLsaInput) throw new InvalidOperationException("input_busy");
            if (Game.IsLoading || Scripted()) throw new InvalidOperationException("scripted_state");
            var ped = CurrentPed();
            if (ped == null || !ped.Exists() || ped.IsDead || ped == Game.LocalPlayer.Character || !LosSantosAlive.NPC.NpcTargeting.IsValidHumanPed(ped)) throw new InvalidOperationException("no_current_npc");
            var encounter = EncounterFor(ped);
            if (encounter.Id != command.ExpectedEncounterId) throw new InvalidOperationException("target_changed");
            if (NpcStateStore.TryGetState(ped)?.InDirectedInteraction == true) throw new InvalidOperationException("scripted_state");
            long now = Now;
            if (lastAskAtUtc.TryGetValue(encounter.Id,out long previous) && now >= previous && now - previous < AskCooldownMs) throw new InvalidOperationException("ask_cooldown");
            // The exact call Essential's own text input makes: P0 context, P1
            // identity, the model and stock decision validation all still apply.
            LosSantosAlive.Input.InputController.SendTextPrompt(ped,command.Phrase);
            if (lastAskAtUtc.Count >= AskHistoryLimit) {
                foreach (var stale in lastAskAtUtc.Where(item => now - item.Value >= AskCooldownMs || now < item.Value).Select(item => item.Key).ToArray()) lastAskAtUtc.Remove(stale);
                if (lastAskAtUtc.Count >= AskHistoryLimit) lastAskAtUtc.Clear();
            }
            lastAskAtUtc[encounter.Id] = now;
            return new {status = "asked",encounterId = encounter.Id};
        }
        // Snapshots are built only while a client has asked for them, at most
        // every 250 ms, so an idle loader costs no game reads.
        void RefreshSnapshot()
        {
            long now = Now;
            if (now >= Interlocked.Read(ref snapshotInterestUntilUtc)) { if (Volatile.Read(ref snapshot) != null) Volatile.Write(ref snapshot,null); return; }
            if (now < nextSnapshotAtUtc) return;
            nextSnapshotAtUtc = now + SnapshotIntervalMs;
            object current = null,gates = null; string reason = null;
            try { current = CurrentView(); gates = Gates(); }
            catch (InvalidOperationException error) { current = gates = null; reason = Regex.IsMatch(error.Message,"^[a-z][a-z0-9_]{0,63}$") ? error.Message : "native_operation_failed"; }
            catch { current = gates = null; reason = "native_operation_failed"; }
            string text = null;
            try { text = json.Serialize(new {v = 1,seq = ++snapshotSequence,builtAtUtc = now,current,gates,reason}); } catch { }
            Volatile.Write(ref snapshot,text != null && text.Length <= LocalCommandQueue.MaxResultChars ? text : null);
        }
        void ResetLocal(string reason)
        {
            local.CancelPending(reason,Now); lastAskAtUtc.Clear(); nextSnapshotAtUtc = 0;
            Volatile.Write(ref snapshot,null);
        }
        void CloseLocal()
        {
            try { local.Close("native_unavailable",Now); } catch { }
            lastAskAtUtc.Clear(); Volatile.Write(ref snapshot,null);
        }
    }
}
