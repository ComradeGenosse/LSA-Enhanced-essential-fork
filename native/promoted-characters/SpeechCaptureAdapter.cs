using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using LosSantosAlive.Input;
using Rage;

namespace LSA.PromotedCharacters
{
    // C-01 source-time recorder. It observes Essential's *existing* microphone
    // lifecycle. It never starts/stops recording and never produces hearing facts.
    // All raw Ped references stay within the native host; none cross the pipe.
    internal sealed class SpeechCaptureAdapter
    {
        const string CoreHash = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
        const int StartToken = 0x0600016f, StopToken = 0x06000170;
        const int Limit = 32, TimeoutMs = 30000;
        static volatile SpeechCaptureAdapter installed;
        readonly object gate = new object();
        static bool patched;
        readonly HostContext host;
        readonly EssentialMicState mic = new EssentialMicState();
        readonly Queue<Fact> pending = new Queue<Fact>();
        Live current;
        bool overflow, disabled;

        internal sealed class Fact
        {
            public string utteranceId, phase, terminal, hostRunId, inputSource;
            public int worldEpoch;
            public uint gameTick;
            public long monotonicMs;
            public Ped Ped;
            public IntPtr Address;
        }
        sealed class Live
        {
            public string Id;
            public Ped Ped;
            public IntPtr Address;
            public long Started;
            public uint StartTick;
            public int WorldEpoch;
            public bool Prepared;
        }
        sealed class StopSample
        {
            public Ped Ped;
            public IntPtr Address;
            public uint Tick;
            public long Time;
        }
        SpeechCaptureAdapter(HostContext context) { host = context; }
        static MethodInfo HookMethod(Assembly core,int token,string expected)
        {
            var method=core.ManifestModule.ResolveMethod(token) as MethodInfo;
            if(method==null || method.DeclaringType!=typeof(InputController) ||
               method.Name!=expected || !method.IsStatic ||
               method.ReturnType!=typeof(void)) throw new InvalidOperationException("c01_core_method_mismatch");
            return method;
        }
        internal static SpeechCaptureAdapter Attach(HostContext context)
        {
            if(installed!=null || context==null)return null;
            var candidate=new SpeechCaptureAdapter(context);
            try {
                if(!candidate.mic.Available)throw new InvalidOperationException("c01_mic_field_missing");
                var core=typeof(InputController).Assembly;
                using(var hash=SHA256.Create()) {
                    var actual=BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(core.Location))).Replace("-","").ToLowerInvariant();
                    if(actual!=CoreHash)throw new InvalidOperationException("c01_core_pin_mismatch");
                }
                // Exact pinned private central start; this is NOT a key-poll hook.
                var start=core.ManifestModule.ResolveMethod(StartToken) as MethodInfo;
                if(start==null || start.DeclaringType!=typeof(InputController) || !start.IsStatic || start.ReturnType!=typeof(void))
                    throw new InvalidOperationException("c01_start_signature_mismatch");
                var stop=HookMethod(core,StopToken,"SendMicStop");
                var harmonyAssembly=AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a=>a.GetName().Name=="0Harmony") ??
                    Assembly.LoadFrom(InputHookFiles.HarmonyPath(AppDomain.CurrentDomain.BaseDirectory));
                var harmony=harmonyAssembly.GetType("HarmonyLib.Harmony",true);
                var harmonyMethod=harmonyAssembly.GetType("HarmonyLib.HarmonyMethod",true);
                var instance=Activator.CreateInstance(harmony,new object[]{"comrade.lsa.c01-mic-lifecycle"});
                var patch=harmony.GetMethods().Single(m=>m.Name=="Patch"&&m.GetParameters().Length==5);
                object M(string name)=>Activator.CreateInstance(harmonyMethod,new object[]{typeof(SpeechCaptureAdapter).GetMethod(name,BindingFlags.Static|BindingFlags.NonPublic)});
                // After first successful install, rebind the receiver on host reload
                // rather than adding a second Harmony patch to Core.
                if(!patched) {
                    patch.Invoke(instance,new object[]{start,M("BeforeStart"),M("AfterStart"),null,null});
                    patch.Invoke(instance,new object[]{stop,M("BeforeStop"),M("AfterStop"),null,null});
                    patched=true;
                }
                installed=candidate;
                Game.LogTrivial("[C01] mic_hooks=attached source=pinned_core mode=shadow");
                return candidate;
            } catch(Exception e) {
                var root=e;
                while(root is TargetInvocationException && root.InnerException!=null)root=root.InnerException;
                Game.LogTrivial("[C01] mic_hooks=unavailable reason="+root.GetType().Name);
                return null;
            }
        }
        static void BeforeStart(object[] __args)
        {
            try {installed?.PrepareStart(__args);}catch {installed?.Disable();}
        }
        static void AfterStart()
        {
            try {installed?.ObserveStart();}catch {installed?.Disable();}
        }
        // Mint ahead of Core's hydration/EnrichActor callback when its pinned
        // shared start signature actually carries a Ped. The postfix confirms
        // Core owns that microphone before emitting an authoritative start.
        // If the signature does not expose a Ped, retain the old fail-closed
        // postfix-only source behavior rather than synthesizing a target.
        void PrepareStart(object[] args)
        {
            if(disabled || args==null)return;
            var ped=args.OfType<Ped>().FirstOrDefault();
            if(ped==null || !ped.Exists())return;
            IntPtr address;try{address=ped.MemoryAddress;}catch{return;}
            if(address==IntPtr.Zero)return;
            lock(gate) {
                if(disabled || current!=null)return;
                current=new Live{Id=Guid.NewGuid().ToString("D"),
                    Ped=ped,Address=address,Started=host.MonotonicMs,
                    StartTick=unchecked((uint)Game.GameTime),
                    WorldEpoch=host.WorldEpoch,Prepared=true};
            }
        }
        static void BeforeStop(ref StopSample __state)
        {
            try {__state=installed?.SampleStop();}catch {installed?.Disable();}
        }
        static void AfterStop(StopSample __state)
        {
            try {installed?.ObserveStop(__state);}catch {installed?.Disable();}
        }
        StopSample SampleStop()
        {
            if(disabled || !mic.TryRead(out var ped) || ped==null)return null;
            IntPtr addr;
            try {addr=ped.MemoryAddress;}catch{return null;}
            return new StopSample{Ped=ped,Address=addr,Time=host.MonotonicMs,Tick=unchecked((uint)Game.GameTime)};
        }
        void Enqueue(Fact item)
        {
            if(disabled)return;
            if(pending.Count>=Limit){Disable();return;}
            pending.Enqueue(item);
        }
        void Emit(string phase,string terminal,Live live,uint tick,long now)
        {
            Enqueue(new Fact{utteranceId=live.Id,phase=phase,terminal=terminal,
                hostRunId=host.HostRunId,worldEpoch=live.WorldEpoch,gameTick=tick,
                monotonicMs=now,inputSource="essential_mic",Ped=live.Ped,Address=live.Address});
        }
        void ObserveStart()
        {
            if(disabled || !mic.TryRead(out var ped) || ped==null) {
                lock(gate)if(current?.Prepared==true)current=null;
                return;
            }
            IntPtr address;
            try {address=ped.MemoryAddress;}catch{return;}
            if(address==IntPtr.Zero)return;
            long now=host.MonotonicMs;uint tick=unchecked((uint)Game.GameTime);
            lock(gate) {
                if(disabled)return;
                if(current!=null) {
                    if(SamePed(current.Ped,ped,current.Address) && current.Address==address) {
                        if(current.Prepared) {
                            current.Prepared=false;
                            Emit("started",null,current,current.StartTick,current.Started);
                        }
                        return;
                    }
                    if(!current.Prepared)Emit("ended","replaced",current,tick,now);
                }
                current=new Live{Id=Guid.NewGuid().ToString("D"),Ped=ped,Address=address,Started=now,StartTick=tick,WorldEpoch=host.WorldEpoch};
                Emit("started",null,current,tick,now);
            }
        }
        void ObserveStop(StopSample before)
        {
            if(disabled || before==null)return;
            var readable=mic.TryRead(out var after);
            bool stillOwned=false;
            try {stillOwned=readable && after!=null && SamePed(after,before.Ped,before.Address);} catch {readable=false;}
            lock(gate) {
                if(disabled || current==null || !SamePed(before.Ped,current.Ped,current.Address) || before.Address!=current.Address)return;
                // A failed SendMicStop is not a terminal event. Clock is sampled
                // after the Core stop, not at the earlier prefix.
                if(stillOwned)return;
                Emit("ended",readable?"released":"unknown_mic_state",current,
                    unchecked((uint)Game.GameTime),host.MonotonicMs);
                current=null;
            }
        }
        internal void Reconcile()
        {
            if(disabled)return;
            long now=host.MonotonicMs;
            bool valid=mic.TryRead(out var active);
            IntPtr address=IntPtr.Zero;
            try {if(active!=null)address=active.MemoryAddress;}catch{valid=false;}
            lock(gate) {
                if(current==null || disabled || current.Prepared)return;
                string reason=current.WorldEpoch!=host.WorldEpoch?"world_reset":
                    now-current.Started>TimeoutMs?"timeout":
                    !valid?"unknown_mic_state":
                    !SamePed(active,current.Ped,current.Address)||address!=current.Address?"ownership_lost":null;
                if(reason!=null) {
                    Emit("ended",reason,current,unchecked((uint)Game.GameTime),now);
                    current=null;
                }
            }
        }
        // A source-pinned P0 actor may be rewrapped by Essential. Never require
        // CLR reference equality for the same live native Ped.
        static bool SamePed(Ped a,Ped b,IntPtr address)
        {
            try {return a!=null && b!=null && a.Exists() && b.Exists() &&
                a.Handle==b.Handle && a.MemoryAddress==address && b.MemoryAddress==address &&
                address!=IntPtr.Zero;}catch{return false;}
        }
        internal string ActiveIdFor(Ped target)
        {
            if(disabled)return null;
            lock(gate) {
                return current!=null && current.WorldEpoch==host.WorldEpoch &&
                    SamePed(current.Ped,target,current.Address) ? current.Id : null;
            }
        }
        internal Fact Take() {lock(gate)return pending.Count==0?null:pending.Dequeue();}
        internal void Reset() {lock(gate) {current=null;pending.Clear();}}
        internal void Disable() {lock(gate) {disabled=true;overflow=true;current=null;pending.Clear();}}
        internal void Detach()
        {
            Reset();disabled=true;
            if(ReferenceEquals(installed,this))installed=null;
        }
        internal bool Available => !disabled;
        internal bool Overflowed => overflow;
    }
}
