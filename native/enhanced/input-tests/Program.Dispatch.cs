using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;

static partial class Program
{
    sealed class Rig
    {
        public readonly FakeClock Clock = new FakeClock();
        public readonly FakeHud Hud = new FakeHud();
        public readonly FakeInjector Injector = new FakeInjector();
        public readonly FakeBridge Bridge = new FakeBridge();
        public readonly FakeCompanion Companion = new FakeCompanion();
        public readonly FakeKeys Keys = new FakeKeys();
        public readonly FakeGame Game = new FakeGame();
        public readonly LoaderDispatcher Dispatcher;
        public readonly List<string> Logs = new List<string>();
        public EnhancedSettings Settings;
        public EssentialBindings Essential = EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F10"});
        public InputRouter Router;
        public Rig(string settings = "{\"version\":1,\"input\":{\"enabled\":true}}")
        {
            Settings = Program.Settings(settings);
            Dispatcher = new LoaderDispatcher(catalog,Bridge,Companion,Hud,new EssentialKeyRelay(Injector),Clock) {Settings = () => Settings,Essential = () => Essential};
            Router = new InputRouter(Keys,Game,Dispatcher,Bridge,Clock,Hud,Logs.Add);
        }
        public void Fresh(Dictionary<string,object> current,Dictionary<string,object> gates = null) => Bridge.SetSnapshot(Clock.Utc,current,gates);
        public Dictionary<string,object> Current = FakeBridge.Owned();
        public Dictionary<string,object> GateState;
        // One 10 ms frame: the runtime keeps refreshing its snapshot while asked.
        public void Frame(int frames = 1) { for (int index = 0; index < frames; index++) { Clock.Advance(10); Fresh(Current,GateState); Router.Tick(); } }
        public void Hold(int vk,int ms) { Keys.Down.Add(vk); Frame(ms / 10); Keys.Down.Remove(vk); Frame(1); }
        public void Chord(int first,int second,int gapMs,int holdMs) { Keys.Down.Add(first); Frame(gapMs / 10); Keys.Down.Add(second); Frame(holdMs / 10); Keys.Down.Clear(); Frame(1); }
    }
    const int F6 = 0x75,F8 = 0x77,F11 = 0x7A;

    static void DispatcherTests()
    {
        var rig = new Rig(); var d = rig.Dispatcher;
        Check(d.Dispatch(CommandCatalog.EssentialMark,"chord") == null && rig.Injector.Calls.SequenceEqual(new[] {"down:F9"}) && rig.Hud.Shown.Count == 0,"mark relays Essential's MarkPedKey without a HUD line");
        rig.Clock.Advance(80); d.Update(); Check(rig.Injector.Calls.Last() == "up:F9","relay key-up from the dispatcher update");
        Check(d.Dispatch(CommandCatalog.EssentialText,"chord") == null && rig.Injector.Calls.Last() == "down:Mouse5","text relays Essential's TextKey");
        rig.Clock.Advance(100); d.Update();
        rig.Essential = EssentialBindings.Parse(new[] {"TextKey=None"});
        Check(d.Dispatch(CommandCatalog.EssentialText,"chord") == "essential_key_unbound" && rig.Hud.Last == "Bind this key in Essential's F7 menu","unbound Essential key explained");
        rig.Essential = EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F10"});

        var r = new Rig(); d = r.Dispatcher;
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == "native_unavailable" && r.Hud.Last == "LSA native host is unavailable" && r.Bridge.Interest == 1,"no snapshot: host unavailable, and interest is requested");
        r.Clock.Advance(1000); r.Bridge.SetSnapshot(r.Clock.Utc - 5000,FakeBridge.Owned());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == "native_unavailable","a stale snapshot is not trusted");
        r.Clock.Advance(1000); r.Fresh(FakeBridge.Absent());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == "no_current_npc" && r.Hud.Last == "No current NPC","no current NPC");
        r.Clock.Advance(1000); r.Fresh(FakeBridge.Owned());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == null && r.Companion.Last["action"] as string == "control_current" && r.Companion.Last["operation"] as string == "follow" && r.Companion.Last["expectedEncounterId"] as string == FakeBridge.Encounter && r.Companion.Last.Count == 3,"a promoted NPC follows through P2 control_current, naming the NPC the player saw");
        r.Companion.Reply(true); d.Update(); Check(r.Hud.Last == "Following" && d.Outstanding == 0,"P2 follow confirmed on the HUD");
        r.Clock.Advance(1000); d.Dispatch(CommandCatalog.CurrentFollow,"chord"); r.Companion.Reply(false,"character_not_promoted"); d.Update();
        Check(r.Hud.Last == "Promote this NPC first","companion failure reasons come from the catalog");
        r.Clock.Advance(1000); r.Fresh(FakeBridge.Ordinary());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == null,"an ordinary NPC is asked");
        var envelope = r.Bridge.LastEnvelope; var target = (Dictionary<string,object>)envelope["target"]; var args = (Dictionary<string,object>)envelope["args"];
        Check(envelope["command"] as string == "npc.ask" && envelope["source"] as string == "chord" && ((Dictionary<string,object>)target["expect"])["encounterId"] as string == FakeBridge.Encounter && args["phrase"] as string == "Follow me.","ask envelope carries the expected encounter and the configured phrase");
        Check(Convert.ToInt64(envelope["expiresAtUtc"]) - Convert.ToInt64(envelope["issuedAtUtc"]) == 4000 && envelope.Count == 8,"exact CommandEnvelope v1 fields and a 4 s lifetime");
        r.Bridge.Complete(null); d.Update(); Check(r.Hud.Last == "Asked to follow","ask confirmed on the HUD");
        r.Clock.Advance(1000); d.Dispatch(CommandCatalog.CurrentFollow,"chord"); r.Bridge.Complete("target_changed"); d.Update();
        Check(r.Hud.Last == "The current NPC changed","runtime rejection explained");
        int submitted = r.Bridge.Submitted.Count;
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == "cooldown" && r.Bridge.Submitted.Count == submitted && r.Hud.Last == "The current NPC changed","a repeat within 750 ms is ignored silently");
        r.Clock.Advance(750); r.Fresh(FakeBridge.Ordinary());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == null && r.Bridge.Submitted.Count == submitted + 1,"accepted again after the cooldown");
        Check(d.Dispatch(CommandCatalog.CurrentWait,"chord") == "command_busy" && r.Hud.Last == "Still working on the last request","one outstanding control command");
        r.Clock.Advance(6001); d.Update(); Check(r.Hud.Last == "The request expired; the game must be running" && d.Outstanding == 0,"bridge results time out");
        r.Bridge.NextSubmitReply = "queue_full"; r.Clock.Advance(1000); r.Fresh(FakeBridge.Ordinary());
        Check(d.Dispatch(CommandCatalog.CurrentWait,"chord") == "queue_full" && r.Hud.Last == "Too many requests" && d.Outstanding == 0,"bridge refusal explained");
        r.Bridge.NextSubmitReply = "accepted"; r.Clock.Advance(1000); r.Fresh(FakeBridge.Owned());
        d.Dispatch(CommandCatalog.CurrentWait,"chord"); r.Clock.Advance(12001); d.Update();
        Check(r.Hud.Last == "AI companion is unavailable" && d.Outstanding == 0,"companion requests time out");
        int shown = r.Hud.Shown.Count; r.Companion.Reply(true); d.Update();
        Check(r.Hud.Shown.Count == shown,"a late companion reply is ignored");

        var o = new Rig("{\"version\":1,\"input\":{\"enabled\":true},\"quickCommands\":{\"ordinaryNpc\":\"off\"}}"); o.Fresh(FakeBridge.Ordinary());
        Check(o.Dispatcher.Dispatch(CommandCatalog.CurrentFollow,"chord") == "promote_first" && o.Hud.Last == "Promote this NPC first","ordinaryNpc off asks for promotion");
        var dismiss = new Rig(); dismiss.Fresh(FakeBridge.Ordinary());
        Check(dismiss.Dispatcher.Dispatch(CommandCatalog.CurrentDismiss,"menu") == null && ((Dictionary<string,object>)dismiss.Bridge.LastEnvelope["args"])["phrase"] as string == "That's all, you can go.","dismissing an ordinary NPC asks them to go");
        var quiet = new Rig("{\"version\":1,\"quickCommands\":{\"phrases\":{\"dismiss\":\"\"}}}"); quiet.Fresh(FakeBridge.Ordinary());
        Check(quiet.Dispatcher.Dispatch(CommandCatalog.CurrentDismiss,"menu") == "promote_first","an empty dismissal phrase turns the ask off");

        var c = new Rig(); d = c.Dispatcher;
        Check(d.Dispatch(CommandCatalog.CurrentPromote,"menu") == "native_unavailable" && c.Companion.Bodies.Count == 0,"promotion needs Essential's current NPC from the runtime");
        c.Fresh(FakeBridge.Ordinary());
        Check(d.Dispatch(CommandCatalog.CurrentPromote,"menu") == null && c.Companion.Last["action"] as string == "promote" && c.Companion.Last["expectedEncounterId"] as string == FakeBridge.Encounter && c.Companion.Last.Count == 2,"promotion goes to the companion and names the NPC the player saw");
        c.Companion.Reply(true); d.Update(); Check(c.Hud.Last == "Promoted","promotion confirmed");
        const string id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",memory = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        c.Clock.Advance(1000);
        Check(d.Dispatch(CommandCatalog.CharacterSummon,"menu",new CommandArgs {CharacterId = id}) == null && c.Companion.Last["action"] as string == "control" && c.Companion.Last["operation"] as string == "summon" && c.Companion.Timeouts.Last() == 70000,"summon waits for the game");
        c.Companion.Reply(true); d.Update(); c.Clock.Advance(1000);
        string doneReason = "unset",doneBody = null;
        d.Dispatch(CommandCatalog.CharacterRename,"menu",new CommandArgs {CharacterId = id,ExpectedRevision = 3,Text = "  Alex  ",OnDone = (reason,body) => { doneReason = reason; doneBody = body; }});
        var patch = (Dictionary<string,object>)c.Companion.Last["patch"];
        Check(c.Companion.Last["action"] as string == "edit" && Convert.ToInt64(c.Companion.Last["expectedRevision"]) == 3 && patch["name"] as string == "Alex" && patch.Count == 1,"rename sends a one-field edit with the revision");
        c.Companion.Reply(true,null,"{\"revision\":4}"); d.Update(); Check(doneReason == null && doneBody == "{\"revision\":4}" && c.Hud.Last == "Renamed","OnDone receives the updated profile");
        foreach (var bad in new[] {"","   ","a\u0001b",new string('x',81)}) { c.Clock.Advance(1000); Check(d.Dispatch(CommandCatalog.CharacterRename,"menu",new CommandArgs {CharacterId = id,Text = bad}) == "invalid_text","invalid name rejected before the companion"); }
        c.Clock.Advance(1000); d.Dispatch(CommandCatalog.CharacterRelationship,"menu",new CommandArgs {CharacterId = id,ExpectedRevision = 4,Value = "friend",Text = "Old friend"});
        var relationship = (Dictionary<string,object>)((Dictionary<string,object>)c.Companion.Last["patch"])["relationship"];
        Check(relationship["state"] as string == "friend" && relationship["description"] as string == "Old friend","relationship keeps its description");
        c.Companion.Reply(true); d.Update(); c.Clock.Advance(1000);
        Check(d.Dispatch(CommandCatalog.CharacterRelationship,"menu",new CommandArgs {CharacterId = id,Value = "lover"}) == "invalid_profile_edit","unknown relationship state rejected");
        c.Clock.Advance(1000); d.Dispatch(CommandCatalog.CharacterAvailability,"menu",new CommandArgs {CharacterId = id,ExpectedRevision = 5,Value = "retired"});
        Check(((Dictionary<string,object>)c.Companion.Last["patch"])["status"] as string == "retired","availability edits the status field");
        c.Companion.Reply(true); d.Update(); c.Clock.Advance(1000);
        Check(d.Dispatch(CommandCatalog.CharacterAvailability,"menu",new CommandArgs {CharacterId = id,Value = "missing"}) == "invalid_profile_edit","unknown availability rejected");
        c.Clock.Advance(1000); d.Dispatch(CommandCatalog.CharacterMemorySelect,"menu",new CommandArgs {CharacterId = id,MemoryId = memory,ExpectedRevision = 6,Flag = true});
        Check(c.Companion.Last["action"] as string == "memory" && c.Companion.Last["operation"] as string == "edit" && c.Companion.Last["memoryId"] as string == memory && (bool)((Dictionary<string,object>)c.Companion.Last["patch"])["selectedForContext"],"memory selection toggles one flag");
        c.Companion.Reply(true); d.Update(); c.Clock.Advance(1000);
        Check(d.Dispatch(CommandCatalog.CharacterMemorySelect,"menu",new CommandArgs {CharacterId = id,MemoryId = "nope"}) == "memory_missing","invalid memory id rejected");
        c.Clock.Advance(1000); d.Dispatch(CommandCatalog.CharacterMemoryAdd,"menu",new CommandArgs {CharacterId = id,ExpectedRevision = 7,Text = " Meet at the pier "});
        var created = (Dictionary<string,object>)c.Companion.Last["patch"];
        Check(c.Companion.Last["operation"] as string == "create" && created["text"] as string == "Meet at the pier" && (bool)created["selectedForContext"] == false,"short memory added unselected");
        c.Companion.Reply(true); d.Update(); c.Clock.Advance(1000);
        Check(d.Dispatch(CommandCatalog.CharacterFollow,"menu",new CommandArgs {CharacterId = "not-a-uuid"}) == "character_missing","invalid character id rejected");
        string immediate = "unset"; c.Clock.Advance(1000);
        d.Dispatch(CommandCatalog.CharacterDespawn,"menu",new CommandArgs {CharacterId = "x",OnDone = (reason,body) => immediate = reason});
        Check(immediate == "character_missing","OnDone also reports immediate rejections");
        Check(d.Dispatch(CommandCatalog.UiQuickMenu,"chord") == "menu_unavailable" && c.Hud.Last == "LSA menu is unavailable","menu commands need the native menu");
        var ui = new FakeUi(); d.Ui = ui;
        d.Dispatch(CommandCatalog.UiQuickMenu,"chord"); d.Dispatch(CommandCatalog.UiMainMenu,"key");
        Check(ui.Toggles.SequenceEqual(new[] {"current","main"}),"quick menu opens the current NPC page; main menu the root");
        c.Clock.Advance(1000); c.Fresh(FakeBridge.Ordinary());
        Check(d.Dispatch(CommandCatalog.NpcAsk,"menu",new CommandArgs {Phrase = "Meet me at the docks."}) == null && ((Dictionary<string,object>)c.Bridge.LastEnvelope["args"])["phrase"] as string == "Meet me at the docks.","custom asks use the player's phrase");
        c.Bridge.Complete(null); d.Update(); c.Clock.Advance(1000);
        Check(d.Dispatch(CommandCatalog.NpcAsk,"menu",new CommandArgs {Phrase = "bad\nphrase"}) == "invalid_text","invalid ask phrase rejected");
        for (int index = 0; index < 15; index++) { c.Clock.Advance(1000); d.Dispatch(CommandCatalog.CharacterFollow,"menu",new CommandArgs {CharacterId = "x"}); }
        Check(d.RecentReasons.Count == LoaderDispatcher.RecentLimit && d.RecentReasons.All(item => item == "character.follow: character_missing"),"diagnostics keep the last 10 reasons");
    }

    static void RouterTests()
    {
        var rig = new Rig(); rig.Router.Apply(rig.Settings,rig.Essential);
        Check(rig.Router.State == "ready" && rig.Router.ActiveBindings.Count == 3 && rig.Logs.Contains("[UX] input_latency L4=120ms R4=120ms Menu=0ms"),"without the native menu the ui bindings are dropped, so the chord fires on press");
        rig.Frame(5);
        for (int round = 0; round < 20; round++) { rig.Hold(F6,60); rig.Frame(20); }
        for (int round = 0; round < 20; round++) { rig.Hold(F8,60); rig.Frame(20); }
        Check(rig.Injector.Presses("F9") == 20 && rig.Injector.Presses("Mouse5") == 20 && rig.Companion.Bodies.Count == 0,"20 taps each give 20 marks and 20 text prompts");
        int relays = rig.Injector.Calls.Count;
        for (int round = 0; round < 20; round++) {
            if (round % 2 == 0) rig.Chord(F6,F8,30,150); else rig.Chord(F8,F6,30,150);
            if (rig.Companion.Pending > 0) rig.Companion.Reply(true);
            rig.Frame(80);
        }
        Check(rig.Injector.Calls.Count == relays && rig.Companion.Bodies.Count == 20 && rig.Companion.Bodies.All(body => body.Contains("\"control_current\"") && body.Contains("\"follow\"")),"20 chords in both orders give zero marks, zero texts and 20 follows");
        rig.Keys.Down.Add(F6); rig.Keys.Down.Add(F8); rig.Frame(500); rig.Keys.Down.Clear(); rig.Frame(1);
        Check(rig.Companion.Bodies.Count == 21,"a 5 s chord hold gives exactly one follow");
        rig.Companion.Reply(true); rig.Frame(80);

        int before = rig.Injector.Calls.Count;
        rig.Game.ConsoleOpen = true; rig.Hold(F6,60); rig.Game.ConsoleOpen = false; rig.Frame(10);
        rig.Game.Paused = true; rig.Hold(F6,60); rig.Game.Paused = false; rig.Frame(10);
        rig.GateState = FakeBridge.Gates(textInput: true); rig.Frame(20); rig.Hold(F8,60); rig.Frame(10);
        rig.GateState = FakeBridge.Gates(menu: true); rig.Frame(20); rig.Hold(F6,60); rig.Frame(10);
        rig.GateState = FakeBridge.Gates(cutscene: true); rig.Frame(20); rig.Hold(F6,60); rig.Frame(10);
        rig.GateState = FakeBridge.Gates(loading: true); rig.Frame(20); rig.Hold(F6,60); rig.Frame(10);
        rig.GateState = FakeBridge.Gates(playerSwitch: true); rig.Frame(20); rig.Hold(F6,60);
        rig.GateState = null; rig.Frame(20);
        rig.Keys.Focus = false; rig.Hold(F6,60); rig.Keys.Focus = true; rig.Frame(10);
        Check(rig.Injector.Calls.Count == before,"nothing fires with the console, pause, text input, the F7 menu, cutscenes, loading, switches or focus loss");
        rig.Keys.Down.Add(F6); rig.Frame(3); rig.Keys.Focus = false; rig.Frame(3); rig.Keys.Down.Add(F8); rig.Frame(3); rig.Keys.Focus = true; rig.Frame(30);
        Check(rig.Injector.Calls.Count == before && rig.Companion.Bodies.Count == 21,"alt-tab mid-chord fires nothing while keys stay held");
        rig.Keys.Down.Clear(); rig.Frame(2); rig.Hold(F6,60); rig.Frame(10);
        Check(rig.Injector.Presses("F9") == 21,"nothing stuck: the next tap marks normally");
        Check(rig.Bridge.Interest >= 10,"snapshot interest is kept alive while focused");

        var conflict = new Rig(); conflict.Essential = EssentialBindings.Parse(new[] {"MarkPedKey=F6","TextKey=Mouse5"});
        conflict.Router.Apply(conflict.Settings,conflict.Essential);
        conflict.Frame(2); conflict.Hold(F6,60); conflict.Frame(10);
        Check(conflict.Router.State == "suspended" && conflict.Hud.Shown.Contains("Input paused: F6 is also Essential's MarkPedKey") && conflict.Injector.Calls.Count == 0,"a router key equal to an Essential key suspends the router");

        var menu = new Rig("{\"version\":1,\"input\":{\"enabled\":true},\"ui\":{\"enabled\":true}}"); var ui = new FakeUi();
        menu.Dispatcher.Ui = ui; menu.Router.UiAvailable = () => ui.Available; menu.Router.MenuOpen = () => ui.AnyMenuOpen;
        menu.Router.Apply(menu.Settings,menu.Essential);
        Check(menu.Router.ActiveBindings.Count == 5,"with the native menu all default bindings are active");
        menu.Frame(2); menu.Hold(F11,50); menu.Frame(5);
        Check(ui.Toggles.SequenceEqual(new[] {"main"}) && ui.AnyMenuOpen,"the menu key opens the main menu on press");
        menu.Hold(F6,60); menu.Frame(10); menu.Chord(F6,F8,20,100); menu.Frame(10);
        Check(menu.Injector.Calls.Count == 0 && menu.Companion.Bodies.Count == 0,"while a menu is open gestures other than menu toggles are dropped");
        menu.Keys.Down.Add(F6); menu.Keys.Down.Add(F8); menu.Frame(70); menu.Keys.Down.Clear(); menu.Frame(2);
        Check(ui.Toggles.SequenceEqual(new[] {"main","current"}) && !ui.AnyMenuOpen,"the chord-hold toggles the quick menu even while a menu is open");
        menu.Chord(F6,F8,20,100); menu.Frame(5);
        Check(menu.Companion.Bodies.Count == 1,"with the quick menu bound, a short chord follows on release");

        var off = new Rig("{\"version\":1}"); off.Router.Apply(off.Settings,off.Essential); off.Frame(2); off.Hold(F6,60);
        Check(off.Router.State == "disabled" && off.Injector.Calls.Count == 0,"input disabled by default");
    }
}
