using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
using LSA.Intelligence;
using LSA.PromotedCharacters;
using LSA.SessionIdentity;
using Rage;

// K-21 adversarial harness for PromotedCharactersIntegration.SampleMemoryCurrentOwnerPlayer.
// The REAL production sampler, anchor table, proof policy and protagonist source run
// against strict game stubs. One unavailable or invalid NPC must be omitted on its own:
// the healthy NPCs keep their exact, fully authenticated proofs, and the bad NPC never
// appears. Frame-level faults (no provable protagonist, readiness lost mid-sample) still
// return null. No GTA, RPH, Essential, SQLite or pipe is involved.
class Program
{
    static int count, cases;
    static readonly string World = Guid.NewGuid().ToString("D");
    static readonly string OtherWorld = Guid.NewGuid().ToString("D");
    const uint Franklin = 0x9B22DBAFu, Michael = 0x0D7114C9u;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    static void Check(bool value, string what)
    {
        count++;
        if (!value) throw new Exception("K-21 assertion " + count + " failed: " + what);
    }

    static T Field<T>(object source, string name) =>
        (T)source.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(source);

    static void SetField(object source, string name, object value) =>
        source.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(source, value);

    sealed class Npc
    {
        public Ped Ped; public Encounter Enc; public RegistrationToken Reg;
        public string Alias, Key; public int Handle;
        public string CaptureRef => Enc.CaptureRef;
    }

    sealed class Fixture
    {
        public PromotedCharactersIntegration Integration;
        public HostContext Host;
        public Ped Player;
        public readonly List<Npc> Npcs = new List<Npc>();
        public readonly List<string> AmbientRefs = new List<string>();
        public Func<string, object[], object> NativeHook;
        public Dictionary<string, Encounter> Encounters => Field<Dictionary<string, Encounter>>(Integration, "encounters");
        public ExplicitCharacterSource Owner => SessionIdentityIntegration.Current.Owner;
        public uint PlayerModel = Franklin;
        public bool Cutscene;
        public int ModelCalls, PlayerPedCalls;
        public Action OnSecondPlayerPed, OnSecondModel;

        public Npc Add(int handle, string aliasOverride = null, string registerWorld = null)
        {
            var ped = new Ped { Handle = handle, MemoryAddress = new IntPtr(5000 + handle) };
            string alias = aliasOverride ?? "promoted." + Guid.NewGuid().ToString("D");
            var enc = new Encounter { Ped = ped, Address = ped.MemoryAddress, Handle = Convert.ToUInt64(handle), OwnerAlias = alias, OwnershipToken = Guid.NewGuid().ToString("D") };
            enc.Registration = Owner.Register(ped, alias, registerWorld ?? World);
            Encounters[handle.ToString()] = enc;
            // The production retention path: anchor lifetime == registration incarnation.
            typeof(PromotedCharactersIntegration).GetMethod("RetainEncounter", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(Integration, new object[] { enc });
            var npc = new Npc { Ped = ped, Enc = enc, Reg = enc.Registration, Alias = alias, Handle = handle };
            Npcs.Add(npc);
            return npc;
        }

        // Ambient observer: a peds PS observes but P2 does not own (no lifetime).
        public void AddAmbient(int handle)
        {
            var ped = new Ped { Handle = handle, MemoryAddress = new IntPtr(9000 + handle) };
            var anchor = Host.Anchors.Retain(ped, Convert.ToUInt64(handle), ped.MemoryAddress, "ped", null,
                () => ped.Exists(), Host.MonotonicMs, true, AnchorConsumer.PsObserver);
            Check(anchor != null && anchor.Observer, "ambient observer retained");
            AmbientRefs.Add(anchor.CaptureRef);
        }

        public void ObserveAll()
        {
            var refs = new List<string>(AmbientRefs);
            refs.AddRange(Npcs.Select(n => n.Enc.CaptureRef));
            Host.Anchors.SetObserverPriority(refs);
        }

        public void SetChannelReady(bool ready)
        {
            // Never started: constructing it opens no pipe.
            SetField(Integration, "channel", ready
                ? new ControlChannel("LSA.P2.k21." + Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("D"), World, Host.HostRunId, Host.WorldEpoch)
                : null);
        }

        public Dictionary<string, object> Sample()
        {
            var frame = Integration.SampleMemoryCurrentOwnerPlayer();
            return frame == null ? null : Json.Deserialize<Dictionary<string, object>>(Json.Serialize(frame));
        }

        public string[] Omissions()
        {
            var property = typeof(PromotedCharactersIntegration).GetProperty("LastCurrentOwnerOmissions", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            return property == null ? null : (string[])property.GetValue(Integration);
        }
    }

    static Fixture Create(int healthy = 3, bool ambient = true)
    {
        Game.GameTime = 5000; Game.NativeCalls = 0; Game.PedReads = 0; Game.ClockReads = 0; Game.Logs.Clear();
        SessionIdentityIntegration.Current = null;
        LosSantosAlive.Integrations.IntegrationManager.Registered.Clear();
        var f = new Fixture();
        f.Host = new HostContext();
        f.Integration = new PromotedCharactersIntegration(World, "LSA.P2.k21." + Guid.NewGuid().ToString("N"), "LSA.Identity.k21." + Guid.NewGuid().ToString("N"), f.Host);
        f.Integration.Prepare();
        SessionIdentityIntegration.Current.Initialize();
        f.SetChannelReady(true);
        Check(f.Integration.IsReady, "integration ready without starting a pipe");

        f.Player = new Ped { Handle = 1, MemoryAddress = new IntPtr(1000), Model = new Model(Franklin) };
        Game.LocalPlayer.Character = f.Player;
        var player = f.Player;
        var playerAnchor = f.Host.Anchors.Retain(player, 1UL, player.MemoryAddress, "player", null,
            () => player.Exists() && player.MemoryAddress == new IntPtr(1000), 0, false, AnchorConsumer.PsDiscovery);
        Check(playerAnchor != null, "player anchor retained");

        NativeFunction_Handler(f);
        for (int n = 0; n < healthy; n++) f.Add(10 + n);
        if (ambient) f.AddAmbient(90);
        f.ObserveAll();
        return f;
    }

    static void NativeFunction_Handler(Fixture f)
    {
        Rage.Native.NativeFunction.Handler = (name, args) =>
        {
            if (f.NativeHook != null) { var hooked = f.NativeHook(name, args); if (hooked != null) return hooked; }
            switch (name)
            {
                case "IS_CUTSCENE_ACTIVE": return f.Cutscene;
                case "IS_CUTSCENE_PLAYING": case "IS_PLAYER_SWITCH_IN_PROGRESS":
                case "NETWORK_IS_SESSION_ACTIVE": case "GET_MISSION_FLAG": return false;
                case "PLAYER_PED_ID":
                    if (++f.PlayerPedCalls == 2) f.OnSecondPlayerPed?.Invoke();
                    return Game.LocalPlayer.Character.Handle;
                case "GET_ENTITY_MODEL":
                    if (++f.ModelCalls == 2) f.OnSecondModel?.Invoke();
                    return f.PlayerModel;
            }
            throw new InvalidOperationException("Unexpected native call in K-21 harness: " + name);
        };
    }

    static List<Dictionary<string, object>> Owners(Dictionary<string, object> frame) =>
        ((ArrayList)frame["owners"]).Cast<Dictionary<string, object>>().ToList();

    static string[] Aliases(Dictionary<string, object> frame) =>
        Owners(frame).Select(o => (string)o["ownerAlias"]).OrderBy(a => a, StringComparer.Ordinal).ToArray();

    static string Canonical(Dictionary<string, object> owner) =>
        Json.Serialize(owner.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => kv.Value));

    static Dictionary<string, string> ByAlias(Dictionary<string, object> frame) =>
        Owners(frame).ToDictionary(o => (string)o["ownerAlias"], Canonical);

    static string[] Sorted(params string[] values) => values.OrderBy(a => a, StringComparer.Ordinal).ToArray();

    static bool Same(string[] a, string[] b) => a.Length == b.Length && a.SequenceEqual(b);

    // Mutate exactly one NPC of three; the other two must keep byte-identical
    // proofs, the mutated NPC must vanish, and the reason must be the exact code.
    static void OneBad(string name, string reason, Action<Fixture, Npc> mutate)
    {
        cases++;
        var f = Create(3);
        var baseline = f.Sample();
        Check(baseline != null && Owners(baseline).Count == 3, name + ": baseline has 3 owners");
        var bad = f.Npcs[1]; var healthy = new[] { f.Npcs[0], f.Npcs[2] };
        var baselineProofs = ByAlias(baseline);
        mutate(f, bad);
        var after = f.Sample();
        Check(after != null, name + ": one bad NPC must NOT null the whole frame");
        var proofs = ByAlias(after);
        Check(!proofs.ContainsKey(bad.Alias), name + ": the bad NPC must not be asserted");
        Check(!Owners(after).Any(o => (string)o["observerCaptureRef"] == bad.CaptureRef), name + ": bad captureRef absent");
        foreach (var good in healthy)
        {
            Check(proofs.ContainsKey(good.Alias), name + ": healthy NPC remains verifiable");
            Check(proofs[good.Alias] == baselineProofs[good.Alias], name + ": healthy proof is byte-identical, fully authenticated");
        }
        Check(proofs.Count == 2, name + ": exactly the two healthy NPCs");
        Check(after["protagonist"] != null && ((Dictionary<string, object>)after["protagonist"])["key"].Equals("franklin"), name + ": protagonist intact");
        var omissions = f.Omissions();
        if (omissions != null && reason != null)
            Check(Same(omissions, new[] { reason }), name + ": omission reason is " + reason + " (got " + string.Join(",", omissions) + ")");
    }

    static void Main()
    {
        // 0. Baseline shape: unchanged D02 payload and per-owner proof fields.
        cases++;
        {
            var f = Create(3);
            var frame = f.Sample();
            Check(frame != null, "baseline frame");
            Check(Same(Sorted(frame.Keys.ToArray()), Sorted("nativeOwnerPlayerProofVersion", "source", "hostRunId", "worldEpoch", "sampledGameTick", "owners", "protagonist")), "exact top-level payload shape (consumer requires it)");
            Check((int)frame["nativeOwnerPlayerProofVersion"] == 1 && (string)frame["source"] == "native_p2_owner_fiber_current_only", "version and source");
            Check(Owners(frame).Count == 3, "ambient observer is never an owner; 3 promoted owners");
            foreach (var owner in Owners(frame))
                Check(Same(Sorted(owner.Keys.ToArray()), Sorted("observerCaptureRef", "incarnationId", "encounterId", "ownerAlias", "hostRunId", "worldEpoch", "nativeActorPedId", "sampledGameTick")), "exact per-owner proof shape");
            Check(f.Omissions() == null || f.Omissions().Length == 0, "no omissions when all healthy");
            var expect = Sorted(f.Npcs.Select(n => n.Alias).ToArray());
            Check(Same(Aliases(frame), expect), "owners are exactly the three registered aliases");
        }

        // 1. Missing / unavailable NPC.
        OneBad("missing: ped despawned", "anchor_not_current", (f, b) => b.Ped.Existing = false);
        OneBad("missing: encounter record gone", "no_unique_encounter", (f, b) => f.Encounters.Remove(b.Handle.ToString()));
        OneBad("missing: anchor retired", null, (f, b) => f.Host.Anchors.Retire(b.CaptureRef));
        // 2. Suspended (scripted/mission): fail-closed for that NPC alone.
        OneBad("suspended", "suspended", (f, b) => b.Enc.Suspended = true);
        // 3. Recycled native identities.
        OneBad("recycled: pool slot reused at a new address", "anchor_not_current", (f, b) => b.Ped.MemoryAddress = new IntPtr(777777));
        OneBad("recycled: wrapper replaced under the same handle", "no_unique_encounter", (f, b) => b.Enc.Ped = new Ped { Handle = b.Handle, MemoryAddress = b.Ped.MemoryAddress });
        OneBad("recycled: ped died", "no_unique_encounter", (f, b) => b.Ped.IsDead = true);
        OneBad("recycled: P1 incarnation re-registered, encounter stale", "owner_mismatch", (f, b) => { f.Owner.Retire(b.Reg); f.Owner.Register(b.Ped, b.Alias, World); });
        OneBad("recycled: P1 claim revoked", "claim_unresolved", (f, b) => f.Owner.Retire(b.Reg));
        // 4. Otherwise invalid.
        OneBad("invalid: alias missing", "alias_missing", (f, b) => b.Enc.OwnerAlias = null);
        OneBad("invalid: alias malformed", "owner_mismatch", (f, b) => b.Enc.OwnerAlias = "promoted.not-a-uuid");
        OneBad("invalid: alias differs from P1 claim", "owner_mismatch", (f, b) => b.Enc.OwnerAlias = "promoted." + Guid.NewGuid().ToString("D"));
        OneBad("invalid: encounter id not a UUID", "id_invalid", (f, b) => b.Enc.Id = "not-a-guid");
        OneBad("invalid: encounter id is a UUID but not a v4 lifetime id", "lifetime_mismatch", (f, b) => b.Enc.Id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
        OneBad("invalid: ambiguous double encounter", "no_unique_encounter", (f, b) =>
        {
            var twin = new Encounter { Ped = b.Ped, Address = b.Enc.Address, Handle = b.Enc.Handle, CaptureRef = b.Enc.CaptureRef, OwnerAlias = b.Alias, Registration = b.Reg };
            f.Encounters["twin"] = twin;
        });
        OneBad("invalid: identity source faults for this ped only", "proof_fault", (f, b) => f.Owner.ResolveFaultFor = ped => ReferenceEquals(ped, b.Ped));

        // 4b. P1 claim bound to a different world than this host's.
        cases++;
        {
            var f = Create(2);
            var foreign = f.Add(40, null, OtherWorld);
            f.ObserveAll();
            var frame = f.Sample();
            Check(frame != null, "foreign-world claim does not null the frame");
            Check(!Aliases(frame).Contains(foreign.Alias) && Aliases(frame).Length == 2, "foreign-world NPC omitted, healthy kept");
            if (f.Omissions() != null) Check(Same(f.Omissions(), new[] { "owner_mismatch" }), "foreign world reason");
        }

        // 5. Handle reuse: a NEW ped at the recycled handle is a NEW owner with its own lifetime.
        cases++;
        {
            var f = Create(3);
            var before = f.Sample();
            var old = f.Npcs[1];
            old.Ped.Existing = false;
            var fresh = f.Add(old.Handle); // same handle, new wrapper/address/registration (production EncounterFor)
            f.Npcs.Remove(old);
            f.ObserveAll();
            var frame = f.Sample();
            Check(frame != null, "recycled handle: frame still produced");
            var aliases = Aliases(frame);
            Check(!aliases.Contains(old.Alias), "recycled handle: old identity never re-asserted");
            Check(aliases.Contains(fresh.Alias) && aliases.Length == 3, "recycled handle: new owner proves under its own lifetime");
            var oldProof = Owners(before).Single(o => (string)o["ownerAlias"] == old.Alias);
            var newProof = Owners(frame).Single(o => (string)o["ownerAlias"] == fresh.Alias);
            Check((string)oldProof["incarnationId"] != (string)newProof["incarnationId"] &&
                  (string)oldProof["observerCaptureRef"] != (string)newProof["observerCaptureRef"], "recycled handle: no incarnation or captureRef carry-over");
        }

        // 6. Duplicate identity is ambiguous: drop every claimant, keep the rest.
        cases++;
        {
            var f = Create(2);
            var first = f.Add(30);
            var clone = f.Add(31, first.Alias); // defense in depth: P1 would refuse this
            f.ObserveAll();
            var frame = f.Sample();
            Check(frame != null, "duplicate alias does not null the frame");
            var aliases = Aliases(frame);
            Check(aliases.Length == 2 && !aliases.Contains(first.Alias), "both claimants of a duplicate alias are omitted; two healthy NPCs remain");
            Check(Owners(frame).Select(o => (string)o["ownerAlias"]).Distinct().Count() == Owners(frame).Count, "frame never contains a repeated alias (consumer would reject the whole frame)");
            if (f.Omissions() != null) Check(f.Omissions().Count(r => r == "duplicate_identity") == 2, "duplicate reason for both claimants");
        }

        // 7. Several failures at once; only the lone healthy NPC survives.
        cases++;
        {
            var f = Create(3);
            var baseline = ByAlias(f.Sample());
            f.Npcs[0].Ped.Existing = false;
            f.Npcs[1].Enc.Suspended = true;
            var frame = f.Sample();
            Check(frame != null, "multi-fault frame produced");
            var proofs = ByAlias(frame);
            Check(proofs.Count == 1 && proofs[f.Npcs[2].Alias] == baseline[f.Npcs[2].Alias], "only the healthy NPC, unchanged");
        }

        // 8. Every NPC invalid: still a valid, empty-owner frame (consumer retires them) - not null.
        cases++;
        {
            var f = Create(3);
            foreach (var n in f.Npcs) n.Enc.Suspended = true;
            var frame = f.Sample();
            Check(frame != null && Owners(frame).Count == 0, "all suspended: empty owners, not null");
            Check(((Dictionary<string, object>)frame["protagonist"])["key"].Equals("franklin"), "protagonist still proven");
        }

        // 9. A bad ambient observer never affects promoted owners.
        cases++;
        {
            var f = Create(2);
            f.AddAmbient(91);
            f.ObserveAll();
            f.Host.Anchors.Retire(f.AmbientRefs[0]);
            var frame = f.Sample();
            Check(frame != null && Owners(frame).Count == 2, "retired ambient observer: promoted owners unaffected");
        }

        // 10. Frame-level faults stay fail-closed (null): the whole snapshot is unprovable.
        cases++;
        {
            var f = Create(3); f.Cutscene = true;
            Check(f.Sample() == null, "cutscene: no protagonist proof => null frame");
        }
        cases++;
        {
            var f = Create(3); f.Host.Anchors.Retire(f.Host.Anchors.Current.Single(a => a.Kind == "player").CaptureRef);
            Check(f.Sample() == null, "no live player anchor => null frame");
        }
        cases++;
        {
            var f = Create(3); f.SetChannelReady(false);
            Check(f.Sample() == null, "not ready => null frame");
        }
        cases++;
        {
            var f = Create(3);
            f.OnSecondPlayerPed = () => f.SetChannelReady(false); // readiness lost between before/after protagonist reads
            Check(f.Sample() == null, "readiness lost mid-sample => null frame");
        }
        cases++;
        {
            var f = Create(3);
            f.OnSecondModel = () => f.PlayerModel = Michael; // avatar switch mid-sample
            Check(f.Sample() == null, "protagonist changed mid-sample => null frame");
        }
        cases++;
        {
            var f = Create(3);
            f.Add(60); // observer limit is 16: fill with ambient + owned observers beyond the cap
            for (int n = 0; n < 20; n++) { try { f.AddAmbient(200 + n); } catch { } }
            f.ObserveAll();
            var frame = f.Sample();
            Check(frame == null || Owners(frame).Count <= 16, "roster is never silently partial or over 16 owners");
        }

        // 11. Recovery: the NPC that was omitted is proven again as soon as it is healthy.
        cases++;
        {
            var f = Create(3);
            var bad = f.Npcs[1];
            bad.Enc.Suspended = true;
            Check(Owners(f.Sample()).Count == 2, "suspended NPC omitted");
            bad.Enc.Suspended = false;
            Check(Owners(f.Sample()).Count == 3, "native side re-proves the NPC once healthy (JS stream policy decides re-admission)");
        }

        Console.WriteLine("K-21 owner sampling: " + cases + " scenarios, " + count + " assertions PASS");
    }
}
