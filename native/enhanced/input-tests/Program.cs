using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;

static partial class Program
{
    static int count;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static void Check(bool condition,string label) { count++; if (!condition) throw new Exception("UX input assertion " + count + " failed: " + label); }
    static CommandCatalog catalog;

    static int Main()
    {
        try {
            CatalogTests();
            SettingsTests();
            RecognizerTests();
            EssentialBindingsTests();
            RelayTests();
            DispatcherTests();
            RouterTests();
            InterceptionTests();
            ViewModelTests();
            Console.WriteLine("UX phase 2/3 input, settings, dispatch and view models: " + count + " assertions passed; no game assemblies loaded.");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    static partial void ViewModelTests();

    static void CatalogTests()
    {
        catalog = CommandCatalog.LoadEmbedded();
        Check(catalog.Sha256 == CommandCatalog.ContractSha256,"embedded contracts/commands.v1.json matches the pinned SHA-256 (update CommandCatalog.ContractSha256 and the companion test together): " + catalog.Sha256);
        foreach (var field in typeof(CommandCatalog).GetFields(BindingFlags.Public | BindingFlags.Static).Where(field => field.IsLiteral && field.Name != "ResourceName" && field.Name != "ContractSha256"))
            Check(catalog.Get((string)field.GetValue(null)) != null,"catalog defines " + field.Name);
        Check(catalog.All.Where(info => info.Gesture).All(info => info.Class == "read" || info.Class == "control" || info.Class == "ui"),"gestures bind only read, control and ui commands");
        Check(catalog.All.Where(info => info.Class == "destructive" || info.Class == "lifecycle" || info.Class == "profile").All(info => !info.Gesture),"no lifecycle, profile or destructive command is gesture-bindable");
        Check(catalog.Get(CommandCatalog.CurrentFollow).AskHud == "Asked to follow" && catalog.Get(CommandCatalog.CurrentFollow).Phrase == "follow","follow carries its ask text and phrase key");
        Check(catalog.Describe("no_current_npc") == "No current NPC" && catalog.Describe("brand_new_code") == "Request failed (brand_new_code)" && catalog.Describe("Bad Code!") == "Request failed (unknown)","reason text comes only from the catalog");
        foreach (var bad in new[] {"{\"version\":2,\"commands\":[],\"reasons\":{}}","{\"version\":1,\"commands\":[{\"id\":\"x.y\",\"class\":\"destructive\",\"target\":\"none\",\"gesture\":true,\"executor\":\"ui\",\"hud\":\"x\"}],\"reasons\":{}}","{\"version\":1,\"commands\":[],\"reasons\":{\"Bad\":\"x\"}}"}) {
            bool rejected = false; try { CommandCatalog.Parse(System.Text.Encoding.UTF8.GetBytes(bad)); } catch (InvalidDataException) { rejected = true; }
            Check(rejected,"invalid catalog rejected: " + bad.Substring(0,30));
        }
    }

    static EnhancedSettings Settings(string json) { Check(EnhancedSettings.TryParse(json,catalog,out var settings,out var error),"settings parse: " + error); return settings; }
    static string SettingsError(string json) { Check(!EnhancedSettings.TryParse(json,catalog,out _,out var error),"settings rejected: " + json); return error; }
    static void SettingsTests()
    {
        var defaults = EnhancedSettings.Defaults(catalog);
        Check(!defaults.InputEnabled && !defaults.UiEnabled && defaults.Revision == "defaults","input and UI are off by default");
        Check(defaults.KeyNames.SequenceEqual(new[] {"L4","R4","Menu"}) && defaults.KeyCodes.SequenceEqual(new[] {0x75,0x77,0x7A}),"default router keys F6, F8 and F11");
        Check(defaults.Timing.ChordWindowMs == 120 && defaults.Timing.HoldMs == 600 && defaults.Timing.DoubleTapMs == 250 && defaults.RelayPulseMs == 80 && defaults.CommandCooldownMs == 750,"default timing");
        Check(defaults.Bindings.Select(binding => binding.Id + ":" + binding.Kind + ":" + binding.Command).SequenceEqual(new[] {"mark:Tap:essential.mark","text:Tap:essential.text","follow:Chord:current.follow","quickMenu:ChordHold:ui.quickMenu","menu:Tap:ui.mainMenu"}),"default bindings");
        Check(defaults.OrdinaryNpc == "ask" && defaults.Phrase("follow") == "Follow me." && defaults.Phrase("wait") == "Wait here." && defaults.Phrase("dismiss") == "That's all, you can go." && defaults.Hud == "notification","default quick commands and HUD");
        var full = Settings("{\"version\":1,\"input\":{\"enabled\":true,\"keys\":{\"L4\":\"F6\",\"R4\":\"Mouse4\"},\"timing\":{\"chordWindowMs\":90,\"holdMs\":700,\"doubleTapMs\":200,\"relayPulseMs\":60,\"commandCooldownMs\":500},"
            + "\"bindings\":[{\"id\":\"mark\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"essential.mark\"},{\"id\":\"wait\",\"gesture\":\"chord\",\"keys\":[\"R4\",\"L4\"],\"command\":\"current.wait\"}]},"
            + "\"quickCommands\":{\"ordinaryNpc\":\"off\",\"phrases\":{\"follow\":\"Komm mit.\",\"dismiss\":\"\"}},\"ui\":{\"enabled\":true},\"feedback\":{\"hud\":\"subtitle\"}}");
        Check(full.InputEnabled && full.UiEnabled && full.KeyCodes[1] == PhysicalKeys.XButton1 && full.Timing.ChordWindowMs == 90 && full.RelayPulseMs == 60 && full.CommandCooldownMs == 500,"explicit settings");
        Check(full.Bindings.Count == 2 && full.Bindings[1].Keys.SequenceEqual(new[] {0,1}) && full.OrdinaryNpc == "off" && full.Phrase("follow") == "Komm mit." && full.Phrase("dismiss") == "" && full.Phrase("wait") == "Wait here." && full.Hud == "subtitle","explicit bindings and phrases");
        Check(full.Revision.Length == 64,"revision is the file hash");
        var noMenu = Settings("{\"version\":1,\"input\":{\"keys\":{\"L4\":\"F6\",\"R4\":\"F8\"}}}");
        Check(noMenu.Bindings.Count == 4 && noMenu.Bindings.All(binding => binding.Command != "ui.mainMenu"),"default bindings skip undefined logical keys");
        var errors = new Dictionary<string,string> {
            {"{\"version\":2}","version"},
            {"{\"version\":1,\"extra\":1}","unknown setting extra"},
            {"{\"version\":1,\"input\":{\"bogus\":true}}","unknown setting bogus"},
            {"{\"version\":1,\"input\":{\"keys\":{}}}","needs 1 to 8"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L 4\":\"F6\"}}}","invalid logical key"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L4\":\"Banana\"}}}","unknown key name"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L4\":\"F4\"}}}","reserved"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L4\":\"F7\"}}}","reserved"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L4\":\"F12\"}}}","reserved"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L4\":\"Mouse1\"}}}","reserved"},
            {"{\"version\":1,\"input\":{\"keys\":{\"L4\":\"F6\",\"R4\":\"f6\"}}}","used twice"},
            {"{\"version\":1,\"input\":{\"timing\":{\"chordWindowMs\":30}}}","from 40 to 250"},
            {"{\"version\":1,\"input\":{\"timing\":{\"chordWindowMs\":250,\"holdMs\":300}}}","chordWindowMs + 100"},
            {"{\"version\":1,\"input\":{\"timing\":{\"relayPulseMs\":10}}}","from 30 to 200"},
            {"{\"version\":1,\"input\":{\"timing\":{\"holdMs\":600.5}}}","integer"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"Mark\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"essential.mark\"}]}}","invalid id"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"essential.mark\"},{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"R4\"],\"command\":\"essential.text\"}]}}","duplicate id"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"swipe\",\"keys\":[\"L4\"],\"command\":\"essential.mark\"}]}}","use tap"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"chord\",\"keys\":[\"L4\"],\"command\":\"current.follow\"}]}}","needs two keys"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"L4\",\"R4\"],\"command\":\"essential.mark\"}]}}","needs one key"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"X9\"],\"command\":\"essential.mark\"}]}}","undefined logical key"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"chord\",\"keys\":[\"L4\",\"L4\"],\"command\":\"current.follow\"}]}}","keys must differ"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"world.explode\"}]}}","unknown command"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"character.despawn\"}]}}","cannot be bound"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"current.promote\"}]}}","cannot be bound"},
            {"{\"version\":1,\"input\":{\"bindings\":[{\"id\":\"a\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"essential.mark\"},{\"id\":\"b\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"essential.text\"}]}}","duplicate gesture"},
            {"{\"version\":1,\"quickCommands\":{\"ordinaryNpc\":\"force\"}}","use ask or off"},
            {"{\"version\":1,\"quickCommands\":{\"phrases\":{\"follow\":\"\"}}}","1-120"},
            {"{\"version\":1,\"quickCommands\":{\"phrases\":{\"wait\":\"a\\nb\"}}}","1-120"},
            {"{\"version\":1,\"quickCommands\":{\"phrases\":{\"follow\":\"" + new string('x',121) + "\"}}}","1-120"},
            {"{\"version\":1,\"quickCommands\":{\"phrases\":{\"greet\":\"Hi\"}}}","unknown setting greet"},
            {"{\"version\":1,\"ui\":{\"enabled\":\"yes\"}}","true or false"},
            {"{\"version\":1,\"feedback\":{\"hud\":\"loud\"}}","notification"},
            {"{\"version\":1,\"input\":[]}","must be an object"},
            {"{not json","invalid_json"},
            {"{\"version\":1,\"pad\":\"" + new string(' ',17000) + "\"}","16 KiB"},
        };
        foreach (var pair in errors) Check(SettingsError(pair.Key).Contains(pair.Value),"settings error mentions '" + pair.Value + "'");
        Check(SettingsError("{\"version\":1,\"input\":{\"bindings\":[" + string.Join(",",Enumerable.Range(0,17).Select(index => "{\"id\":\"b" + index + "\",\"gesture\":\"tap\",\"keys\":[\"L4\"],\"command\":\"essential.mark\"}")) + "]}}").Contains("at most 16"),"binding count cap");
    }

    static readonly GestureBinding Mark = new GestureBinding("mark",GestureKind.Tap,new[] {0},"essential.mark"),Text = new GestureBinding("text",GestureKind.Tap,new[] {1},"essential.text"),
        Follow = new GestureBinding("follow",GestureKind.Chord,new[] {0,1},"current.follow"),Quick = new GestureBinding("quick",GestureKind.ChordHold,new[] {1,0},"ui.quickMenu"),
        Menu = new GestureBinding("menu",GestureKind.Tap,new[] {2},"ui.mainMenu");
    // Frames every 10 ms; mask(t) gives the logical keys held at time t.
    static List<string> Simulate(GestureRecognizer recognizer,long from,long to,Func<long,int> mask,Action<long> frame = null)
    {
        var all = new List<string>(); var events = new List<GestureEvent>();
        for (long t = from; t <= to; t += 10) { frame?.Invoke(t); events.Clear(); recognizer.Update(t,mask(t),events); all.AddRange(events.Select(e => e.BindingId + "@" + t)); }
        return all;
    }
    static GestureRecognizer Basic() => new GestureRecognizer(new[] {Mark,Text,Follow},GestureTiming.Default,3);
    static int Keys(params int[] keys) => keys.Aggregate(0,(mask,key) => mask | 1 << key);
    static void RecognizerTests()
    {
        Check(Simulate(Basic(),0,300,t => t < 50 ? Keys(0) : 0).SequenceEqual(new[] {"mark@50"}),"tap L4 marks once, on release");
        Check(Simulate(Basic(),0,300,t => t < 60 ? Keys(1) : 0).SequenceEqual(new[] {"text@60"}),"tap R4 opens text once");
        Check(Simulate(Basic(),0,500,t => t < 40 ? Keys(0) : t < 200 ? Keys(0,1) : 0).SequenceEqual(new[] {"follow@40"}),"chord L4 then R4 follows on press, no taps");
        Check(Simulate(Basic(),0,500,t => t < 30 ? Keys(1) : t < 200 ? Keys(0,1) : t < 260 ? Keys(0) : 0).SequenceEqual(new[] {"follow@30"}),"chord R4 then L4 follows once; staggered release adds nothing");
        Check(Simulate(Basic(),0,300,t => t < 100 ? Keys(0,1) : 0).SequenceEqual(new[] {"follow@0"}),"simultaneous press is a chord");
        Check(Simulate(Basic(),0,500,t => t < 130 ? Keys(0) : t < 300 ? Keys(0,1) : 0).SequenceEqual(new[] {"mark@130"}),"near miss just outside the window marks once and swallows the late key");
        Check(Simulate(Basic(),0,500,t => t < 120 ? Keys(0) : t < 300 ? Keys(0,1) : 0).SequenceEqual(new[] {"follow@120"}),"second key at the window edge still chords");
        Check(Simulate(Basic(),0,30000,t => t < 29990 ? Keys(0) : 0).SequenceEqual(new[] {"mark@130"}),"a key held for 30 s fires one tap at the window end and nothing more");
        Check(Simulate(Basic(),0,900,t => t < 40 ? Keys(0) : t < 200 ? Keys(0,1) : t < 300 ? Keys(0) : t < 400 ? Keys(0,1) : t < 500 ? Keys(0) : t < 600 ? 0 : t < 640 ? Keys(0) : t < 700 ? Keys(0,1) : 0)
            .SequenceEqual(new[] {"follow@40","follow@640"}),"release one and re-press does not re-fire until all keys are released");
        var reset = Basic();
        Check(Simulate(reset,0,400,t => t < 60 ? Keys(0) : t < 300 ? Keys(0,1) : 0,t => { if (t == 50) reset.Reset(); }).Count == 0,"focus loss mid-chord fires nothing and leaves no key stuck");
        Check(Simulate(reset,410,800,t => t < 450 ? Keys(0) : 0).SequenceEqual(new[] {"mark@450"}),"input works again after the reset release");
        var heldReset = Basic(); heldReset.Reset();
        Check(Simulate(heldReset,0,300,t => Keys(1)).Count == 0,"keys already held when input resumes never fire");
        var matrix = Basic(); var outputs = new List<string>(); long clock = 0;
        for (int round = 0; round < 20; round++) { outputs.AddRange(Simulate(matrix,clock,clock + 290,t => t - clock < 60 ? Keys(0) : 0)); clock += 300; }
        for (int round = 0; round < 20; round++) { outputs.AddRange(Simulate(matrix,clock,clock + 290,t => t - clock < 60 ? Keys(1) : 0)); clock += 300; }
        for (int round = 0; round < 40; round++) { int first = round % 2; outputs.AddRange(Simulate(matrix,clock,clock + 290,t => t - clock < 30 ? Keys(first) : t - clock < 150 ? Keys(0,1) : 0)); clock += 300; }
        Check(outputs.Count(item => item.StartsWith("mark@")) == 20 && outputs.Count(item => item.StartsWith("text@")) == 20 && outputs.Count(item => item.StartsWith("follow@")) == 40,"20 taps each give 20 marks and 20 texts; 40 chords in both orders give 40 follows and no taps");

        var withHold = new GestureRecognizer(new[] {Mark,Text,Follow,Quick},GestureTiming.Default,3);
        Check(Simulate(withHold,0,400,t => t < 100 ? Keys(0,1) : 0).SequenceEqual(new[] {"follow@100"}),"with chord-hold bound, a quick chord follows on release");
        Check(Simulate(withHold,0,6000,t => t < 5000 ? Keys(0,1) : 0).SequenceEqual(new[] {"quick@600"}),"a 5 s chord hold opens the quick menu once and never follows");
        Check(Simulate(withHold,0,800,t => t < 300 ? Keys(0,1) : t < 500 ? Keys(0) : 0).SequenceEqual(new[] {"follow@300"}),"releasing one chord key before the hold follows; the other key adds nothing");
        Check(Simulate(withHold,0,300,t => t < 50 ? Keys(1) : 0).SequenceEqual(new[] {"text@50"}),"taps unaffected by the chord-hold");

        var hold = new GestureRecognizer(new[] {Mark,new GestureBinding("hold",GestureKind.Hold,new[] {0},"current.wait")},GestureTiming.Default,1);
        Check(Simulate(hold,0,500,t => t < 200 ? Keys(0) : 0).SequenceEqual(new[] {"mark@200"}),"with a hold bound, a tap fires on release before the hold");
        Check(Simulate(hold,0,1500,t => t < 1000 ? Keys(0) : 0).SequenceEqual(new[] {"hold@600"}),"a long press fires the hold once and no tap");
        var doubles = new GestureRecognizer(new[] {Text,new GestureBinding("double",GestureKind.DoubleTap,new[] {1},"current.follow")},GestureTiming.Default,2);
        Check(Simulate(doubles,0,600,t => t < 50 ? Keys(1) : 0).SequenceEqual(new[] {"text@310"}),"a single tap waits out the double-tap window");
        Check(Simulate(doubles,0,600,t => t < 50 || t >= 120 && t < 170 ? Keys(1) : 0).SequenceEqual(new[] {"double@120"}),"a double tap fires once and no single tap");
        var menu = new GestureRecognizer(new[] {Mark,Text,Follow,Menu},GestureTiming.Default,3);
        Check(Simulate(menu,0,300,t => t < 200 ? Keys(2) : 0).SequenceEqual(new[] {"menu@0"}),"an unambiguous key fires on press");
        Check(Simulate(menu,0,400,t => t < 60 ? Keys(0) : 0,null).SequenceEqual(new[] {"mark@60"}) && Simulate(menu,500,800,t => t < 560 ? Keys(0,2) : 0).SequenceEqual(new[] {"menu@500","mark@560"}),"separate key groups resolve independently");
        Check(menu.TapLatencyMs(0) == 120 && menu.TapLatencyMs(2) == 0 && withHold.TapLatencyMs(0) == 120 && hold.TapLatencyMs(0) == 600 && doubles.TapLatencyMs(1) == 250,"reported latency per key");
        var triple = new GestureRecognizer(new[] {Mark,Text,Follow,new GestureBinding("other",GestureKind.Chord,new[] {1,2},"current.wait")},GestureTiming.Default,3);
        Check(Simulate(triple,0,400,t => t < 30 ? Keys(0) : t < 200 ? Keys(0,1,2) : 0).Count == 0,"a third key during a pending chord suppresses everything");
    }

    static IEnumerable<string> Strings(object value,int depth = 0)
    {
        if (value == null || depth > 4) yield break;
        if (value is string text) { yield return text; yield break; }
        if (value is IEnumerable sequence) { foreach (var item in sequence) foreach (var inner in Strings(item,depth + 1)) yield return inner; yield break; }
        foreach (var field in value.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            if (field.FieldType == typeof(string) || !field.FieldType.IsPrimitive && !field.FieldType.IsEnum) foreach (var inner in Strings(field.GetValue(value),depth + 1)) yield return inner;
    }
    static void EssentialBindingsTests()
    {
        var parsed = EssentialBindings.Parse(new[] {"# Los Santos Alive controls","","ApiKey=sk-super-secret-gemini-key","Language=English","talkkey = Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F10","AudioVolume=0.4"});
        Check(parsed.Available && parsed.Talk.Vk == PhysicalKeys.XButton1 && parsed.Text.Vk == PhysicalKeys.XButton2 && parsed.Mark.Vk == 0x78 && parsed.MarkedTalk.Vk == 0x79,"Essential keys parsed (setting names case-insensitive)");
        Check(!Strings(parsed).Any(text => text.Contains("secret")) && !Strings(parsed).Any(text => text.Contains("English")),"the ApiKey value (and any other setting) is never retained");
        var stock = EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=None","MarkPedKey=F3","MarkedPedTalkKey=Mouse5"});
        Check(stock.Text.State == EssentialKeyState.Unbound && stock.Text.Display == "None" && stock.Mark.Vk == 0x72,"stock defaults: TextKey None, MarkPedKey F3");
        foreach (var pair in new Dictionary<string,int> {{"F1",0x70},{"F24",0x87},{"A",0x41},{"z",0x5A},{"5",0x05},{"D5",0x35},{"NumPad7",0x67},{"120",0x78},{"Mouse4",5},{"mouse5",6},{"Insert",0x2D}}) {
            var key = EssentialBindings.Parse(new[] {"MarkPedKey=" + pair.Key}).Mark;
            Check(key.State == EssentialKeyState.Bound && key.Vk == pair.Value,"Essential key name " + pair.Key + " (numbers are virtual-key codes, as in Essential)");
        }
        foreach (var bad in new[] {"Banana","999","-3","F25"}) Check(EssentialBindings.Parse(new[] {"MarkPedKey=" + bad}).Mark.State == EssentialKeyState.Unknown,"unknown Essential key " + bad);
        var missing = EssentialBindings.Parse(new[] {"TalkKey=Mouse4"});
        Check(missing.Mark.State == EssentialKeyState.Unknown && missing.Talk.State == EssentialKeyState.Bound,"missing settings are unknown");
        Check(parsed.ConflictWith(0x78)?.Setting == "MarkPedKey" && parsed.ConflictWith(0x75) == null && stock.ConflictWith(0) == null,"conflict lookup");
        Check(!EssentialBindings.Load(Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"),"LosSantosAlive.config")).Available,"missing config is unavailable");
        string file = Path.GetTempFileName();
        try {
            File.WriteAllText(file,"# ApiKey=commented\r\nApiKey=abc\r\n  markpedkey = F9  \r\nLanguage=" + new string('x',5000) + "\nTalkKey=Mouse4\nTextKey=Mouse5");
            var loaded = EssentialBindings.Load(file);
            Check(loaded.Mark.Vk == 0x78 && loaded.Talk.Vk == PhysicalKeys.XButton1 && loaded.Text.Vk == PhysicalKeys.XButton2,"config loads from disk (CRLF, spaces, long lines, no final newline)");
            using (var reader = new StringReader(File.ReadAllText(file))) {
                var lines = EssentialBindings.KeyLines(reader).ToList();
                Check(lines.Count == 3 && !lines.Any(line => line.Contains("abc") || line.Contains("commented") || line.Contains("xxx")),"only the four key settings are ever read into strings: " + string.Join(" | ",lines));
            }
            using (new FileStream(file,FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {
                var locked = EssentialBindings.Load(file);
                Check(locked == null || locked.Mark.Vk == 0x78,"a locked config reads as 'retry later' (null), never as 'unavailable'");
            }
        } finally { File.Delete(file); }
    }

    static void RelayTests()
    {
        var injector = new FakeInjector(); var relay = new EssentialKeyRelay(injector);
        var keys = EssentialBindings.Parse(new[] {"MarkPedKey=F9","TextKey=Mouse5","TalkKey=Mouse1","MarkedPedTalkKey=Banana"});
        Check(relay.Pulse(keys.Mark,80,1000) == null && injector.Calls.SequenceEqual(new[] {"down:F9"}),"one key-down per pulse");
        relay.Update(1050); Check(injector.Calls.Count == 1 && relay.Busy,"key stays down for the pulse");
        Check(relay.Pulse(keys.Mark,80,1055) == "relay_busy" && injector.Calls.Count == 1,"the same key inside its own pulse is refused");
        Check(relay.Pulse(keys.Text,80,1060) == null && injector.Calls.Count == 1,"a quick second tap of the other key waits");
        Check(relay.Pulse(keys.Text,80,1065) == "relay_busy","only one pulse waits");
        relay.Update(1080); Check(injector.Calls.SequenceEqual(new[] {"down:F9","up:F9","down:Mouse5"}) && relay.Busy,"key-up after the pulse, then the queued key");
        relay.Update(1159); Check(injector.Calls.Count == 3,"the queued key gets its own full pulse");
        relay.Update(1160); Check(injector.Calls.Last() == "up:Mouse5" && !relay.Busy,"queued pulse released");
        relay.Pulse(keys.Mark,80,1200); relay.Pulse(keys.Text,80,1210); relay.ReleaseAll(); relay.Update(1300);
        Check(injector.Calls.Skip(4).SequenceEqual(new[] {"down:F9","up:F9"}),"release all also drops a queued pulse");
        Check(relay.Pulse(keys.Text,80,2000) == null && injector.Calls.Last() == "down:Mouse5","X buttons relay through mouse input");
        relay.ReleaseAll(); Check(injector.Calls.Last() == "up:Mouse5" && !relay.Busy,"release all on focus loss or shutdown");
        int releases = injector.Calls.Count(call => call.StartsWith("up:"));
        relay.ReleaseAll(); Check(injector.Calls.Count(call => call.StartsWith("up:")) == releases,"no duplicate releases");
        var unbound = EssentialBindings.Parse(new[] {"TextKey=None"});
        Check(relay.Pulse(unbound.Text,80,3000) == "essential_key_unbound" && relay.Pulse(keys.MarkedTalk,80,3000) == "essential_key_unsupported" && relay.Pulse(keys.Talk,80,3000) == "essential_key_unsupported" && relay.Pulse(null,80,3000) == "essential_key_unbound","unbound, unknown and mouse-button keys are not relayed");
        injector.Fail = true; Check(relay.Pulse(keys.Mark,80,4000) == "native_operation_failed" && !relay.Busy,"a failed SendInput leaves nothing held");
    }
}
