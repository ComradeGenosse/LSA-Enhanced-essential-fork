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
        Game.LocalPlayer.Character=player;NpcTargeting.Conversation=actor;bool owned=true;var lifetime=Guid.NewGuid().ToString("D");var rosterList=new List<OwnedParticipant> {new OwnedParticipant {Ped=actor,Lifetime=lifetime,Current=()=>owned&&actor.Existing}};
        var integration=new IntelligenceIntegration(()=>owned?rosterList.ToArray():new OwnedParticipant[0],"LSA.Integration.Tests."+Guid.NewGuid().ToString("N"));
        // Startup pin verification is independently tested above. The game harness
        // substitutes only external APIs, then executes the real Update/Sample code.
        Set(integration,"started",true);var sensors=(SensorAdapters)Get(integration,"sensors");sensors.Enabled=true;
        var caps=(Dictionary<string,bool>)Get(integration,"capabilities");foreach(var k in new[]{"state","shooting","action"}) caps[k]=true;
        Set(integration,"channel",new IntelligenceChannel("LSA.Unconnected.Tests",Guid.NewGuid().ToString("D"),()=>caps));
        PerceptionSystem.Snapshot=null;Tick(integration);Check(integration.IsAvailable,"optional snapshot absence preserves adapter");Check(!((Dictionary<string,bool>)Get(integration,"capabilities"))["snapshot"],"snapshot unavailable reported");
        Check(integration.UpdateCalls==1&&integration.CompletedUpdates==1&&integration.RuntimeStatus().Contains("shutdown_reason=none"),"completed production update records entry and completion");
        var anchors=(EntityAnchors)Get(integration,"anchors");Check(anchors.Count==2&&anchors.ObserverCount==1,"player and owned conversation baseline");
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
        var wireNextConversation=new Ped {Handle=98,MemoryAddress=new IntPtr(98)};var pipeName="LSA.Integration.Tests."+Guid.NewGuid().ToString("N");var wireCaps=(Dictionary<string,bool>)Get(integration,"capabilities");var wireChannel=new IntelligenceChannel(pipeName,Guid.NewGuid().ToString("D"),()=>wireCaps);Set(integration,"channel",wireChannel);wireChannel.Start();
        using(var client=new NamedPipeClientStream(".",pipeName,PipeDirection.In)) {
            client.Connect(3000);using(var reader=new StreamReader(client)) {
                var hello=ReadFrame(reader);Check((string)hello["type"]=="hello","observer transition transport hello");Tick(integration);
                var received=new HashSet<string>();while(received.Count<anchors.Count) {var frame=ReadFrame(reader);if((string)frame["type"]!="anchors") continue;foreach(var item in FrameAnchors(frame)) received.Add((string)item["captureRef"]);}
                Check(received.Count==anchors.Count&&anchors.ObserverCount==16,"initial published roster has bounded observer set");
                var beforeConversation=conversationAnchor.CaptureRef;NpcTargeting.Conversation=wireNextConversation;Tick(integration);
                var demotion=ReadFrame(reader);var promotion=ReadFrame(reader);Check((string)demotion["type"]=="anchors"&&(string)promotion["type"]=="anchors","observer state changes use anchor frames");
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
        Console.WriteLine("PASS "+assertions+" production integration assertions including lifecycle telemetry");
    }
}
