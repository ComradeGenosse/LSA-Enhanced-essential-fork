using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.PromotedCharacters;
using LSA.SessionIdentity;
using LosSantosAlive.Context;
using LosSantosAlive.Integrations;
using Rage;

class Program
{
    static int count;
    static readonly string WorldId = Guid.NewGuid().ToString("D");
    static void Check(bool value) { count++; if (!value) throw new Exception("P2 lifecycle assertion " + count); }
    static T Field<T>(object source,string name) => (T)source.GetType().GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(source);
    static Dictionary<string,Encounter> Encounters(PromotedCharactersIntegration integration) => Field<Dictionary<string,Encounter>>(integration,"encounters");
    static Dictionary<string,Capture> Captures(PromotedCharactersIntegration integration) => Field<Dictionary<string,Capture>>(integration,"captures");
    static string HelloEpoch(string pipeName)
    {
        using (var pipe = new NamedPipeClientStream(".",pipeName,PipeDirection.InOut)) {
            pipe.Connect(3000);
            var frame = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new StreamReader(pipe).ReadLine());
            return (string)frame["ownerEpoch"];
        }
    }
    static PromotedCharactersIntegration Create(out string pipeName)
    {
        Game.GameTime = 2000; Game.NativeCalls = 0; Game.PedReads = 0; Game.ClockReads = 0; Game.Logs.Clear();
        SessionIdentityIntegration.Current = null;
        IntegrationManager.Registered.Clear();
        pipeName = "LSA.P2.lifecycle." + Guid.NewGuid().ToString("N");
        var integration = new PromotedCharactersIntegration(WorldId,pipeName);
        integration.Prepare();
        Check(integration.IsAvailable && !integration.IsReady);
        Check(!SessionIdentityIntegration.Current.IsAvailable && Game.ClockReads == 0 && Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Initialize(); Check(integration.IsAvailable && integration.IsReady);
        return integration;
    }
    static Encounter Seed(PromotedCharactersIntegration integration)
    {
        var ped = new Ped();
        var encounter = new Encounter {Ped = ped,Address = ped.MemoryAddress,Created = true,OwnerAlias = "promoted." + Guid.NewGuid().ToString("D"),OwnershipToken = Guid.NewGuid().ToString("D")};
        encounter.Registration = SessionIdentityIntegration.Current.Owner.Register(ped,encounter.OwnerAlias,WorldId);
        Encounters(integration).Add("old-ped",encounter);
        Captures(integration).Add("old-capture",new Capture {Encounter = encounter,ExpiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+10000});
        return encounter;
    }
    static Task<bool> QueuePending(string pipeName)
    {
        return Task.Run(()=>{
            try {
                using (var pipe = new NamedPipeClientStream(".",pipeName,PipeDirection.InOut)) {
                    pipe.Connect(3000); var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) {AutoFlush = true};
                    var json = new JavaScriptSerializer();
                    var hello = json.Deserialize<Dictionary<string,object>>(reader.ReadLine());
                    writer.WriteLine(json.Serialize(new {version = 1,requestId = Guid.NewGuid().ToString("D"),worldProfileId = WorldId,ownerEpoch = (string)hello["ownerEpoch"],operation = "capture",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+2500}));
                    return reader.ReadLine() == null;
                }
            } catch (IOException) {return true;}
        });
    }
    static ControlRequest AwaitQueued(ControlChannel channel)
    {
        var requests = Field<ConcurrentQueue<ControlRequest>>(channel,"requests");
        var deadline = DateTime.UtcNow.AddSeconds(3);
        while (DateTime.UtcNow < deadline) { if (requests.TryPeek(out var request)) return request; Thread.Sleep(10); }
        throw new Exception("Timed out waiting for the real control pipe request.");
    }
    sealed class BrokenMicField { public Ped Instance; }
    static void MicReadFailure()
    {
        var mic=new EssentialMicState();
        Check(mic.Available && mic.CanStart()==null);
        // Exercise a *real* reflection failure in the production reader, not
        // a mock CanStart result. A non-static FieldInfo throws on null target.
        var source=typeof(EssentialMicState).GetField("activePed",BindingFlags.Instance|BindingFlags.NonPublic);
        Check(source!=null);
        source.SetValue(mic,typeof(BrokenMicField).GetField("Instance"));
        Check(mic.Available && mic.CanStart()=="mic_state_unavailable");
        Check(!mic.Owns(new Ped {Handle=77,MemoryAddress=new IntPtr(77)},77));
        Check(mic.StopOwned(new Ped {Handle=77,MemoryAddress=new IntPtr(77)},77)=="mic_state_unavailable");
    }
    static void PrimaryOwnerTruth()
    {
        var act=PrimaryBehaviorOwner.Transition(null,"act","activity",10);
        Check(act.owner=="act" && act.mode=="activity" && act.since==10);
        Check(ReferenceEquals(act,PrimaryBehaviorOwner.Transition(act,"act","activity",20)));
        var follow=PrimaryBehaviorOwner.Residual(act,true,true,false,false,false,30);
        Check(follow.owner=="essential_residual" && follow.mode=="follow" && follow.since==30);
        Check(PrimaryBehaviorOwner.Residual(follow,true,false,true,false,false,40).mode=="follow");
        Check(PrimaryBehaviorOwner.Residual(act,true,false,false,true,false,40).mode=="sit");
        Check(PrimaryBehaviorOwner.Residual(act,true,true,false,true,false,40).mode=="unknown");
        Check(PrimaryBehaviorOwner.Residual(act,true,true,false,false,true,40).mode=="unknown");
        var unknown=PrimaryBehaviorOwner.Residual(act,false,false,false,false,false,40);
        Check(unknown.owner=="none" && unknown.mode=="unknown");
        Check(PrimaryBehaviorOwner.Residual(act,true,false,false,false,false,40).mode=="unknown");
        var command=PrimaryBehaviorOwner.Transition(follow,"p2","wait",50);
        Check(command.owner=="p2" && command.mode=="wait" && command.since==50);
        var wire=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(follow));
        Check(wire.Count==3 && (string)wire["owner"]=="essential_residual" && (string)wire["mode"]=="follow" && Convert.ToUInt32(wire["since"])==30);
    }
    static void NativeOwnerSamples()
    {
        // Exercise production refresh rather than only its pure token helper.
        var integration=Create(out _);var ped=new Ped{Handle=88,MemoryAddress=new IntPtr(88)};
        var encounter=(Encounter)typeof(PromotedCharactersIntegration).GetMethod("EncounterFor",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(integration,new object[]{ped});
        encounter.OwnerAlias="promoted."+Guid.NewGuid().ToString("D");
        encounter.Registration=SessionIdentityIntegration.Current.Owner.Register(ped,encounter.OwnerAlias,WorldId);
        var refresh=typeof(PromotedCharactersIntegration).GetMethod("RefreshPrimaryOwner",BindingFlags.Static|BindingFlags.NonPublic);
        var samples=new[]{
            (new LosSantosAlive.NPC.NpcState{FollowPlayerOnFoot=true},"follow"),
            (new LosSantosAlive.NPC.NpcState{FollowPaused=true},"follow"),
            (new LosSantosAlive.NPC.NpcState{SitOnGroundMode=true},"sit"),
            (new LosSantosAlive.NPC.NpcState{FollowPlayerOnFoot=true,SitOnGroundMode=true},"unknown"),
            (new LosSantosAlive.NPC.NpcState{FollowPaused=true,SitOnGroundMode=true},"unknown"),
            (new LosSantosAlive.NPC.NpcState{FollowPlayerOnFoot=true,HasActiveReflex=true},"unknown"),
            (new LosSantosAlive.NPC.NpcState{SitOnGroundMode=true,InDirectedInteraction=true},"unknown"),
            (new LosSantosAlive.NPC.NpcState{},"unknown")};
        try{
            foreach(var sample in samples){
                encounter.Owner=PrimaryBehaviorOwner.Transition(null,"act","activity",10);Game.GameTime=200;
                LosSantosAlive.NPC.NpcStateStore.State=body=>{Check(ReferenceEquals(body,ped));return sample.Item1;};
                refresh.Invoke(null,new object[]{encounter});
                Check(encounter.Owner.owner=="essential_residual" && encounter.Owner.mode==sample.Item2 && encounter.Mode==sample.Item2 && encounter.Owner.since==200);
                var verified=integration.PerceptionRoster().Single(x=>x.Lifetime==encounter.Registration.IncarnationId);
                var director=verified.DirectorOwner();
                Check(director!=null && director.Owner=="essential_residual" && director.Mode==sample.Item2 && !director.Suspended);
                encounter.Suspended=true;
                Check(verified.DirectorOwner().Suspended,"Director source preserves native P2 suspension");
                encounter.Suspended=false;
                var original=encounter.Owner;Game.GameTime=201;refresh.Invoke(null,new object[]{encounter});
                Check(ReferenceEquals(original,encounter.Owner));
            }
            LosSantosAlive.NPC.NpcStateStore.State=body=>null;refresh.Invoke(null,new object[]{encounter});
            Check(encounter.Owner.owner=="none" && encounter.Owner.mode=="unknown" && encounter.Mode=="unknown");
            encounter.Owner=PrimaryBehaviorOwner.Transition(null,"act","activity",10);
            LosSantosAlive.NPC.NpcStateStore.State=body=>throw new InvalidOperationException("native_sample_failed");
            refresh.Invoke(null,new object[]{encounter});Check(encounter.Owner.owner=="none" && encounter.Mode=="unknown");
            LosSantosAlive.NPC.NpcStateStore.State=body=>throw new Exception("stale body must never sample");
            ped.MemoryAddress=new IntPtr(89);int reads=Game.NativeCalls;
            refresh.Invoke(null,new object[]{encounter});Check(Game.NativeCalls==reads && encounter.Owner.owner=="none" && encounter.Mode=="unknown");
            ped.MemoryAddress=new IntPtr(88);
            var prior=integration.PerceptionRoster().Single(x=>x.Lifetime==encounter.Registration.IncarnationId);
            encounter.Registration=null;
            Check(prior.DirectorOwner()==null,"retired P2 registration cannot retain Director mode authorization");
            reads=Game.NativeCalls;
            refresh.Invoke(null,new object[]{encounter});Check(Game.NativeCalls==reads && encounter.Owner.mode=="unknown");
        }finally{LosSantosAlive.NPC.NpcStateStore.State=null;integration.Shutdown();}
    }
    static void Main()
    {
        try {
            MicReadFailure(); PrimaryOwnerTruth(); NativeOwnerSamples(); DeferredInitialization(); ShutdownOnCoreUpdate(); ResetWithPendingRequest(); ResetAfterP1(); RetireFailure(); ForwardClock(); ActivityIsolation(); ExactEncounterLifetime(); DialogueActorResolution(); DialogueObserverLifetime();
            Console.WriteLine("P2 production clock recovery and Windows pipe cancellation: " + count + " assertions passed; no game assemblies loaded.");
        } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; }
    }
    static void ExactEncounterLifetime()
    {
        var integration=Create(out _);
        Game.LocalPlayer.Character=new Ped {Handle=1,MemoryAddress=new IntPtr(1)};
        var first=new Ped {Handle=12,MemoryAddress=new IntPtr(12)};
        var lookup=typeof(PromotedCharactersIntegration).GetMethod("EncounterFor",BindingFlags.NonPublic|BindingFlags.Instance);
        var old=(Encounter)lookup.Invoke(integration,new object[]{first});
        Check(old.CaptureRef!=null && integration.Host.Anchors.Resolve(old.CaptureRef)?.Entity==first);
        Check(ReferenceEquals(old,lookup.Invoke(integration,new object[]{first})) && Encounters(integration).Count==1);
        var replacement=new Ped {Handle=12,MemoryAddress=new IntPtr(12)};
        var current=(Encounter)lookup.Invoke(integration,new object[]{replacement});
        Check(current.Id!=old.Id && current.CaptureRef!=old.CaptureRef && integration.Host.Anchors.Resolve(old.CaptureRef)==null);
        Check(ReferenceEquals(integration.Host.Anchors.Resolve(current.CaptureRef).Entity,replacement));
        replacement.Handle=13;
        Check(integration.Host.Anchors.Resolve(current.CaptureRef)==null);
        integration.Shutdown();Check(integration.Host.Anchors.Count==0);
    }
    static Dictionary<string,object> DialogueAnnotation(PromotedCharactersIntegration integration,string captureRef)
    {
        return new Dictionary<string,object>{{"version",1},{"type","dialogue.action.pending"},{"sequence",1},{"dialogueActionVersion",1},{"publicationId",Guid.NewGuid().ToString("D")},{"tuple",new Dictionary<string,object>{{"pedId","40"},{"turnId","turn"},{"generationId",1},{"sessionNonce",1}}},{"binding",new Dictionary<string,object>{{"captureRef",captureRef},{"hostContext",new Dictionary<string,object>{{"hostContextVersion",1},{"hostRunId",integration.Host.HostRunId},{"worldEpoch",integration.Host.WorldEpoch}}}}},{"canonicalAction","waithere"},{"publishedAtMs",100}};
    }
    static void DialogueActorResolution()
    {
        var integration=Create(out _);Game.LocalPlayer.Character=new Ped{Handle=1,MemoryAddress=new IntPtr(1)};
        var ped=new Ped{Handle=40,MemoryAddress=new IntPtr(40)};
        var anchor=integration.Host.Anchors.Retain(ped,40,new IntPtr(40),"ped",null,()=>ped.Exists() && ped.Handle==40 && ped.MemoryAddress==new IntPtr(40),integration.Host.MonotonicMs,false,LSA.Intelligence.AnchorConsumer.TurnActor);
        var annotation=DialogueAnnotation(integration,anchor.CaptureRef);int nativeBefore=Game.NativeCalls;
        Check(integration.ResolveDialogueActor(annotation,out var resolved) && ReferenceEquals(resolved,ped));
        Check(Encounters(integration).Count==0 && anchor.OwnerLifetime==null && Game.NativeCalls==nativeBefore);
        var binding=(Dictionary<string,object>)annotation["binding"];binding["encounterId"]=Guid.NewGuid().ToString("D");binding["incarnationId"]=Guid.NewGuid().ToString("D");Check(!integration.ResolveDialogueActor(annotation,out resolved) && resolved==null);binding.Remove("encounterId");binding.Remove("incarnationId");
        var context=(Dictionary<string,object>)binding["hostContext"];context["worldEpoch"]=2;Check(!integration.ResolveDialogueActor(annotation,out resolved));context["worldEpoch"]=1;
        integration.Host.Anchors.Retire(anchor.CaptureRef);Check(!integration.ResolveDialogueActor(annotation,out resolved));
        var ownedPed=new Ped{Handle=50,MemoryAddress=new IntPtr(50)};
        var owned=(Encounter)typeof(PromotedCharactersIntegration).GetMethod("EncounterFor",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(integration,new object[]{ownedPed});
        owned.OwnerAlias="promoted."+Guid.NewGuid().ToString("D");owned.Registration=SessionIdentityIntegration.Current.Owner.Register(ownedPed,owned.OwnerAlias,WorldId);
        typeof(PromotedCharactersIntegration).GetMethod("RetainEncounter",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(integration,new object[]{owned});
        var ownedAnnotation=DialogueAnnotation(integration,owned.CaptureRef);var ownedBinding=(Dictionary<string,object>)ownedAnnotation["binding"];
        Check(!integration.ResolveDialogueActor(ownedAnnotation,out resolved));ownedBinding["encounterId"]=owned.Id;ownedBinding["incarnationId"]=owned.Registration.IncarnationId;
        Check(integration.ResolveDialogueActor(ownedAnnotation,out resolved) && ReferenceEquals(resolved,ownedPed));ownedBinding["incarnationId"]=Guid.NewGuid().ToString("D");Check(!integration.ResolveDialogueActor(ownedAnnotation,out resolved));
        ownedBinding["incarnationId"]=owned.Registration.IncarnationId;ownedPed.MemoryAddress=new IntPtr(51);Check(!integration.ResolveDialogueActor(ownedAnnotation,out resolved));integration.Shutdown();
    }
    static void DialogueObserverLifetime()
    {
        var integration=Create(out _);var json=new JavaScriptSerializer();
        integration.EnableActivityShadow("LSA.C05.lifecycle."+Guid.NewGuid().ToString("N"),true);
        var session=integration.ActivitySession;Check(session.DialogueSupported && json.Deserialize<Dictionary<string,object>>(session.ServerHello()).ContainsKey("dialogueActionVersion"));
        var ped=new Ped{Handle=70,MemoryAddress=new IntPtr(70)};
        var anchor=integration.Host.Anchors.Retain(ped,70,new IntPtr(70),"ped",null,()=>ped.Exists() && ped.Handle==70 && ped.MemoryAddress==new IntPtr(70),integration.Host.MonotonicMs,false,LSA.Intelligence.AnchorConsumer.TurnActor);
        var hello=new Dictionary<string,object>{{"version",1},{"type","hello"},{"contractSha256",LSA.Activities.CapabilityTable.ContractSha256},{"clientRun",Guid.NewGuid().ToString("D")},{"hostContextVersion",1},{"hostRunId",integration.Host.HostRunId},{"worldEpoch",1},{"dialogueActionVersion",1}};
        session.OpenTransport();Check(session.AcceptClient(json.Serialize(hello)));var annotation=DialogueAnnotation(integration,anchor.CaptureRef);((Dictionary<string,object>)annotation["tuple"])["pedId"]="70";
        int actions=Game.NativeCalls;Check(session.AcceptClient(json.Serialize(annotation)) && integration.PendingDialogueReceipts==1);
        Check(Encounters(integration).Count==0 && Game.NativeCalls==actions);
        integration.ApplyActionState(ped,null,"waithere",ActionStateModifierPhase.BeforeCoreStateRule);integration.OnNpcActionExecuted(ped,"waithere",true);
        typeof(PromotedCharactersIntegration).GetMethod("DrainActivityRing",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(integration,new object[0]);
        var ordinaryReceipt=json.Deserialize<Dictionary<string,object>>(session.TakeOutbound());
        Check(ordinaryReceipt!=null && (string)ordinaryReceipt["type"]=="dialogue.action.receipt" && (bool)ordinaryReceipt["succeeded"] && integration.PendingDialogueReceipts==0);
        Check(!((Dictionary<string,object>)ordinaryReceipt["binding"]).ContainsKey("encounterId") && Encounters(integration).Count==0 && Game.NativeCalls==actions);
        annotation["sequence"]=2;annotation["publicationId"]=Guid.NewGuid().ToString("D");Check(session.AcceptClient(json.Serialize(annotation)) && integration.PendingDialogueReceipts==1);
        integration.Host.Anchors.Retire(anchor.CaptureRef);Check(integration.PendingDialogueReceipts==0);
        annotation["sequence"]=3;Check(session.AcceptClient(json.Serialize(annotation)) && session.ClientReady && integration.PendingDialogueReceipts==0);
        Check(session.AcceptClient(json.Serialize(new{version=1,type="lease",sequence=4,leaseTtlMs=5000})));
        integration.Host.AdvanceWorld("timeline_change");Check(integration.PendingDialogueReceipts==0 && !session.ClientReady);
        var fresh=integration.Host.Anchors.Retain(ped,70,new IntPtr(70),"ped",null,()=>ped.Exists() && ped.Handle==70 && ped.MemoryAddress==new IntPtr(70),integration.Host.MonotonicMs,false,LSA.Intelligence.AnchorConsumer.TurnActor);
        hello["worldEpoch"]=integration.Host.WorldEpoch;session.OpenTransport();Check(session.AcceptClient(json.Serialize(hello)));
        var newAnnotation=DialogueAnnotation(integration,fresh.CaptureRef);((Dictionary<string,object>)newAnnotation["tuple"])["pedId"]="70";
        Check(session.AcceptClient(json.Serialize(newAnnotation)) && integration.PendingDialogueReceipts==1);
        integration.InjectActivityFault(true);integration.Update();Check(integration.ActivityDisabled && integration.PendingDialogueReceipts==0);
        integration.Shutdown();Check(integration.PendingDialogueReceipts==0);
        Check(Field<Action<LSA.Intelligence.EntityAnchor>>(integration.Host.Anchors,"Retired")==null);
    }
    static void ActivityIsolation()
    {
        var integration = Create(out _);
        integration.EnableActivityShadow("LSA.ACT.lifecycle." + Guid.NewGuid().ToString("N"));
        integration.InjectActivityFault(true);
        integration.Update();
        Check(integration.IsAvailable && integration.ActivityDisabled);
        integration.Shutdown();
        integration = Create(out _);
        integration.EnableActivityShadow("LSA.ACT.lifecycle." + Guid.NewGuid().ToString("N"));
        for (var n = 0; n < 3; n++) { integration.InjectActivityFault(false); integration.Update(); }
        Check(integration.IsAvailable && !integration.ActivityDisabled && integration.ActivityFaults == 3 && integration.ActivityBreakerTrips == 1);
        Check(Game.Logs.Count(line => line == "[ACT] breaker_tripped") == 1);
        integration.Shutdown();
    }
    static void DeferredInitialization()
    {
        Game.GameTime = 2000; Game.NativeCalls = 0; Game.PedReads = 0; Game.ClockReads = 0;
        SessionIdentityIntegration.Current = null; IntegrationManager.Registered.Clear();
        var integration = new PromotedCharactersIntegration(WorldId,"LSA.P2.lifecycle." + Guid.NewGuid().ToString("N"));
        // Preparation can come from the addon fiber, while the subsequent
        // Initialize/Update callback comes from Core's distinct owner thread.
        Task.Run(()=>integration.Prepare()).GetAwaiter().GetResult();
        Check(integration.IsAvailable && !integration.IsReady);
        Check(SessionIdentityIntegration.Current.Owner == null && SessionIdentityIntegration.Current.InitializationCalls == 0);
        Check(Game.ClockReads == 0 && Game.NativeCalls == 0 && Game.PedReads == 0);
        int registrationCount = IntegrationManager.Registered.Count;
        integration.Prepare(); Check(IntegrationManager.Registered.Count == registrationCount && registrationCount == 1);
        integration.EnrichActor(new Ped(),new ActorContext {PedId = "12"});
        Check(Encounters(integration).Count == 0 && Game.PedReads == 0);
        integration.Update();
        Check(integration.IsAvailable && integration.IsReady);
        Check(SessionIdentityIntegration.Current.InitializationThread == Thread.CurrentThread.ManagedThreadId);
        Check(SessionIdentityIntegration.Current.InitializationThread != IntegrationManager.RegistrationThread);
        Check(IntegrationManager.Registered.Count == registrationCount);
        Check(SessionIdentityIntegration.Current.InitializationCalls == 1);
        integration.Update(); Check(SessionIdentityIntegration.Current.InitializationCalls == 1 && integration.IsReady);
        integration.Shutdown();
    }
    static void ResetWithPendingRequest()
    {
        var integration = Create(out var pipeName); var old = Field<ControlChannel>(integration,"channel");
        string epoch = HelloEpoch(pipeName); var encounter = Seed(integration);
        var client = QueuePending(pipeName); var request = AwaitQueued(old);
        Game.GameTime = 1000; integration.Update();
        Check(integration.IsAvailable); Check(!ReferenceEquals(old,Field<ControlChannel>(integration,"channel")));
        Check(HelloEpoch(pipeName) != epoch);
        Check(request.Cancelled && request.Done.IsSet); Check(client.GetAwaiter().GetResult());
        Check(!old.TryTake(out _));
        Check(Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(SessionIdentityIntegration.Current.Owner.Count == 0);
        Check(encounter.Registration == null && encounter.OwnerAlias == null && encounter.OwnershipToken == null);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        Check(Game.Logs.Count(message=>message == "[P2] game_clock_reset") == 1);
        // P1 can rotate after P2 in the same tick without ending P2's lifetime.
        SessionIdentityIntegration.Current.ResetForTest(); Game.GameTime = 1100; integration.Update();
        Check(integration.IsAvailable); Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Shutdown();
    }
    static void ShutdownOnCoreUpdate()
    {
        var integration = Create(out var pipeName); var encounter = Seed(integration);
        var owner = SessionIdentityIntegration.Current.Owner;
        encounter.Ped.IsDead = true;
        Task.Run(()=>integration.RequestShutdown()).GetAwaiter().GetResult();
        Check(integration.IsAvailable && !integration.IsReady);
        Check(owner.Count == 1 && owner.LastRetirementThread == 0);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.EnrichActor(encounter.Ped,new ActorContext {PedId = "12"});
        integration.OnPedControlChanged(encounter.Ped,false);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0 && owner.Count == 1);
        integration.Update();
        Check(!integration.IsAvailable && !integration.IsReady);
        Check(owner.Count == 0 && owner.LastRetirementThread == Thread.CurrentThread.ManagedThreadId);
        Check(Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(Game.PedReads > 0 && Game.NativeCalls == 0);
        integration.Shutdown();
    }
    static void ResetAfterP1()
    {
        var integration = Create(out var pipeName); var encounter = Seed(integration);
        SessionIdentityIntegration.Current.ResetForTest();
        var newOwner = SessionIdentityIntegration.Current.Owner;
        newOwner.Register(new Ped(),"unrelated-owner",WorldId);
        Game.GameTime = 1000; integration.Update();
        Check(integration.IsAvailable); Check(newOwner.Count == 1);
        Check(encounter.Registration == null && Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Shutdown();
    }
    static void RetireFailure()
    {
        var integration = Create(out var pipeName); Seed(integration);
        SessionIdentityIntegration.Current.Owner.ThrowOnRetire = true;
        Game.GameTime = 1000; integration.Update();
        Check(!integration.IsAvailable);
        Check(Encounters(integration).Count == 0 && Captures(integration).Count == 0);
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        Check(Game.Logs.Contains("[P2] game_clock_reset_failed"));
        integration.Shutdown();
    }
    static void ForwardClock()
    {
        var integration = Create(out var pipeName); var original = Field<ControlChannel>(integration,"channel");
        integration.Update(); Game.GameTime = 2500; integration.Update();
        Check(integration.IsAvailable && ReferenceEquals(original,Field<ControlChannel>(integration,"channel")));
        Check(!Game.Logs.Contains("[P2] game_clock_reset"));
        Check(Game.NativeCalls == 0 && Game.PedReads == 0);
        integration.Shutdown();
    }
}
