using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Threading;
using System.Threading.Tasks;
using LSA.Intelligence;
using Rage;
using LosSantosAlive.NPC;
using LosSantosAlive.NPC.Perception;
class Program
{
    static int assertions;
    static void Check(bool condition,string name) {if(!condition) throw new Exception(name);assertions++;}
    static object Get(object target,string name)=>target.GetType().GetField(name,BindingFlags.NonPublic|BindingFlags.Instance).GetValue(target);
    static void Set(object target,string name,object value)=>target.GetType().GetField(name,BindingFlags.NonPublic|BindingFlags.Instance).SetValue(target,value);
    static void Call(object target,string name,params object[] args)=>target.GetType().GetMethod(name,BindingFlags.NonPublic|BindingFlags.Instance).Invoke(target,args);
    static Dictionary<string,object> ReadFrame(StreamReader reader)
    {var line=Task.Run(()=>reader.ReadLine());if(!line.Wait(3000)) throw new TimeoutException("Timed out waiting for an intelligence frame.");return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line.Result);}
    static IEnumerable<Dictionary<string,object>> FrameAnchors(Dictionary<string,object> frame)=>((System.Collections.IEnumerable)frame["payload"]).Cast<object>().Cast<Dictionary<string,object>>();
    static Dictionary<string,object> Anchor(string captureRef,Dictionary<string,object> frame)=>FrameAnchors(frame).Single(a=>(string)a["captureRef"]==captureRef);
    static void Tick(IntelligenceIntegration integration)
    {Game.GameTime+=210;Set(integration,"nextDiscovery",0L);Set(integration,"nextState",0L);Set(integration,"nextShot",0L);integration.Update();}
    static void Main()
    {try{Run();}catch(Exception e){Console.Error.WriteLine(e.ToString());Environment.ExitCode=1;}}
    static void Run()
    {
        var unavailable=new IntelligenceIntegration(()=>new OwnedParticipant[0]);unavailable.Initialize();unavailable.Update();Check(!unavailable.IsAvailable,"missing pinned core fails closed");Check(Rage.Native.NativeFunction.Reads==0,"missing capability no game work");
        Check(unavailable.UpdateCalls==0&&unavailable.CompletedUpdates==0&&unavailable.RuntimeStatus().Contains("last_update_age_ms=2147483647"),"unavailable adapter does not invent update receipts");
        var player=new Ped {Handle=1,MemoryAddress=new IntPtr(1)};var actor=new Ped {Handle=2,MemoryAddress=new IntPtr(2)};
        Game.LocalPlayer.Character=player;NpcTargeting.Conversation=actor;bool owned=true;var lifetime=Guid.NewGuid().ToString("D");
        var directorMode=new DirectorOwnerSample {Owner="none",Mode="idle",Revision=2};
        NpcStateStore.Sampled=new NpcState();
        var rosterList=new List<OwnedParticipant> {new OwnedParticipant {Ped=actor,Lifetime=lifetime,
            Current=()=>owned&&actor.Existing,DirectorOwner=()=>directorMode}};
        var integration=new IntelligenceIntegration(()=>owned?rosterList.ToArray():new OwnedParticipant[0],"LSA.Integration.Tests."+Guid.NewGuid().ToString("N"));
        // Startup pin verification is independently tested above. The game harness
        // substitutes only external APIs, then executes the real Update/Sample code.
        Set(integration,"started",true);var sensors=(SensorAdapters)Get(integration,"sensors");sensors.Enabled=true;
        var caps=(Dictionary<string,bool>)Get(integration,"capabilities");foreach(var k in new[]{"state","shooting","action"}) caps[k]=true;
        Set(integration,"channel",new IntelligenceChannel("LSA.Unconnected.Tests",Guid.NewGuid().ToString("D"),()=>caps));
        PerceptionSystem.Snapshot=null;Tick(integration);Check(integration.IsAvailable,"optional snapshot absence preserves adapter");Check(!((Dictionary<string,bool>)Get(integration,"capabilities"))["snapshot"],"snapshot unavailable reported");
        Check(integration.UpdateCalls==1&&integration.CompletedUpdates==1&&integration.RuntimeStatus().Contains("shutdown_reason=none"),"completed production update records entry and completion");
        var anchors=(EntityAnchors)Get(integration,"anchors");Check(anchors.Count==2&&anchors.ObserverCount==1,"player and owned conversation baseline");
        // The optional Director probe reads live existing PS/P2 capture refs,
        // but cannot manufacture a source-pinned C-06 busy or PS3 grant proof.
        var c06speaker=anchors.Current.Single(a=>a.Kind=="ped");
        var c06player=anchors.Current.Single(a=>a.Kind=="player");
        var c06request=new DirectorAdmission.Request {
            HostRunId=((LSA.PromotedCharacters.HostContext)Get(integration,"host")).HostRunId,
            WorldEpoch=((LSA.PromotedCharacters.HostContext)Get(integration,"host")).WorldEpoch,
            SpeakerCaptureRef=c06speaker.CaptureRef,PlayerCaptureRef=c06player.CaptureRef,
            OwnerIncarnationId=lifetime,ProofRevision=1,PlayerTurnVersion=0,PolicyVersion=1
        };
        // All-positive fixture tests a *pure stock request DTO*, not an
        // actual Core/PS3 authorization, scheduling effect, or GTA runtime.
        c06request.TicketId=Guid.NewGuid().ToString("D");
        c06request.Version=1;c06request.Operation="submit";
        c06request.DedupeKey="ps:"+c06request.TicketId;c06request.AgeMs=100;
        c06request.ObservationId=Guid.NewGuid().ToString("D");
        c06request.DecisionKey="original-ps3-grant";
        c06request.ObservationRevision=1;
        var preparedProof=new DirectorC06Policy.Snapshot {
            HostRunId=c06request.HostRunId,WorldEpoch=c06request.WorldEpoch,
            SpeakerCaptureRef=c06request.SpeakerCaptureRef,PlayerCaptureRef=c06request.PlayerCaptureRef,
            OwnerIncarnationId=c06request.OwnerIncarnationId,OwnerProofRevision=c06request.ProofRevision,
            PlayerTurnVersion=c06request.PlayerTurnVersion,PolicyVersion=c06request.PolicyVersion,
            ObservationId=c06request.ObservationId,ObservationRevision=c06request.ObservationRevision,
            DecisionKey=c06request.DecisionKey,
            SpeakerAnchorCurrent=true,SpeakerOwned=true,SpeakerObserver=true,SpeakerAlive=true,
            PlayerAnchorCurrent=true,PlayerIsLocal=true,PlayerAlive=true,
            OwnerProofCurrent=true,OwnerPrimaryModeKnown=true,OwnerIdle=true,
            PlayerTurnSourceCurrent=true,PlayerTurnIdle=true,MicStateKnown=true,MicIdle=true,
            ConversationStateKnown=true,ConversationIdle=true,
            EssentialTurnKnown=true,EssentialTurnIdle=true,PlaybackKnown=true,PlaybackIdle=true,
            ScriptStateKnown=true,ScriptSafe=true,ActorReflexKnown=true,ActorReflexIdle=true,
            ObservationReceiptCurrent=true,ResponseGrantCurrent=true
        };
        Check(DirectorStockTurnRequest.Prepare(c06request,null,actor,player,
              "brief relevant reaction")==null,
              "missing C06 snapshot cannot construct Essential request");
        var prepared=DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,player,"brief relevant reaction");
        Check(prepared!=null && ReferenceEquals(prepared.SpeakerPed,actor) &&
              ReferenceEquals(prepared.ListenerPed,player) &&
              ReferenceEquals(prepared.SpeechTargetPed,player) &&
              prepared.Content=="brief relevant reaction" &&
              prepared.Reason=="ps6_observer" &&
              prepared.DedupeKey=="ps:"+c06request.TicketId,
              "stock kb request carries exact speaker, original ticket and listener");
        Check(!prepared.FaceListener&&!prepared.InterruptExisting &&
              prepared.DelayMilliseconds==0 && prepared.CancelIfPlayerStartsTurn &&
              !prepared.RequireCurrentPlayerConversation && prepared.SkipIfSpeakerBusy,
              "stock kb safety fields are noninterrupting and zero-delay");
        Check(DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,player,
              "unsafe"+((char)10)+"command")==null &&
              DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,actor,
              "context")==null,
              "newline and self-target forbidden");
        c06request.Operation="reserve";
        Check(DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,player,
              "context")==null,"non-submitted ticket cannot become stock request");
        c06request.Operation="submit";c06request.DedupeKey="ps:"+Guid.NewGuid().ToString("D");
        Check(DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,player,
              "context")==null,"forged dedupe cannot become stock request");
        c06request.DedupeKey="ps:"+c06request.TicketId;
        preparedProof.ObservationReceiptCurrent=false;
        Check(DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,player,
              "context")==null,"missing original PS3 receipt refuses stock request");
        preparedProof.ObservationReceiptCurrent=true;
        preparedProof.EssentialTurnKnown=false;
        Check(DirectorStockTurnRequest.Prepare(c06request,preparedProof,actor,player,
              "context")==null,"unknown Essential turn refuses stock request");

        var c06probe=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(c06probe.SpeakerAnchorCurrent && c06probe.SpeakerOwned && c06probe.SpeakerObserver &&
              c06probe.PlayerAnchorCurrent && c06probe.PlayerIsLocal && c06probe.OwnerProofCurrent,
              "real Core host reads the exact current owned observer and local player");
        Check(c06probe.OwnerPrimaryModeKnown&&c06probe.OwnerIdle&&
              c06probe.ActorReflexKnown&&c06probe.ActorReflexIdle&&
              c06probe.ScriptStateKnown&&c06probe.ScriptSafe,
              "native C06 samples explicit idle P2 mode, Core reflex and GTA scripted state");
        Check(c06probe.OwnerProofRevision==2 && !DirectorC06Policy.Safe(c06request,c06probe),
              "original P2 owner revision sampled but never synthesizes global permission");
        directorMode.Revision=3;
        var changedOwnerVersion=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(changedOwnerVersion.OwnerProofRevision==3 &&
              changedOwnerVersion.OwnerProofRevision!=c06request.ProofRevision &&
              !DirectorC06Policy.Safe(c06request,changedOwnerVersion),
              "owner revision changes even when idle owner/mode identity is unchanged");
        directorMode.Revision=0;
        var overflowOwnerVersion=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(overflowOwnerVersion.OwnerProofRevision==-1 &&
              !DirectorC06Policy.Safe(c06request,overflowOwnerVersion),
              "zero/overflow owner revision fails closed");
        directorMode.Revision=2;
        // Baseline setup has a deliberately selected player conversation.
        // A distinct truly-idle Core probe must not inherit that target.
        var earlierConversation=LosSantosAlive.NPC.NpcTargeting.Conversation;
        LosSantosAlive.NPC.NpcTargeting.Conversation=null;
        c06probe=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(c06probe.ConversationStateKnown && c06probe.ConversationIdle &&
              !c06probe.PlayerTurnSourceCurrent,
              "readable idle Core target/speaker is only negative conversation evidence, not a global grant");
        LosSantosAlive.NPC.NpcTargeting.Conversation=actor;
        var activeConversation=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(activeConversation.ConversationStateKnown && !activeConversation.ConversationIdle &&
              !DirectorC06Policy.Safe(c06request,activeConversation),
              "active Core player-conversation target independently vetoes Director");
        LosSantosAlive.NPC.NpcTargeting.Conversation=null;
        LosSantosAlive.NPC.NpcTargeting.CurrentSpeaker=actor;
        var activeSpeaker=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(activeSpeaker.ConversationStateKnown && !activeSpeaker.ConversationIdle &&
              !DirectorC06Policy.Safe(c06request,activeSpeaker),
              "active Essential current speaker independently vetoes Director");
        LosSantosAlive.NPC.NpcTargeting.CurrentSpeaker=null;
        LosSantosAlive.NPC.NpcTargeting.ThrowConversation=true;
        var unknownConversation=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!unknownConversation.ConversationStateKnown && !unknownConversation.ConversationIdle &&
              !DirectorC06Policy.Safe(c06request,unknownConversation),
              "failed Core conversation read never becomes idle");
        LosSantosAlive.NPC.NpcTargeting.ThrowConversation=false;
        LosSantosAlive.NPC.NpcTargeting.ThrowSpeaker=true;
        var unknownSpeaker=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!unknownSpeaker.ConversationStateKnown && !unknownSpeaker.ConversationIdle &&
              !DirectorC06Policy.Safe(c06request,unknownSpeaker),
              "failed Core speaker read never becomes idle");
        LosSantosAlive.NPC.NpcTargeting.ThrowSpeaker=false;
        LosSantosAlive.NPC.NpcTargeting.Conversation=earlierConversation;
        Check(c06probe.SpecialTurnVersionKnown && c06probe.SpecialTurnVersion==0 &&
              c06probe.PlaybackKnown && c06probe.PlaybackIdle &&
              !c06probe.PlayerTurnSourceCurrent && !c06probe.EssentialTurnKnown,
              "Core exposes real special-turn counter and global playback, not global player/Essential idle");
        LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.Version=(long)int.MaxValue+10L;
        var newerSpecial=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(newerSpecial.SpecialTurnVersionKnown && newerSpecial.SpecialTurnVersion==(long)int.MaxValue+10L &&
              newerSpecial.PlayerTurnVersion==-1 && !newerSpecial.PlayerTurnSourceCurrent,
              "64-bit special-turn version is preserved without truncating to request's unrelated int field");
        LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.Version=-1;
        var unknownSpecial=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!unknownSpecial.SpecialTurnVersionKnown && unknownSpecial.SpecialTurnVersion==-1,
              "invalid Core special-turn revision cannot be promoted as current");
        LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.Version=0;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.AnyAudio=true;
        var queuedAudio=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(queuedAudio.PlaybackKnown && !queuedAudio.PlaybackIdle &&
              !DirectorC06Policy.Safe(c06request,queuedAudio),
              "any Core playing or pending audio independently vetoes new speech");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.AnyAudio=false;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.ThrowRead=true;
        var failedPlayback=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!failedPlayback.PlaybackKnown && !failedPlayback.PlaybackIdle &&
              !DirectorC06Policy.Safe(c06request,failedPlayback),
              "unreadable Core playback fails closed instead of inferring idle");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.ThrowRead=false;
        LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.ThrowRead=true;
        var failedSpecial=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!failedSpecial.SpecialTurnVersionKnown && !failedSpecial.PlaybackKnown &&
              !DirectorC06Policy.Safe(c06request,failedSpecial),
              "failed special-turn revision read cannot silently grant playback");
        LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService.ThrowRead=false;
        Check(LosSantosAlive.Audio.NpcPlaybackCoordinator.BusyReads>=3,
              "Core global playback query is sampled on owner fiber");
        directorMode.Owner="act";directorMode.Mode="activity";
        var modeBusy=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(modeBusy.OwnerPrimaryModeKnown&&!modeBusy.OwnerIdle,"ACT owner is not native idle");
        directorMode.Owner="none";directorMode.Mode="idle";directorMode.Suspended=true;
        var suspended=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!suspended.OwnerIdle,"suspended P2 encounter vetoes idle");
        directorMode.Suspended=false;
        NpcStateStore.Sampled.HasActiveReflex=true;
        var reflex=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(reflex.ActorReflexKnown&&!reflex.ActorReflexIdle,"Core reflex vetoes Director");
        NpcStateStore.Sampled.HasActiveReflex=false;NpcStateStore.Sampled.InDirectedInteraction=true;
        var directed=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(directed.ActorReflexKnown&&!directed.ActorReflexIdle,"directed Essential interaction vetoes Director");
        NpcStateStore.Sampled.InDirectedInteraction=false;NpcStateStore.Sampled=null;
        var missingState=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!missingState.ActorReflexKnown&&!missingState.ActorReflexIdle,"missing Core actor state is unknown");
        NpcStateStore.Sampled=new NpcState();
        Rage.Native.NativeFunction.Scripted=true;
        var scripted=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(scripted.ScriptStateKnown&&!scripted.ScriptSafe,"scripted GTA state explicitly vetoes Director");
        Rage.Native.NativeFunction.Scripted=false;
        Rage.Native.NativeFunction.ThrowSafetyRead=true;
        var unreadable=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!unreadable.ScriptStateKnown&&!DirectorC06Policy.Safe(c06request,unreadable),
              "failed GTA safety native read never becomes safe");
        Rage.Native.NativeFunction.ThrowSafetyRead=false;
        Check(!c06probe.PlayerTurnSourceCurrent&&!c06probe.EssentialTurnKnown&&
              !c06probe.ResponseGrantCurrent&&!DirectorC06Policy.Safe(c06request,c06probe),
              "Core host never claims C06/player-turn or PS3 permission from anchor identity");
        // Pinned EssentialMicState is an independent read-only native source.
        // No synthetic "idle" if the private field is unavailable/busy.
        Set(integration,"directorMic",new LSA.PromotedCharacters.EssentialMicState());
        LSA.PromotedCharacters.EssentialMicState.Supported=true;
        LSA.PromotedCharacters.EssentialMicState.Idle=true;
        var micIdle=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(micIdle.MicStateKnown&&micIdle.MicIdle&&!DirectorC06Policy.Safe(c06request,micIdle),
              "pinned Essential native microphone empty is a known but insufficient C06 fact");
        LSA.PromotedCharacters.EssentialMicState.Idle=false;
        var micBusy=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(micBusy.MicStateKnown&&!micBusy.MicIdle&&!DirectorC06Policy.Safe(c06request,micBusy),
              "player microphone busy vetoes Director admission");
        LSA.PromotedCharacters.EssentialMicState.Supported=false;
        var micUnknown=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!micUnknown.MicStateKnown&&!micUnknown.MicIdle&&!DirectorC06Policy.Safe(c06request,micUnknown),
              "missing source-pinned Essential microphone field never means idle");
        LSA.PromotedCharacters.EssentialMicState.Supported=true;
        LSA.PromotedCharacters.EssentialMicState.Idle=true;
        owned=false;
        var ownerGone=(DirectorC06Policy.Snapshot)integration.GetType().GetMethod(
            "ReadDirectorC06",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{c06request});
        Check(!ownerGone.OwnerProofCurrent&&!DirectorC06Policy.Safe(c06request,ownerGone),
              "P2 association retired between admission checks cannot grant speech");
        owned=true;

        Check(sensors.Counters.Count==0,"initial baseline no events");
        var far=new Ped {Handle=3,MemoryAddress=new IntPtr(3),Position=new Vector3 {X=1000}};
        PerceptionSystem.Snapshot=new PerceptionSnapshot {GameTime=Game.GameTime-2000,AllPeds=new[]{far}};Tick(integration);Check(anchors.Count==2,"stale snapshot ignored");
        var nearby=new Ped {Handle=4,MemoryAddress=new IntPtr(4),Position=new Vector3 {X=5}};
        PerceptionSystem.Snapshot=new PerceptionSnapshot {GameTime=Game.GameTime+210,AllPeds=new[]{nearby,far}};Tick(integration);Tick(integration);
        Check(!anchors.Current.Any(a=>a.Handle==3),"cheap range rejection");Check(PerceptionSystem.Scans==0,"existing snapshot reused without scanner");
        var ordinaryAnchor=anchors.Current.Single(a=>a.Handle==4);Check(ordinaryAnchor.Observer&&ordinaryAnchor.OwnerLifetime==null,"ordinary snapshot ped receives transient observer admission without promotion");
        Set(integration,"lineOfSightBudget",8);var playerCapture=anchors.Current.Single(a=>a.Kind=="player").CaptureRef;
        var witnessed=(List<WitnessReceipt>)integration.GetType().GetMethod("CaptureWitnesses",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{new RawSignal {kind="firing",source=playerCapture,gameTick=99}});
        var promotedAnchor=anchors.Current.Single(a=>a.OwnerLifetime==lifetime);Check(witnessed.Any(w=>w.Observer==ordinaryAnchor.CaptureRef&&w.Channel=="visual")&&witnessed.Any(w=>w.Observer==promotedAnchor.CaptureRef&&w.Channel=="visual"),"ordinary and promoted observers use the same source-sample visual witness policy");
        // Warm the native substitutes before testing the 1 ms sampling budget.
        for(int n=0;n<3;n++) Tick(integration);
        player.Shooting=true;Tick(integration);Check(sensors.Counters.TryGetValue("firing",out var firing)&&firing==1,"real Update shooting edge");
        for(int n=0;n<5;n++) Tick(integration);Check(sensors.Counters["firing"]==1,"real Update sustained shooting bounded");
        actor.IsDead=true;actor.Health=0;Tick(integration);Check(sensors.Counters.TryGetValue("death",out var deaths)&&deaths==1,"real retained alive to dead");
        actor.Existing=false;Tick(integration);Check(sensors.Counters["death"]==1,"disappearance is not another death");
        owned=false;integration.OwnerRetired(lifetime);Check(!anchors.Current.Any(a=>a.OwnerLifetime==lifetime),"owner revoke clears original anchor");
        rosterList.Clear();owned=true;
        for(int n=0;n<16;n++) {var promoted=new Ped {Handle=(uint)(100+n),MemoryAddress=new IntPtr(100+n)};var ownerLifetime=Guid.NewGuid().ToString("D");rosterList.Add(new OwnedParticipant {Ped=promoted,Lifetime=ownerLifetime,Current=()=>promoted.Existing});}
        var conversation=new Ped {Handle=99,MemoryAddress=new IntPtr(99)};NpcTargeting.Conversation=conversation;Tick(integration);
        var conversationAnchor=anchors.Current.Single(a=>ReferenceEquals(a.Entity,conversation));var ownedObservers=anchors.Current.Where(a=>a.OwnerLifetime!=null&&a.Observer).ToArray();var demotedOwned=anchors.Current.Single(a=>a.OwnerLifetime!=null&&!a.Observer);
        Check(conversationAnchor.Observer&&anchors.ObserverCount==16,"conversation NPC takes priority at full 16 promoted observers");
        Check(ownedObservers.Length==15&&demotedOwned.OwnerLifetime!=null&&anchors.Resolve(demotedOwned.CaptureRef)==demotedOwned,"lowest-priority promoted observer demoted safely");
        var wireNextConversation=new Ped {Handle=98,MemoryAddress=new IntPtr(98)};var pipeName="LSA.Integration.Tests."+Guid.NewGuid().ToString("N");var wireCaps=(Dictionary<string,bool>)Get(integration,"capabilities");var wireChannel=new IntelligenceChannel(pipeName,Guid.NewGuid().ToString("D"),()=>wireCaps,((LSA.PromotedCharacters.HostContext)Get(integration,"host")).HostRunId,()=>((LSA.PromotedCharacters.HostContext)Get(integration,"host")).WorldEpoch,true);Set(integration,"channel",wireChannel);wireChannel.Start();
        using(var client=new NamedPipeClientStream(".",pipeName,PipeDirection.In)) {
            client.Connect(3000);using(var reader=new StreamReader(client)) {
                var hello=ReadFrame(reader);Check((string)hello["type"]=="hello","observer transition transport hello");Tick(integration);
                var received=new HashSet<string>();while(received.Count<anchors.Count) {var frame=ReadFrame(reader);if((string)frame["type"]!="anchors") continue;foreach(var item in FrameAnchors(frame)) received.Add((string)item["captureRef"]);}
                Check(received.Count==anchors.Count&&anchors.ObserverCount==16,"initial published roster has bounded observer set");
                Check((int)hello["observerIndexVersion"]==1 && hello.ContainsKey("hostRunId"),"native advertises closed index and host extension");
                var wireIndexed=new HashSet<string>();
                while(wireIndexed.Count<anchors.Count) {
                    var frame=ReadFrame(reader);Check((string)frame["type"]=="observer_index","index follows complete anchor admission");
                    var rows=FrameAnchors(frame).ToArray();Check(rows.Length<=32,"index wire batch bounded");
                    foreach(Dictionary<string,object> row in rows) {Check(received.Contains((string)row["captureRef"]) && !row.ContainsKey("characterId") && !row.ContainsKey("handle") && !row.ContainsKey("address"),"index references admitted private lifetime only");wireIndexed.Add((string)row["captureRef"]);}
                }

                var beforeConversation=conversationAnchor.CaptureRef;NpcTargeting.Conversation=wireNextConversation;Tick(integration);
                Dictionary<string,object> NextAnchor() {for(int n=0;n<16;n++) {var frame=ReadFrame(reader);if((string)frame["type"]=="anchors") return frame;}throw new Exception("missing anchor transition");}
                var demotion=NextAnchor();var promotion=NextAnchor();Check((string)demotion["type"]=="anchors"&&(string)promotion["type"]=="anchors","observer state changes use anchor frames");
                var demotedWire=Anchor(beforeConversation,demotion);var promotedWire=Anchor(anchors.Current.Single(a=>ReferenceEquals(a.Entity,wireNextConversation)).CaptureRef,promotion);
                Check((bool)demotedWire["observer"]==false&&(bool)demotedWire["conversation"]==false,"transport sends observer/conversation demotion first");
                Check((bool)promotedWire["observer"]&&(bool)promotedWire["conversation"],"transport sends conversation promotion after demotion");
                Check((bool)demotedWire["owned"]==false&&anchors.ObserverCount==16,"transport transition preserves ownership and hard observer cap");
            }
        }
        var conversationToken=conversationAnchor.CaptureRef;var nextConversation=wireNextConversation;NpcTargeting.Conversation=nextConversation;Tick(integration);
        var nextAnchor=anchors.Current.Single(a=>ReferenceEquals(a.Entity,nextConversation));
        Check(nextAnchor.Observer&&anchors.ObserverCount==16&&!conversationAnchor.Observer&&anchors.Resolve(conversationToken)==conversationAnchor,"changing conversation demotes prior target without retargeting token");
        NpcTargeting.Conversation=conversation;Tick(integration);
        Check(anchors.Current.Single(a=>ReferenceEquals(a.Entity,conversation)).CaptureRef==conversationToken&&conversationAnchor.Observer&&anchors.ObserverCount==16,"returning conversation restores same lifetime without token reuse");
        var replacement=new Ped {Handle=2,MemoryAddress=new IntPtr(2)};
        var old=anchors.Current.FirstOrDefault(a=>a.Handle==4);if(old!=null) {
            var newWrapper=new Ped {Handle=4,MemoryAddress=new IntPtr(4)};
            Call(integration,"Retain",newWrapper,"ped",null,false,null);Check(anchors.Resolve(old.CaptureRef)==null,"same handle/address replacement rejected");
            var oldToken=(string)integration.GetType().GetMethod("CallbackAnchor",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{(uint)4,nearby,false});Check(oldToken==null || anchors.Resolve(oldToken)==null,"old callback token stays retired");
            var wrong=(string)integration.GetType().GetMethod("CallbackAnchor",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(integration,new object[]{(uint)4,newWrapper,false});Check(wrong==null,"callback cannot borrow replacement token");
        }
        var before=Rage.Native.NativeFunction.Reads;integration.OnNpcActionExecuted(replacement,"follow",true);Check(Rage.Native.NativeFunction.Reads==before,"action callback no native operations");
        while(sensors.Take()!=null) {}
        var indexed=new Ped {Handle=7,MemoryAddress=new IntPtr(7)};
        Set(integration,"actionIndex",new Dictionary<Ped,string>{{indexed,Guid.NewGuid().ToString("D")}});
        integration.OnNpcActionExecuted(indexed,"followtarget",true);var action=sensors.Take();Check(action!=null&&(string)action.facts["action"]=="followtarget"&&(bool)action.facts["succeeded"],"canonical followtarget is preserved");
        integration.OnNpcActionExecuted(indexed,"waithere",false);action=sensors.Take();Check((string)action.facts["action"]=="waithere"&&(bool)action.facts["succeeded"]==false,"canonical waithere is preserved");
        integration.OnNpcActionExecuted(indexed,"follow",true);action=sensors.Take();Check((string)action.facts["action"]=="other","non-canonical follow is not classified as followtarget");
        integration.OnNpcActionExecuted(indexed,"wait",true);action=sensors.Take();Check((string)action.facts["action"]=="other","non-canonical wait is not classified as waithere");
        var previous=anchors.Current.Select(a=>a.CaptureRef).ToArray();Game.GameTime=0;integration.Update();Check(anchors.Current.All(a=>!previous.Contains(a.CaptureRef)),"clock reset discards stale anchors");
        Check(Rage.Native.NativeFunction.Effects==0&&NpcStateStore.Creates==0,"no task/state promotion effects");integration.Shutdown();before=Rage.Native.NativeFunction.Reads;integration.Update();Check(Rage.Native.NativeFunction.Reads==before,"shutdown performs no sampling");
        Check(Game.Logs.All(l=>!l.Contains(lifetime)),"diagnostics omit owner proofs");
        var calls=integration.UpdateCalls;integration.Shutdown("host_stop_requested");integration.Update();
        Check(integration.ShutdownReason=="integration_shutdown"&&integration.UpdateCalls==calls,"first shutdown reason and counters survive repeated shutdown");
        var failed=new IntelligenceIntegration(()=>new OwnedParticipant[0]);Set(failed,"started",true);failed.Update();
        Check(failed.UpdateCalls==1&&failed.CompletedUpdates==0&&!failed.IsAvailable&&failed.ShutdownReason=="update_failed","update failure remains distinguishable from completed updates");
        Check(Game.Logs.Any(l=>l.StartsWith("[PS] shutdown ")&&l.Contains("shutdown_reason=update_failed")),"formerly silent stop has bounded shutdown telemetry");
        var sinkFailed=new IntelligenceIntegration(()=>new OwnedParticipant[0]);Set(sinkFailed,"started",true);
        Game.ThrowLogs=true;
        try{IntelligenceIntegration.LogStatus("[PS] test_status");sinkFailed.Update();}finally{Game.ThrowLogs=false;}
        Check(!sinkFailed.IsAvailable&&sinkFailed.ShutdownReason=="update_failed","failed diagnostic sink cannot prevent optional update cleanup");
        Check(failed.RuntimeStatus().Contains("update_completed=0"),"diagnostic sink failure leaves lifecycle state intact");
        var host=new LSA.PromotedCharacters.HostContext();host.ObserveGameTick(2000);
        var sharedRoster=new List<OwnedParticipant>();
        var shared=new IntelligenceIntegration(()=>sharedRoster.ToArray(),"LSA.Shared.Tests."+Guid.NewGuid().ToString("N"),host);
        Set(shared,"started",true);Set(shared,"channel",new IntelligenceChannel("LSA.Shared.Unconnected",Guid.NewGuid().ToString("D"),()=>caps));
        Check(ReferenceEquals(Get(shared,"anchors"),host.Anchors),"integration uses supplied host table");
        host.Anchors.Retain(actor,(ulong)actor.Handle,actor.MemoryAddress,"ped",null,()=>true,host.MonotonicMs,false,AnchorConsumer.P2Encounter);
        Game.GameTime=100;shared.Update();Check(host.WorldEpoch==1,"shared PS does not run a second clock detector");
        host.ObserveGameTick(100);Check(host.WorldEpoch==2 && host.Anchors.Count==0 && shared.IsAvailable,"owner reset clears shared refs and reinitializes optional PS");
        actor.Existing=true;
        var kept=host.Anchors.Retain(actor,(ulong)actor.Handle,actor.MemoryAddress,"ped",null,()=>true,host.MonotonicMs,false,AnchorConsumer.P2Encounter);
        actor.IsDead=false;
        string PhysicalActivity()=> (string)shared.GetType().GetMethod("ObserverActivity",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(shared,new object[]{kept,actor});
        var sampledVehicle=new Vehicle {Handle=900,MemoryAddress=new IntPtr(900),Driver=actor};actor.CurrentVehicle=sampledVehicle;
        Check(PhysicalActivity()=="driving","exact current driver is driving");sampledVehicle.Driver=null;Check(PhysicalActivity()=="in_vehicle","absent driver cannot prove passenger");
        sampledVehicle.Driver=player;Check(PhysicalActivity()=="passenger","different valid sampled driver proves passenger");actor.CurrentVehicle=null;
        NpcTargeting.Conversation=actor;Check(PhysicalActivity()=="conversation","committed exact partner is conversation");NpcTargeting.Conversation=player;Check(PhysicalActivity()=="unknown","unproven ambient mode is unknown");
        NpcStateStore.Sampled=new NpcState {FollowPlayerOnFoot=true};Check(PhysicalActivity()=="following","active sampled follow flag is following");NpcStateStore.Sampled.FollowPaused=true;Check(PhysicalActivity()=="unknown","paused follow is unknown");NpcStateStore.Sampled=null;
        var captured=new LosSantosAlive.Context.ActorContext {PedId=actor.Handle.ToString()};
        shared.EnrichActor(actor,captured);
        Check(captured.IntegrationBlocks.Count==1 && captured.IntegrationBlocks[0].Id=="turnKnowledge","exact supplied actor gets reserved private capture");
        var privateBlock=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string,object>>(captured.IntegrationBlocks[0].Text);
        Check((string)privateBlock["captureRef"]==kept.CaptureRef && (string)privateBlock["hostRunId"]==host.HostRunId && (int)privateBlock["worldEpoch"]==host.WorldEpoch,"capture reuses shared reference and host fence");
        Check(!privateBlock.ContainsKey("encounterId") && !privateBlock.ContainsKey("characterId"),"ordinary capture does not infer durable ownership");
        var wrongActor=new LosSantosAlive.Context.ActorContext {PedId="999"};shared.EnrichActor(actor,wrongActor);Check(wrongActor.IntegrationBlocks.Count==0,"wrong PedId omits capture");
        var ownerPed=new Ped {Handle=901,MemoryAddress=new IntPtr(901)};var c06Lifetime=Guid.NewGuid().ToString("D");bool ownerCurrent=true;
        var ownerAnchor=host.Anchors.Retain(ownerPed,(ulong)ownerPed.Handle,ownerPed.MemoryAddress,"ped",c06Lifetime,()=>true,host.MonotonicMs,false,AnchorConsumer.P2Encounter);
        var ownerToken=new {owner="p2",mode="wait",since=100u};
        var participant=new OwnedParticipant {Ped=ownerPed,Lifetime=c06Lifetime,EncounterId=Guid.NewGuid().ToString("D"),Current=()=>ownerCurrent,PrimaryOwner=()=>ownerToken};sharedRoster.Add(participant);
        object SampleOwner()=>shared.GetType().GetMethod("SamplePrimaryOwner",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(shared,new object[]{ownerAnchor});
        Check(ReferenceEquals(SampleOwner(),ownerToken),"C06 samples exact current owned participant token without a parallel store");
        int? SampleRevision()=> (int?)shared.GetType().GetMethod("SampleDirectorOwnerRevision",
            BindingFlags.NonPublic|BindingFlags.Instance).Invoke(shared,new object[]{ownerAnchor});
        participant.DirectorOwner=()=>new DirectorOwnerSample{Owner="p2",Mode="wait",Revision=9};
        Check(SampleRevision()==9,"observer situation samples genuine P2 incarnation revision");
        participant.DirectorOwner=()=>new DirectorOwnerSample{Owner="p2",Mode="wait",Revision=0};
        Check(SampleRevision()==null,"overflowed P2 revision cannot be published as positive");
        participant.DirectorOwner=()=>throw new Exception("P2 revision missing");
        Check(SampleRevision()==null,"throwing P2 version read never publishes guessed revision");
        participant.DirectorOwner=()=>new DirectorOwnerSample{Owner="p2",Mode="wait",Revision=10};
        ownerCurrent=false;
        Check(SampleOwner()==null && SampleRevision()==null,
             "retired P2 registration has neither primary owner nor source revision");
        ownerCurrent=true;
        participant.PrimaryOwner=()=>throw new Exception("optional owner sample");Check(SampleOwner()==null,"C06 getter fault omits only optional metadata");
        // Core callback threads do not get access to the Director admission
        // dictionary. Queue only scalar/native event identity and drain it on
        // the host fiber; no injected original bound ticket means no admission.
        var callbackBridge=new IntelligenceIntegration(()=>sharedRoster.ToArray(),
            "LSA.Callback.Tests."+Guid.NewGuid().ToString("N"),host,true);
        Set(callbackBridge,"started",true);
        Call(callbackBridge,"UpdateIndexes");
        int Queued()=> (int)Get(callbackBridge,"directorPlaybackEvents").GetType()
            .GetProperty("Count").GetValue(Get(callbackBridge,"directorPlaybackEvents"));
        void StartCallback(Ped speaker,string pedId,string turnId,long generation)
        {
            Call(callbackBridge,"PlaybackStarted",new LosSantosAlive.Audio.NpcPlaybackStartedEvent{
                SpeakerPed=speaker,PedId=pedId,TurnId=turnId,GenerationId=generation});
        }
        StartCallback(ownerPed,ownerPed.Handle.ToString(),"real-core-turn",long.MaxValue);
        Check(Queued()==1,"Core start callback queued off owner fiber without executing Director");
        Call(callbackBridge,"DrainDirectorCorePlayback");
        Check(Queued()==0 &&
            !((DirectorAdmission)Get(callbackBridge,"director")).HasActive,
            "source callback without original reserved/bound native ticket does not become permission");
        for(int i=0;i<33;i++)StartCallback(ownerPed,ownerPed.Handle.ToString(),
            "callback-overflow",i);
        Check(Queued()==0 && (bool)Get(callbackBridge,"directorPlaybackOverflow"),
            "overflow closes bounded Core callback queue and poisons current batch");
        Call(callbackBridge,"DrainDirectorCorePlayback");
        Check(Queued()==0 && !(bool)Get(callbackBridge,"directorPlaybackOverflow"),
            "owner-fiber overflow path resets native Director and drops untrusted batch");
        StartCallback(ownerPed,ownerPed.Handle.ToString(),"reset-core",3);
        Check(Queued()==1,"late callback queued before reset");
        Call(callbackBridge,"WorldChanged",host.WorldEpoch+1,"unit_reset");
        Check(Queued()==0,"world reset retires callback queue");
        callbackBridge.Shutdown();
        Check(Queued()==0,"shutdown keeps callback queue retired");
        shared.Shutdown();Check(host.Anchors.Resolve(kept.CaptureRef)!=null,"optional PS shutdown cannot clear another consumer's shared lifetime");
        host.Shutdown();Check(host.Anchors.Count==0,"host teardown clears shared table");
        Console.WriteLine("PASS "+assertions+" production integration assertions including lifecycle telemetry");
    }
}
