using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;
using LSA.Enhanced.Ui;
using LSA.PromotedCharacters;

static partial class Program
{
    const int F10 = 0x79;
    static void TalkTests()
    {
        PolicyTests();
        PttSessionTests();
        GeometryTests();
        TalkSettingsTests();
        TalkInputTests();
        TalkViewTests();
    }
    static TalkCandidate Ped(string id,float distance,float error,bool onScreen,int order) => new TalkCandidate {PedId = id,Address = order + 10,Distance = distance,ScreenCenterError = error,OnScreen = onScreen,InputOrder = order};
    static void PolicyTests()
    {
        var options = new TalkTargetOptions();
        var farCenter = Ped("b",8,0,true,1);
        var nearEdge = Ped("a",5,400,true,0);
        var closerOff = Ped("c",3,900,false,2);
        var ranked = TalkTargetPolicy.Rank(new[] {nearEdge,closerOff,farCenter},8);
        Check(ranked.Select(item => item.PedId).SequenceEqual(new[] {"b","a","c"}),"on-screen center outranks a nearer edge and an off-screen ped");
        var many = new List<TalkCandidate>();
        for (int index = 0; index < 12; index++) many.Add(Ped("p" + index.ToString("00"),index,0,true,index));
        Check(TalkTargetPolicy.Rank(many,8).Count == 8 && TalkTargetPolicy.Rank(many,8)[0].PedId == "p00","ranking keeps the eight closest");
        var policy = new TalkTargetPolicy();
        var first = policy.SelectFirst(new[] {farCenter,nearEdge,closerOff},1000,options);
        Check(first.Present && first.PedId == "b" && first.CycleIndex == 1 && first.CycleCount == 3,"first selection is the best candidate");
        string id = first.SelectionId;
        var moved = new[] {Ped("c",1,0,true,0),Ped("a",1,0,true,1),Ped("b",50,900,false,2)};
        var next = policy.SelectNext(1100,options);
        Check(next.PedId == "a" && next.SelectionId != id && next.CycleIndex == 2,"the cycle order stays frozen when scores change");
        Check(policy.SelectNext(1200,options).PedId == "c" && policy.SelectNext(1300,options).PedId == "b","the cycle wraps");
        var single = new TalkTargetPolicy();
        var one = single.SelectFirst(new[] {nearEdge},0,options);
        var same = single.SelectNext(10,options);
        Check(one.PedId == "a" && same.PedId == "a" && same.CycleCount == 1 && same.SelectionId != one.SelectionId,"one candidate is reaffirmed");
        var empty = single.SelectFirst(new TalkCandidate[0],20,options);
        Check(!empty.Present && empty.Reason == "no_nearby_npc" && !single.HasSelection,"no candidate clears the previous selection");
        policy = new TalkTargetPolicy();
        policy.SelectFirst(new[] {farCenter},0,options);
        Check(!policy.CycleOpen(options.CycleWindowMs) && policy.SelectNext(options.CycleWindowMs,options).Reason == "cycle_expired" && policy.PedId == "b","the cycle window does not reshuffle or drop the current target");
        Check(policy.Confirm(policy.PedId,policy.Address,true,false,false,true,1,options.RetentionRadiusMeters,100) && policy.HasSelection,"a live matching ped stays selected");
        Check(!policy.Confirm("b",policy.Address + 1,true,false,false,true,1,options.RetentionRadiusMeters,100) && !policy.HasSelection,"the same handle at a new address is dropped");
        policy.SelectFirst(new[] {farCenter},0,options);
        Check(!policy.Confirm(policy.PedId,policy.Address,false,false,false,true,1,20,100) && !policy.HasSelection,"despawn clears the selection");
        policy.SelectFirst(new[] {farCenter},0,options);
        Check(!policy.Confirm(policy.PedId,policy.Address,true,true,false,true,1,20,100),"death clears the selection");
        policy.SelectFirst(new[] {farCenter},0,options);
        Check(!policy.Confirm(policy.PedId,policy.Address,true,false,false,true,21,20,100),"leaving the retention radius clears the selection");
        policy.SelectFirst(new[] {farCenter},0,new TalkTargetOptions {SelectionTimeoutMs = 2000,CycleWindowMs = 1500,RetentionRadiusMeters = 20,RadiusMeters = 15,MaxCandidates = 8});
        var stillThere = policy.Inspect(1999);
        var gone = policy.Inspect(2000);
        Check(stillThere.Present && !gone.Present && gone.Reason == "expired","selection expires at its deadline");
        policy.SelectFirst(new[] {farCenter},0,options);
        policy.Commit(policy.SelectionId,0);
        Check(policy.Confirm(policy.PedId,policy.Address,true,false,false,true,1,20,options.SelectionTimeoutMs + 1),"an active talk does not expire the selection");
        policy.Release(5000,options);
        Check(!policy.Inspect(5000 + options.SelectionTimeoutMs).Present,"release starts a fresh selection lifetime");
        policy.SelectFirst(new[] {farCenter},0,options);
        string old = policy.SelectionId;
        policy.ResetForWorldChange();
        Check(!policy.HasSelection && !policy.Confirm(old,1,true,false,false,true,1,20,1),"a world reset drops every frozen candidate");
        Check(!TalkTargetOptions.Valid(2,20,8,1500,8000) && !TalkTargetOptions.Valid(15,14,8,1500,8000) && !TalkTargetOptions.Valid(15,20,0,1500,8000) && TalkTargetOptions.Valid(15,20,8,1500,8000),"option bounds match the plan");
    }
    static void PttSessionTests()
    {
        var session = new TalkPttSession();
        var fenced = new TalkPttSession();
        Check(!fenced.ShouldStop(4) && !fenced.Commit(4) && !fenced.IsLive,"a stop recorded before commit refuses the late start");
        Check(!session.ShouldStop(4) && session.Admit(4) == "cancelled" && !session.IsLive,"a stop before admit cancels that generation");
        Check(session.Admit(5) == "start" && session.Commit(5) && session.IsLive,"a start commits one generation");
        Check(session.Admit(6) == "busy" && session.LiveGeneration == 5,"a second generation cannot steal the microphone");
        Check(session.ShouldStop(9) == false && session.LiveGeneration == 5,"a stop for another generation does not end this one");
        Check(session.ShouldStop(5) && session.IsLive && session.CompleteStop(5) && !session.IsLive && !session.ShouldStop(5),"the matching stop keeps ownership until physical completion, then runs once");
        Check(session.Admit(8) == "start" && session.Commit(8),"a generation can start after reset preparation");
        session.Reset();
        Check(!session.IsLive && session.Admit(8) == "start","reset drops ownership without implying a microphone stop");
    }
    static void GeometryTests()
    {
        var rects = new List<TalkRect>();
        Check(TalkTargetGeometry.TryBrackets(960,540,1920,1080,rects,out float labelX,out float labelY) && rects.Count == 8,"a centered target gets eight bracket strokes");
        Check(rects.All(rect => rect.X >= 0 && rect.Y >= 0 && rect.X + rect.W <= 1920 && rect.Y + rect.H <= 1080 && rect.W > 0 && rect.H > 0),"centered brackets stay on screen");
        Check(labelX > 0 && labelY > 0 && labelY < 540,"the cycle label sits above the bracket");
        Check(TalkTargetGeometry.TryBrackets(-40,-20,1920,1080,rects,out _,out _) && rects.All(rect => rect.X >= 0 && rect.Y >= 0 && rect.X + rect.W <= 1920 && rect.Y + rect.H <= 1080),"an off-screen head is clamped back onto the screen");
        Check(TalkTargetGeometry.TryBrackets(1900,1060,1920,1080,rects,out _,out _) && rects.All(rect => rect.X + rect.W <= 1920 && rect.Y + rect.H <= 1080),"a corner head stays inside the screen");
        Check(!TalkTargetGeometry.TryBrackets(10,10,20,20,rects,out _,out _) && rects.Count == 0,"a tiny surface draws nothing");
        Check(TalkTargetGeometry.OnScreen(0,0,100,100) && TalkTargetGeometry.OnScreen(100,100,100,100) && !TalkTargetGeometry.OnScreen(-0.1f,50,100,100),"screen membership includes the edges only");
        Check(Math.Abs(TalkTargetGeometry.CenterError(50,50,100,100)) < 0.01f && TalkTargetGeometry.CenterError(0,0,0,0) == float.MaxValue,"center error is distance from the screen center");
        Check(TalkTargetGeometry.CycleLabel(2,3) == "2/3" && TalkTargetGeometry.CycleLabel(0,3) == null,"cycle text is the one-based position");
    }
    static string TalkJson(bool enabled = true,string key = "F10",int hold = 220,int window = 1500,int timeout = 8000,double radius = 15,double retention = 20,int max = 8,string extra = "") =>
        "{\"version\":1" + extra + ",\"talkTargeting\":{\"enabled\":" + (enabled ? "true" : "false") + ",\"key\":\"" + key + "\",\"talkHoldMs\":" + hold + ",\"cycleWindowMs\":" + window + ",\"selectionTimeoutMs\":" + timeout + ",\"radiusMeters\":" + radius.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"retentionRadiusMeters\":" + retention.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"maxCandidates\":" + max + ",\"indicator\":true}}";
    static void TalkSettingsTests()
    {
        var defaults = EnhancedSettings.Defaults(catalog);
        Check(!defaults.TalkEnabled && defaults.TalkHoldMs == 220 && defaults.TalkCycleWindowMs == 1500 && defaults.TalkSelectionTimeoutMs == 8000 && defaults.TalkRadiusMeters == 15 && defaults.TalkMaxCandidates == 8,"missing talkTargeting leaves the feature off with plan defaults");
        var example = Settings(Resource("LSA.Enhanced.example.json"));
        Check(!example.TalkEnabled && example.TalkKeyName == "F10" && example.InputEnabled == defaults.InputEnabled,"the packaged example documents talk targeting disabled");
        var enabled = Settings(TalkJson());
        Check(enabled.TalkEnabled && enabled.TalkKeyCode == F10 && enabled.TalkKeyName == "F10","F10 is the neutral talk key");
        var previous = enabled;
        Check(!EnhancedSettings.TryParse(TalkJson(key: "Banana"),catalog,out _,out var error) && error.Contains("talkTargeting.key") && previous.TalkEnabled,"a bad talk section is rejected and the previous object is untouched");
        foreach (var pair in new[] {TalkJson(hold: 119),TalkJson(hold: 501),TalkJson(window: 499),TalkJson(window: 3001),TalkJson(timeout: 1999),TalkJson(timeout: 30001),TalkJson(radius: 2.9),TalkJson(radius: 30.1),TalkJson(radius: 18,retention: 17),TalkJson(max: 0),TalkJson(max: 17),TalkJson(key: "F6"),TalkJson(key: "F4")})
            Check(SettingsError(pair).StartsWith("talkTargeting"),"talk setting rejected: " + pair);
        Check(Settings(TalkJson(hold: 120)).TalkHoldMs == 120 && Settings(TalkJson(hold: 500)).TalkHoldMs == 500 && Settings(TalkJson(radius: 3,retention: 3)).TalkRadiusMeters == 3 && Settings(TalkJson(max: 16)).TalkMaxCandidates == 16,"talk bounds accept the edges");
        Check(Settings(TalkJson(enabled: false,extra: ",\"input\":{\"keys\":{\"L4\":\"F6\"}}")).TalkEnabled == false,"talk targeting can stay off beside the router keys");
        Check(SettingsError("{\"version\":1,\"talkTargeting\":{\"enabled\":true}}").Contains("key"),"enabled talk targeting needs a key");
        Check(SettingsError("{\"version\":1,\"talkTargeting\":{\"nope\":true}}").Contains("unknown setting"),"unknown talk settings are rejected");
    }
    sealed class TalkRig
    {
        public readonly FakeClock Clock = new FakeClock();
        public readonly FakeKeys Keys = new FakeKeys();
        public readonly FakeBridge Bridge = new FakeBridge();
        public readonly FakeHud Hud = new FakeHud();
        public readonly FakeGame Game = new FakeGame();
        public readonly List<string> Logs = new List<string>();
        public readonly TalkTargetInput Talk;
        public bool Menu;
        public EnhancedSettings Settings;
        public EssentialBindings Essential = EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F3"});
        public TalkRig(string json = null)
        {
            Settings = Program.Settings(json ?? TalkJson());
            Bridge.SetSnapshot(Clock.Utc,FakeBridge.Ordinary(),FakeBridge.Gates());
            Talk = new TalkTargetInput(Keys,Game,Bridge,Clock,Hud,Logs.Add,() => NativeSnapshot.Parse(Bridge.Snapshot()),() => Menu);
            Talk.Apply(Settings,Essential);
        }
        public void Frame(int frames = 1) { for (int index = 0; index < frames; index++) { Clock.Advance(10); Refresh(); Talk.Tick(); } }
        public void Refresh() => Bridge.SetSnapshot(Clock.Utc,FakeBridge.Ordinary(),FakeBridge.Gates());
        // The press is observed at the current clock. Elapse moves to pressAt + ms.
        public void Press() { Keys.Down.Add(F10); Refresh(); Talk.Tick(); }
        public void Elapse(int ms) { Clock.Advance(ms); Refresh(); Talk.Tick(); }
        public Dictionary<string,object> Last() => Bridge.LastEnvelope;
        public string LastCommand() => (string)Last()["command"];
        public void Reply(string id,object result,string reason = null)
        {
            Bridge.Results[id] = Json.Serialize(new Dictionary<string,object> {{"v",1},{"id",id},{"command","talk"},{"status",reason == null ? "ok" : "failed"},{"reason",reason},{"result",result}});
        }
        public string LastId() => (string)Last()["id"];
    }
    static void TalkInputTests()
    {
        var rig = new TalkRig();
        Check(rig.Talk.DisplayState == "On" && rig.Logs.Any(line => line.Contains("input=ready")),"talk input starts ready");
        rig.Press(); rig.Elapse(40); rig.Keys.Down.Remove(F10); rig.Frame(1);
        Check(rig.LastCommand() == "talk.select_first" && rig.Bridge.Submitted.All(item => !item.Contains("ptt_start")),"a tap selects and never starts PTT");
        string firstId = rig.LastId();
        rig.Reply(firstId,new Dictionary<string,object> {{"present",true},{"selectionId",Id()},{"encounterId",FakeBridge.Encounter},{"cycleIndex",1},{"cycleCount",3}});
        rig.Frame(1);
        Check(rig.Hud.Last == "Target 1/3","a selection reports its cycle position");
        rig.Press(); rig.Elapse(40); rig.Keys.Down.Remove(F10); rig.Frame(1);
        Check(rig.LastCommand() == "talk.select_next","a second tap cycles");
        rig.Reply(rig.LastId(),new Dictionary<string,object> {{"present",false},{"reason","no_nearby_npc"}}); rig.Frame(1);
        Check(rig.Hud.Last == "No nearby NPC","no candidate is reported without a microphone command");
        int submitted = rig.Bridge.Submitted.Count;
        rig.Press(); rig.Elapse(210);
        Check(rig.Talk.State == "pending" && rig.Bridge.Submitted.Count == submitted,"210 ms is still a press, not a talk");
        rig.Elapse(10);
        Check(rig.Talk.State == "start_pending" && rig.LastCommand() == "talk.ptt_start" && (bool)((Dictionary<string,object>)rig.Last()["args"])["selectFirst"] && !((Dictionary<string,object>)rig.Last()["target"]).ContainsKey("expect"),"a hold with no selection asks native to choose then commit");
        string start = rig.LastId();
        rig.Keys.Down.Remove(F10); rig.Frame(1);
        Check(rig.Talk.State == "idle" && rig.LastCommand() == "talk.ptt_stop","release while the start is pending sends one stop");
        string stop = rig.LastId();
        rig.Reply(start,new Dictionary<string,object> {{"started",true},{"selectionId",Id()},{"encounterId",FakeBridge.Encounter},{"cycleIndex",1},{"cycleCount",1}});
        rig.Frame(1);
        Check(rig.Talk.State == "idle" && rig.Bridge.Submitted.Count(item => item.Contains("talk.ptt_stop")) == 1,"a late start success does not open another microphone stop or a new press");
        rig.Reply(stop,new Dictionary<string,object> {{"stopped",true}}); rig.Frame(1);
        Check(!rig.Logs.Any(line => line.Contains("stop_abandoned")) && rig.Bridge.Submitted.Count(item => item.Contains("talk.ptt_stop")) == 1,"the matching stop completes");

        var direct = new TalkRig();
        direct.Press(); direct.Elapse(220);
        string directStart = direct.LastId();
        direct.Reply(directStart,new Dictionary<string,object> {{"started",true},{"selectionId",Id()},{"encounterId",FakeBridge.Encounter},{"cycleIndex",1},{"cycleCount",3}});
        direct.Frame(1);
        direct.Keys.Down.Remove(F10); direct.Frame(1);
        string directStop = direct.LastId();
        direct.Reply(directStop,new Dictionary<string,object> {{"stopped",true}}); direct.Frame(1);
        direct.Press(); direct.Elapse(40); direct.Keys.Down.Remove(F10); direct.Frame(1);
        Check(direct.LastCommand() == "talk.select_first","a normal direct hold does not silently enter explicit selector/cycle mode");

        var explicitHold = new TalkRig();
        explicitHold.Press(); explicitHold.Elapse(40); explicitHold.Keys.Down.Remove(F10); explicitHold.Frame(1);
        string explicitSelection = Id();
        explicitHold.Reply(explicitHold.LastId(),new Dictionary<string,object> {{"present",true},{"selectionId",explicitSelection},{"encounterId",FakeBridge.Encounter},{"cycleIndex",1},{"cycleCount",3}});
        explicitHold.Frame(1);
        explicitHold.Clock.Advance(2000); explicitHold.Refresh(); explicitHold.Talk.Tick();
        explicitHold.Press(); explicitHold.Elapse(220);
        var explicitArgs = (Dictionary<string,object>)explicitHold.Last()["args"];
        var explicitTarget = (Dictionary<string,object>)explicitHold.Last()["target"];
        var explicitExpect = (Dictionary<string,object>)explicitTarget["expect"];
        Check(!(bool)explicitArgs["selectFirst"] && (string)explicitExpect["selectionId"] == explicitSelection,"an explicit tap target remains usable after the cycle window closes");

        var late = new TalkRig();
        late.Press(); late.Elapse(220);
        string lateStart = late.LastId();
        late.Keys.Down.Remove(F10); late.Frame(1);
        late.Reply(late.LastId(),new Dictionary<string,object> {{"stopped",true}}); late.Frame(1);
        late.Reply(lateStart,new Dictionary<string,object> {{"started",true},{"selectionId",Id()},{"cycleIndex",1},{"cycleCount",1}}); late.Frame(1);
        Check(late.Talk.State == "idle" && late.Bridge.Submitted.Count(item => item.Contains("talk.ptt_stop")) == 1,"a start result that arrives after the stop completed does not stop again");

        var held = new TalkRig();
        held.Press(); held.Elapse(220);
        held.Reply(held.LastId(),new Dictionary<string,object> {{"started",true},{"selectionId",Id()},{"encounterId",FakeBridge.Encounter},{"cycleIndex",1},{"cycleCount",1}});
        held.Frame(1);
        Check(held.Talk.State == "talking","a start that returns while the key is held begins talking");
        held.Keys.Focus = false; held.Frame(1);
        Check(held.LastCommand() == "talk.ptt_stop" && held.Logs.Any(line => line.Contains("reason=focus")),"focus loss stops the UX4 generation");
        held.Reply(held.LastId(),new Dictionary<string,object> {{"stopped",true}});
        held.Keys.Focus = true; held.Frame(3);
        Check(held.Talk.State == "idle" && held.Bridge.Submitted.Count(item => item.Contains("talk.ptt_start")) == 1,"the key staying down after focus returns does not start again");

        var menu = new TalkRig();
        menu.Press(); menu.Elapse(220);
        menu.Reply(menu.LastId(),new Dictionary<string,object> {{"started",true},{"selectionId",Id()},{"cycleIndex",1},{"cycleCount",1}}); menu.Frame(1);
        menu.Menu = true; menu.Frame(1);
        Check(menu.LastCommand() == "talk.ptt_stop" && menu.Logs.Any(line => line.Contains("reason=menu")),"opening the menu stops talk");
        menu.Reply(menu.LastId(),new Dictionary<string,object> {{"stopped",true}});

        var reload = new TalkRig();
        reload.Press(); reload.Elapse(220);
        int before = reload.Bridge.Submitted.Count;
        reload.Talk.Apply(reload.Settings,reload.Essential);
        Check(reload.Bridge.Submitted.Count == before + 1 && reload.LastCommand() == "talk.ptt_stop","settings reload while talking sends one stop");
        reload.Reply(reload.LastId(),new Dictionary<string,object> {{"stopped",true}}); reload.Frame(1);
        reload.Talk.Apply(Settings("{\"version\":1}"),reload.Essential);
        Check(!reload.Talk.Enabled && reload.Talk.DisplayState == "Off","removing talkTargeting disables the feature");

        var shared = new TalkRig();
        shared.Bridge.InputSupported = true; shared.Bridge.InputClock = shared.Clock;
        shared.Essential = EssentialBindings.Parse(new[] {"TalkKey=F10","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F3"});
        shared.Talk.Apply(shared.Settings,shared.Essential);
        Check(shared.Talk.DisplayState == "On" && shared.Talk.Conflict == null && shared.Bridge.TalkLeaseCalls == 1,"a talk key matching Essential TalkKey enters shared interception mode");
        bool stockDown;
        Check(shared.Bridge.Input.Read(F10,true,shared.Clock.Monotonic,out stockDown) && !stockDown,"shared UX4 Talk suppresses Essential's duplicate physical Talk poll");
        shared.Press(); shared.Elapse(220);
        Check(shared.LastCommand() == "talk.ptt_start","shared Essential Talk key still drives UX4 hold-to-talk");
        shared.Talk.Stop();
        Check(shared.Bridge.TalkReleaseCalls == 1 && shared.Bridge.Input.Read(F10,true,shared.Clock.Monotonic,out stockDown) && !stockDown,"disabling UX4 drains a still-held shared Talk key");
        shared.Keys.Down.Remove(F10);
        Check(shared.Bridge.Input.Read(F10,false,shared.Clock.Monotonic,out stockDown) && !stockDown && !shared.Bridge.Input.Read(F10,true,shared.Clock.Monotonic,out stockDown),"stock Essential Talk returns after physical release");

        var sharedUnavailable = new TalkRig();
        sharedUnavailable.Essential = EssentialBindings.Parse(new[] {"TalkKey=F10","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F3"});
        sharedUnavailable.Talk.Apply(sharedUnavailable.Settings,sharedUnavailable.Essential);
        Check(sharedUnavailable.Talk.DisplayState == "Paused" && sharedUnavailable.Talk.Conflict.Contains("interception"),"shared Talk fails closed when interception is unavailable");

        foreach (var setting in new[] {"TextKey","MarkPedKey","MarkedPedTalkKey"}) {
            var conflict = new TalkRig();
            conflict.Essential = EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F3"}.Select(line => line.Split('=')[0] == setting ? setting + "=F10" : line));
            conflict.Talk.Apply(conflict.Settings,conflict.Essential);
            Check(conflict.Talk.DisplayState == "Paused" && conflict.Talk.Conflict.Contains(setting),"Essential conflict: " + setting);
        }

        var lost = new TalkRig();
        lost.Press(); lost.Elapse(220);
        lost.Reply(lost.LastId(),null,"target_lost"); lost.Frame(1);
        Check(lost.Talk.State == "idle" && lost.Hud.Last == "Target lost" && lost.Bridge.Submitted.Count(item => item.Contains("talk.ptt_stop")) == 0,"target loss before the microphone starts does not send a stop");

        var unavailable = new TalkRig();
        unavailable.Bridge.NextSubmitReply = "native_unavailable";
        unavailable.Press(); unavailable.Elapse(220);
        Check(unavailable.Talk.State == "idle" && unavailable.Bridge.Submitted.Count(item => item.Contains("talk.ptt_stop")) == 0,"native unavailable does not invent a stop");

        var shutdown = new TalkRig();
        shutdown.Press(); shutdown.Elapse(220);
        shutdown.Talk.Stop();
        Check(shutdown.LastCommand() == "talk.ptt_stop" && !shutdown.Talk.Enabled,"shutdown stops a pending start");
        shutdown.Reply(shutdown.LastId(),new Dictionary<string,object> {{"stopped",false}}); shutdown.Talk.Tick();

        var staleStop = new TalkRig();
        staleStop.Press(); staleStop.Elapse(220);
        staleStop.Keys.Down.Remove(F10); staleStop.Frame(1);
        string staleId = staleStop.LastId();
        staleStop.Reply(staleId,null,"native_stale"); staleStop.Frame(1);
        Check(staleStop.Bridge.Submitted.Count(item => item.Contains("talk.ptt_stop")) == 2,"a stale stop is retried once");
        staleStop.Reply(staleStop.LastId(),new Dictionary<string,object> {{"stopped",true}}); staleStop.Frame(1);
        Check(staleStop.Talk.State == "idle","the retried stop completes");

        var unresolved = new TalkRig();
        unresolved.Press(); unresolved.Elapse(220);
        unresolved.Keys.Down.Remove(F10); unresolved.Frame(1);
        int beforeSecond = unresolved.Bridge.Submitted.Count;
        unresolved.Keys.Down.Add(F10); unresolved.Frame(3);
        Check(unresolved.Bridge.Submitted.Count == beforeSecond && unresolved.Bridge.Submitted.Count(item => item.Contains("talk.ptt_start")) == 1,"a new hold cannot erase or bypass an unresolved previous stop");
        unresolved.Keys.Down.Remove(F10); unresolved.Frame(1);
        unresolved.Reply(unresolved.LastId(),new Dictionary<string,object> {{"stopped",true}}); unresolved.Frame(1);

        int starts = 0, stops = 0;
        var rapid = new TalkRig();
        for (int round = 0; round < 100; round++) {
            rapid.Press(); rapid.Elapse(40); rapid.Keys.Down.Remove(F10); rapid.Frame(1);
            if (rapid.LastCommand() == "talk.select_first" || rapid.LastCommand() == "talk.select_next") rapid.Reply(rapid.LastId(),new Dictionary<string,object> {{"present",true},{"selectionId",Id()},{"cycleIndex",1},{"cycleCount",1}});
            rapid.Press(); rapid.Elapse(220);
            if (rapid.LastCommand() == "talk.ptt_start") { starts++; rapid.Reply(rapid.LastId(),new Dictionary<string,object> {{"started",true},{"selectionId",Id()},{"cycleIndex",1},{"cycleCount",1}}); rapid.Frame(1); }
            rapid.Keys.Down.Remove(F10); rapid.Frame(1);
            if (rapid.LastCommand() == "talk.ptt_stop") { stops++; rapid.Reply(rapid.LastId(),new Dictionary<string,object> {{"stopped",true}}); rapid.Frame(1); }
        }
        Check(rapid.Talk.State == "idle" && starts == 100 && stops == 100,"100 hold and release cycles leave no owned generation");

        var follow = new TalkRig();
        follow.Bridge.SetSnapshot(follow.Clock.Utc,FakeBridge.Ordinary());
        var dispatcher = new LoaderDispatcher(catalog,follow.Bridge,new FakeCompanion(),follow.Hud,new EssentialKeyRelay(new FakeInjector()),follow.Clock) {Settings = () => follow.Settings,Essential = () => follow.Essential};
        Check(dispatcher.Dispatch(CommandCatalog.CurrentFollow,"chord") == null && ((Dictionary<string,object>)((Dictionary<string,object>)follow.Bridge.LastEnvelope["target"])["expect"])["encounterId"] as string == FakeBridge.Encounter,"current.follow names the encounter the snapshot got from the selected NPC");
    }
    static string Id() => Guid.NewGuid().ToString("D");
    static void TalkViewTests()
    {
        long now = 1_800_000_000_000;
        var current = FakeBridge.Ordinary();
        var root = new Dictionary<string,object> {{"v",1},{"seq",1},{"builtAtUtc",now},{"current",current},{"gates",FakeBridge.Gates()},{"talkTarget",new Dictionary<string,object> {{"present",true},{"selectionId",Id()},{"encounterId",FakeBridge.Encounter},{"pedId","20"},{"cycleIndex",2},{"cycleCount",3},{"pttCommitted",false},{"expiresInMs",4200},{"indicator","ready"}}},{"reason",null}};
        var snapshot = NativeSnapshot.Parse(Json.Serialize(root));
        Check(snapshot.TalkTarget != null && snapshot.TalkTarget.Present && snapshot.TalkTarget.CycleIndex == 2 && snapshot.Current.EncounterId == FakeBridge.Encounter,"a talk target parses beside the current NPC");
        var model = CurrentNpcView.Build(snapshot,now,null,true,true,EnhancedSettings.Defaults(catalog));
        Check(Line(model.Lines,"talk").Right == "Selected" && Line(model.Lines,"talkCycle").Right == "2/3" && Line(model.Lines,"talkExpires").Right == "5 s" && Line(model.Lines,"clearTalk").Command == CurrentNpcView.ClearTalkCommand,"the current NPC page shows the explicit target and can clear it");
        root["talkTarget"] = new Dictionary<string,object> {{"present",true},{"pedId","nope"}};
        var broken = NativeSnapshot.Parse(Json.Serialize(root));
        Check(broken != null && broken.Current.Present && broken.TalkTarget == null,"a malformed talk target does not blank the current NPC");
        var controls = ControlsView.Build(Settings(TalkJson()),EssentialBindings.Parse(new[] {"TalkKey=Mouse4","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F3"}),"ready",null,false,120,new GestureBinding[0],"Talking",null);
        Check(Line(controls,"talkTarget").Right == "Talking" && Line(controls,"talkKey").Right == "F10" && Line(controls,"talkHold").Right == "220 ms","controls show the talk-target state");
        var paused = ControlsView.Build(Settings(TalkJson()),EssentialBindings.Unavailable(),"ready",null,false,120,new GestureBinding[0],"Paused","Essential Talk interception unavailable");
        Check(Line(paused,"talkConflict").Right.Contains("interception"),"controls show a Talk interception failure");
    }
}
