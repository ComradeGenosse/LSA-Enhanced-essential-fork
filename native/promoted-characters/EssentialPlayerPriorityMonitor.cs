using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using LSA.Intelligence;
using LosSantosAlive.Input;

namespace LSA.PromotedCharacters
{
    // Passive Core-entry observer for Phase 13a C-06. No patch rewrites Core
    // behavior, synthesizes idle or owns a turn. Actual capture/model terminal
    // ownership is *not* supplied by these entry events (see checkpoint 89).
    internal static class EssentialPlayerPriorityMonitor
    {
        const string CoreHash="9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
        // Source-pinned internal shared entry called by InputController.Update
        // (stock PTT) and BOTH public SendMicStart overloads (UX4 and external).
        const int SharedMicStartToken=0x0600016f;
        static readonly object gate=new object();
        static readonly PlayerPriorityEpoch epoch=new PlayerPriorityEpoch();
        static bool attempted,installed;
        internal static long Read()=>installed?epoch.Revision:-1;
        static void ObserveOriginalCoreTransition()=>epoch.Transition();

        static MethodInfo One(Assembly core,string type,string name,params Type[] parameters)
        {
            var target=core.GetType(type,true);
            var method=target.GetMethod(name,BindingFlags.Public|BindingFlags.NonPublic|
                BindingFlags.Static,null,parameters,null);
            if(method==null || !method.IsStatic || method.GetMethodBody()==null)
                throw new InvalidOperationException("missing_core_entry_"+name);
            return method;
        }
        internal static bool Attach()
        {
            lock(gate) {
                if(attempted)return installed;
                attempted=true;
                try {
                    var core=typeof(InputController).Assembly;
                    if(core.GetName().Name!="LosSantosAlive")throw new InvalidOperationException("core_identity");
                    using(var hash=SHA256.Create())
                        if(BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(core.Location)))
                            .Replace("-","").ToLowerInvariant()!=CoreHash)
                            throw new InvalidOperationException("core_hash");
                    var helper=core.ManifestModule.ResolveMethod(SharedMicStartToken) as MethodInfo;
                    if(helper==null || !helper.IsStatic || helper.DeclaringType!=typeof(InputController) ||
                        helper.GetMethodBody()==null)
                        throw new InvalidOperationException("core_mic_entry");

                    // Names and signatures are checked under the pinned exact
                    // binary; mismatches never silently downgrade coverage.
                    var targets=new [] {
                        helper,
                        One(core,"LosSantosAlive.Input.InputController","SendMicStop"),
                        One(core,"LosSantosAlive.Input.InputController","SendTextPrompt",
                            typeof(Rage.Ped),typeof(string)),
                        One(core,"LosSantosAlive.Input.TextInputService","StartTextInputMode"),
                        One(core,"LosSantosAlive.Context.ConversationHydrationCoordinator","BeginMicTurn",typeof(Rage.Ped)),
                        One(core,"LosSantosAlive.Context.ConversationHydrationCoordinator","MarkMicReleased",typeof(Rage.Ped)),
                        One(core,"LosSantosAlive.NPC.NpcTargeting","SetPlayerConversationPed",typeof(Rage.Ped)),
                        One(core,"LosSantosAlive.NPC.NpcTargeting","ClearPlayerConversationPed"),
                        One(core,"LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService","NotifyPlayerTurnStarted")
                    };
                    if(targets.Distinct().Count()!=targets.Length)
                        throw new InvalidOperationException("duplicate_core_entry");
                    var loaded=AppDomain.CurrentDomain.GetAssemblies()
                        .FirstOrDefault(a=>a.GetName().Name=="0Harmony") ??
                        Assembly.LoadFrom(InputHookFiles.HarmonyPath(AppDomain.CurrentDomain.BaseDirectory));
                    var type=loaded.GetType("HarmonyLib.Harmony",true);
                    var hm=loaded.GetType("HarmonyLib.HarmonyMethod",true);
                    var patch=type.GetMethods().Single(m=>m.Name=="Patch"&&m.GetParameters().Length==5);
                    var instance=Activator.CreateInstance(type,new object[]{"comrade.lsa.director.player-priority-observer"});
                    var prefix=Activator.CreateInstance(hm,new object[]{
                        typeof(EssentialPlayerPriorityMonitor).GetMethod(
                            "ObserveOriginalCoreTransition",BindingFlags.Static|BindingFlags.NonPublic)});
                    // Observe before Core is permitted to yield or send an
                    // asynchronous request. Failed/duplicate calls simply
                    // cause conservative extra invalidations.
                    foreach(var target in targets)patch.Invoke(instance,new object[]{target,prefix,null,null,null});
                    epoch.Installed();
                    installed=true;
                    return true;
                } catch(Exception ex) {
                    epoch.Unavailable();
                    installed=false;
                    try {Rage.Game.LogTrivial("[PS6] player_transition_observer unavailable "+ex.GetType().Name);}catch{}
                    return false;
                }
            }
        }
    }
}
