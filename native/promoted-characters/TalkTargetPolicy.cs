using System;
using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    // Pure selection session. No Rage types: the native adapter resolves these
    // tokens back to the exact Ped it ranked, and never substitutes a new one.
    internal struct TalkCandidate
    {
        public string PedId;
        public long Address;
        public float Distance;
        public float ScreenCenterError;
        public bool OnScreen;
        public int InputOrder;
        public TalkCandidate(string pedId,long address,float distance,float error,bool onScreen,int order)
        {
            PedId = pedId; Address = address; Distance = distance; ScreenCenterError = error; OnScreen = onScreen; InputOrder = order;
        }
    }
    internal sealed class TalkTargetOptions
    {
        public float RadiusMeters = 15f, RetentionRadiusMeters = 20f;
        public int MaxCandidates = 8, CycleWindowMs = 1500, SelectionTimeoutMs = 8000;
        public bool Indicator = true;
        public static bool Valid(float radius,float retention,int max,int cycleMs,int timeoutMs) =>
            radius >= 3f && radius <= 30f && retention >= radius && retention <= 50f && !float.IsNaN(radius) && !float.IsInfinity(radius) && !float.IsNaN(retention) && !float.IsInfinity(retention)
            && max >= 1 && max <= 16 && cycleMs >= 500 && cycleMs <= 3000 && timeoutMs >= 2000 && timeoutMs <= 30000;
    }
    internal sealed class TalkTargetView
    {
        public bool Present, PttCommitted;
        public string SelectionId, PedId, Reason;
        public long Address;
        public int CycleIndex, CycleCount;
        public long ExpiresInMs;
    }
    internal sealed class TalkTargetPolicy
    {
        struct Token { public string PedId; public long Address; }
        readonly List<Token> frozen = new List<Token>();
        string selectionId;
        int index = -1;
        long selectedAt, expiresAt, cycleUntil;
        bool committed;
        public bool HasSelection => selectionId != null;
        public bool PttCommitted => committed;
        public string SelectionId => selectionId;
        public string PedId => index >= 0 && index < frozen.Count ? frozen[index].PedId : null;
        public long Address => index >= 0 && index < frozen.Count ? frozen[index].Address : 0;
        public int Index => index;
        public int Count => frozen.Count;
        public bool CycleOpen(long now) => HasSelection && !committed && now < cycleUntil && now < expiresAt;

        public static List<TalkCandidate> Rank(IReadOnlyList<TalkCandidate> candidates,int maxCandidates)
        {
            var ranked = new List<TalkCandidate>();
            if (candidates == null || maxCandidates < 1) return ranked;
            foreach (var candidate in candidates) if (candidate.PedId != null && candidate.Address != 0) ranked.Add(candidate);
            ranked.Sort((left,right) => {
                int screen = right.OnScreen.CompareTo(left.OnScreen);
                if (screen != 0) return screen;
                int error = left.ScreenCenterError.CompareTo(right.ScreenCenterError);
                if (error != 0) return error;
                int distance = left.Distance.CompareTo(right.Distance);
                if (distance != 0) return distance;
                int ped = string.CompareOrdinal(left.PedId,right.PedId);
                if (ped != 0) return ped;
                int address = left.Address.CompareTo(right.Address);
                return address != 0 ? address : left.InputOrder.CompareTo(right.InputOrder);
            });
            if (ranked.Count > maxCandidates) ranked.RemoveRange(maxCandidates,ranked.Count - maxCandidates);
            return ranked;
        }

        public TalkTargetView SelectFirst(IReadOnlyList<TalkCandidate> candidates,long now,TalkTargetOptions options)
        {
            options = options ?? new TalkTargetOptions();
            var ranked = Rank(candidates,options.MaxCandidates);
            frozen.Clear(); index = -1; selectionId = null; committed = false;
            if (ranked.Count == 0) return Absent("no_nearby_npc");
            foreach (var candidate in ranked) frozen.Add(new Token {PedId = candidate.PedId,Address = candidate.Address});
            index = 0;
            return Touch(now,options,"first");
        }
        public TalkTargetView SelectNext(long now,TalkTargetOptions options)
        {
            options = options ?? new TalkTargetOptions();
            if (!CycleOpen(now) || frozen.Count == 0 || index < 0) return Absent(HasSelection ? "cycle_expired" : "no_selection");
            index = (index + 1) % frozen.Count;
            committed = false;
            return Touch(now,options,"cycle");
        }
        TalkTargetView Touch(long now,TalkTargetOptions options,string reason)
        {
            selectionId = Guid.NewGuid().ToString("D");
            selectedAt = now;
            expiresAt = now + options.SelectionTimeoutMs;
            cycleUntil = now + options.CycleWindowMs;
            committed = false;
            return View(now,reason);
        }
        public void Commit(string expectedSelectionId,long now)
        {
            if (selectionId == null || expectedSelectionId != selectionId) return;
            committed = true;
        }
        public void Release(long now,TalkTargetOptions options)
        {
            committed = false;
            if (selectionId == null) return;
            options = options ?? new TalkTargetOptions();
            expiresAt = now + options.SelectionTimeoutMs;
        }
        public string Problem(string pedId,long address,bool exists,bool dead,bool player,bool human,float distance,float retention,long now)
        {
            if (!HasSelection) return "lost";
            if (!committed && now >= expiresAt) return "expired";
            if (pedId != PedId || address != Address || address == 0 || !exists || dead || player || !human || float.IsNaN(distance) || distance > retention) return "lost";
            return null;
        }
        public bool Confirm(string pedId,long address,bool exists,bool dead,bool player,bool human,float distance,float retention,long now)
        {
            string problem = Problem(pedId,address,exists,dead,player,human,distance,retention,now);
            if (problem == null) return true;
            Clear(problem);
            return false;
        }
        public void Export(List<TalkCandidate> into)
        {
            into.Clear();
            foreach (var token in frozen) into.Add(new TalkCandidate {PedId = token.PedId,Address = token.Address});
        }
        public TalkTargetView Inspect(long now)
        {
            if (!HasSelection) return Absent(null);
            if (!committed && now >= expiresAt) { Clear("expired"); return Absent("expired"); }
            return View(now,null);
        }
        public void Clear(string reason)
        {
            frozen.Clear(); index = -1; selectionId = null; committed = false; selectedAt = expiresAt = cycleUntil = 0;
        }
        public void ResetForWorldChange() => Clear("world_reset");
        TalkTargetView View(long now,string reason) => new TalkTargetView {
            Present = true,SelectionId = selectionId,PedId = PedId,Address = Address,PttCommitted = committed,
            CycleIndex = index + 1,CycleCount = frozen.Count,ExpiresInMs = committed ? Math.Max(0,expiresAt - selectedAt) : Math.Max(0,expiresAt - now),Reason = reason};
        static TalkTargetView Absent(string reason) => new TalkTargetView {Reason = reason};
    }
}
