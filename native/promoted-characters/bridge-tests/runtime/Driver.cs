using System;
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
        readonly HashSet<string> trueNatives = new HashSet<string>();
        readonly HashSet<int> nonHuman = new HashSet<int>();
        int directed;
        public override object InitializeLifetimeService() => null;
        static PromotedCharactersIntegration Integration
        {
            get { lock (IntegrationManager.Registered) return IntegrationManager.Registered.OfType<PromotedCharactersIntegration>().SingleOrDefault(); }
        }
        public Driver()
        {
            NativeFunction.Handler = (name,args) => trueNatives.Contains(name);
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
        public void Gates(bool textInput,bool controlsMenu,bool loading) { TextInputService.IsOpen = textInput; LsaControlsMenu.BlocksLsaInput = controlsMenu; Game.IsLoading = loading; }
        public void Native(string name,bool value) { if (value) trueNatives.Add(name); else trueNatives.Remove(name); }
        public void Human(int handle,bool human) { if (human) nonHuman.Remove(handle); else nonHuman.Add(handle); }
        public void Directed(int handle) => directed = handle;
        public void PromptFailure(string mode) =>
            InputController.OnPrompt = mode == null ? null : (Action<Ped,string>)((ped,text) => { if (mode == "invalid_operation") throw new InvalidOperationException("Essential prompt failure"); throw new ApplicationException("Essential prompt failure"); });
        public int PromptCount => InputController.Prompts.Count;
        public string LastPrompt { get { var last = InputController.Prompts.LastOrDefault(); return last.Key == null ? null : last.Key.Handle + ":" + last.Value; } }
        public string[] Logs { get { lock (Game.Logs) return Game.Logs.ToArray(); } }
        // The read-only P2 pipe op, invoked exactly as Update dispatches a request.
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
