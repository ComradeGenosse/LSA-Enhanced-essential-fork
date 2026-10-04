using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using LSA.Enhanced.Companion;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;
using LSA.Enhanced.Ui;

// UX phase 3: pure view models, the companion data client and the RNUI-free
// UI bridge. The RNUI menus themselves only render these lines (GTA gate).
static partial class Program
{
    const string CharacterA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CharacterB = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb", MemoryA = "cccccccc-cccc-4ccc-acc0-cccccccccccc";
    static string Resource(string name)
    {
        using (var stream = typeof(Program).Assembly.GetManifestResourceStream(name)) using (var reader = new StreamReader(stream)) return reader.ReadToEnd();
    }
    static Dictionary<string,object> Profile(string id,string name,long revision,string status = "available",string runtimeStatus = null,string relationship = "associate",params Dictionary<string,object>[] memories)
    {
        var profile = new Dictionary<string,object> {{"profileVersion",1},{"characterId",id},{"revision",revision},{"name",name},{"nicknames",new object[0]},{"biography","Private biography"},
            {"playerNotes","Private notes"},{"relationship",new Dictionary<string,object> {{"state",relationship},{"description","Met at the pier"}}},{"voiceReference",new Dictionary<string,object> {{"voice","ash"}}},
            {"status",status},{"memories",memories.Cast<object>().ToArray()}};
        if (runtimeStatus != null) profile["runtimeStatus"] = runtimeStatus;
        return profile;
    }
    static Dictionary<string,object> Memory(string id,string text,bool selected,int importance = 50) =>
        new Dictionary<string,object> {{"memoryId",id},{"text",text},{"category","event"},{"importance",importance},{"selectedForContext",selected},{"editable",true}};
    static MenuLine Line(IEnumerable<MenuLine> lines,string key) => lines.FirstOrDefault(line => line.Key == key);
    static NativeSnapshot SnapshotOf(long builtAtUtc,Dictionary<string,object> current)
    {
        var bridge = new FakeBridge(); bridge.SetSnapshot(builtAtUtc,current); return NativeSnapshot.Parse(bridge.SnapshotJson);
    }

    static partial void ViewModelTests()
    {
        ExampleSettingsTests();
        CurrentNpcTests();
        DescribeTests();
        CharacterListTests();
        MenuDataTests();
        CompanionClientTests();
        ControlsAndDiagnosticsTests();
        AiVoiceTests();
        UiBridgeTests();
        SessionOverrideTests();
    }

    static void ExampleSettingsTests()
    {
        var example = Settings(Resource("LSA.Enhanced.example.json"));
        var defaults = EnhancedSettings.Defaults(catalog);
        Check(!example.InputEnabled && !example.UiEnabled,"the packaged example keeps input and the menu off");
        Check(example.KeyNames.SequenceEqual(defaults.KeyNames) && example.KeyCodes.SequenceEqual(defaults.KeyCodes) && example.Timing.ChordWindowMs == defaults.Timing.ChordWindowMs && example.Timing.HoldMs == defaults.Timing.HoldMs
            && example.Timing.DoubleTapMs == defaults.Timing.DoubleTapMs && example.RelayPulseMs == defaults.RelayPulseMs && example.CommandCooldownMs == defaults.CommandCooldownMs,"the example spells out the default keys and timing");
        Check(example.Bindings.Select(binding => binding.Id + binding.Kind + binding.Mask + binding.Command).SequenceEqual(defaults.Bindings.Select(binding => binding.Id + binding.Kind + binding.Mask + binding.Command))
            && example.OrdinaryNpc == defaults.OrdinaryNpc && example.Phrases.OrderBy(pair => pair.Key).SequenceEqual(defaults.Phrases.OrderBy(pair => pair.Key)) && example.Hud == defaults.Hud,"the example spells out the default bindings, phrases and HUD");
    }

    static void CurrentNpcTests()
    {
        long now = 1_800_000_000_000;
        var settings = EnhancedSettings.Defaults(catalog);
        var offline = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Owned()),now,null,false,true,settings);
        Check(offline.Lines.Count == 1 && offline.Lines[0].Right == "Unavailable" && !offline.Present,"host unavailable: one status line, no actions");
        var stale = CurrentNpcView.Build(SnapshotOf(now - 5000,FakeBridge.Owned()),now,null,true,true,settings);
        Check(stale.Lines.Count == 1 && stale.Lines[0].Right == "Waiting for the game" && !stale.Present,"a stale snapshot waits for the game instead of guessing");
        var none = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Absent()),now,null,true,true,settings);
        Check(none.Lines.Count == 1 && none.Lines[0].Text == "No current NPC","no current NPC");

        var ordinary = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Ordinary()),now,null,true,true,settings);
        Check(ordinary.Present && !ordinary.Owned && ordinary.Title == "Current NPC" && Line(ordinary.Lines,"type").Right == "Not promoted","ordinary NPC without a name yet");
        Check(Line(ordinary.Lines,"promote").Command == CommandCatalog.CurrentPromote && Line(ordinary.Lines,"promote").Enabled && Line(ordinary.Lines,"promote").Confirm,"promotion needs a second select");
        Check(Line(ordinary.Lines,"askFollow").Command == CommandCatalog.CurrentFollow && Line(ordinary.Lines,"askFollow").Description.Contains("\"Follow me.\"") && Line(ordinary.Lines,"askWait").Command == CommandCatalog.CurrentWait,"ordinary NPCs are asked in character");
        Check(Line(ordinary.Lines,"follow") == null && Line(ordinary.Lines,"dismiss") == null,"no P2 control lines for an ordinary NPC");
        var quiet = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Ordinary()),now,null,true,true,Settings("{\"version\":1,\"quickCommands\":{\"ordinaryNpc\":\"off\"}}"));
        Check(Line(quiet.Lines,"askFollow") == null && Line(quiet.Lines,"promote") != null,"ordinaryNpc off removes the asks");
        var animal = FakeBridge.Ordinary(); animal["human"] = false;
        Check(!Line(CurrentNpcView.Build(SnapshotOf(now,animal),now,null,true,true,settings).Lines,"promote").Enabled,"only human peds can be promoted");
        var named = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Ordinary()),now,Describe.Parse("{\"kind\":\"encounter\",\"name\":\"Maya Lopez\",\"facts\":[\"Street vendor\"],\"voice\":\"nova\"}"),true,true,settings);
        Check(named.Title == "Maya Lopez" && Line(named.Lines,"role").Right == "Street vendor" && Line(named.Lines,"voice").Right == "nova","encounter names, role and voice from the companion");

        var owned = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Owned()),now,Describe.Parse("{\"kind\":\"promoted\",\"name\":\"Lamar Davis\",\"characterId\":\"" + CharacterA + "\",\"relationship\":\"friend\",\"status\":\"available\",\"voice\":\"ash\",\"facts\":[]}"),true,true,settings);
        Check(owned.Owned && owned.Title == "Lamar Davis" && Line(owned.Lines,"mode").Right == "Waiting" && Line(owned.Lines,"relationship").Right == "Friend","promoted name, mode and relationship");
        Check(Line(owned.Lines,"follow").Command == CommandCatalog.CurrentFollow && Line(owned.Lines,"wait").Command == CommandCatalog.CurrentWait && Line(owned.Lines,"dismiss").Confirm && Line(owned.Lines,"promote") == null,"promoted NPCs get Follow, Wait and a confirmed Dismiss");
        var mismatch = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Owned()),now,Describe.Parse("{\"kind\":\"encounter\",\"name\":\"Old name\"}"),true,true,settings);
        Check(mismatch.Title == "Promoted character" && Line(mismatch.Lines,"relationship") == null,"a describe for the wrong kind is ignored");
        var noCompanion = CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Owned()),now,null,true,false,settings);
        Check(Line(noCompanion.Lines,"companion").Right == "Unavailable" && !Line(noCompanion.Lines,"follow").Enabled && !Line(noCompanion.Lines,"dismiss").Enabled,"companion offline: P2 actions disabled and explained");
        var unsafeNpc = FakeBridge.Owned(); unsafeNpc["safe"] = false;
        Check(Line(CurrentNpcView.Build(SnapshotOf(now,unsafeNpc),now,null,true,true,settings).Lines,"blocked").Right == "Blocked now","scripted state is shown");
        Check(owned.Signature != mismatch.Signature && owned.Signature == CurrentNpcView.Build(SnapshotOf(now,FakeBridge.Owned()),now,Describe.Parse("{\"kind\":\"promoted\",\"name\":\"Lamar Davis\",\"characterId\":\"" + CharacterA + "\",\"relationship\":\"friend\",\"voice\":\"ash\"}"),true,true,settings).Signature,"signatures change only with content");
    }

    static void DescribeTests()
    {
        var full = Describe.Parse("{\"kind\":\"promoted\",\"name\":\"Lamar Davis\",\"characterId\":\"" + CharacterA + "\",\"relationship\":\"friend\",\"status\":\"available\",\"voice\":\"ash\",\"facts\":[\"a\",\"b\",\"c\",\"d\"]}");
        Check(full.Kind == "promoted" && full.Name == "Lamar Davis" && full.CharacterId == CharacterA && full.Facts.Length == 3,"describe fields, at most three facts");
        Check(Describe.Parse("{\"kind\":\"promoted\",\"characterId\":\"not-a-uuid\"}").CharacterId == null && Describe.Parse("{\"kind\":\"weird\"}").Kind == "unknown","invalid ids and kinds are dropped");
        Check(Describe.Parse("{\"kind\":\"encounter\",\"name\":\"Bad\\u0007Name\"}").Name == null && Describe.Parse("{\"kind\":\"encounter\",\"name\":\"" + new string('x',81) + "\"}").Name == null,"control characters and overlong names are refused");
        Check(Describe.Parse("not json") == null && Describe.Parse(null) == null && Describe.Parse("[1]") == null,"invalid replies parse to null");
    }

    static void CharacterListTests()
    {
        string list = Json.Serialize(new object[] {
            Profile(CharacterB,"Zed",4,runtimeStatus: "suspended"),
            Profile(CharacterA,"Amy",7,runtimeStatus: "spawned",relationship: "trusted",memories: Memory(MemoryA,"  Met   Amy at the\npier during a storm, she owed me money and a long explanation for everything  ",true,80)),
            Profile("not-a-uuid","Broken",1),
        });
        var rows = CharacterList.Parse(list);
        Check(rows.Count == 2 && rows[0].Name == "Amy" && rows[1].Name == "Zed","roster sorted by name; invalid ids skipped");
        var amy = rows[0];
        Check(amy.Revision == 7 && amy.Spawned && amy.StatusLabel == "In world" && amy.RelationshipState == "trusted" && amy.RelationshipDescription == "Met at the pier" && amy.Voice == "ash" && amy.IdSuffix == "aaaa","profile fields");
        Check(amy.Memories.Count == 1 && amy.Memories[0].Selected && amy.Memories[0].Importance == 80 && amy.Memories[0].Preview.Length == CharacterList.MemoryPreviewChars && amy.Memories[0].Preview.StartsWith("Met Amy at the pier") && amy.Memories[0].Preview.EndsWith("…"),"memory previews are flattened and truncated");
        Check(rows[1].Suspended && rows[1].StatusLabel == "Suspended","suspended runtime status");
        Check(CharacterList.Parse(Json.Serialize(new object[] {Profile(CharacterA,"Old",1,status: "retired")}))[0].StatusLabel == "Retired" && CharacterList.Parse(Json.Serialize(new object[] {Profile(CharacterA,"Gone",1,status: "dead")}))[0].StatusLabel == "Dead"
            && CharacterList.Parse(Json.Serialize(new object[] {Profile(CharacterA,"Home",1)}))[0].StatusLabel == "Absent","availability labels");
        Check(CharacterList.Parse("{}") == null && CharacterList.Parse("oops") == null && CharacterList.Parse("[]").Count == 0,"non-array replies parse to null");

        var actions = CharacterList.Actions(amy,true,true);
        Check(!Line(actions,"summon").Enabled && Line(actions,"follow").Enabled && Line(actions,"dismiss").Confirm && Line(actions,"despawn").Confirm && Line(actions,"despawn").Description.Contains("Amy, …aaaa"),"a spawned character: no summon; dismiss and despawn confirm with name and id suffix");
        var relationship = Line(actions,"relationship");
        Check(relationship.Options.SequenceEqual(CharacterList.Relationships) && relationship.Value == "trusted" && relationship.OptionLabels[2] == "Trusted" && relationship.Command == CommandCatalog.CharacterRelationship,"relationship is a left/right choice");
        Check(Line(actions,"availability").Options.SequenceEqual(CharacterList.Availability) && Line(actions,"availability").Value == "available","availability is a left/right choice");
        var memory = Line(actions,"memory:" + MemoryA);
        Check(memory.Toggle && memory.Value == "on" && memory.Command == CommandCatalog.CharacterMemorySelect && Line(actions,"rename").Command == CommandCatalog.CharacterRename && Line(actions,"memoryAdd").Command == CommandCatalog.CharacterMemoryAdd,"memories are checkboxes; rename and add use the keyboard");
        var absent = CharacterList.Parse(Json.Serialize(new object[] {Profile(CharacterB,"Bo",2)}))[0];
        var absentActions = CharacterList.Actions(absent,true,true);
        Check(Line(absentActions,"summon").Enabled && !Line(absentActions,"follow").Enabled && !Line(absentActions,"despawn").Enabled && Line(absentActions,"memories").Right == "None yet","an absent character can only be summoned");
        Check(!Line(CharacterList.Actions(absent,true,false),"summon").Enabled && Line(CharacterList.Actions(absent,true,false),"rename").Enabled,"without the native host only profile edits stay available");
        Check(!Line(CharacterList.Actions(absent,false,true),"rename").Enabled && !Line(CharacterList.Actions(absent,false,true),"relationship").Enabled,"without the companion nothing can be edited");
        var retired = CharacterList.Parse(Json.Serialize(new object[] {Profile(CharacterB,"Ret",2,status: "retired")}))[0];
        Check(!Line(CharacterList.Actions(retired,true,true),"summon").Enabled,"retired characters cannot be summoned");
        var unknown = CharacterList.Parse(Json.Serialize(new object[] {Profile(CharacterB,"Odd",2,relationship: "bestie")}))[0];
        Check(Line(CharacterList.Actions(unknown,true,true),"relationship").Value == "associate","an unknown stored state shows the first valid option");
    }

    static void MenuDataTests()
    {
        var companion = new FakeCompanion(); var clock = new FakeClock(); var data = new MenuData(companion,clock,work => work());
        data.RequestCharacters(); data.RequestCharacters();
        Check(companion.Bodies.Count == 1 && companion.Last["action"] as string == "list","one roster request in flight");
        companion.Reply(true,body: Json.Serialize(new object[] {Profile(CharacterA,"Amy",3,runtimeStatus: "spawned",memories: Memory(MemoryA,"Pier",false))}));
        Check(data.Characters == null,"results apply only on the loader fiber");
        int version = data.Version; data.Pump();
        Check(data.Characters.Count == 1 && data.CharactersError == null && data.CompanionReachable && data.Version == version + 1,"roster applied in Pump");
        data.RequestCharacters(); companion.Unreachable(); data.Pump();
        Check(!data.CompanionReachable && data.CharactersError == "companion_unavailable" && data.Characters.Count == 1,"companion down: reachability off, last roster kept");
        data.RequestCharacters(); companion.Reply(false,"profile_store_unavailable"); data.Pump();
        Check(data.CompanionReachable && data.CharactersError == "profile_store_unavailable","an error reply still proves the companion is reachable");
        data.RequestCharacters(); companion.Reply(true,body: "{\"not\":\"a list\"}"); data.Pump();
        Check(data.CharactersError == "invalid_result" && data.Characters.Count == 1,"an unexpected list body is refused");

        string edited = Json.Serialize(new Dictionary<string,object> {{"profile",Profile(CharacterA,"Amy",4,memories: Memory(MemoryA,"Pier",true))},{"memoryId",MemoryA}});
        var row = data.ApplyProfile(edited);
        Check(row != null && data.Characters[0].Revision == 4 && data.Characters[0].Memories[0].Selected && data.Characters[0].RuntimeStatus == "spawned","an edit reply updates the revision and keeps the runtime status");
        Check(data.ApplyProfile(Json.Serialize(Profile(CharacterA,"Amy Renamed",5))).Name == "Amy Renamed" && data.Characters[0].Revision == 5,"plain edit replies apply too");
        Check(data.ApplyProfile("garbage") == null,"garbage replies are ignored");
        data.ApplyReply(Json.Serialize(Profile(CharacterA,"Amy Again",6))); data.Pump();
        Check(data.Characters[0].Name == "Amy Again" && data.Characters[0].Revision == 6,"edit replies are parsed by the worker and applied in Pump");
        int lists = companion.Bodies.Count(body => body.Contains("\"list\""));
        data.ApplyReply(null); data.Pump();
        Check(companion.Bodies.Count(body => body.Contains("\"list\"")) == lists + 1,"a success without a usable body reloads the roster");
        companion.Reply(true,body: Json.Serialize(new object[] {Profile(CharacterA,"Amy",7,runtimeStatus: "spawned")})); data.Pump();

        data.RequestDescribe(FakeBridge.Encounter,null);
        Check(companion.Last["action"] as string == "current_describe" && companion.Last["encounterId"] as string == FakeBridge.Encounter && companion.Last.ContainsKey("ownerAlias") && companion.Last["ownerAlias"] == null,"describe asks for the encounter");
        int posts = companion.Bodies.Count; data.RequestDescribe(FakeBridge.Encounter,null);
        Check(companion.Bodies.Count == posts,"one describe in flight");
        companion.Reply(true,body: "{\"kind\":\"encounter\",\"name\":\"Maya Lopez\",\"facts\":[]}"); data.Pump();
        Check(data.DescribeFor(FakeBridge.Encounter,null).Name == "Maya Lopez" && data.DescribeFor(FakeBridge.Encounter,FakeBridge.Alias) == null,"describe matches only its exact NPC");
        clock.Advance(1000); data.RequestDescribe(FakeBridge.Encounter,null);
        Check(companion.Bodies.Count == posts,"the same NPC is not re-described within 5 s");
        clock.Advance(MenuData.DescribeRefreshMs); data.RequestDescribe(FakeBridge.Encounter,null);
        Check(companion.Bodies.Count == posts + 1,"refreshed after 5 s");
        companion.Reply(false,"invalid_editor_action"); data.Pump();
        Check(data.DescribeFor(FakeBridge.Encounter,null) == null && data.CompanionReachable,"an older companion without describe shows no name but stays reachable");
        data.RequestDescribe(FakeBridge.Encounter,FakeBridge.Alias);
        Check(companion.Bodies.Count == posts + 2 && companion.Last["ownerAlias"] as string == FakeBridge.Alias,"a newly promoted NPC is described again at once");
        companion.Reply(true,body: "{\"kind\":\"promoted\",\"name\":\"Lamar\"}"); data.Pump();
        data.RequestDescribe(null,null);
        Check(data.DescribeFor(FakeBridge.Encounter,FakeBridge.Alias) == null && companion.Bodies.Count == posts + 2,"no NPC: describe cleared without a request");

        data.Probe(); data.Probe();
        Check(companion.Bodies.Count == posts + 3 && companion.Last.Count == 1 && companion.Last["action"] as string == "current_describe","one id-less probe in flight");
        companion.Unreachable(); data.Pump();
        Check(!data.CompanionReachable,"probe failure marks the companion unreachable");
        data.Probe(); companion.Reply(true,body: "{\"kind\":\"unknown\",\"facts\":[]}"); data.Pump();
        Check(data.CompanionReachable,"probe success restores it");
    }

    // The real loopback client against a local server: oversized success bodies
    // are successes without a body, not "companion unavailable".
    static void CompanionClientTests()
    {
        var listener = new TcpListener(IPAddress.Loopback,0); listener.Start(); int port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        string address = "http://127.0.0.1:" + port,token = new string('d',64);
        string saved = CompanionClient.EndpointPath; CompanionClient.EndpointPath = null;
        try {
            using (var server = new HttpListener()) {
                server.Prefixes.Add(address + "/"); server.Start();
                var serving = Task.Run(() => {
                    while (server.IsListening) {
                        HttpListenerContext context; try { context = server.GetContext(); } catch { return; }
                        try {
                            string body; using (var reader = new StreamReader(context.Request.InputStream)) body = reader.ReadToEnd();
                            string reply; int status = 200;
                            if (context.Request.HttpMethod == "GET") reply = "<script>const auth=\"" + token + "\",summonWaitMs=30000;</script>";
                            else if (context.Request.Headers["x-lsa-editor"] != token) { status = 403; reply = "{\"error\":\"editor_access_denied\"}"; }
                            else if (body.Contains("big")) reply = "[" + string.Join(",",Enumerable.Repeat("{\"pad\":\"" + new string('x',100) + "\"}",40)) + "]";
                            else if (body.Contains("conflict")) { status = 400; reply = "{\"error\":\"profile_revision_conflict\"}"; }
                            else reply = "{\"ok\":true}";
                            var bytes = System.Text.Encoding.UTF8.GetBytes(reply);
                            context.Response.StatusCode = status; context.Response.ContentLength64 = bytes.Length; context.Response.OutputStream.Write(bytes,0,bytes.Length); context.Response.Close();
                        } catch { }
                    }
                });
                var big = CompanionClient.Send(address,"{\"action\":\"big\"}",1000);
                Check(big.Ok && big.Status == 200 && big.Body == null,"an oversized success body is still a success, without the body");
                var small = CompanionClient.Send(address,"{\"action\":\"list\"}",1000);
                Check(small.Ok && small.Body == "{\"ok\":true}","a body within the limit is returned");
                var conflict = CompanionClient.Send(address,"{\"action\":\"conflict\"}",1000);
                Check(!conflict.Ok && conflict.Status == 400 && conflict.Error == "profile_revision_conflict","a 400 carries the companion's bounded error code");
                server.Stop(); serving.Wait(2000);
            }
            var done = new ManualResetEventSlim(); CompanionReply down = null;
            new CompanionClient(() => address).Post("{\"action\":\"list\"}",1000,1000,reply => { down = reply; done.Set(); });
            Check(done.Wait(10000) && down != null && !down.Ok && down.Status == 0 && down.Error == "companion_unavailable","no server: unavailable with no HTTP status");
        } finally { CompanionClient.EndpointPath = saved; }
    }

    static void ControlsAndDiagnosticsTests()
    {
        var settings = Settings("{\"version\":1,\"input\":{\"enabled\":true,\"timing\":{\"chordWindowMs\":95}},\"ui\":{\"enabled\":true}}");
        var essential = EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=None"});
        Check(ControlsView.ChordWindowOptions(120).Length == 22 && ControlsView.ChordWindowOptions(95).Contains(95) && ControlsView.ChordWindowOptions(95).Length == 23 && ControlsView.ChordWindowOptions(95).SequenceEqual(ControlsView.ChordWindowOptions(95).OrderBy(value => value)),"chord window choices: 40-250 ms in 10 ms steps plus the saved value");
        var lines = ControlsView.Build(settings,essential,"ready",null,false,95,settings.Bindings);
        var gestures = Line(lines,"gestures"); var window = Line(lines,"chordWindow");
        Check(gestures.Toggle && gestures.Value == "on" && gestures.Command == ControlsView.GesturesCommand && window.Value == "95" && window.OptionLabels.Contains("95 ms") && window.Command == ControlsView.ChordWindowCommand,"gestures switch and chord window choice");
        Check(Line(lines,"router").Right == "Ready" && Line(lines,"key:L4").Right == "F6" && Line(lines,"binding:follow").Text == "Chord L4 (F6) + R4 (F8)" && Line(lines,"binding:follow").Right == "Follow current NPC" && Line(lines,"binding:quickMenu").Text == "Hold L4 (F6) + R4 (F8) (600 ms)","router keys and bindings");
        Check(Line(lines,"essential:MarkPedKey").Right == "F9" && Line(lines,"essential:MarkedPedTalkKey").Right == "None" && Line(lines,"essentialInMenus").Right == "Still active" && Line(lines,"conflict") == null,"Essential's keys are shown read-only");
        var paused = ControlsView.Build(settings,essential,"gated:input_busy","L4=F6 is also Essential's MarkPedKey",true,150,new GestureBinding[0]);
        Check(Line(paused,"gestures").Value == "off" && Line(paused,"chordWindow").Value == "150" && Line(paused,"router").Right == "Waiting for gameplay" && Line(paused,"conflict").Right.Contains("MarkPedKey"),"paused gestures, session window, gated router and conflicts");
        var disabled = ControlsView.Build(EnhancedSettings.Defaults(catalog),essential,"disabled",null,false,120,new GestureBinding[0]);
        Check(!Line(disabled,"gestures").Enabled && !Line(disabled,"chordWindow").Enabled && Line(disabled,"router").Right == "Off (input.enabled)","input disabled: session controls are greyed out");
        Check(ControlsView.Build(null,essential,"ready",null,false,120,new GestureBinding[0]).Count == 0,"no settings: no lines");

        var empty = DiagnosticsView.Build(new DiagnosticsInput {HostStatus = "host=none",RouterState = "disabled",SettingsRevision = "defaults",CatalogSha = catalog.Sha256});
        Check(Line(empty,"snapshot").Right == "None" && Line(empty,"reasons").Right == "None" && Line(empty,"settings").Right == "Defaults" && Line(empty,"catalog").Right == catalog.Sha256.Substring(0,8) && Line(empty,"companion").Right == "Not reachable","empty diagnostics");
        Check(Line(empty,"refresh").Command == null && Line(empty,"log").Command == null && !Line(empty,"refresh").Info,"diagnostics actions are local");
        var busy = DiagnosticsView.Build(new DiagnosticsInput {HostStatus = "status=ready",BridgeAvailable = true,CompanionReachable = true,SnapshotAgeMs = 120,Outstanding = 1,SettingsRevision = new string('a',64),RecentReasons = new[] {"first: a","second: b"}});
        Check(Line(busy,"snapshot").Right == "120 ms" && Line(busy,"bridge").Right == "Available" && Line(busy,"settings").Right == "aaaaaaaa" && busy.Where(line => line.Text == "Recent").Select(line => line.Right).SequenceEqual(new[] {"second: b","first: a"}),"recent failures newest first");
    }

    static void AiVoiceTests()
    {
        string config = Resource("e1.config.example.json");
        var lines = AiVoiceView.Build(config,true);
        Check(Line(lines,"provider").Right == "openai" && Line(lines,"voice").Right == "nova" && Line(lines,"assignment").Right == "character-aware-session" && Line(lines,"acting").Right == "On" && Line(lines,"intelligence").Right == "off" && Line(lines,"characters").Right == "Off","public companion settings");
        Check(Line(lines,"credentials").Right == "Present" && Line(AiVoiceView.Build(config,false),"credentials").Right == "Missing","credential file presence only");
        var secretive = AiVoiceView.Build("{\"provider\":\"openai\",\"apiKey\":\"sk-secret\",\"reasoningModel\":\"" + new string('m',41) + "\"}",false);
        Check(!secretive.Any(line => (line.Right ?? "").Contains("sk-secret")) && Line(secretive,"model") == null,"unknown keys and overlong values never appear");
        Check(Line(AiVoiceView.Build(null,false),"config").Right == "Not found" && Line(AiVoiceView.Build("{oops",false),"config").Right == "Not found","missing or invalid config");
    }

    static void UiBridgeTests()
    {
        var logs = new List<string>(); var context = new UiContext {Log = logs.Add};
        int created = 0; var surface = new FakeSurface();
        int guards = 0;
        var missing = new UiBridge(context,_ => { created++; return surface; },() => ++guards == 1 ? "rnui_missing" : null);
        missing.Configure(false);
        Check(missing.Status == "off" && !missing.Available && created == 0,"menus stay off until ui.enabled");
        missing.Configure(true); missing.Toggle("main"); missing.Tick();
        Check(missing.Status == "rnui_missing" && !missing.Available && !missing.AnyMenuOpen && created == 0 && logs.Contains("[UX] menu_unavailable reason=rnui_missing"),"without RAGENativeUI no menu is created and toggles do nothing");
        missing.Configure(false); missing.Configure(true);
        Check(missing.Status == "rnui_missing" && created == 0 && guards == 1,"a failed guard stays final for the session and is not retried");
        Check(UiBridge.DefaultGuard() == "rnui_missing","the default guard reports RNUI missing here without naming an RNUI type");

        var ui = new UiBridge(context,_ => { created++; return surface; },() => null);
        ui.Configure(true);
        Check(ui.Available && ui.Status == "ready" && created == 1,"guard passed: one menu surface");
        ui.Toggle("current");
        Check(surface.Calls.Last() == "toggle:current" && ui.AnyMenuOpen,"toggle reaches the surface");
        ui.Tick(); Check(surface.Calls.Last() == "tick" && ui.AnyMenuOpen,"tick keeps the open state");
        ui.Configure(false);
        Check(!ui.Available && ui.Status == "off" && surface.Calls.Last() == "close" && !ui.AnyMenuOpen,"ui.enabled off closes the menus");
        ui.Configure(true);
        Check(ui.Available && created == 1,"turning it back on reuses the surface");
        surface.ThrowOnTick = true;
        for (int index = 0; index < UiBridge.MaxConsecutiveFailures - 1; index++) ui.Tick();
        Check(ui.Available,"isolated tick failures are tolerated");
        ui.Tick();
        Check(!ui.Available && ui.Status == "menu_disabled" && logs.Count(line => line == "[UX] menu_tick_failed InvalidOperationException") == 1 && logs.Contains("[UX] menu_unavailable reason=menu_disabled"),"repeated failures disable the menu and log once");
        ui.Configure(false); ui.Configure(true);
        Check(ui.Status == "menu_disabled" && !ui.Available,"a disabled menu stays disabled until the plugin reloads");
        var failing = new UiBridge(context,_ => throw new TypeLoadException(),() => null);
        failing.Configure(true);
        Check(failing.Status == "menu_failed" && !failing.Available,"a surface that cannot be created leaves gestures running");

        // The dispatcher and router see the bridge exactly like the fake UI.
        var rig = new Rig("{\"version\":1,\"input\":{\"enabled\":true},\"ui\":{\"enabled\":true}}"); var menuSurface = new FakeSurface();
        var bridgeUi = new UiBridge(context,_ => menuSurface,() => null); bridgeUi.Configure(true);
        rig.Dispatcher.Ui = bridgeUi; rig.Router.UiAvailable = () => bridgeUi.Available; rig.Router.MenuOpen = () => bridgeUi.AnyMenuOpen;
        rig.Router.Apply(rig.Settings,rig.Essential); rig.Frame(2); rig.Hold(F11,50); rig.Frame(5);
        Check(menuSurface.Calls.Contains("toggle:main") && bridgeUi.AnyMenuOpen,"the menu key opens the RNUI surface through the bridge");
        rig.Hold(F6,60); rig.Frame(10);
        Check(rig.Injector.Calls.Count == 0,"gestures pause while the menu is open");
    }

    static void SessionOverrideTests()
    {
        var rig = new Rig(); rig.Router.Apply(rig.Settings,rig.Essential); rig.Frame(2);
        rig.Router.GesturesPaused = true; rig.Hold(F6,60); rig.Frame(10); rig.Chord(F6,F8,20,100); rig.Frame(10);
        Check(rig.Injector.Calls.Count == 0 && rig.Companion.Bodies.Count == 0,"paused gestures fire nothing");
        rig.Router.GesturesPaused = false; rig.Hold(F6,60); rig.Frame(10);
        Check(rig.Injector.Presses("F9") == 1,"resumed gestures mark again");
        // L4 then R4 in quick succession: the second relay waits for the first.
        int beforeMarks = rig.Injector.Presses("F9"),beforeTexts = rig.Injector.Presses("Mouse5");
        rig.Hold(F6,30); rig.Frame(4); rig.Hold(F8,30); rig.Frame(20);
        Check(rig.Injector.Presses("F9") == beforeMarks + 1 && rig.Injector.Presses("Mouse5") == beforeTexts + 1,"a quick Mark then Text both reach Essential");
        // Focus loss inside a relay pulse releases the synthesized key at once.
        int pulses = rig.Injector.Presses("F9");
        rig.Keys.Down.Add(F6); rig.Frame(3); rig.Keys.Down.Remove(F6); rig.Frame(1);
        Check(rig.Injector.Calls.Last() == "down:F9" && rig.Injector.Presses("F9") == pulses + 1,"a mark is being pressed");
        rig.Keys.Focus = false; rig.Frame(1); rig.Keys.Focus = true;
        Check(rig.Injector.Calls.Last() == "up:F9" && rig.Injector.Presses("F9") == pulses + 1,"alt-tab during a relay pulse releases the key in the same frame, not after the pulse");
        rig.Frame(20);
        rig.Router.SetSessionChordWindow(40);
        Check(rig.Router.ChordWindowMs == 40 && rig.Logs.Last() == "[UX] input_latency L4=40ms R4=40ms Menu=0ms","a session chord window applies at once");
        rig.Keys.Down.Add(F6); rig.Frame(6); rig.Keys.Down.Add(F8); rig.Frame(10); rig.Keys.Down.Clear(); rig.Frame(20);
        Check(rig.Injector.Presses("F9") == pulses + 2 && rig.Injector.Presses("Mouse5") == beforeTexts + 1 && rig.Companion.Bodies.Count == 0,"with a 40 ms window a 60 ms gap is a Mark tap; the late key is swallowed, never a chord");
        rig.Router.Apply(rig.Settings,rig.Essential);
        Check(rig.Router.ChordWindowMs == 40,"a settings reload keeps the session override");
        int marks = rig.Injector.Presses("F9");
        rig.Keys.Down.Add(F6); rig.Frame(2); rig.Router.Apply(rig.Settings,rig.Essential); rig.Frame(2); rig.Keys.Down.Remove(F6); rig.Frame(15);
        Check(rig.Injector.Presses("F9") == marks,"a key held across a settings reload fires nothing");
        rig.Hold(F6,20); rig.Frame(15);
        Check(rig.Injector.Presses("F9") == marks + 1,"the next tap after the reload marks once");
        rig.Router.SetSessionChordWindow(1000);
        Check(rig.Router.ChordWindowMs == 250,"session windows are clamped to 40-250 ms");
        rig.Router.SetSessionChordWindow(null);
        Check(rig.Router.ChordWindowMs == 120,"clearing the override restores the saved window");

        // Menu selections are explicit: no gesture cooldown, still one job per class.
        var menu = new Rig(); var d = menu.Dispatcher; menu.Fresh(FakeBridge.Owned());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"menu") == null,"menu follow sent");
        menu.Companion.Reply(true); d.Update(); menu.Fresh(FakeBridge.Owned());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"menu") == null && menu.Companion.Bodies.Count == 2,"a second menu selection inside 750 ms is not dropped");
        Check(d.Dispatch(CommandCatalog.CurrentWait,"menu") == "command_busy" && menu.Hud.Last == "Still working on the last request","but one control job at a time still applies");
        menu.Companion.Reply(true); d.Update(); menu.Fresh(FakeBridge.Owned());
        Check(d.Dispatch(CommandCatalog.CurrentFollow,"chord") == "cooldown","a gesture right after a menu selection is still a repeat");
    }
}
