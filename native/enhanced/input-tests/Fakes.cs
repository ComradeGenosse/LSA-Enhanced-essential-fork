using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;

// Test doubles for the loader seams. Everything is single-threaded and driven
// by a manual clock, so gesture and dispatch timing is exact.
sealed class FakeClock : IClock
{
    public long Monotonic {get;set;} = 1000;
    public long Utc {get;set;} = 1_800_000_000_000;
    public void Advance(long ms) { Monotonic += ms; Utc += ms; }
}
sealed class FakeHud : IHud
{
    public readonly List<string> Shown = new List<string>();
    public void Show(string text) => Shown.Add(text);
    public string Last => Shown.LastOrDefault();
}
sealed class FakeInjector : IInputInjector
{
    public readonly List<string> Calls = new List<string>();
    public bool Fail;
    public bool Press(int vk) { if (Fail) return false; Calls.Add("down:" + PhysicalKeys.Name(vk)); return true; }
    public bool Release(int vk) { Calls.Add("up:" + PhysicalKeys.Name(vk)); return true; }
    public int Presses(string name) => Calls.Count(call => call == "down:" + name);
}
sealed class FakeBridge : INativeBridge, IEssentialInputBridge
{
    public bool InputSupported;
    public readonly LSA.PromotedCharacters.InputLeaseState Input = new LSA.PromotedCharacters.InputLeaseState();
    public FakeClock InputClock;
    public readonly List<int> Pulses = new List<int>();
    public int TalkLeaseCalls, TalkReleaseCalls;
    public bool LeaseInput(int mark,int text) => InputSupported && InputClock != null && Input.LeaseRouter(mark,text,InputClock.Monotonic);
    public bool LeaseTalkInput(int talk) { TalkLeaseCalls++; return InputSupported && InputClock != null && Input.LeaseTalk(talk,InputClock.Monotonic); }
    public bool PulseInput(int vk) { if (!InputSupported || InputClock == null || !Input.Pulse(vk,InputClock.Monotonic)) return false; Pulses.Add(vk); return true; }
    public void ReleaseInput() => Input.ReleaseRouter();
    public void ReleaseTalkInput() { TalkReleaseCalls++; Input.ReleaseTalk(); }
    public bool Available {get;set;} = true;
    public string SnapshotJson;
    public readonly List<string> Submitted = new List<string>();
    public readonly Dictionary<string,string> Results = new Dictionary<string,string>();
    public int Interest;
    public string NextSubmitReply = "accepted";
    public string Submit(string envelope) { Submitted.Add(envelope); return NextSubmitReply; }
    public string TryTakeResult(string id) { if (Results.TryGetValue(id,out var text)) { Results.Remove(id); return text; } return null; }
    public string Snapshot() => SnapshotJson;
    public void RequestSnapshots(int forMs) => Interest++;
    public Dictionary<string,object> LastEnvelope => (Dictionary<string,object>)new JavaScriptSerializer().DeserializeObject(Submitted.Last());
    public void Complete(string reason)
    {
        string id = (string)LastEnvelope["id"];
        Results[id] = new JavaScriptSerializer().Serialize(new Dictionary<string,object> {{"v",1},{"id",id},{"command","npc.ask"},{"status",reason == null ? "ok" : "failed"},{"reason",reason},{"result",null}});
    }
    public void SetSnapshot(long builtAtUtc,object current,object gates = null) =>
        SnapshotJson = new JavaScriptSerializer().Serialize(new Dictionary<string,object> {{"v",1},{"seq",1},{"builtAtUtc",builtAtUtc},{"current",current},{"gates",gates ?? Gates()},{"reason",null}});
    public static Dictionary<string,object> Gates(bool textInput = false,bool menu = false,bool cutscene = false,bool playerSwitch = false,bool loading = false) =>
        new Dictionary<string,object> {{"textInputOpen",textInput},{"controlsMenuOpen",menu},{"cutscene",cutscene},{"playerSwitch",playerSwitch},{"mission",false},{"online",false},{"loading",loading},{"inputFree",!textInput && !menu},{"scripted",cutscene || playerSwitch || loading}};
    public const string Encounter = "7a3e9b1c-5d2f-4e8a-b6c4-1f0e9d8c7b6a";
    public const string Alias = "promoted.11111111-1111-4111-8111-111111111111";
    public static Dictionary<string,object> Ordinary() => new Dictionary<string,object> {{"present",true},{"pedId","101"},{"encounterId",Encounter},{"ownerAlias",null},{"owned",false},{"suspended",false},{"mode",null},{"human",true},{"safe",true}};
    public static Dictionary<string,object> Owned() => new Dictionary<string,object> {{"present",true},{"pedId","102"},{"encounterId",Encounter},{"ownerAlias",Alias},{"owned",true},{"suspended",false},{"mode","wait"},{"human",true},{"safe",true}};
    public static Dictionary<string,object> Absent() => new Dictionary<string,object> {{"present",false}};
}
sealed class FakeCompanion : ICompanion
{
    public readonly List<string> Bodies = new List<string>();
    public readonly List<int> Timeouts = new List<int>();
    readonly Queue<Action<CompanionReply>> pending = new Queue<Action<CompanionReply>>();
    public void Post(string body,int maxBodyBytes,int timeoutMs,Action<CompanionReply> done) { Bodies.Add(body); Timeouts.Add(timeoutMs); pending.Enqueue(done); }
    public int Pending => pending.Count;
    public void Reply(bool ok,string error = null,string body = null) => pending.Dequeue()(new CompanionReply {Ok = ok,Error = error,Body = body,Status = ok ? 200 : 400});
    // A transport failure: no HTTP status at all (companion not running).
    public void Unreachable() => pending.Dequeue()(new CompanionReply {Error = "companion_unavailable"});
    public Dictionary<string,object> Last => (Dictionary<string,object>)new JavaScriptSerializer().DeserializeObject(Bodies.Last());
}
sealed class FakeKeys : IKeySource
{
    public readonly HashSet<int> Down = new HashSet<int>();
    public bool Focus = true;
    public bool IsDown(int vk) => Down.Contains(vk);
    public bool GameHasFocus() => Focus;
}
sealed class FakeGame : IGameState
{
    public bool ConsoleOpen {get;set;}
    public bool Paused {get;set;}
}
sealed class FakeUi : IUiController
{
    public bool Available {get;set;} = true;
    public bool AnyMenuOpen {get;set;}
    public readonly List<string> Toggles = new List<string>();
    public void Toggle(string page) { Toggles.Add(page); AnyMenuOpen = !AnyMenuOpen; }
}
sealed class FakeSurface : LSA.Enhanced.Ui.IMenuSurface
{
    public bool AnyOpen {get;set;}
    public readonly List<string> Calls = new List<string>();
    public bool ThrowOnTick;
    public void Toggle(string page) { Calls.Add("toggle:" + page); AnyOpen = !AnyOpen; }
    public void Tick() { if (ThrowOnTick) throw new InvalidOperationException("tick"); Calls.Add("tick"); }
    public void CloseAll() { Calls.Add("close"); AnyOpen = false; }
}
