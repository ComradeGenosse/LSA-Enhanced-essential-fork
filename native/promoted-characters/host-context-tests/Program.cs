using System;
using System.Linq;
using System.Collections.Generic;
using LSA.Intelligence;
using LSA.PromotedCharacters;

static class Program
{
    static int assertions;
    static void Check(bool value,string label) { if(!value) throw new Exception(label); assertions++; }
    static void Main()
    {
        var host = new HostContext(); var reload = new HostContext();
        Check(Guid.TryParse(host.HostRunId,out _) && host.HostRunId!=reload.HostRunId,"one fresh run per host");
        Check(host.WorldEpoch==1 && host.MonotonicMs>=0,"initial epoch and local monotonic clock");
        int worlds=0,retirements=0; string reason=null;
        var resetOrder=new List<string>();
        host.WorldChanged+=(epoch,why)=> { worlds++;reason=why;resetOrder.Add("P2");Check(host.Anchors.Count==0 && epoch==host.WorldEpoch,"anchors retire before reset subscribers"); };
        host.WorldChanged+=(epoch,why)=> resetOrder.Add("PS");
        host.WorldChanged+=(epoch,why)=> resetOrder.Add("ACT/UX");
        host.Anchors.Retirement+=(anchor,why)=> { retirements++; Check(why==AnchorRetirement.WorldReset,"world retirement reason"); };
        host.Anchors.Retain(new object(),1,new IntPtr(1),"ped",null,()=>true,0);
        Check(!host.ObserveGameTick(uint.MaxValue-5) && !host.ObserveGameTick(3),"normal unsigned clock wrap");
        Check(host.WorldEpoch==1 && host.Anchors.Count==1,"wrap keeps current lifetime");
        Check(host.ObserveGameTick(2),"backwards game tick resets");
        Check(worlds==1 && retirements==1 && reason=="clock_regression" && host.WorldEpoch==2,"one epoch and retirement per regression");
        Check(resetOrder.SequenceEqual(new[]{"P2","PS","ACT/UX"}),"one ordered world reset fanout to existing host subscribers");
        Check(!host.ObserveGameTick(2) && worlds==1,"duplicate tick is idempotent");
        Check(resetOrder.Count==3,"idempotent tick cannot pump another reset");
        host.AdvanceWorld("timeline_change"); Check(worlds==2 && host.WorldEpoch==3,"explicit timeline invalidation");
        Check(resetOrder.SequenceEqual(new[]{"P2","PS","ACT/UX","P2","PS","ACT/UX"}),"explicit timeline receives one ordered subscriber fanout");
        try { host.AdvanceWorld("unknown"); throw new Exception("unknown reason accepted"); } catch(ArgumentException) { Check(host.WorldEpoch==3,"closed reset vocabulary"); }
        // A failed optional callback must not withhold reset from the other
        // owners. The host still surfaces the fault so the caller fails closed.
        var failures=new HostContext();int healthy=0;
        failures.WorldChanged+=(epoch,why)=>throw new InvalidOperationException("failed optional consumer");
        failures.WorldChanged+=(epoch,why)=>healthy++;
        try {failures.AdvanceWorld("timeline_change");Check(false,"lost world reset fault");}
        catch(InvalidOperationException error) {Check(error.InnerException!=null &&
            healthy==1 && failures.WorldEpoch==2,"world subscriber failure fans out, then fails closed");}


        var anchors = new EntityAnchors(); var ped = new object(); bool live=true;
        var a=anchors.Retain(ped,1,new IntPtr(1),"ped","owner",()=>live,0,false,AnchorConsumer.P2Encounter);
        var shared=anchors.Retain(ped,1,new IntPtr(1),"ped","owner",()=>live,1,false,AnchorConsumer.TurnActor);
        Check(ReferenceEquals(a,shared) && anchors.Count==1,"consumers share a single lifetime");
        Check(anchors.ConsumerCount(AnchorConsumer.P2Encounter)==1 && anchors.ConsumerCount(AnchorConsumer.TurnActor)==1,"per consumer accounting");
        Check(anchors.Retain(ped,1,new IntPtr(1),"ped","owner",()=>live,2,true,AnchorConsumer.ActTarget)==null && anchors.ObserverCount==0,"ACT cannot admit an observer");
        for(int n=0;n<32;n++) Check(anchors.Retain(new object(),(ulong)n+2,new IntPtr(n+2),"ped",null,()=>true,0,false,AnchorConsumer.ActTarget)!=null,"ACT quota admission");
        Check(anchors.ConsumerCount(AnchorConsumer.ActTarget)==32 && anchors.Count==33,"ACT bound independent of P2");
        Check(anchors.Retain(new object(),99,new IntPtr(99),"ped",null,()=>true,0,false,AnchorConsumer.ActTarget)==null && anchors.Count==33,"quota refusal never evicts active refs");
        var act=anchors.Current.First(x=>x.Handle==2);
        anchors.ReleaseConsumer(act.CaptureRef,AnchorConsumer.ActTarget);
        Check(anchors.Resolve(act.CaptureRef)==act && anchors.ConsumerCount(AnchorConsumer.ActTarget)==31,"release quota without retargeting or retiring shared entity");
        Check(anchors.Retain(new object(),99,new IntPtr(99),"ped",null,()=>true,0,false,AnchorConsumer.ActTarget)!=null,"released consumer slot reused");
        AnchorRetirement retiredReason=AnchorRetirement.Shutdown;int reasons=0;
        anchors.Retirement+=(anchor,why)=> { reasons++;retiredReason=why; };
        var reused=anchors.Retain(new object(),1,new IntPtr(1),"ped","owner",()=>true,3,false,AnchorConsumer.P2Encounter);
        Check(reused.CaptureRef!=a.CaptureRef && anchors.Resolve(a.CaptureRef)==null && retiredReason==AnchorRetirement.LifetimeMismatch,"same handle/address new wrapper retires original");
        anchors.RevokeOwner(null); Check(anchors.Count==34,"null owner cannot revoke ordinary entities");
        anchors.RevokeOwner("owner");Check(anchors.Resolve(reused.CaptureRef)==null && retiredReason==AnchorRetirement.OwnerRevoked,"owner retirement invalidates all consumers");
        var expiring=anchors.Retain(new object(),100,new IntPtr(100),"ped",null,()=>true,10);
        anchors.Cleanup(30010);Check(anchors.Count==0 && retiredReason==AnchorRetirement.Expired,"bounded expiry clears quota state");
        Check(anchors.ConsumerCount(AnchorConsumer.ActTarget)==0,"retirement frees consumer quota");
        bool validateThrows=false;int notified=0;
        anchors.Retired+=anchor=> {throw new InvalidOperationException("failed optional subscriber");};
        anchors.Retired+=anchor=>notified++;
        var invalid=anchors.Retain(new object(),101,new IntPtr(101),"ped",null,()=> {if(validateThrows) throw new Exception();return true;},0);
        validateThrows=true;
        Check(anchors.Resolve(invalid.CaptureRef)==null && notified==1 && anchors.RetirementNotificationFaults==1,"failed validator retires and failed subscriber does not block fanout");
        Check(anchors.Retain(new object(),102,new IntPtr(102),"ped",null,()=> {throw new Exception();},0)==null,"throwing admission validation fails closed");
        Console.WriteLine("PASS "+assertions+" shared host/anchor assertions");
    }
}
