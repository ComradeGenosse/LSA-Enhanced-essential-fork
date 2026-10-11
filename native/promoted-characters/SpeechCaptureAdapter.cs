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
        static SpeechCaptureAdapter installed;
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
            public int WorldEpoch;
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
                // Install patches BEFORE exposing the receiver; hooks fail closed.
                patch.Invoke(instance,new object[]{start,null,M("AfterStart"),null,null});
                patch.Invoke(instance,new object[]{stop,M("BeforeStop"),M("AfterStop"),null,null});
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
        static void AfterStart()
        {
            try {installed?.ObserveStart();}catch {installed?.Disable();}
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
            if(disabled || !mic.TryRead(out var ped) || ped==null)return;
            IntPtr address;
            try {address=ped.MemoryAddress;}catch{return;}
            if(address==IntPtr.Zero)return;
            long now=host.MonotonicMs;uint tick=unchecked((uint)Game.GameTime);
            if(current!=null) {
                if(ReferenceEquals(current.Ped,ped) && current.Address==address)return;
                Emit("ended","replaced",current,tick,now);
            }
            current=new Live{Id=Guid.NewGuid().ToString("D"),Ped=ped,Address=address,Started=now,WorldEpoch=host.WorldEpoch};
            Emit("started",null,current,tick,now);
        }
        void ObserveStop(StopSample before)
        {
            if(disabled || before==null || current==null)return;
            if(!ReferenceEquals(before.Ped,current.Ped) || before.Address!=current.Address)return;
            // A failed SendMicStop is not a terminal event.
            if(mic.TryRead(out var after) && after!=null && ReferenceEquals(after,before.Ped) && after.MemoryAddress==before.Address)return;
            Emit("ended","released",current,before.Tick,before.Time);
            current=null;
        }
        internal void Reconcile()
        {
            if(disabled || current==null)return;
            long now=host.MonotonicMs;
            bool valid=mic.TryRead(out var active);
            IntPtr address=IntPtr.Zero;
            try {if(active!=null)address=active.MemoryAddress;}catch{valid=false;}
            string reason=current.WorldEpoch!=host.WorldEpoch?"world_reset":
                now-current.Started>TimeoutMs?"timeout":
                !valid?"unknown_mic_state":
                !ReferenceEquals(active,current.Ped)||address!=current.Address?"ownership_lost":null;
            if(reason!=null) {
                Emit("ended",reason,current,unchecked((uint)Game.GameTime),now);
                current=null;
            }
        }
        internal Fact Take() => pending.Count==0?null:pending.Dequeue();
        internal void Reset()
        {
            current=null;pending.Clear();
        }
        internal void Disable()
        {
            disabled=true;overflow=true;Reset();
        }
        internal bool Available => !disabled;
        internal bool Overflowed => overflow;
    }
}
