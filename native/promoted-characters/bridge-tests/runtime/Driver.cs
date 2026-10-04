using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.PromotedCharacters;
using LosSantosAlive.Core;
using LosSantosAlive.Input;
using LosSantosAlive.Integrations;
using LosSantosAlive.NPC;
using LosSantosAlive.NPC.Perception;
using Rage;
using Rage.Native;

namespace LSA.BridgeTests
{
    // Plays Essential's Core inside the harness's Essential domain: it ticks the
    // production integration on the caller's thread (Core's callback thread) and
    // configures the game substitutes. Only strings, ints and bools cross back.
    public sealed class Driver : MarshalByRefObject
    {
        readonly Dictionary<int,Ped> peds = new Dictionary<int,Ped>();
        readonly List<int> nearby = new List<int>();
        readonly HashSet<string> trueNatives = new HashSet<string>();
        readonly List<ControlRequest> pushed = new List<ControlRequest>();
        string failingNative;
        readonly HashSet<int> nonHuman = new HashSet<int>();
        int directed;
        public override object InitializeLifetimeService() => null;
        static PromotedCharactersIntegration Integration
        {
            get { lock (IntegrationManager.Registered) return IntegrationManager.Registered.OfType<PromotedCharactersIntegration>().SingleOrDefault(); }
        }
        public Driver()
        {
            NativeFunction.Handler = (name,args) => {
                // Stands in for an RPH invalid-handle or native failure.
                if (name == failingNative) throw new ApplicationException("native failure: " + name);
                if (name.StartsWith("GET_NUMBER",StringComparison.Ordinal)) return 0;
                return trueNatives.Contains(name);
            };
            NpcTargeting.Human = ped => !nonHuman.Contains(ped.Handle);
            NpcStateStore.State = ped => ped != null && ped.Handle == directed ? new NpcState {InDirectedInteraction = true} : null;
        }
        public bool WaitForIntegration(int milliseconds)
        {
            var until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (DateTime.UtcNow < until) {
                try { if (Integration != null) return true; } catch (InvalidOperationException) { }
                Thread.Sleep(10);
            }
            return false;
        }
        // Loads (never executes) the pinned Essential DLL so the real DomainHost
        // pin check passes in this domain, exactly as in Essential's domain.
        public bool LoadCore(string path) => Assembly.LoadFrom(path).GetName().Name == "LosSantosAlive";
        public void Tick() => Integration.Update();
        public bool Available => Integration?.IsAvailable == true;
        public bool Ready => Integration?.IsReady == true;
        public string Reason => Integration?.UnavailabilityReason;
        public int NativeCalls { get => Game.NativeCalls; set => Game.NativeCalls = value; }
        public int GameTime { set => Game.GameTime = value; }
        Ped Ped(int handle)
        {
            if (handle == 0) return null;
            if (!peds.TryGetValue(handle,out var ped)) peds[handle] = ped = new Ped {Handle = handle,MemoryAddress = new IntPtr(handle * 16)};
            return ped;
        }
        public void Select(int conversation,int speaker) { NpcTargeting.ConversationPed = Ped(conversation); NpcTargeting.SpeakerPed = Ped(speaker); }
        public void Kill(int handle) => Ped(handle).IsDead = true;
        public bool MicIsCurrent(int handle) => InputController.LastMic != null && peds.ContainsKey(handle) && ReferenceEquals(InputController.LastMic,peds[handle]);
        public void Gates(bool textInput,bool controlsMenu,bool loading) { TextInputService.IsOpen = textInput; LsaControlsMenu.BlocksLsaInput = controlsMenu; Game.IsLoading = loading; }
        public void Native(string name,bool value) { if (value) trueNatives.Add(name); else trueNatives.Remove(name); }
        public void Human(int handle,bool human) { if (human) nonHuman.Remove(handle); else nonHuman.Add(handle); }
        public void Directed(int handle) => directed = handle;
        public void FailNative(string name) => failingNative = name;
        // Queues admitted requests exactly where the pipe worker puts them, so a
        // tick can mix P2 pipe work with loader commands under one budget.
        public void PushPipe(string operation,int count)
        {
            var channel = typeof(PromotedCharactersIntegration).GetField("channel",BindingFlags.Instance | BindingFlags.NonPublic).GetValue(Integration);
            var requests = (ConcurrentQueue<ControlRequest>)typeof(ControlChannel).GetField("requests",BindingFlags.Instance | BindingFlags.NonPublic).GetValue(channel);
            var queued = typeof(ControlChannel).GetField("count",BindingFlags.Instance | BindingFlags.NonPublic);
            for (int index = 0; index < count; index++) {
                var request = new ControlRequest {RequestId = Guid.NewGuid().ToString("D"),Operation = operation,Args = new Dictionary<string,object>(),ExpiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 3000};
                queued.SetValue(channel,(int)queued.GetValue(channel) + 1); requests.Enqueue(request); pushed.Add(request);
            }
        }
        public string PipeOutcomes() { var outcomes = string.Join(",",pushed.Select(request => request.Done.IsSet ? request.Reason ?? "ok" : "pending")); pushed.Clear(); return outcomes; }
        public void PromptFailure(string mode) =>
            InputController.OnPrompt = mode == null ? null : (Action<Ped,string>)((ped,text) => { if (mode == "invalid_operation") throw new InvalidOperationException("Essential prompt failure"); throw new ApplicationException("Essential prompt failure"); });
        public int PromptCount => InputController.Prompts.Count;
        public string LastPrompt { get { var last = InputController.Prompts.LastOrDefault(); return last.Key == null ? null : last.Key.Handle + ":" + last.Value; } }
        public string[] Logs { get { lock (Game.Logs) return Game.Logs.ToArray(); } }
        // The read-only P2 pipe op, invoked exactly as Update dispatches a request.
        public void Clock(long value) => PromotedCharactersIntegration.SetMonotonic(value);
        public void ClearClock() => PromotedCharactersIntegration.SetMonotonic(null);
        public void ResetTalkCounters() { InputController.MicStarts = InputController.MicStops = 0; InputController.LastMic = null; NpcTargeting.Sets = NpcTargeting.Clears = 0; }
        public int MicStarts => InputController.MicStarts;
        public int MicStops => InputController.MicStops;
        public int ConversationSets => NpcTargeting.Sets;
        public int ConversationClears => NpcTargeting.Clears;
        public int ConversationHandle => NpcTargeting.ConversationPed?.Handle ?? 0;
        public int LastMicHandle => InputController.LastMic?.Handle ?? 0;
        public long LastMicAddress => InputController.LastMic == null ? 0 : InputController.LastMic.MemoryAddress.ToInt64();
        public void PlayerAt(float x,float y,float z)
        {
            var player = new Ped {Handle = 1,MemoryAddress = new IntPtr(16),Position = new Vector3(x,y,z)};
            Game.LocalPlayer.Character = player;
        }
        public void Nearby(int handle,float x,float y,float z,float screenX,float screenY)
        {
            var ped = Ped(handle);
            ped.Position = new Vector3(x,y,z);
            ped.Bone = new Vector3(x,y,z + 1f);
            ped.Existing = true; ped.IsDead = false;
            ped.ScreenX = screenX; ped.ScreenY = screenY;
            if (!nearby.Contains(handle)) nearby.Add(handle);
            World.Projector = world => {
                foreach (var candidate in peds.Values) if (Math.Abs(candidate.Bone.X - world.X) < 0.05f && Math.Abs(candidate.Bone.Y - world.Y) < 0.05f) return new Vector2 {X = candidate.ScreenX,Y = candidate.ScreenY};
                return new Vector2 {X = -100f,Y = -100f};
            };
        }
        public void PublishSnapshot()
        {
            var list = nearby.Select(handle => Ped(handle)).Where(ped => ped.Existing).ToArray();
            PerceptionSystem.Snapshot = new PerceptionSnapshot {AllPeds = list,GameTime = unchecked((int)Game.GameTime),IsValid = true};
        }
        public void SnapshotAge(int delta) { if (PerceptionSystem.Snapshot != null) PerceptionSystem.Snapshot.GameTime = unchecked((int)Game.GameTime) - delta; }
        public void ClearNearby() { nearby.Clear(); peds.Clear(); PerceptionSystem.Snapshot = null; }
        public void Despawn(int handle) => Ped(handle).Existing = false;
        public void Retarget(int handle,int address) => Ped(handle).MemoryAddress = new IntPtr(address);
        public string Capture()
        {
            var request = new ControlRequest {RequestId = Guid.NewGuid().ToString("D"),Operation = "capture",ExpiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 3000,Args = new Dictionary<string,object>()};
            var handle = typeof(PromotedCharactersIntegration).GetMethod("Handle",BindingFlags.Instance | BindingFlags.NonPublic);
            try { return new JavaScriptSerializer().Serialize(handle.Invoke(Integration,new object[] {request})); }
            catch (TargetInvocationException error) { return "error:" + error.InnerException?.Message; }
        }
        public string PipeCurrent(bool withArguments)
        {
            var request = new ControlRequest {RequestId = Guid.NewGuid().ToString("D"),Operation = "current",ExpiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 3000,
                Args = withArguments ? new Dictionary<string,object> {{"pedId","12"}} : new Dictionary<string,object>()};
            var handle = typeof(PromotedCharactersIntegration).GetMethod("Handle",BindingFlags.Instance | BindingFlags.NonPublic);
            try { return new JavaScriptSerializer().Serialize(handle.Invoke(Integration,new object[] {request})); }
            catch (TargetInvocationException error) { return "error:" + error.InnerException?.Message; }
        }
    }
}
