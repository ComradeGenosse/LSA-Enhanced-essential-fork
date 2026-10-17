using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using LosSantosAlive.Audio;
using LosSantosAlive.NPC;
using LSA.Reactions;
using Rage;
using Rage.Native;

// Focused offline tests for conversation reactions: selection-adjacent policy,
// cooldowns, identity safety and cleanup. Run: dotnet run --project ReactionTests.csproj
// Limits (also in docs/plans/npc-gestures-findings.md): RAGE is a stub. Nothing here
// shows that a clip exists or looks right on GTA V Enhanced.
static class Tests
{
    const string Host = "11111111-1111-4111-8111-111111111111";
    static int failures, passed;
    static readonly HashSet<string> everCalled = new HashSet<string>();
    static int frameCounter;

    static void Check(bool ok, string what) { if (!ok) { failures++; Console.WriteLine("    FAIL: " + what); } }
    static void Run(string name, Action body)
    {
        int before = failures;
        try { body(); }
        catch (Exception e) { failures++; Console.WriteLine("    EXCEPTION: " + e); }
        if (failures == before) { passed++; Console.WriteLine("ok   " + name); } else Console.WriteLine("FAIL " + name);
    }

    // --------------------------------------------------------------- rig

    sealed class Mem : IReactionTransport
    {
        public readonly Queue<KeyValuePair<IDictionary<string, object>, long>> In = new Queue<KeyValuePair<IDictionary<string, object>, long>>();
        public readonly List<IDictionary<string, object>> Sent = new List<IDictionary<string, object>>();
        public int Drops; public bool Disposed;
        public bool TryTakeFrame(out IDictionary<string, object> frame, out long receivedMs)
        {
            frame = null; receivedMs = 0;
            if (In.Count == 0) return false;
            var item = In.Dequeue(); frame = item.Key; receivedMs = item.Value; return true;
        }
        public bool Send(IDictionary<string, object> message) { Sent.Add(message); return true; }
        public void Drop() { Drops++; }
        public void Dispose() { Disposed = true; }
        public string LastStatus() => Sent.Count == 0 ? null : (string)Sent[Sent.Count - 1]["status"];
        public string LastReason() => Sent.Count == 0 ? null : (string)Sent[Sent.Count - 1]["reason"];
    }

    sealed class Rig : IDisposable
    {
        public long Now = 100000;
        public int Epoch = 1;
        public readonly Mem Transport = new Mem();
        public readonly ReactionExecutor Ex;
        public readonly Ped Ped = new Ped { Handle = 4242 };
        public bool DictExists = true, DictLoaded = true, Playing;
        public float Duration = 1.2f;
        public readonly HashSet<string> TrueNatives = new HashSet<string>();
        public readonly HashSet<string> Throwing = new HashSet<string>();
        public readonly ReactionOptions Options;
        public readonly List<string> Logs = new List<string>();
        // null = every dictionary exists; otherwise only those the predicate accepts.
        public Func<string, bool> DictFilter;

        public Rig(string mode, Action<ReactionOptions> tune = null)
        {
            NativeFunction.Reset();
            NpcStateStore.Current = null;
            NpcTargeting.Conversation = Ped; NpcTargeting.Speaker = Ped; NpcTargeting.HumanPed = true;
            Options = new ReactionOptions { Mode = mode };
            tune?.Invoke(Options);
            NativeFunction.Script = (name, args) =>
            {
                if (Throwing.Contains(name)) throw new InvalidOperationException("scripted fault in " + name);
                switch (name)
                {
                    case "DOES_ANIM_DICT_EXIST": return DictExists && (DictFilter == null || DictFilter((string)args[0]));
                    case "HAS_ANIM_DICT_LOADED": return DictLoaded;
                    case "REQUEST_ANIM_DICT": DictLoaded = true; return null;
                    case "GET_ANIM_DURATION": return Duration;
                    case "IS_ENTITY_PLAYING_ANIM": return Playing;
                    default: return TrueNatives.Contains(name) ? (object)true : null;
                }
            };
            Ex = new ReactionExecutor(Options, Transport, Host, () => Epoch, () => Now, null, Logs.Add);
            Ex.Attach();
        }

        public List<string> Calls => NativeFunction.Calls;
        public int Count(string native) => Calls.Count(c => c == native);
        public void Step(long ms) { Now += ms; Ex.Update(); }

        public void Start(string turn, long gen = 1, Ped ped = null, string pedId = null)
        {
            ped = ped ?? Ped;
            NpcPlaybackCoordinator.RaiseStarted(new NpcPlaybackStartedEvent { SpeakerPed = ped, PedId = pedId ?? ped.Handle.ToString(), TurnId = turn, GenerationId = gen });
        }
        public void End(string turn, long gen = 1, bool interrupted = false)
        {
            NpcPlaybackCoordinator.RaiseEnded(new NpcPlaybackEndedEvent
            {
                SpeakerPed = Ped, PedId = Ped.Handle.ToString(), TurnId = turn, GenerationId = gen,
                WasInterrupted = interrupted, HadAudio = true, PlaybackStarted = true, Reason = interrupted ? "interrupted" : "completed",
            });
        }
        public void Frame(string turn, long gen = 1, string reaction = "facepalm", string host = Host, int? epoch = null, string pedId = null)
        {
            Transport.In.Enqueue(new KeyValuePair<IDictionary<string, object>, long>(MakeFrame(pedId ?? Ped.Handle.ToString(), turn, gen, reaction, host, epoch ?? Epoch), Now));
        }

        // Start line, send frame, reach the planned start offset, and (in "on") play + confirm.
        public void StartAndPlay(string turn, string reaction = "facepalm", long gen = 1)
        {
            Start(turn, gen); Frame(turn, gen, reaction);
            Step(0); Step(1300);
            if (Options.Mutates) { Playing = true; Step(200); }
        }

        public void Dispose()
        {
            foreach (var c in Calls) everCalled.Add(c);
            Ex.Shutdown();
            NativeFunction.Reset();
        }
    }

    static Dictionary<string, object> MakeFrame(string pedId, string turn, long gen, string reaction, string host, int epoch) =>
        new Dictionary<string, object>
        {
            { "version", 1 }, { "type", "reaction" },
            { "frameId", string.Format("00000000-0000-4000-8000-{0:D12}", ++frameCounter) },
            { "hostRunId", host }, { "worldEpoch", epoch },
            { "tuple", new Dictionary<string, object> { { "pedId", pedId }, { "turnId", turn }, { "generationId", gen } } },
            { "reaction", reaction },
        };

    static PlaybackKey K(string ped, string turn, long gen = 1) => new PlaybackKey(ped, turn, gen);
    static string Here([CallerFilePath] string path = "") => path;

    // -------------------------------------------------------------- tests

    static int Main()
    {
        // ---- catalog / source guards
        Run("catalog: closed set, secondary+upper-body flags, bounded durations, candidates for both genders", () =>
        {
            Check(ReactionCatalog.PlayFlags == 48, "flags 16|32");
            Check(ReactionCatalog.Names.OrderBy(n => n).SequenceEqual(new[] { "facepalm", "middle_finger", "nod", "shrug" }), "exactly facepalm, middle_finger, nod, shrug");
            Check(!ReactionCatalog.Get("facepalm").OptIn && !ReactionCatalog.Get("middle_finger").OptIn, "the two #204 gestures keep their behavior");
            Check(ReactionCatalog.Get("nod").OptIn && ReactionCatalog.Get("shrug").OptIn, "nod and shrug are opt-in");
            foreach (var name in ReactionCatalog.Names)
            {
                var spec = ReactionCatalog.Get(name);
                Check(spec.MaxMs > 0 && spec.MaxMs <= 2000, name + " short");
                Check(spec.Candidates(true).Count > 0 && spec.Candidates(false).Count > 0, name + " candidates");
                Check(spec.BlendIn > 0 && spec.BlendOut < 0, name + " blends");
            }
            Check(!ReactionCatalog.IsKnown("smile") && !ReactionCatalog.IsKnown(null) && !ReactionCatalog.IsKnown("Facepalm"), "unknown names rejected");
        });

        Run("catalog: nod/shrug use ambient gesture dictionaries per gender, with the male clip as the female fallback, and start inside the late-start bound", () =>
        {
            var nod = ReactionCatalog.Get("nod"); var shrug = ReactionCatalog.Get("shrug");
            Check(nod.Candidates(true)[0].Dict == "gestures@m@standing@casual" && nod.Candidates(true)[0].Clip == "gesture_nod_yes_soft", "male nod");
            Check(nod.Candidates(false)[0].Dict == "gestures@f@standing@casual" && nod.Candidates(false).Any(c => c.Dict == "gestures@m@standing@casual"), "female nod then male fallback");
            Check(shrug.Candidates(true)[0].Clip == "gesture_shrug_soft" && shrug.Candidates(false)[0].Dict == "gestures@f@standing@casual", "shrug candidates");
            foreach (var spec in new[] { nod, shrug })
                Check(spec.StartMinMs >= 0 && spec.StartMinMs + spec.StartSpanMs - 1 < new ReactionOptions().MaxLateStartMs && spec.MaxMs <= 1800, spec.Name + " window and ceiling");
            Check(ReactionCatalog.FacialProbeDicts.Length > 0 && ReactionCatalog.FacialProbeDicts.All(d => d.StartsWith("mp_facial") || d.StartsWith("facials@")), "facial probe dictionaries are existence-only and from the overlay's own set");
        });

        Run("source: executor calls only allow-listed natives; no task clearing, movement, weapon, gaze or heading code in any reaction file", () =>
        {
            string dir = Path.GetDirectoryName(Path.GetDirectoryName(Here()));
            string Code(string file) => Regex.Replace(Regex.Replace(File.ReadAllText(Path.Combine(dir, file)), @"/\*.*?\*/", "", RegexOptions.Singleline), @"//[^\n]*", "");
            var allowed = new HashSet<string>
            {
                "DOES_ANIM_DICT_EXIST", "HAS_ANIM_DICT_LOADED", "REQUEST_ANIM_DICT", "GET_ANIM_DURATION", "TASK_PLAY_ANIM", "IS_ENTITY_PLAYING_ANIM",
                "STOP_ANIM_TASK", "REMOVE_ANIM_DICT",
                "IS_PED_INJURED", "IS_CUTSCENE_ACTIVE", "IS_CUTSCENE_PLAYING", "IS_PLAYER_SWITCH_IN_PROGRESS", "GET_MISSION_FLAG", "NETWORK_IS_SESSION_ACTIVE",
                "IS_PED_RAGDOLL", "IS_PED_IN_ANY_VEHICLE", "IS_PED_GETTING_INTO_A_VEHICLE", "IS_PED_IN_MELEE_COMBAT", "IS_PED_SHOOTING", "IS_PED_IN_COMBAT",
                "IS_PED_FLEEING", "IS_PED_ARMED", "IS_PED_USING_ANY_SCENARIO", "IS_PED_SWIMMING", "IS_PED_FALLING", "IS_PED_JUMPING", "IS_PED_CLIMBING",
                "IS_PED_GETTING_UP", "IS_PED_PERFORMING_MELEE_ACTION", "IS_PED_BEING_STUNNED",
            };
            var used = Regex.Matches(Code("ReactionExecutor.cs"), "\"([A-Z][A-Z0-9_]{4,})\"").Cast<Match>().Select(m => m.Groups[1].Value).Distinct().ToList();
            Check(used.Count > 0, "found native literals");
            foreach (var native in used) Check(allowed.Contains(native), "unexpected native " + native);
            var banned = new[] { "ClearAll", "CLEAR_PED", "CLEAR_", "SET_ENTITY_", "SET_PED_", "TASK_GO", "TASK_TURN", "TASK_LOOK", "TASK_STAND", "TASK_GOTO", "FREEZE", "WEAPON", "Teleport", ".Heading", ".Position", "Tasks.", "SET_CURRENT_" };
            foreach (var file in new[] { "ReactionCatalog.cs", "ReactionFrame.cs", "ReactionPolicy.cs", "ReactionExecutor.cs", "ReactionChannel.cs", "ReactionIntegration.cs" })
            {
                var code = Code(file);
                foreach (var word in banned) Check(!code.Contains(word), file + " contains " + word);
            }
        });

        // ---- wire shape
        Run("codec: exact frame accepted; extra/missing keys, bad ids, floats, unknown reaction rejected", () =>
        {
            var ok = MakeFrame("4242", "turn-1", 3, "facepalm", Host, 2);
            Check(ReactionFrameCodec.TryParse(ok, out var frame, out var reason) && frame.Key.Equals(K("4242", "turn-1", 3)) && frame.WorldEpoch == 2, "valid");
            var extra = MakeFrame("4242", "t", 1, "facepalm", Host, 1); extra["text"] = "hello";
            Check(!ReactionFrameCodec.TryParse(extra, out _, out _), "extra key");
            var missing = MakeFrame("4242", "t", 1, "facepalm", Host, 1); missing.Remove("reaction");
            Check(!ReactionFrameCodec.TryParse(missing, out _, out _), "missing key");
            Check(!ReactionFrameCodec.TryParse(MakeFrame("4242", "t", 1, "facepalm", "not-a-uuid", 1), out _, out _), "bad host uuid");
            Check(!ReactionFrameCodec.TryParse(MakeFrame("bad id!", "t", 1, "facepalm", Host, 1), out _, out _), "bad ped id");
            Check(!ReactionFrameCodec.TryParse(MakeFrame("4242", "t", 1, "facepalm", Host, 0), out _, out _), "epoch 0");
            var frac = MakeFrame("4242", "t", 1, "facepalm", Host, 1); ((Dictionary<string, object>)frac["tuple"])["generationId"] = 1.5;
            Check(!ReactionFrameCodec.TryParse(frac, out _, out _), "fractional generation");
            Check(!ReactionFrameCodec.TryParse(MakeFrame("4242", "t", -1, "facepalm", Host, 1), out _, out _), "negative generation");
            Check(!ReactionFrameCodec.TryParse(MakeFrame("4242", "t", 1, "wink", Host, 1), out _, out var r) && r == "unknown_reaction", "unknown reaction");
            Check(!ReactionFrameCodec.TryParse(null, out _, out _), "null");
            Check(ReactionFrameCodec.Ack(frame, "played", "Bad Reason!")["reason"].Equals("unspecified"), "ack reason is sanitized");
        });

        // ---- identity: playback book
        Run("book: exact-tuple end, supersede per ped, idempotent start, capacity, expiry", () =>
        {
            var book = new PlaybackBook();
            var a = book.Started(K("1", "A"), "x", 0, out var sup);
            Check(a != null && sup == null, "start A");
            Check(book.Started(K("1", "A"), "x", 5, out sup) == a && sup == null, "duplicate start idempotent");
            var b = book.Started(K("1", "B", 2), "x", 10, out sup);
            Check(b != null && sup == a && book.Count == 1, "B supersedes A for the same ped");
            Check(book.Ended(K("1", "A"), false) == null && book.Active(K("1", "B", 2)) == b, "late end of A cannot end B");
            Check(book.Ended(K("1", "B", 1), false) == null, "wrong generation cannot end B");
            Check(book.Ended(K("2", "B", 2), false) == null, "wrong ped cannot end B");
            Check(book.Ended(K("1", "B", 2), true) == b && b.Interrupted && book.Count == 0, "exact end removes and records interruption");
            for (int i = 0; i < PlaybackBook.Capacity; i++) Check(book.Started(K("p" + i, "t"), "x", 0, out _) != null, "fill " + i);
            Check(book.Started(K("overflow", "t"), "x", 0, out _) == null, "full book fails closed");
            var expired = new List<PlaybackEntry>();
            book.Expire(PlaybackBook.MaxAgeMs + 1, expired);
            Check(expired.Count == PlaybackBook.Capacity && book.Count == 0, "missing terminal events expire");
        });

        // ---- cooldowns
        Run("cooldowns: global, ped, same-reaction windows; clear; bounded", () =>
        {
            var options = new ReactionOptions { Mode = "on" };
            var cd = new ReactionCooldowns(options);
            Check(cd.Check("1", "facepalm", 0) == null, "fresh");
            cd.Record("1", "facepalm", 0);
            Check(cd.Check("2", "facepalm", 11999) == "global_cooldown", "global");
            Check(cd.Check("1", "middle_finger", 12000) == "ped_cooldown", "ped");
            Check(cd.Check("1", "facepalm", 20000) == "reaction_cooldown", "same reaction on same ped");
            Check(cd.Check("1", "middle_finger", 20000) == null, "other reaction ok after ped window");
            Check(cd.Check("2", "facepalm", 12000) == null, "other ped ok after global window");
            Check(cd.Check("1", "facepalm", 60000) == null, "all windows over");
            cd.Clear();
            Check(cd.Check("1", "facepalm", 1) == null, "clear");
            for (int i = 0; i < 500; i++) cd.Record("p" + i, "facepalm", i);
            Check(cd.Check("p499", "facepalm", 500) == "global_cooldown", "still functional after many peds");
        });

        // ---- admission
        Run("admission: every refusal reason, and the single admit path", () =>
        {
            var options = new ReactionOptions { Mode = "on" };
            var book = new PlaybackBook(); var cd = new ReactionCooldowns(options);
            book.Started(K("1", "t"), "x", 1000, out _);
            ReactionFrame F(string reaction = "facepalm", string host = Host, int epoch = 1, string ped = "1", string turn = "t")
            {
                ReactionFrameCodec.TryParse(MakeFrame(ped, turn, 1, reaction, host, epoch), out var f, out _); return f;
            }
            AdmissionDecision Eval(ReactionFrame f, long received = 1100, long now = 1200, bool busy = false, ReactionOptions o = null) =>
                ReactionAdmission.Evaluate(o ?? options, f, Host, 1, book, cd, received, now, busy);
            Check(Eval(F()).Outcome == AdmissionOutcome.Admit, "admit");
            Check(Eval(F(), o: new ReactionOptions { Mode = "off" }).Reason == "mode_off", "off");
            Check(Eval(F(host: "22222222-2222-4222-8222-222222222222")).Reason == "host_mismatch", "other host run");
            Check(Eval(F(epoch: 2)).Reason == "host_mismatch", "other world epoch");
            var disabled = new ReactionOptions { Mode = "on" }; disabled.Disabled.Add("facepalm");
            Check(Eval(F(), o: disabled).Reason == "reaction_disabled", "disabled by config");
            Check(Eval(F(), received: 1000, now: 1000 + options.FrameFreshMs + 1).Reason == "stale_frame", "stale");
            Check(Eval(F(turn: "other"), now: 1200).Outcome == AdmissionOutcome.Defer, "no record yet: defer");
            Check(Eval(F(turn: "other"), received: 1000, now: 1000 + options.PendingMs + 1).Reason == "no_active_playback", "never started: reject");
            Check(Eval(F(ped: "2")).Outcome == AdmissionOutcome.Defer, "other ped has no playback");
            Check(Eval(F(), received: 1000 + options.MaxLateStartMs, now: 1000 + options.MaxLateStartMs + 1).Reason == "playback_too_far_along", "too late in the line");
            Check(Eval(F(), busy: true).Reason == "busy", "one reaction at a time");
            cd.Record("1", "facepalm", 1150);
            Check(Eval(F("middle_finger")).Reason == "global_cooldown", "cooldown applies");
        });

        Run("admission: opt-in reactions need native reactions.enabled; disabled still wins; others unaffected", () =>
        {
            var book = new PlaybackBook();
            book.Started(K("1", "t"), "x", 1000, out _);
            ReactionFrame F(string reaction) { ReactionFrameCodec.TryParse(MakeFrame("1", "t", 1, reaction, Host, 1), out var f, out _); return f; }
            AdmissionDecision Eval(string reaction, ReactionOptions o) =>
                ReactionAdmission.Evaluate(o, F(reaction), Host, 1, book, new ReactionCooldowns(o), 1100, 1200, false);
            var none = new ReactionOptions { Mode = "on" };
            Check(Eval("nod", none).Reason == "reaction_not_enabled" && Eval("shrug", none).Reason == "reaction_not_enabled", "default: refused");
            Check(Eval("facepalm", none).Outcome == AdmissionOutcome.Admit && Eval("middle_finger", none).Outcome == AdmissionOutcome.Admit, "#204 gestures need no opt-in");
            var nodOnly = new ReactionOptions { Mode = "on" }; nodOnly.Enabled.Add("nod");
            Check(Eval("nod", nodOnly).Outcome == AdmissionOutcome.Admit, "listed nod admitted");
            Check(Eval("shrug", nodOnly).Reason == "reaction_not_enabled", "shrug still refused");
            nodOnly.Disabled.Add("nod");
            Check(Eval("nod", nodOnly).Reason == "reaction_disabled", "disabled overrides enabled");
        });

        Run("timing: start offset is deterministic and inside 500..1199 ms", () =>
        {
            var seen = new HashSet<int>();
            for (int i = 0; i < 200; i++)
            {
                int a = ReactionTiming.StartDelayMs(K("1", "turn-" + i)), b = ReactionTiming.StartDelayMs(K("999", "turn-" + i));
                Check(a == b && a >= 500 && a < 1200, "range/determinism " + i);
                seen.Add(a);
            }
            Check(seen.Count > 50, "offsets vary between turns");
        });

        Run("timing: nod starts early, shrug a little later, both deterministic inside their own windows", () =>
        {
            var nod = ReactionCatalog.Get("nod"); var shrug = ReactionCatalog.Get("shrug");
            for (int i = 0; i < 200; i++)
            {
                int a = ReactionTiming.StartDelayMs(K("1", "turn-" + i), nod), b = ReactionTiming.StartDelayMs(K("9", "turn-" + i), nod);
                Check(a == b && a >= 250 && a < 700, "nod window " + a);
                int c = ReactionTiming.StartDelayMs(K("1", "turn-" + i), shrug);
                Check(c >= 400 && c < 900, "shrug window " + c);
                Check(ReactionTiming.StartDelayMs(K("1", "turn-" + i), ReactionCatalog.Get("facepalm")) == ReactionTiming.StartDelayMs(K("1", "turn-" + i)), "#204 timing unchanged");
            }
            Check(ReactionTiming.StartDelayMs(K("1", "t"), null) == ReactionTiming.StartDelayMs(K("1", "t")), "null spec falls back to the default window");
        });

        // ---- run lifecycle (pure)
        Run("run: waits, starts once due, completes; ends or stops on interruption, death/replacement, playback end", () =>
        {
            PlaybackEntry E() => new PlaybackEntry { Key = K("1", "t"), Actor = "ped", StartedMs = 0 };
            var r = new ReactionRun("facepalm", E(), false, 700);
            Check(r.Tick(100, true, false, true) == RunStep.None, "not yet");
            Check(r.Tick(700, true, false, true) == RunStep.Start, "start");
            r.MarkPlaying(700, 1000);
            Check(r.Tick(1000, false, false, true) == RunStep.None, "normal playback end lets the short clip finish");
            Check(r.Tick(1700, false, false, true) == RunStep.Finish && r.EndReason == "completed", "finish");
            Check(r.Tick(1800, true, false, true) == RunStep.None, "done is terminal");

            r = new ReactionRun("facepalm", E(), false, 700);
            Check(r.Tick(800, false, false, true) == RunStep.None && r.State == RunState.Done && r.EndReason == "playback_ended", "line ended before start: never starts");
            r = new ReactionRun("facepalm", E(), false, 700); r.MarkPlaying(700, 1000);
            Check(r.Tick(800, true, true, true) == RunStep.Stop && r.EndReason == "interrupted", "interruption stops a playing gesture");
            r = new ReactionRun("facepalm", E(), false, 700); r.MarkPlaying(700, 1000);
            Check(r.Tick(800, true, false, false) == RunStep.Stop && r.EndReason == "actor_invalid", "death/replacement stops it");
            r = new ReactionRun("facepalm", E(), false, 700);
            Check(r.Tick(800, true, true, true) == RunStep.None && r.State == RunState.Done, "interrupted before start: nothing to stop");
        });

        Run("preflight: clear ped passes; each blocking fact refuses; owned behavior needs opt-in", () =>
        {
            Check(ReactionPreflight.Verdict(new ActorFacts(), false) == null, "idle conversation ped");
            var cases = new Dictionary<string, Action<ActorFacts>>
            {
                { "dead", f => f.Dead = true }, { "injured", f => f.Injured = true }, { "player", f => f.IsPlayer = true },
                { "not_human", f => f.IsHuman = false }, { "scripted", f => f.Scripted = true },
                { "not_conversation_speaker", f => f.ConversationSpeaker = false }, { "ragdoll", f => f.Ragdoll = true },
                { "in_vehicle", f => f.InVehicle = true }, { "in_combat", f => f.InCombat = true }, { "fleeing", f => f.Fleeing = true },
                { "armed", f => f.Armed = true }, { "scenario", f => f.UsingScenario = true }, { "swimming", f => f.Swimming = true },
                { "falling_or_climbing", f => f.FallingOrClimbing = true }, { "getting_up", f => f.GettingUp = true },
                { "melee", f => f.MeleeAction = true }, { "stunned", f => f.BeingStunned = true },
                { "directed_interaction", f => f.InDirectedInteraction = true }, { "reflex", f => f.HasActiveReflex = true },
                { "hands_up", f => f.HandsUp = true }, { "kneel_or_sit", f => f.KneelOrSit = true }, { "hostile_mode", f => f.HostileMode = true },
                { "holding_item", f => f.HoldingItem = true }, { "activity", f => f.ActivityInProgress = true },
                { "owned_behavior", f => f.OwnedBehavior = true },
            };
            foreach (var pair in cases) { var f = new ActorFacts(); pair.Value(f); Check(ReactionPreflight.Verdict(f, false) == pair.Key, pair.Key); }
            Check(ReactionPreflight.Verdict(new ActorFacts { OwnedBehavior = true }, true) == null, "opt-in allows owned behavior");
            Check(ReactionPreflight.Verdict(new ActorFacts { Armed = true, OwnedBehavior = true }, true) == "armed", "opt-in never overrides hard blocks");
            Check(ReactionPreflight.Verdict(new ActorFacts { Exists = false }, false) == "actor_missing", "missing");
            Check(ReactionPreflight.Verdict(null, false) == "actor_missing", "null");
        });

        // ---- executor
        Run("executor off: no subscription, no natives", () =>
        {
            int before = NpcPlaybackCoordinator.Subscribers;
            using (var rig = new Rig("off"))
            {
                Check(NpcPlaybackCoordinator.Subscribers == before, "no subscribers");
                rig.Start("t1"); rig.Frame("t1"); rig.Step(2000);
                Check(rig.Calls.Count == 0 && rig.Transport.Sent.Count == 0, "inert");
            }
        });

        Run("executor shadow: reports would_play and performs no mutating native", () =>
        {
            using (var rig = new Rig("shadow"))
            {
                rig.StartAndPlay("t1");
                Check(rig.Ex.ShadowPlayed == 1 && rig.Ex.Played == 0, "counted as shadow");
                Check(rig.Transport.LastStatus() == "shadow" && rig.Transport.LastReason() == "would_play", "ack");
                foreach (var native in new[] { "TASK_PLAY_ANIM", "REQUEST_ANIM_DICT", "STOP_ANIM_TASK", "REMOVE_ANIM_DICT" })
                    Check(rig.Count(native) == 0, "shadow must not call " + native);
            }
        });

        Run("executor on: plays upper-body secondary-slot clip, confirms it, finishes and releases only what it requested", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.DictLoaded = false; // forces our own request, so we own the release
                rig.Start("t1"); rig.Frame("t1");
                rig.Step(0); rig.Step(1300); // due -> request dictionary
                Check(rig.Count("REQUEST_ANIM_DICT") == 1 && rig.Count("TASK_PLAY_ANIM") == 0, "waits for load, does not block");
                rig.Step(50);
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "plays once loaded");
                int i = rig.Calls.IndexOf("TASK_PLAY_ANIM");
                var args = NativeFunction.Args[i];
                Check(ReferenceEquals(args[0], rig.Ped) && (string)args[1] == "anim@mp_player_intupperface_palm" && (string)args[2] == "idle_a", "dictionary + clip from catalog");
                Check((int)args[6] == 48, "upper-body | secondary-slot flags");
                Check((int)args[5] > 0 && (int)args[5] <= 1800, "finite and short");
                rig.Playing = true; rig.Step(200);
                Check(rig.Ex.Played == 1 && rig.Transport.LastStatus() == "played", "confirmed by IS_ENTITY_PLAYING_ANIM");
                rig.End("t1"); rig.Step(100);
                Check(rig.Ex.HasActiveRun, "normal line end lets the finite clip finish");
                rig.Playing = false; rig.Step(1500);
                Check(!rig.Ex.HasActiveRun, "run over");
                Check(rig.Count("STOP_ANIM_TASK") == 0, "nothing to stop once the clip ended by itself");
                Check(rig.Count("REMOVE_ANIM_DICT") == 1, "released the dictionary it requested");
            }
        });

        Run("executor on: an already-loaded dictionary is never removed", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.DictLoaded = true;
                rig.StartAndPlay("t1");
                Check(rig.Ex.Played == 1, "played");
                rig.Playing = false; rig.Step(2000);
                Check(rig.Count("REQUEST_ANIM_DICT") == 0 && rig.Count("REMOVE_ANIM_DICT") == 0, "someone else's dictionary stays");
            }
        });

        Run("executor on: interrupted line stops only our clip, once", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.StartAndPlay("t1");
                rig.End("t1", interrupted: true); rig.Step(50);
                Check(!rig.Ex.HasActiveRun, "stopped");
                Check(rig.Count("STOP_ANIM_TASK") == 1, "one clip-scoped stop");
                var args = NativeFunction.Args[rig.Calls.IndexOf("STOP_ANIM_TASK")];
                Check((string)args[1] == "anim@mp_player_intupperface_palm" && (string)args[2] == "idle_a", "stop names our dictionary and clip");
            }
        });

        Run("executor on: death, handle reuse and despawn end the run without touching the ped", () =>
        {
            foreach (var kind in new[] { "dead", "reused", "gone" })
            {
                using (var rig = new Rig("on"))
                {
                    rig.StartAndPlay("t1");
                    if (kind == "dead") rig.Ped.IsDead = true;
                    else if (kind == "reused") rig.Ped.MemoryAddress = new IntPtr(0x2000);
                    else rig.Ped.Alive = false;
                    rig.Step(50);
                    Check(!rig.Ex.HasActiveRun, kind + ": run ended");
                    Check(rig.Count("STOP_ANIM_TASK") == 0, kind + ": no native on a stale ped");
                }
            }
        });

        Run("executor on: changing combat, activities or speaker stops a running clip immediately", () =>
        {
            foreach (var reason in new[] { "combat", "activity", "owner", "speaker" })
            {
                using (var rig = new Rig("on"))
                {
                    rig.StartAndPlay("t1");
                    Check(rig.Ex.HasActiveRun && rig.Ex.Played == 1, reason + ": gesture was playing");
                    if (reason == "combat") rig.TrueNatives.Add("IS_PED_SHOOTING");
                    if (reason == "activity") NpcStateStore.Current = new NpcState { ActivityInProgress = true };
                    if (reason == "owner") NpcStateStore.Current = new NpcState { FollowPlayerOnFoot = true };
                    if (reason == "speaker") { NpcTargeting.Speaker = null; NpcTargeting.Conversation = null; }
                    rig.Step(20);
                    Check(!rig.Ex.HasActiveRun && rig.Count("STOP_ANIM_TASK") == 1,
                        reason + ": stop only our own active clip on the same owner tick");
                }
            }
        });

        Run("executor on: world reset ends the run, drops the channel, voids old identities", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.StartAndPlay("t1");
                rig.Ex.WorldChanged("test");
                Check(!rig.Ex.HasActiveRun && rig.Transport.Drops == 1, "ended + dropped");
                Check(rig.Count("STOP_ANIM_TASK") == 1, "own clip stopped");
                rig.Epoch = 2;
                rig.Frame("t1", epoch: 1); rig.Step(10);
                Check(rig.Ex.Rejected("host_mismatch") == 1 && !rig.Ex.HasActiveRun, "frame from the previous world epoch is refused");
                rig.Frame("t1", epoch: 2); rig.Step(10);
                Check(!rig.Ex.HasActiveRun, "playback record was cleared too: still nothing runs for the old line");
            }
        });

        Run("executor: frame for a line native never saw is refused; wrong ped/turn/generation never plays", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Start("t1");
                rig.Frame("t2"); rig.Frame("t1", gen: 9); rig.Frame("t1", pedId: "777");
                rig.Step(0);
                Check(!rig.Ex.HasActiveRun, "nothing admitted");
                rig.Step(rig.Options.PendingMs + 100);
                Check(rig.Ex.Rejected("no_active_playback") == 3, "all three refused after the grace window");
                Check(rig.Count("TASK_PLAY_ANIM") == 0 && rig.Count("DOES_ANIM_DICT_EXIST") == 0, "no animation natives were touched");
            }
        });

        Run("executor: late old-generation START cannot supersede newer playback", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Start("latest", gen: 4); rig.Frame("latest", gen: 4); rig.Step(0);
                rig.Start("old", gen: 3); rig.Step(0);
                Check(rig.Ex.Rejected("playback_start_unavailable") == 1, "old START refused while newer active");
                rig.Step(1300);
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "newer turn still animates");
                rig.End("latest", gen: 4); rig.Step(20);
                rig.Start("older-after-end", gen: 2); rig.Frame("older-after-end", gen: 2);
                rig.Step(1800);
                Check(rig.Ex.Rejected("playback_start_unavailable") == 2, "old START cannot reappear after the newer END");
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "stale turn never animated");
            }
        });

        Run("executor: frame arriving before native's own playback record waits, then plays", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Frame("t1"); rig.Step(100);
                Check(!rig.Ex.HasActiveRun, "deferred");
                rig.Start("t1"); rig.Step(10); rig.Step(1300);
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "plays after the record exists");
            }
        });

        Run("executor: a new line for the same ped supersedes; a late end of the old line does not end the new one", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Start("t1"); rig.Frame("t1"); rig.Step(0);
                Check(rig.Ex.HasActiveRun, "t1 waiting");
                rig.Start("t2", gen: 2);
                rig.Step(0);
                Check(!rig.Ex.HasActiveRun && rig.Count("TASK_PLAY_ANIM") == 0, "t1 run dropped without ever animating");
                rig.Frame("t2", gen: 2); rig.Step(0); rig.End("t1", interrupted: true); rig.Step(1300);
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "t2 still plays: the late end of t1 was ignored");
            }
        });

        Run("executor: a start whose PedId is not the speaker's handle is ignored", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Start("t1", pedId: "9999"); rig.Frame("t1", pedId: "9999"); rig.Step(2000);
                Check(rig.Ex.Rejected("playback_ped_invalid") == 1 && rig.Count("TASK_PLAY_ANIM") == 0, "refused");
            }
        });

        Run("executor: preflight refusals do nothing and answer skipped", () =>
        {
            var cases = new Dictionary<string, Action<Rig>>
            {
                { "in_vehicle", r => r.TrueNatives.Add("IS_PED_IN_ANY_VEHICLE") },
                { "in_combat", r => r.TrueNatives.Add("IS_PED_IN_MELEE_COMBAT") },
                { "armed", r => r.TrueNatives.Add("IS_PED_ARMED") },
                { "scenario", r => r.TrueNatives.Add("IS_PED_USING_ANY_SCENARIO") },
                { "scripted", r => r.TrueNatives.Add("IS_CUTSCENE_PLAYING") },
                { "not_conversation_speaker", r => { NpcTargeting.Conversation = null; NpcTargeting.Speaker = null; } },
                { "directed_interaction", r => NpcStateStore.Current = new NpcState { InDirectedInteraction = true } },
                { "owned_behavior", r => NpcStateStore.Current = new NpcState { FollowPlayerOnFoot = true } },
                { "holding_item", r => NpcStateStore.Current = new NpcState { HeldItem = new LosSantosAlive.NPC.Items.NpcHeldItemState { IsHoldingItem = true } } },
            };
            foreach (var pair in cases)
            {
                using (var rig = new Rig("on"))
                {
                    pair.Value(rig);
                    rig.StartAndPlay("t1");
                    Check(rig.Count("TASK_PLAY_ANIM") == 0 && rig.Count("REQUEST_ANIM_DICT") == 0, pair.Key + ": no animation");
                    Check(rig.Transport.LastStatus() == "skipped" && rig.Transport.LastReason() == "preflight_" + pair.Key, pair.Key + ": ack " + rig.Transport.LastReason());
                    Check(rig.Count("STOP_ANIM_TASK") == 0 && !rig.Ex.HasActiveRun, pair.Key + ": clean");
                }
            }
        });

        Run("executor: owner callback decides 'owned' and a throwing callback is treated as owned", () =>
        {
            foreach (var thrower in new[] { false, true })
            {
                NativeFunction.Reset();
                var transport = new Mem(); long now = 100000;
                var ped = new Ped { Handle = 4242 }; NpcTargeting.Conversation = ped; NpcTargeting.Speaker = ped; NpcStateStore.Current = null;
                NativeFunction.Script = (n, a) => n == "DOES_ANIM_DICT_EXIST" || n == "HAS_ANIM_DICT_LOADED" ? (object)true : n == "GET_ANIM_DURATION" ? (object)1.2f : null;
                var ex = new ReactionExecutor(new ReactionOptions { Mode = "on" }, transport, Host, () => 1, () => now,
                    p => { if (thrower) throw new InvalidOperationException(); return true; });
                ex.Attach();
                NpcPlaybackCoordinator.RaiseStarted(new NpcPlaybackStartedEvent { SpeakerPed = ped, PedId = "4242", TurnId = "t", GenerationId = 1 });
                transport.In.Enqueue(new KeyValuePair<IDictionary<string, object>, long>(MakeFrame("4242", "t", 1, "facepalm", Host, 1), now));
                ex.Update(); now += 1300; ex.Update();
                Check(!NativeFunction.Calls.Contains("TASK_PLAY_ANIM") && ex.Rejected("preflight_owned_behavior") == 1, "owned -> nothing (thrower=" + thrower + ")");
                foreach (var c in NativeFunction.Calls) everCalled.Add(c);
                ex.Shutdown(); NativeFunction.Reset();
            }
        });

        Run("executor: unknown dictionary or zero-length clip is skipped; falls through to the next candidate", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.DictExists = false;
                rig.StartAndPlay("t1");
                Check(rig.Count("TASK_PLAY_ANIM") == 0 && rig.Transport.LastReason() == "no_clip", "nothing exists -> skipped, not guessed");
            }
            using (var rig = new Rig("on"))
            {
                rig.Duration = 0f;
                rig.StartAndPlay("t1");
                Check(rig.Count("TASK_PLAY_ANIM") == 0 && rig.Transport.LastReason() == "no_clip", "clip duration 0 -> skipped");
            }
            using (var rig = new Rig("on"))
            {
                int calls = 0;
                var inner = NativeFunction.Script;
                NativeFunction.Script = (n, a) => n == "DOES_ANIM_DICT_EXIST" ? (object)(++calls > 1) : inner(n, a);
                rig.StartAndPlay("t1");
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "second candidate used when the first dictionary is absent");
            }
        });

        Run("executor: a gesture that never shows up is reported as skipped, not played", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Start("t1"); rig.Frame("t1"); rig.Step(0); rig.Step(1300);
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "task issued");
                rig.Playing = false;
                rig.Step(300); rig.Step(500);
                Check(rig.Ex.Played == 0 && rig.Transport.LastStatus() == "skipped" && rig.Transport.LastReason() == "not_playing", "no false success");
                Check(!rig.Ex.HasActiveRun, "run ended");
            }
        });

        Run("executor: cooldowns hold across lines (global, same reaction) and a different reaction may follow", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.StartAndPlay("t1");
                rig.Playing = false; rig.Step(1500);
                Check(rig.Ex.Played == 1 && !rig.Ex.HasActiveRun, "first played");
                rig.Start("t2", gen: 2); rig.Frame("t2", gen: 2); rig.Step(100);
                Check(rig.Ex.Rejected("global_cooldown") == 1, "second gesture within 12s refused");
                rig.Step(25000);
                rig.Start("t3", gen: 3); rig.Frame("t3", gen: 3, reaction: "facepalm"); rig.Step(100);
                Check(rig.Ex.Rejected("reaction_cooldown") == 1, "same reaction on same ped inside 60s refused");
                rig.Start("t4", gen: 4); rig.Frame("t4", gen: 4, reaction: "middle_finger"); rig.Step(100);
                Check(rig.Ex.HasActiveRun, "other reaction allowed after global+ped windows");
                rig.Step(1300);
                var args = NativeFunction.Args[rig.Calls.LastIndexOf("TASK_PLAY_ANIM")];
                Check(((string)args[1]).Contains("finger"), "middle finger clip");
                Check((int)args[5] <= 1500, "middle finger capped at 1.5 s");
            }
        });

        Run("executor: repeated native faults disable it permanently and detach", () =>
        {
            int before = NpcPlaybackCoordinator.Subscribers;
            using (var rig = new Rig("on", o => { o.GlobalCooldownMs = 0; o.PedCooldownMs = 0; o.SameReactionMs = 0; }))
            {
                rig.Throwing.Add("IS_PED_INJURED");
                for (int i = 1; i <= 3; i++)
                {
                    rig.Start("t" + i, gen: i); rig.Frame("t" + i, gen: i); rig.Step(0); rig.Step(1300);
                }
                Check(rig.Ex.Disabled, "disabled after 3 faults");
                Check(NpcPlaybackCoordinator.Subscribers == before, "unsubscribed");
                rig.Throwing.Clear();
                rig.Start("t9", gen: 9); rig.Frame("t9", gen: 9); rig.Step(2000);
                Check(rig.Count("TASK_PLAY_ANIM") == 0, "stays off");
            }
        });

        Run("executor: callback flood fails closed and recovers for later lines", () =>
        {
            using (var rig = new Rig("on"))
            {
                for (int i = 0; i < 40; i++) rig.Start("flood" + i, ped: new Ped { Handle = (uint)(100 + i) });
                rig.Step(10);
                Check(rig.Ex.Rejected("callback_overflow") == 1, "overflow noticed");
                rig.Start("t1"); rig.Frame("t1"); rig.Step(0); rig.Step(1300);
                Check(rig.Count("TASK_PLAY_ANIM") == 1, "normal operation resumes");
            }
        });

        Run("executor: shutdown unsubscribes, stops the clip and disposes the transport", () =>
        {
            int before = NpcPlaybackCoordinator.Subscribers;
            var rig = new Rig("on");
            rig.StartAndPlay("t1");
            rig.Ex.Shutdown();
            Check(NpcPlaybackCoordinator.Subscribers == before, "unsubscribed");
            Check(rig.Count("STOP_ANIM_TASK") == 1 && rig.Transport.Disposed && !rig.Ex.HasActiveRun, "cleaned up");
            rig.Dispose();
        });

        Run("executor: malformed frames are dropped without effect", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.Start("t1");
                var bad = MakeFrame("4242", "t1", 1, "facepalm", Host, 1); bad["text"] = "extra";
                rig.Transport.In.Enqueue(new KeyValuePair<IDictionary<string, object>, long>(bad, rig.Now));
                rig.Transport.In.Enqueue(new KeyValuePair<IDictionary<string, object>, long>(new Dictionary<string, object>(), rig.Now));
                rig.Transport.In.Enqueue(new KeyValuePair<IDictionary<string, object>, long>(MakeFrame("4242", "t1", 1, "wave", Host, 1), rig.Now));
                rig.Step(2000);
                Check(!rig.Ex.HasActiveRun && rig.Count("TASK_PLAY_ANIM") == 0, "nothing runs");
                Check(rig.Ex.Rejected("unknown_reaction") == 1 && rig.Ex.Rejected("frame_invalid") == 2, "counted");
            }
        });

        Run("executor on: enabled nod plays the male or female ambient gesture clip, upper-body and finite", () =>
        {
            foreach (var male in new[] { true, false })
            {
                using (var rig = new Rig("on", o => o.Enabled.Add("nod")))
                {
                    rig.Ped.IsMale = male;
                    rig.Start("t1"); rig.Frame("t1", reaction: "nod");
                    rig.Step(0); rig.Step(800); rig.Playing = true; rig.Step(200);
                    int i = rig.Calls.IndexOf("TASK_PLAY_ANIM");
                    Check(i >= 0, "played");
                    var args = NativeFunction.Args[i];
                    Check((string)args[1] == (male ? "gestures@m@standing@casual" : "gestures@f@standing@casual") && (string)args[2] == "gesture_nod_yes_soft", "clip for gender");
                    Check((int)args[6] == 48 && (int)args[5] > 0 && (int)args[5] <= 1400, "flags and finite duration");
                    Check(rig.Ex.Played == 1 && rig.Transport.LastStatus() == "played", "confirmed");
                }
            }
        });

        Run("executor on: a missing female dictionary falls back to the male clip, and no dictionary skips quietly", () =>
        {
            using (var rig = new Rig("on", o => o.Enabled.Add("shrug")))
            {
                rig.Ped.IsMale = false;
                rig.DictFilter = d => d.Contains("@m@");
                rig.Start("t1"); rig.Frame("t1", reaction: "shrug");
                rig.Step(0); rig.Step(1000); rig.Step(50);
                var args = NativeFunction.Args[rig.Calls.IndexOf("TASK_PLAY_ANIM")];
                Check((string)args[1] == "gestures@m@standing@casual" && (string)args[2] == "gesture_shrug_soft", "male fallback");
            }
            using (var rig = new Rig("on", o => o.Enabled.Add("shrug")))
            {
                rig.DictExists = false;
                rig.Start("t1"); rig.Frame("t1", reaction: "shrug");
                rig.Step(0); rig.Step(1000);
                Check(rig.Count("TASK_PLAY_ANIM") == 0 && rig.Transport.LastStatus() == "skipped" && rig.Transport.LastReason() == "no_clip", "no_clip, no fault");
                Check(!rig.Ex.Disabled, "not a native fault");
            }
        });

        Run("executor: nod/shrug are refused without native opt-in, in shadow and on, and touch no ped native", () =>
        {
            foreach (var mode in new[] { "shadow", "on" })
            {
                using (var rig = new Rig(mode))
                {
                    rig.Start("t1"); rig.Frame("t1", reaction: "nod"); rig.Step(2000);
                    Check(rig.Transport.LastStatus() == "rejected" && rig.Transport.LastReason() == "reaction_not_enabled", mode + " refused");
                    Check(rig.Calls.Count == 0 && !rig.Ex.HasActiveRun && rig.Ex.Rejected("reaction_not_enabled") == 1, mode + " no natives at all");
                }
            }
            using (var rig = new Rig("shadow", o => o.Enabled.Add("nod")))
            {
                rig.StartAndPlay("t1", "nod");
                Check(rig.Transport.LastStatus() == "shadow" && rig.Count("TASK_PLAY_ANIM") == 0 && rig.Count("REQUEST_ANIM_DICT") == 0, "enabled nod is shadow-only in shadow");
            }
        });

        Run("executor on: nod interrupted by the line stops only its own clip", () =>
        {
            using (var rig = new Rig("on", o => o.Enabled.Add("nod")))
            {
                rig.Start("t1"); rig.Frame("t1", reaction: "nod");
                rig.Step(0); rig.Step(800); rig.Playing = true; rig.Step(200);
                rig.End("t1", interrupted: true); rig.Step(50);
                var args = NativeFunction.Args[rig.Calls.IndexOf("STOP_ANIM_TASK")];
                Check(rig.Count("STOP_ANIM_TASK") == 1 && (string)args[1] == "gestures@m@standing@casual" && (string)args[2] == "gesture_nod_yes_soft", "clip-scoped stop");
            }
        });

        Run("diagnostics: off by default; on reports each candidate once per reaction and gender, plus facial dictionary existence only", () =>
        {
            using (var rig = new Rig("on"))
            {
                rig.StartAndPlay("t1");
                Check(!rig.Logs.Any(l => l.Contains("probe")) && !rig.Logs.Any(l => l.Contains("clip=")), "silent without diagnostics");
            }
            using (var rig = new Rig("on", o => o.Diagnostics = true))
            {
                rig.DictFilter = d => d != "anim@mp_player_intcelebrationmale@face_palm";
                rig.StartAndPlay("t1");
                var probe = rig.Logs.Where(l => l.StartsWith("[RX] probe reaction=facepalm")).ToList();
                Check(probe.Count == 1 && probe[0].Contains("gender=m") && probe[0].Contains("anim@mp_player_intupperface_palm/idle_a=loaded")
                    && probe[0].Contains("face_palm/face_palm=missing"), "candidate states: " + string.Join("|", probe));
                Check(rig.Logs.Count(l => l.StartsWith("[RX] probe_facial")) == 1 && rig.Logs.Any(l => l.Contains("mp_facial=exists") && l.Contains("existence only")), "facial existence line");
                Check(rig.Logs.Any(l => l.StartsWith("[RX] played reaction=facepalm clip=anim@mp_player_intupperface_palm/idle_a ms=")), "played line names the winning clip");
                // second turn for the same reaction and gender: no repeated probe lines
                rig.End("t1"); rig.Step(3000); rig.Playing = false; rig.Step(3000);
                rig.Now += 70000; rig.Start("t2", 2); rig.Frame("t2", 2); rig.Step(0); rig.Step(1300); rig.Playing = true; rig.Step(200);
                Check(rig.Logs.Count(l => l.StartsWith("[RX] probe reaction=facepalm")) == 1 && rig.Logs.Count(l => l.StartsWith("[RX] probe_facial")) == 1, "probed once per session");
                Check(rig.Logs.All(l => !l.Contains("hello") && !l.Contains("dialogue")), "no dialogue in logs");
            }
        });

        Run("diagnostics: shadow probe reads only (exists/loaded) and never plays or requests", () =>
        {
            using (var rig = new Rig("shadow", o => { o.Diagnostics = true; o.Enabled.Add("shrug"); }))
            {
                rig.Ped.IsMale = false;
                rig.StartAndPlay("t1", "shrug");
                Check(rig.Logs.Any(l => l.StartsWith("[RX] probe reaction=shrug gender=f")), "probe line");
                foreach (var native in new[] { "TASK_PLAY_ANIM", "REQUEST_ANIM_DICT", "STOP_ANIM_TASK", "REMOVE_ANIM_DICT", "GET_ANIM_DURATION" })
                    Check(rig.Count(native) == 0, "no " + native);
            }
        });

        // ---- everything the executor ever did, across all scenarios
        Run("across all scenarios: only allow-listed, non-clearing natives were ever invoked", () =>
        {
            var forbidden = new[] { "CLEAR_PED_TASKS", "CLEAR_PED_TASKS_IMMEDIATELY", "CLEAR_PED_SECONDARY_TASK", "SET_ENTITY_COORDS", "SET_ENTITY_HEADING", "TASK_TURN_PED_TO_FACE_ENTITY", "TASK_LOOK_AT_ENTITY", "REMOVE_ALL_PED_WEAPONS", "SET_CURRENT_PED_WEAPON" };
            foreach (var native in forbidden) Check(!everCalled.Contains(native), native);
            Check(everCalled.Contains("TASK_PLAY_ANIM") && everCalled.Contains("STOP_ANIM_TASK"), "sanity: scenarios exercised the play/stop path");
            Console.WriteLine("     natives exercised: " + string.Join(", ", everCalled.OrderBy(x => x)));
        });

        Console.WriteLine();
        Console.WriteLine(failures == 0 ? "ALL PASSED (" + passed + " tests)" : "FAILURES: " + failures + " (passed " + passed + ")");
        return failures == 0 ? 0 : 1;
    }
}
