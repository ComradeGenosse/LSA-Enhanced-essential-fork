using System;
using System.Collections.Generic;
using System.Threading;
using LSA.Standalone;
using LSA.Standalone.Tests;

internal static class Program
{
    private static int assertions;
    private static void Check(bool condition, string label)
    {
        assertions++;
        if (!condition) throw new InvalidOperationException("Assertion " + assertions + " failed: " + label);
    }

    private static ActorRef Register(NativeAuthority host, int handle)
    {
        ActorRef actor;
        string reason;
        Check(host.TryRegister(handle, out actor, out reason) && actor != null,
            "register actor " + handle + ": " + reason);
        return actor;
    }

    private static OwnershipLease Acquire(NativeAuthority host, ActorRef actor, LeaseKind kind, string owner, long ttl = 1000)
    {
        OwnershipLease lease;
        string reason;
        Check(host.TryAcquire(actor, kind, owner, ttl, out lease, out reason) && lease != null,
            "acquire " + kind + " for " + owner + ": " + reason);
        return lease;
    }

    private static void Refuse(NativeAuthority host, ActorRef actor, LeaseKind kind, string owner, string expected)
    {
        OwnershipLease lease;
        string reason;
        Check(!host.TryAcquire(actor, kind, owner, 1000, out lease, out reason) &&
            lease == null && reason == expected, "reject " + expected + ", got " + reason);
    }

    private static void IdentityAndLeases()
    {
        var game = new SimulatedGame();
        game.Spawn(17, 0xA100);
        var host = new NativeAuthority(game, game, game, game);
        var actor = Register(host, 17);
        Check(actor.HostRunId == host.HostRunId && actor.WorldEpoch == 1 &&
            actor.Handle == 17 && actor.Address == 0xA100 && actor.IncarnationId != Guid.Empty,
            "independent run, epoch, handle, address and incarnation");
        ActorRef same; string reason;
        Check(host.TryRegister(17, out same, out reason) && actor.Equals(same) && reason == "current",
            "observing same physical actor is idempotent");
        Check(host.IsActorCurrent(actor) && host.TrackedActors == 1, "current actor valid");
        var claim = Acquire(host, actor, LeaseKind.Conversation, "targeter");
        Check(host.IsLeaseCurrent(claim), "exact token current");
        Refuse(host, actor, LeaseKind.Conversation, "other", "owner_busy");
        Check(Acquire(host, actor, LeaseKind.Audio, "voice") != null, "audio lane separate");
        Check(Acquire(host, actor, LeaseKind.PhysicalAction, "actor") != null, "physical lane separate");
        OwnershipLease replacement;
        Check(host.TrySupersede(claim, "new-targeter", 1000, out replacement, out reason) &&
            replacement.Generation > claim.Generation && reason == "superseded", "compare-and-swap supersede");
        Check(!host.IsLeaseCurrent(claim) && !host.TryRelease(claim) &&
            host.IsLeaseCurrent(replacement), "old lease cannot mutate new ownership");
        OwnershipLease fake;
        Check(!host.TrySupersede(claim, "hijack", 1000, out fake, out reason) &&
            reason == "stale_lease" && fake == null, "old lease cannot supersede future owner");
        Check(host.TryRelease(replacement) && !host.TryRelease(replacement), "exact single release");
        Check(Acquire(host, actor, LeaseKind.Conversation, "reacquired") != null, "reacquire after release");

        game.Advance(1000);
        Refuse(host, actor, (LeaseKind)99, "bad", "invalid_lease_request");
        var later = Acquire(host, actor, LeaseKind.Conversation, "after-expiry");
        Check(host.IsLeaseCurrent(later), "expiry permits new owner without old token");
        game.Advance(1000);
        Check(!host.IsLeaseCurrent(later), "expiry at boundary fails closed");
        Refuse(host, actor, LeaseKind.Conversation, "", "invalid_lease_request");

        game.Spawn(17, 0xB200);
        Check(!host.IsActorCurrent(actor) && !host.IsLeaseCurrent(later),
            "address change retires old actor and all leases");
        var replacementActor = Register(host, 17);
        Check(replacementActor.IncarnationId != actor.IncarnationId &&
            replacementActor.WorldEpoch == actor.WorldEpoch &&
            !host.IsActorCurrent(actor), "recycled native handle is not old incarnation");
        Check(!host.RetireActor(actor), "old retired actor cannot evict new identity");
        Check(host.RetireActor(replacementActor), "explicit retirement");
        var samePointerNewLifetime = Register(host, 17);
        Check(samePointerNewLifetime.IncarnationId != replacementActor.IncarnationId,
            "same handle/address after explicit retire gets new incarnation");

        game.Spawn(19, 0xB200);
        ActorRef colliding;
        Check(!host.TryRegister(19, out colliding, out reason) && reason == "address_conflict" &&
            colliding == null, "one address cannot back two live actor handles");
        game.Spawn(19, 0xC300);
        Check(Register(host, 19) != null, "independent second actor");

        var token = Acquire(host, samePointerNewLifetime, LeaseKind.Audio, "narrator");
        game.ScriptControl(17, true);
        Check(!host.IsLeaseCurrent(token), "script takeover cancels active leases");
        Refuse(host, samePointerNewLifetime, LeaseKind.Audio, "narrator", "script_controlled");
        game.ScriptControl(17, false);
        Check(!host.IsLeaseCurrent(token), "released script control cannot resurrect old lease");
        var newToken = Acquire(host, samePointerNewLifetime, LeaseKind.Audio, "resume");
        game.AllowsNpcControl = false;
        Check(!host.IsLeaseCurrent(newToken), "unsafe mission state cancels active lease");
        game.AllowsNpcControl = true;
        Check(!host.IsLeaseCurrent(newToken), "safe again does not revive stale work");

        game.Kill(17);
        Check(!host.IsActorCurrent(samePointerNewLifetime), "death retires actor");
        Refuse(host, samePointerNewLifetime, LeaseKind.Conversation, "actor", "actor_retired");
        game.Spawn(17, 0xB200);
        var newborn = Register(host, 17);
        Check(newborn.IncarnationId != samePointerNewLifetime.IncarnationId, "resurrected actor must re-register");
        var priorEpochLease = Acquire(host, newborn, LeaseKind.Input, "input");
        host.WorldChanged();
        Check(host.WorldEpoch == 2 && host.TrackedActors == 0 &&
            !host.IsActorCurrent(newborn) && !host.IsLeaseCurrent(priorEpochLease), "world reset retires all actors and leases");
        var afterWorld = Register(host, 17);
        Check(afterWorld.WorldEpoch == 2 && afterWorld.HostRunId == host.HostRunId, "new epoch identity");
        host.Stop();
        Check(!host.IsActorCurrent(afterWorld) && !host.TryRegister(17, out colliding, out reason) &&
            !host.TryRelease(priorEpochLease), "stop prevents all future mutations");
        host.Stop();
    }

    private static void ClockAndThreadSafety()
    {
        var game = new SimulatedGame();
        game.Spawn(1, 0x1000);
        var host = new NativeAuthority(game, game, game, game);
        var ref1 = Register(host, 1);
        var first = Acquire(host, ref1, LeaseKind.Audio, "test");
        game.Advance(400);
        Check(host.IsLeaseCurrent(first), "monotonic time before lease expiry");
        game.Regress(20);
        Check(!host.IsLeaseCurrent(first) && host.WorldEpoch == 2 &&
            !host.IsActorCurrent(ref1), "clock regression revokes all authority and bumps epoch");
        var ref2 = Register(host, 1);
        Check(ref2.WorldEpoch == 2 && !ref1.Equals(ref2), "clock regression requires new actor registration");

        game.IsOwner = false;
        bool refusedFiber = false;
        try { host.WorldChanged(); }
        catch (InvalidOperationException e) { refusedFiber = e.Message == "native_owner_required"; }
        Check(refusedFiber && host.WorldEpoch == 2, "wrong RAGE fiber refused without changing state");
        game.IsOwner = true;

        bool refusedThread = false;
        var worker = new Thread(() => {
            try { host.TryRegister(1, out _, out _); }
            catch (InvalidOperationException e) { refusedThread = e.Message == "native_owner_required"; }
        });
        worker.Start();
        worker.Join();
        Check(refusedThread && host.WorldEpoch == 2, "wrong OS thread refused even if context says owner");

        OwnershipLease invalid;
        string reason;
        Check(!host.TryAcquire(ref2, LeaseKind.Input, "oversized", 60001, out invalid, out reason) &&
            reason == "invalid_lease_request", "bounded TTL");
        Check(!host.TryAcquire(ref2, LeaseKind.Input, new string('x', 129), 100, out invalid, out reason) &&
            reason == "invalid_lease_request", "bounded owner identity");
        game.Despawn(1);
        Check(!host.IsActorCurrent(ref2), "lost resolver observation retires actor");
    }

    private static void DeterministicScenarioReplay()
    {
        // Repeat exactly the same logical event sequence with a deterministic clock;
        // assert that no stale lease from the previous world/actor can take effect.
        for (int pass = 0; pass < 25; pass++)
        {
            var game = new SimulatedGame();
            game.Spawn(7, 0x7000);
            var host = new NativeAuthority(game, game, game, game);
            var oldActor = Register(host, 7);
            var past = Acquire(host, oldActor, LeaseKind.PhysicalAction, "old");
            for (int step = 0; step < 10; step++)
            {
                game.Advance(5);
                if (step % 3 == 0)
                {
                    game.Spawn(7, (ulong)(0x7100 + step));
                    var present = Register(host, 7);
                    Check(!host.IsLeaseCurrent(past), "past physical command can't cross reincarnation");
                    past = Acquire(host, present, LeaseKind.PhysicalAction, "new");
                }
                else if (step % 3 == 1)
                {
                    var newLease = Acquire(host, past.Actor, LeaseKind.Audio, "voice");
                    Check(host.IsLeaseCurrent(newLease), "new audio lease");
                }
                else
                {
                    host.WorldChanged();
                    Check(!host.IsLeaseCurrent(past), "past command can't cross world epoch");
                    past = Acquire(host, Register(host, 7), LeaseKind.PhysicalAction, "fresh");
                }
            }
            host.Stop();
            Check(!host.IsLeaseCurrent(past), "host stop terminates all authority");
        }
    }


    private static void ReconciliationAndTrace()
    {
        var game = new SimulatedGame();
        game.Spawn(11, 0xB100);
        var host = new NativeAuthority(game, game, game, game);
        var original = Register(host, 11);
        var first = Acquire(host, original, LeaseKind.Conversation, "private-scoped-owner");
        var second = Acquire(host, original, LeaseKind.Audio, "voice");

        // Script control can start and end between user commands. A native game
        // fiber should reconcile observations continuously, not only at dispatch.
        game.ScriptControl(11, true);
        host.Reconcile();
        Check(!host.IsLeaseCurrent(first) && !host.IsLeaseCurrent(second),
            "reconcile retires claims on script takeover");
        game.ScriptControl(11, false);
        Check(!host.IsLeaseCurrent(first) && !host.IsLeaseCurrent(second),
            "script handback must not resurrect old leases");
        var after = Acquire(host, original, LeaseKind.Conversation, "new");

        game.AllowsNpcControl = false;
        host.Reconcile();
        game.AllowsNpcControl = true;
        Check(!host.IsLeaseCurrent(after), "temporary unsafe game state permanently revokes");
        var fresh = Acquire(host, original, LeaseKind.Audio, "fresh");
        game.ThrowOnObserve = true;
        Check(!host.IsLeaseCurrent(fresh), "native reader throwing fails closed");
        game.ThrowOnObserve = false;
        Check(!host.IsActorCurrent(original), "failed native reader retires actor incarnation");

        game.Spawn(12, 0xB200);
        var gone = Register(host, 12);
        game.Despawn(12);
        game.Spawn(13, 0xB200);
        Check(Register(host, 13) != null && !host.IsActorCurrent(gone),
            "stale old address does not block independent new actor");
        game.Spawn(14, 0xC300);
        var leaseActor = Register(host, 14);
        var lease = Acquire(host, leaseActor, LeaseKind.PhysicalAction, "follow");
        Check(host.RetireActor(leaseActor) && !host.IsLeaseCurrent(lease),
            "explicit actor retire terminates exact physical lease");
        Check(host.ReadTrace().Count > 0, "trace contains lifecycle evidence");
        var trace = host.ReadTrace();
        long previous = 0;
        bool sawScriptRevocation = false;
        bool sawRetirement = false;
        bool sawActionAcquisition = false;
        foreach (var item in trace)
        {
            Check(item.Sequence > previous, "strictly increasing trace sequence");
            previous = item.Sequence;
            Check(item.HostRunId == host.HostRunId, "trace binds host run");
            Check(item.Reason != "private-scoped-owner" && item.Reason != "voice",
                "trace excludes potentially sensitive owner strings");
            if (item.Event == "lease_revoked" && item.Reason == "script_controlled" &&
                item.LeaseId == first.LeaseId) sawScriptRevocation = true;
            if (item.Event == "actor_retired" && item.Handle == 14 &&
                item.IncarnationId == leaseActor.IncarnationId) sawRetirement = true;
            if (item.Event == "lease_acquired" && item.LeaseId == lease.LeaseId &&
                item.Kind == LeaseKind.PhysicalAction) sawActionAcquisition = true;
        }
        Check(sawScriptRevocation && sawRetirement && sawActionAcquisition,
            "exact trace captures grants, revocations and actor retirement");

        // A bounded tracing subsystem cannot grow memory with long gameplay sessions.
        game.Spawn(15, 0xD400);
        var boundedActor = Register(host, 15);
        for (int i = 0; i < 400; i++)
        {
            var token = Acquire(host, boundedActor, LeaseKind.Input, "bounded");
            Check(host.TryRelease(token), "repeated release");
        }
        Check(host.ReadTrace().Count == 256 && host.DroppedTraceEvents > 0,
            "trace bounded to 256 records with explicit loss counter");
        Check(host.ReadTrace()[0].Sequence > 1,
            "bounded trace discards oldest records rather than reordering");
    }

    private static void UnavailableWorldAndClock()
    {
        var game = new SimulatedGame();
        game.Spawn(23, 0x2300);
        var host = new NativeAuthority(game, game, game, game);
        var actor = Register(host, 23);
        var lease = Acquire(host, actor, LeaseKind.Conversation, "speaker");
        game.ThrowOnWorldRead = true;
        host.Reconcile();
        Check(!host.IsLeaseCurrent(lease), "world query failure retires earlier lease");
        game.ThrowOnWorldRead = false;
        Check(!host.IsLeaseCurrent(lease), "world recovery does not revive old lease");

        var later = Acquire(host, actor, LeaseKind.Conversation, "later");
        game.ThrowOnClockRead = true;
        Check(!host.IsLeaseCurrent(later) && host.WorldEpoch == 2,
            "clock query failure revokes world epoch and all lease authority");
        game.ThrowOnClockRead = false;
        Check(!host.IsActorCurrent(actor), "clock recovery requires new actor incarnation");
        var refreshed = Register(host, 23);
        Check(refreshed.WorldEpoch == 2 && refreshed.IncarnationId != actor.IncarnationId,
            "new epoch cannot borrow old physical identity");

        var another = Acquire(host, refreshed, LeaseKind.PhysicalAction, "act");
        game.ScriptControl(23, true);
        ActorRef duplicate;
        string reason;
        Check(host.TryRegister(23, out duplicate, out reason) && duplicate.Equals(refreshed),
            "idempotent registration observes current actor while script-controlled");
        game.ScriptControl(23, false);
        Check(!host.IsLeaseCurrent(another),
            "re-register of script-controlled actor revokes all pre-takeover claims");
    }

    private static void SeededSafetyScenarios()
    {
        // Model-independent invariant: once an exact lease becomes invalid, no
        // future event may ever make the identical lease current again.
        for (uint seed = 1; seed <= 24; seed++)
        {
            var game = new SimulatedGame();
            game.Spawn(41, 0x4100);
            var host = new NativeAuthority(game, game, game, game);
            ActorRef active = Register(host, 41);
            var all = new List<OwnershipLease>();
            var retired = new HashSet<Guid>();
            uint random = seed;
            for (int tick = 0; tick < 90; tick++)
            {
                random = unchecked(random * 1664525U + 1013904223U);
                switch ((int)(random % 9))
                {
                    case 0:
                        host.WorldChanged();
                        active = Register(host, 41);
                        break;
                    case 1:
                        game.Spawn(41, (ulong)(0x5000 + tick + seed * 100));
                        active = Register(host, 41);
                        break;
                    case 2:
                        game.ScriptControl(41, true);
                        host.Reconcile();
                        game.ScriptControl(41, false);
                        break;
                    case 3:
                        game.AllowsNpcControl = false;
                        host.Reconcile();
                        game.AllowsNpcControl = true;
                        break;
                    case 4:
                        game.Advance(1200);
                        break;
                    case 5:
                        game.Kill(41);
                        host.Reconcile();
                        game.Spawn(41, (ulong)(0x6000 + tick + seed * 100));
                        active = Register(host, 41);
                        break;
                    case 6:
                    case 7:
                        OwnershipLease acquired;
                        string reject;
                        if (host.TryAcquire(active, (LeaseKind)((random >> 8) % 4 + 1),
                            "owner", 1000, out acquired, out reject)) all.Add(acquired);
                        break;
                    case 8:
                        if (all.Count > 0)
                        {
                            var old = all[(int)((random >> 12) % (uint)all.Count)];
                            OwnershipLease replacement;
                            string reason;
                            if (host.TrySupersede(old, "new-owner", 1000, out replacement, out reason))
                                all.Add(replacement);
                        }
                        break;
                }
                foreach (var token in all)
                {
                    bool valid = host.IsLeaseCurrent(token);
                    if (retired.Contains(token.LeaseId))
                        Check(!valid, "seed " + seed + " resurrected retired lease after step " + tick);
                    else if (!valid) retired.Add(token.LeaseId);
                }
            }
            host.Stop();
            foreach (var token in all)
                Check(!host.IsLeaseCurrent(token), "seed " + seed + " cleanup retained lease");
        }
    }

    private static void DecoratorReuseAndNativeTurnAdmission()
    {
        var game = new SimulatedGame();
        game.Spawn(17, 0xA100, lifetimeTag: 111);
        var host = new NativeAuthority(game, game, game, game);
        var first = Register(host, 17);
        var oldLease = Acquire(host, first, LeaseKind.Audio, "old-audio");

        // Critical hidden ABA: identical handle AND address, but the native
        // physical lifetime tag changes between owner samples.
        game.Spawn(17, 0xA100, lifetimeTag: 222);
        Check(!host.IsLeaseCurrent(oldLease), "tagged hidden ABA revokes audio");
        var second = Register(host, 17);
        Check(second.IncarnationId != first.IncarnationId,
            "tag mismatch creates a new native incarnation");
        Check(!host.IsActorCurrent(first), "old same-address actor retired");

        var tickets = new NativeTurnRegistry(host);
        NativeTurnPermit permit; string reason;
        Check(tickets.TryIssue(second, "player_text", 1000, out permit, out reason),
            "native source creates single permitted turn");
        Check(!tickets.TryConfirm(permit.TurnId.ToString("D"), permit.SessionNonce.ToString("D"),
            first.IncarnationId.ToString("D"), permit.LeaseId.ToString("D"),
            permit.Generation, permit.Source, out reason),
            "old incarnation cannot confirm native permit");
        Check(!tickets.TryConfirm(permit.TurnId.ToString("D"), permit.SessionNonce.ToString("D"),
            permit.ActorIncarnationId.ToString("D"), Guid.NewGuid().ToString("D"),
            permit.Generation, permit.Source, out reason),
            "fabricated lease cannot confirm native permit");
        Check(tickets.TryConfirm(permit.TurnId.ToString("D"), permit.SessionNonce.ToString("D"),
            permit.ActorIncarnationId.ToString("D"), permit.LeaseId.ToString("D"),
            permit.Generation, permit.Source, out reason),
            "exact native ticket accepted once");
        Check(!tickets.TryConfirm(permit.TurnId.ToString("D"), permit.SessionNonce.ToString("D"),
            permit.ActorIncarnationId.ToString("D"), permit.LeaseId.ToString("D"),
            permit.Generation, permit.Source, out reason),
            "replay of acknowledged native turn rejected");
        Check(tickets.IsCurrent(permit.TurnId.ToString("D"), permit.LeaseId.ToString("D"),
            permit.Generation, permit.ActorIncarnationId.ToString("D")),
            "confirmed native ticket is still live");
        Check(tickets.TryCancel(permit.TurnId.ToString("D"), permit.LeaseId.ToString("D"),
            permit.Generation, permit.ActorIncarnationId.ToString("D")), "exact cancel");
        Check(!tickets.TryCancel(permit.TurnId.ToString("D"), permit.LeaseId.ToString("D"),
            permit.Generation, permit.ActorIncarnationId.ToString("D")),
            "retired ticket cannot be replayed");

        Check(tickets.TryIssue(second, "player_mic", 1000, out var later, out reason),
            "new source can acquire after exact release");
        tickets.RetireAll();
        Check(tickets.TryIssue(second, "player_text", 1000, out var afterRestart, out reason),
            "disconnect releases exact native conversation lease");
        tickets.RetireAll();
        Check(!tickets.TryConfirm(later.TurnId.ToString("D"), later.SessionNonce.ToString("D"),
            later.ActorIncarnationId.ToString("D"), later.LeaseId.ToString("D"),
            later.Generation, later.Source, out reason), "stale reconnect cannot confirm");
        host.Stop();
    }

    private static void NativeTypedTextAndStagedReply()
    {
        var game = new SimulatedGame();
        game.Spawn(92, 0xA220, lifetimeTag: 123);
        var host = new NativeAuthority(game, game, game, game);
        var actor = Register(host, 92);
        var tickets = new NativeTurnRegistry(host);
        NativeTurnPermit permit;
        string reason;
        Check(!tickets.TryIssueTyped(actor, "   ", 1000, out permit, out reason)
            && reason == "invalid_native_text", "blank native typed turn rejected");
        Check(!tickets.TryIssueTyped(actor, new string('x', 1025), 1000, out permit, out reason)
            && reason == "invalid_native_text", "oversized player text rejected");
        Check(!tickets.TryIssueTyped(actor, "unsafe" + (char)0 + "text", 1000,
            out permit, out reason), "embedded NUL rejected");
        Check(tickets.TryIssueTyped(actor, "Where are we?", 1000, out permit, out reason),
            "typed source issues native conversation");
        Check(permit.Source == "player_text" && permit.PlayerText == "Where are we?",
            "typed text bound to immutable native-issued permit");
        Check(tickets.TryConfirm(permit.TurnId.ToString("D"),
            permit.SessionNonce.ToString("D"), permit.ActorIncarnationId.ToString("D"),
            permit.LeaseId.ToString("D"), permit.Generation, permit.Source, out reason),
            "native confirmation before any staged reply");
        Check(!tickets.TryStageReply(permit.TurnId.ToString("D"),
            Guid.NewGuid().ToString("D"), permit.Generation,
            permit.ActorIncarnationId.ToString("D"), "spoofed", out reason),
            "fabricated effect claim rejected");
        Check(tickets.TryStageReply(permit.TurnId.ToString("D"),
            permit.LeaseId.ToString("D"), permit.Generation,
            permit.ActorIncarnationId.ToString("D"), "Right here.", out reason)
            && reason == "staged_not_played" && permit.StagedReply == "Right here.",
            "text staged but NEVER counted as playback");
        Check(!tickets.TryStageReply(permit.TurnId.ToString("D"),
            permit.LeaseId.ToString("D"), permit.Generation,
            permit.ActorIncarnationId.ToString("D"), "double stage", out reason)
            && reason == "reply_already_staged", "double reply stages fail");
        Check(!tickets.TryStageReply(permit.TurnId.ToString("D"),
            permit.LeaseId.ToString("D"), permit.Generation,
            permit.ActorIncarnationId.ToString("D"), new string('q', 2049), out reason)
            && reason == "invalid_reply", "oversized response refused");
        Check(tickets.DiscardStagedForActor(actor) == 1,
            "next physical player turn discards unplayed reply, not commits it");
        NativeTurnPermit next;
        Check(tickets.TryIssueTyped(actor, "One more question", 1000,
            out next, out reason), "new typed turn permitted after explicitly discarded reply");
        Check(next.ConversationId == permit.ConversationId &&
            next.TurnOrdinal == permit.TurnOrdinal + 1,
            "same actor retains native conversation ID with strictly increasing ordinal");
        Check(next.TurnId != permit.TurnId && next.LeaseId != permit.LeaseId,
            "conversation continuity never means reusing a native turn or lease");
        Check(tickets.TryConfirm(next.TurnId.ToString("D"),
            next.SessionNonce.ToString("D"), next.ActorIncarnationId.ToString("D"),
            next.LeaseId.ToString("D"), next.Generation, next.Source, out reason),
            "second turn confirmed independently");
        game.Spawn(92, 0xA220, lifetimeTag: 456);
        Check(!tickets.TryStageReply(next.TurnId.ToString("D"),
            next.LeaseId.ToString("D"), next.Generation,
            next.ActorIncarnationId.ToString("D"), "stale", out reason),
            "same-handle and same-address ABA kills second turn authorization");
        tickets.RetireAll();
        Check(!host.IsActorCurrent(actor), "physical identity retired after ABA");
        host.Stop();
    }

    private static void PreconfirmationCancelReleasesActor()
    {
        var game = new SimulatedGame();
        game.Spawn(144, 0xC100, lifetimeTag: 9221);
        var host = new NativeAuthority(game, game, game, game);
        var actor = Register(host, 144);
        var tickets = new NativeTurnRegistry(host);
        string reason;
        NativeTurnPermit offer;
        Check(tickets.TryIssueTyped(actor, "unconfirmed", 4000, out offer, out reason),
            "issue unconfirmed native offer");
        Check(!tickets.TryCancel(offer.TurnId.ToString("D"),
            Guid.NewGuid().ToString("D"), offer.Generation,
            offer.ActorIncarnationId.ToString("D")), "wrong lease cannot cancel unconfirmed offer");
        Check(!tickets.TryCancel(offer.TurnId.ToString("D"),
            offer.LeaseId.ToString("D"), offer.Generation,
            Guid.NewGuid().ToString("D")), "wrong incarnation cannot cancel");
        Check(!tickets.TryCancel(offer.TurnId.ToString("D"),
            offer.LeaseId.ToString("D"), "987654321",
            offer.ActorIncarnationId.ToString("D")), "wrong generation cannot cancel");
        Check(tickets.TryCancel(offer.TurnId.ToString("D"),
            offer.LeaseId.ToString("D"), offer.Generation,
            offer.ActorIncarnationId.ToString("D")), "native unconfirmed lease immediately retired");
        Check(!tickets.TryConfirm(offer.TurnId.ToString("D"),
            offer.SessionNonce.ToString("D"), offer.ActorIncarnationId.ToString("D"),
            offer.LeaseId.ToString("D"), offer.Generation, offer.Source, out reason),
            "cancelled offer cannot later confirm");
        NativeTurnPermit next;
        Check(tickets.TryIssueTyped(actor, "new after cancel", 4000,
            out next, out reason), "actor immediately reacquired after cancelled offer");
        Check(next.LeaseId != offer.LeaseId, "new turn never reuses prior lease");
        Check(tickets.TryConfirm(next.TurnId.ToString("D"),
            next.SessionNonce.ToString("D"), next.ActorIncarnationId.ToString("D"),
            next.LeaseId.ToString("D"), next.Generation, next.Source, out reason),
            "second offer valid independently");
        Check(tickets.TryStageReply(next.TurnId.ToString("D"),
            next.LeaseId.ToString("D"), next.Generation,
            next.ActorIncarnationId.ToString("D"), "not played", out reason),
            "staging before explicit cancel");
        Check(tickets.TryCancel(next.TurnId.ToString("D"),
            next.LeaseId.ToString("D"), next.Generation,
            next.ActorIncarnationId.ToString("D")), "staged reply can be cancelled");
        Check(!tickets.TryStageReply(next.TurnId.ToString("D"),
            next.LeaseId.ToString("D"), next.Generation,
            next.ActorIncarnationId.ToString("D"), "late", out reason),
            "cancelled staged reply never resurrected");
        host.Stop();
    }

    private static void Main()
    {
        IdentityAndLeases();
        ClockAndThreadSafety();
        DeterministicScenarioReplay();
        ReconciliationAndTrace();
        UnavailableWorldAndClock();
        SeededSafetyScenarios();
        DecoratorReuseAndNativeTurnAdmission();
        NativeTypedTextAndStagedReply();
        PreconfirmationCancelReleasesActor();
        Console.WriteLine("PASS " + assertions +
            " standalone native core assertions; no Essential/RAGE/game assembly loaded.");
    }
}
