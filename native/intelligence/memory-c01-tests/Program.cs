using System;
using LSA.Intelligence.MemoryC01;

static class Program
{
    static int checks;
    static void Check(bool allowed, string name)
    {
        if (!allowed) throw new Exception(name);
        checks++;
    }

    static void Main()
    {
        const string host = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const string observer = "55555555-5555-4555-8555-555555555555";
        const string incarnation = "88888888-8888-4888-8888-888888888888";
        const string encounter = "12121212-1212-4212-8212-121212121212";
        const string alias = "promoted.33333333-3333-4333-8333-333333333333";
        const string playerRef = "77777777-7777-4777-8777-777777777777";

        OriginalC01Owner Owner(string aliasValue = alias, string inc = incarnation,
            string ped = "101", int world = 1) =>
            new OriginalC01Owner(host,world,observer,inc,encounter,aliasValue,ped,123);
        OriginalC01Tuple Turn(long generation = 7,long session = 2,
            uint accepted = 123,uint expires = 623,string ped = "101") =>
            new OriginalC01Tuple(ped,"normal-typed-stt-1",generation,session,accepted,expires);
        OriginalC01Player Player(string key = "franklin",uint tick = 123) =>
            new OriginalC01Player(playerRef,key,tick);
        bool IsBound(OriginalC01Tuple t,OriginalC01Owner o,
            OriginalC01Player p,uint now = 125) =>
            OriginalC01SourceGate.StructurallyBound(t,o,p,now);

        Check(!OriginalC01SourceGate.PinnedSourceExposed,
            "pinned_C01_normal_turn_API_must_remain_unavailable");
        Check(OriginalC01SourceGate.TryReadPinnedAcceptedTurn() == null,
            "no fabricated_original_C01_producer");
        foreach (string key in new [] {"franklin","michael","trevor","unknown"})
            Check(IsBound(Turn(),Owner(),Player(key)),
                "structure_only_protagonist_" + key);
        Check(!IsBound(Turn(),Owner(),Player("nearest_player")),
            "unknown_must_not_be_guessed");
        Check(!IsBound(Turn(session:0),Owner(),Player()),
            "zero_session_nonce");
        Check(!IsBound(Turn(generation:-1),Owner(),Player()),
            "invalid_generation");
        Check(!IsBound(Turn(ped:"102"),Owner(),Player()),
            "ped_recycled");
        Check(!IsBound(Turn(),Owner(ped:"102"),Player()),
            "cross_ped_native_owner");
        Check(!IsBound(Turn(),Owner(aliasValue:"promoted.other"),Player()),
            "unregistered_owner_alias");
        Check(!IsBound(Turn(),Owner(inc:"stale"),Player()),
            "invalid_incarnation");
        Check(!IsBound(Turn(),Owner(world:0),Player()),
            "invalid_world_epoch");
        Check(!IsBound(Turn(),Owner(),Player(tick:124)),
            "non_coincident_original_player_tick");
        Check(!IsBound(Turn(accepted:122),Owner(),Player(tick:122)),
            "retroactive_acceptance");
        Check(!IsBound(Turn(),Owner(),Player(),624),
            "expired_receipt");
        Check(!IsBound(Turn(expires:1124),Owner(),Player()),
            "receipt_lifetime_over_1000ms");
        Check(!IsBound(Turn(),Owner(),Player(),122),
            "future_receipt");
        Check(!IsBound(Turn(accepted:123,expires:123),Owner(),Player(),124),
            "terminal_tick_exceeded");
        Console.WriteLine("OriginalC01SourcePolicy " + checks +
            " assertions PASS (structural tests ONLY; original source unavailable; NOT GTA)");
    }
}
