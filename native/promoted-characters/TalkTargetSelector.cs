using System;
using System.Collections.Generic;
using LosSantosAlive.Input;
using LosSantosAlive.NPC;
using LosSantosAlive.NPC.Perception;
using Rage;
using Rage.Native;

namespace LSA.PromotedCharacters
{
    // Candidate search, exact ped lifetime and the stock microphone seam.
    // Preview and cycling never call SetPlayerConversationPed or SendMicStart.
    internal sealed class TalkTargetSelector
    {
        const int ProjectionCap = 48;
        sealed class Sample { public TalkCandidate Token; public Ped Ped; }
        readonly TalkTargetPolicy policy = new TalkTargetPolicy();
        readonly TalkPttSession ptt = new TalkPttSession();
        readonly EssentialMicState mic = new EssentialMicState();
        readonly TalkTargetIndicator indicator = new TalkTargetIndicator();
        readonly Func<Ped,string> encounterId;
        readonly List<Ped> frozenPeds = new List<Ped>();
        readonly List<TalkCandidate> exported = new List<TalkCandidate>();
        TalkTargetOptions options = new TalkTargetOptions();
        Ped essentialPed;
        long essentialAddress, clock;
        bool essentialSet, hooked;
        public TalkTargetSelector(Func<Ped,string> encounterId) { this.encounterId = encounterId; }
        public string IndicatorState => indicator.State;

        public void Maintain(long now)
        {
            clock = now;
            try {
                if (!hooked) { indicator.EnsureHooked(); hooked = true; }
                if (!policy.HasSelection) { frozenPeds.Clear(); indicator.Clear(); return; }
                string problem = Fitness(now,false);
                if (problem != null) {
                    if (ptt.IsLive) Stop(ptt.LiveGeneration,problem,now);
                    Drop(problem);
                    return;
                }
                if (options.Indicator && !indicator.Disabled && policy.Index >= 0 && policy.Index < frozenPeds.Count) indicator.Publish(frozenPeds[policy.Index],policy.Index + 1,policy.Count);
                else indicator.Clear();
            } catch { indicator.Clear(); }
        }
        public object AsResult(TalkTargetView view) => view != null && view.Present ? Payload(view,EncounterOf(Bound()),0,view.PttCommitted) : new {present = false,reason = view?.Reason,indicator = indicator.State};
        public TalkTargetView SelectFirst(long now,TalkTargetOptions next) { clock = now; return Select(now,Sanitize(next)); }
        public TalkTargetView SelectNext(long now,TalkTargetOptions next)
        {
            clock = now;
            next = Sanitize(next);
            if (ptt.IsLive) return Current(now,"ptt_busy");
            if (!policy.CycleOpen(now)) return Select(now,next);
            options = next;
            var advanced = policy.SelectNext(now,next);
            if (!advanced.Present) return Select(now,next);
            string problem = Fitness(now,false);
            if (problem != null) { Drop(problem); return Absent(problem); }
            LogSelected("cycle");
            Publish();
            return Current(now,"cycle");
        }
        public object Start(string expectedSelectionId,string expectedEncounterId,int generation,bool selectFirst,TalkTargetOptions next,long now)
        {
            clock = now;
            next = Sanitize(next);
            string admission = ptt.Admit(generation);
            if (admission == "cancelled") return new {started = false,reason = "cancelled",generation};
            if (admission == "already") return Payload(policy.Inspect(now),EncounterOf(Bound()),generation,true);
            if (admission != "start") throw new InvalidOperationException(admission == "busy" ? "ptt_busy" : "invalid_arguments");
            try {
                if (!selectFirst) {
                    if (!policy.HasSelection || expectedSelectionId != policy.SelectionId) { ptt.Fence(generation); throw new InvalidOperationException(policy.HasSelection ? "target_changed" : "target_lost"); }
                    if (Fitness(now,true) != null) { Drop("lost"); ptt.Fence(generation); throw new InvalidOperationException("target_lost"); }
                } else if (!policy.HasSelection || Fitness(now,true) != null) {
                    if (policy.HasSelection) Drop("lost");
                    var selected = Select(now,next);
                    if (!selected.Present) { ptt.Fence(generation); throw new InvalidOperationException(selected.Reason ?? "no_nearby_npc"); }
                }
                var ped = Bound();
                if (ped == null) { ptt.Fence(generation); throw new InvalidOperationException("target_lost"); }
                string encounter = EncounterOf(ped);
                if (expectedEncounterId != null && encounter != expectedEncounterId) { ptt.Fence(generation); throw new InvalidOperationException("target_changed"); }

                string gate = StartGate();
                if (gate != null) { ptt.Fence(generation); throw new InvalidOperationException(gate); }
                string micGate = mic.CanStart();
                if (micGate != null) { ptt.Fence(generation); throw new InvalidOperationException(micGate); }

                long address;
                try { address = ped.MemoryAddress.ToInt64(); } catch { ptt.Fence(generation); throw new InvalidOperationException("target_lost"); }

                try {
                    NpcTargeting.SetPlayerConversationPed(ped);
                    essentialPed = ped; essentialAddress = address; essentialSet = true;
                    InputController.SendMicStart(ped);
                    if (!mic.Owns(ped,address)) { TryRevert(ped); ptt.Fence(generation); throw new InvalidOperationException("mic_ownership_lost"); }

                    if (!ptt.Commit(generation)) {
                        string cancelledStop = mic.StopOwned(ped,address);
                        if (cancelledStop == "native_operation_failed" || cancelledStop == "mic_state_unavailable") throw new InvalidOperationException(cancelledStop);
                        ReleaseEssential();
                        return new {started = false,reason = "cancelled",generation};
                    }

                    policy.Commit(policy.SelectionId,now);
                    try { Game.LogTrivial("[UX4] talk_ptt commit=accepted generation=" + generation); } catch { }
                    try { Publish(); } catch { }
                    return Payload(policy.Inspect(now),encounter,generation,true);
                } catch {
                    TryRevert(ped);
                    throw;
                }
            } catch (InvalidOperationException) { throw; }
            catch { ptt.Fence(generation); throw; }
        }
        public object Stop(int generation,string reason,long now)
        {
            clock = now;
            if (!ptt.ShouldStop(generation)) return new {stopped = false,released = false,generation};

            string outcome = mic.StopOwned(essentialPed,essentialAddress);
            if (outcome == "native_operation_failed" || outcome == "mic_state_unavailable") throw new InvalidOperationException(outcome);

            ptt.CompleteStop(generation);
            policy.Release(now,options);
            DetachEssential();
            try { Game.LogTrivial("[UX4] talk_ptt end reason=" + (reason ?? outcome ?? "stop") + " generation=" + generation); } catch { }
            return new {stopped = outcome == null,released = true,generation,reason = outcome};
        }
        public object Describe(long now)
        {
            clock = now;
            bool had = policy.HasSelection;
            var view = policy.Inspect(now);
            if (!view.Present) { if (had) Forget(view.Reason ?? "expired"); return new {present = false}; }
            if (Fitness(now,false) != null) { Drop("lost"); return new {present = false}; }
            return Payload(view,EncounterOf(Bound()),0,view.PttCommitted);
        }
        public Ped SelectedPedIfValid(long now)
        {
            clock = now;
            if (!policy.HasSelection) return null;
            string problem = Fitness(now,false);
            if (problem == null) return Bound();
            if (ptt.IsLive) Stop(ptt.LiveGeneration,problem,now);
            Drop(problem);
            return null;
        }
        public void Clear(string reason,long now)
        {
            clock = now;
            if (ptt.IsLive) Stop(ptt.LiveGeneration,reason ?? "manual",now);
            Drop(reason ?? "manual");
            DetachEssential();
        }
        public void ResetForWorldChange(long now)
        {
            clock = now;
            bool had = policy.HasSelection || ptt.IsLive || essentialSet;
            if (ptt.IsLive) Stop(ptt.LiveGeneration,"world_reset",now);
            ptt.Reset();
            policy.ResetForWorldChange();
            frozenPeds.Clear();
            indicator.Clear();
            DetachEssential();
            if (had) Game.LogTrivial("[UX4] talk_target cleared reason=world_reset");
        }
        public void Shutdown(long now) { try { ResetForWorldChange(now); } catch { } try { indicator.Detach(); } catch { } }

        TalkTargetView Select(long now,TalkTargetOptions next)
        {
            if (ptt.IsLive) return Current(now,"ptt_busy");
            options = next;
            var samples = Collect(next,out string unavailable);
            if (unavailable != null) { Drop(unavailable); return Absent(unavailable); }
            var tokens = new List<TalkCandidate>();
            var lookup = new Dictionary<string,Ped>();
            foreach (var sample in samples) { tokens.Add(sample.Token); lookup[sample.Token.PedId + ":" + sample.Token.Address] = sample.Ped; }
            var view = policy.SelectFirst(tokens,now,next);
            frozenPeds.Clear();
            if (!view.Present) { indicator.Clear(); Game.LogTrivial("[UX4] talk_target cleared reason=" + view.Reason); return view; }
            policy.Export(exported);
            foreach (var token in exported) {
                if (!lookup.TryGetValue(token.PedId + ":" + token.Address,out var ped) || ped == null) { Drop("lost"); return Absent("target_lost"); }
                frozenPeds.Add(ped);
            }
            if (Fitness(now,true) != null) { Drop("lost"); return Absent("target_lost"); }
            LogSelected("first");
            Publish();
            return Current(now,"first");
        }
        string Fitness(long now,bool strict)
        {
            var ped = Bound();
            if (ped == null) return "lost";
            bool exists = false, dead = true, player = true, human = false;
            float distance = float.MaxValue;
            long address = 0;
            string pedId = null;
            try {
                exists = ped.Exists();
                dead = ped.IsDead;
                address = ped.MemoryAddress.ToInt64();
                pedId = ped.Handle.ToString();
                var character = Game.LocalPlayer.Character;
                player = character != null && ped == character;
                human = exists && !dead && !player && NpcTargeting.IsValidHumanPed(ped);
                if (character != null && character.Exists()) distance = Distance(ped.Position,character.Position);
            } catch { return "lost"; }
            string problem = policy.Problem(pedId,address,exists,dead,player,human,distance,options.RetentionRadiusMeters,now);
            if (problem != null) return problem;
            if (strict && (pedId != policy.PedId || address != policy.Address)) return "lost";
            return null;
        }
        List<Sample> Collect(TalkTargetOptions next,out string unavailable)
        {
            unavailable = null;
            var found = new List<Sample>();
            PerceptionSnapshot snapshot = null;
            try {
                if (!PerceptionSystem.TryGetSnapshot(out snapshot) || snapshot == null || !snapshot.IsValid || snapshot.AllPeds == null) { unavailable = "selector_unavailable"; return found; }
                uint age = unchecked((uint)((int)Game.GameTime - snapshot.GameTime));
                if (age > 1000) { unavailable = "selector_unavailable"; return found; }
            } catch { unavailable = "selector_unavailable"; return found; }
            var player = Game.LocalPlayer.Character;
            if (player == null || !player.Exists()) { unavailable = "selector_unavailable"; return found; }
            var near = new List<Ped>();
            foreach (var ped in snapshot.AllPeds) {
                if (ped == null || ped == player) continue;
                try {
                    if (!ped.Exists() || ped.IsDead || ped.MemoryAddress == IntPtr.Zero || !NpcTargeting.IsValidHumanPed(ped)) continue;
                    if (Distance(ped.Position,player.Position) > next.RadiusMeters) continue;
                    near.Add(ped);
                } catch { }
            }
            near.Sort((left,right) => Distance(left.Position,player.Position).CompareTo(Distance(right.Position,player.Position)));
            if (near.Count > ProjectionCap) near.RemoveRange(ProjectionCap,near.Count - ProjectionCap);
            int order = 0;
            foreach (var ped in near) {
                var projection = new TalkProjection {OnScreen = false,CenterError = float.MaxValue};
                try { projection = TalkTargetIndicator.Project(ped); } catch { }
                found.Add(new Sample {Ped = ped,Token = new TalkCandidate {PedId = ped.Handle.ToString(),Address = ped.MemoryAddress.ToInt64(),Distance = Distance(ped.Position,player.Position),ScreenCenterError = projection.CenterError,OnScreen = projection.OnScreen,InputOrder = order++}});
            }
            return found;
        }
        Ped Bound() => policy.HasSelection && policy.Index >= 0 && policy.Index < frozenPeds.Count ? frozenPeds[policy.Index] : null;
        TalkTargetView Current(long now,string reason)
        {
            var view = policy.Inspect(now);
            view.Reason = view.Present ? reason : view.Reason;
            return view;
        }
        void Publish()
        {
            var ped = Bound();
            if (ped != null && options.Indicator && !indicator.Disabled) indicator.Publish(ped,policy.Index + 1,policy.Count);
            else indicator.Clear();
        }
        object Payload(TalkTargetView view,string encounter,int generation,bool started) => new {
            present = view.Present,started,selectionId = view.SelectionId,encounterId = encounter,pedId = view.PedId,
            cycleIndex = view.CycleIndex,cycleCount = view.CycleCount,pttCommitted = view.PttCommitted || started,
            expiresInMs = view.ExpiresInMs,indicator = indicator.State,generation,reason = view.Reason};
        string EncounterOf(Ped ped)
        {
            if (ped == null || encounterId == null) return null;
            try { return encounterId(ped); } catch { return null; }
        }
        void Drop(string reason)
        {
            if (!policy.HasSelection && frozenPeds.Count == 0) { indicator.Clear(); return; }
            policy.Clear(reason);
            Forget(reason);
        }
        void Forget(string reason)
        {
            frozenPeds.Clear();
            indicator.Clear();
            if (reason != null) Game.LogTrivial("[UX4] talk_target cleared reason=" + reason);
        }
        void TryRevert(Ped ped)
        {
            try {
                var current = NpcTargeting.GetPlayerConversationPed();
                if (current != null && current == ped) { essentialPed = ped; essentialAddress = ped.MemoryAddress.ToInt64(); essentialSet = true; ReleaseEssential(); }
            } catch { }
        }
        void DetachEssential()
        {
            essentialSet = false;
            essentialPed = null;
            essentialAddress = 0;
        }
        void ReleaseEssential()
        {
            if (!essentialSet) return;
            try {
                var current = NpcTargeting.GetPlayerConversationPed();
                if (current != null && current == essentialPed && current.MemoryAddress.ToInt64() == essentialAddress) NpcTargeting.ClearPlayerConversationPed();
            } catch { }
            DetachEssential();
        }
        static string StartGate()
        {
            try {
                if (TextInputService.IsOpen || LosSantosAlive.Core.LsaControlsMenu.BlocksLsaInput) return "input_busy";
                if (Game.IsLoading
                    || NativeFunction.CallByName<bool>("IS_CUTSCENE_ACTIVE")
                    || NativeFunction.CallByName<bool>("IS_CUTSCENE_PLAYING")
                    || NativeFunction.CallByName<bool>("IS_PLAYER_SWITCH_IN_PROGRESS")
                    || NativeFunction.CallByName<bool>("GET_MISSION_FLAG")
                    || NativeFunction.CallByName<bool>("NETWORK_IS_SESSION_ACTIVE")) return "scripted_state";
                return null;
            } catch { return "scripted_state"; }
        }
        void LogSelected(string reason) => Game.LogTrivial("[UX4] talk_target selected index=" + (policy.Index + 1) + " count=" + policy.Count + " reason=" + reason);
        static TalkTargetView Absent(string reason) => new TalkTargetView {Reason = reason};
        static TalkTargetOptions Sanitize(TalkTargetOptions next) => next != null && TalkTargetOptions.Valid(next.RadiusMeters,next.RetentionRadiusMeters,next.MaxCandidates,next.CycleWindowMs,next.SelectionTimeoutMs) ? next : new TalkTargetOptions();
        static float Distance(Vector3 from,Vector3 to)
        {
            float dx = from.X - to.X, dy = from.Y - to.Y, dz = from.Z - to.Z;
            return (float)Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
    }
}
