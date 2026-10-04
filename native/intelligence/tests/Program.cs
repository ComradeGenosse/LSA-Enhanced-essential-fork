using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.Intelligence;
using DamageTrackerLib;
using DamageTrackerLib.DamageInfo;
class Program
{
    static int assertions;
    static void Check(bool condition,string name) {if(!condition) throw new Exception(name);assertions++;}
    static void Main(string[] args)
    {
        if(args.Length==2&&args[0]=="--serve") {Serve(args[1]);return;}
        var anchors=new EntityAnchors();bool live=true;var entity=new object();int retired=0;anchors.Retired+=_=>retired++;
        var a=anchors.Retain(entity,1,new IntPtr(10),"ped","owner-1",()=>live,0,true);
        Check(a!=null&&anchors.ObserverCount==1,"owned anchor");
        Check(ReferenceEquals(a,anchors.Retain(entity,1,new IntPtr(10),"ped","owner-1",()=>live,1)),"stable lifetime");
        live=false;Check(anchors.Resolve(a.CaptureRef)==null&&retired==1,"retained invalid");live=true;
        var b=anchors.Retain(new object(),1,new IntPtr(20),"ped","owner-1",()=>live,2,true);
        Check(a.CaptureRef!=b.CaptureRef&&anchors.Resolve(a.CaptureRef)==null,"same handle new lifetime");
        anchors.RevokeOwner("owner-1");Check(anchors.Count==0,"owner revocation");
        var c=anchors.Retain(new object(),1,new IntPtr(20),"ped","owner-2",()=>live,3,true);
        Check(c.CaptureRef!=b.CaptureRef,"recreated owner cannot revive");anchors.Cleanup(30003);Check(anchors.Count==0,"anchor expiry");
        var original=anchors.Retain(new object(),8,new IntPtr(8),"ped",null,()=>true,0);
        var reused=anchors.Retain(new object(),8,new IntPtr(8),"ped",null,()=>true,1);
        Check(original.CaptureRef!=reused.CaptureRef && anchors.Resolve(original.CaptureRef)==null,"same handle/address new retained object fails closed");anchors.Clear();
        for(int n=0;n<16;n++) Check(anchors.Retain(new object(),(ulong)n+1,new IntPtr(n+1),"ped",null,()=>true,0,true)!=null,"observer admission");
        Check(anchors.Retain(new object(),99,new IntPtr(99),"ped",null,()=>true,0,true)==null,"observer cap");
        var firstPriority=anchors.Current.OrderBy(a=>a.Handle).First();var secondPriority=anchors.Current.OrderBy(a=>a.Handle).Skip(1).First();var priorityToken=firstPriority.CaptureRef;var demotedToken=anchors.Current.OrderBy(a=>a.Handle).Last().CaptureRef;
        var conversationAnchor=anchors.Retain(new object(),99,new IntPtr(99),"ped",null,()=>true,1);var conversationToken=conversationAnchor.CaptureRef;
        anchors.SetObserverPriority(new[]{conversationToken}.Concat(anchors.Current.Where(a=>a.CaptureRef!=conversationToken).OrderBy(a=>a.Handle).Take(15).Select(a=>a.CaptureRef)));
        Check(conversationAnchor.Observer&&anchors.ObserverCount==16,"conversation gets priority at full promoted observer cap");
        Check(!anchors.Current.Single(a=>a.CaptureRef==demotedToken).Observer&&anchors.Resolve(demotedToken)!=null,"lower priority observer demoted without retiring lifetime");
        anchors.SetObserverPriority(new[]{secondPriority.CaptureRef});Check(secondPriority.Observer&&!conversationAnchor.Observer&&anchors.ObserverCount==1,"changing conversation demotes prior target");
        anchors.SetObserverPriority(new[]{conversationToken,priorityToken});Check(conversationAnchor.Observer&&firstPriority.Observer&&anchors.ObserverCount==2,"returning conversation promotes retained lifetimes");
        Check(anchors.Resolve(priorityToken)==firstPriority&&anchors.Resolve(conversationToken)==conversationAnchor&&conversationToken!=demotedToken,"conversation changes never reuse or retarget captureRefs");
        for(int n=16;n<256;n++) anchors.Retain(new object(),(ulong)n+1,new IntPtr(n+1),"ped",null,()=>true,0);
        Check(anchors.Count==256&&anchors.Retain(new object(),999,new IntPtr(999),"vehicle",null,()=>true,0)==null,"anchor cap");anchors.Clear();Check(anchors.Count==0,"anchor reset");
        var sensors=new SensorAdapters();string target=Guid.NewGuid().ToString("D"),attacker=Guid.NewGuid().ToString("D");
        Check(!sensors.Damage("ped_damage",target,null,2,0,"unknown",1,1,false)&&sensors.Count==0,"disabled parity");sensors.Enabled=true;
        using(var callbacks=new DamageSensors(sensors,(h,e)=>h==1?target:h==2?attacker:null,(h,e)=>h==3?target:null,r=>r==target,()=>100,()=>42)) {
            Check(callbacks.Running,"existing service available");
            DamageTrackerService.Ped(new PedDamageInfo {PedHandle=1,AttackerPedHandle=2,Damage=10,ArmourDamage=3,WeaponInfo=new WeaponDamageInfo {Type=DamageType.Pistol}});
            var signal=sensors.Take();Check(signal.target==target&&signal.source==attacker&&signal.gameTick==42&&(string)signal.facts["classification"]=="bullet","ped callback facts");
            Check(sensors.DamageCallbacks["ped_damage"]==1&&sensors.DamageCallbacks["player_damage"]==0,"NPC callback diagnostic separated from player callback");
            DamageTrackerService.Ped(new PedDamageInfo {PedHandle=1,AttackerPedHandle=0,Damage=1},true);
            signal=sensors.Take();Check(signal.producer=="player_damage"&&signal.source==null,"player absent attacker");
            Check(sensors.DamageCallbacks["ped_damage"]==1&&sensors.DamageCallbacks["player_damage"]==1,"one canonical player callback counted once");
            DamageTrackerService.Ped(new PedDamageInfo {PedHandle=1,Damage=-1},true);Check(sensors.Count==0&&sensors.DamageCallbacks["player_damage"]==2,"callback diagnostic records invocation before payload validation");
            DamageTrackerService.Ped(new PedDamageInfo {PedHandle=99,AttackerPedHandle=99,Damage=1,WeaponInfo=new WeaponDamageInfo {Type=(DamageType)999}});
            signal=sensors.Take();Check(signal.target==null&&signal.source==null&&(string)signal.facts["classification"]=="unknown","unknown participants and type");
            DamageTrackerService.Vehicle(new VehDamageInfo {VehHandle=3,Damage=4,LastCollisionPosition=new Rage.Vector3 {X=1,Y=2,Z=3},WeaponInfo=new WeaponDamageInfo {Type=DamageType.Vehicle}});
            signal=sensors.Take();Check(signal.kind=="vehicle_damage"&&signal.facts.ContainsKey("collision")&&(string)signal.facts["classification"]=="collision","vehicle callback collision");
            DamageTrackerService.Vehicle(new VehDamageInfo {VehHandle=3,Damage=1,LastCollisionPosition=new Rage.Vector3 {X=float.NaN}});
            Check(!sensors.Take().facts.ContainsKey("collision"),"invalid collision omitted");
            DamageTrackerService.IsRunning=false;Check(!callbacks.Running,"missing running capability");
            for(int n=0;n<400;n++) DamageTrackerService.Ped(new PedDamageInfo {PedHandle=1,Damage=1});
            Check(sensors.Count==256&&sensors.Dropped==144,"400 critical callbacks bounded");
            sensors.Reset();
        }
        DamageTrackerService.Ped(new PedDamageInfo {PedHandle=1,Damage=1});Check(sensors.Count==0,"unsubscribe");Check(DamageTrackerService.StartCalls==0&&DamageTrackerService.StopCalls==0,"service untouched");
        for(int n=0;n<400;n++) sensors.Damage("ped_damage",target,null,1,0,"unknown",1,1,false);
        Check(sensors.Count==192&&sensors.Dropped==208,"routine reserve");for(int n=0;n<100;n++) sensors.Damage("player_damage",target,null,1,0,"unknown",1,1,true);
        Check(sensors.Count==256,"critical replaces routine within cap");sensors.Reset();
        Check(!sensors.Damage("ped_damage",target,null,-1,0,"unknown",1,1,false),"negative damage rejected");
        sensors.Sample(target,new StateSample {Health=100,Location="ZONE1",Activity="stationary",Presence="retained"},1,1);
        Check(sensors.Count==0,"initial state baseline");sensors.Sample(target,new StateSample {Health=80,Location="ZONE1",Activity="stationary",Presence="retained"},2,2);
        Check(sensors.Take().kind=="injury_state","injury state edge");
        sensors.Sample(target,new StateSample {Health=0,Dead=true,Location="ZONE1",Activity="stationary",Presence="retained"},3,3);
        Check(sensors.Take().kind=="death","alive to dead");while(sensors.Take()!=null) {}
        sensors.Retire(target);Check(sensors.Count==0,"disappearance creates no death");
        sensors.Sample(target,new StateSample {Dead=true,Health=0},4,4);Check(sensors.Count==0,"dead initial baseline");sensors.Retire(target);
        sensors.Shooting(target,false,1,0);sensors.Shooting(target,true,2,1);Check(sensors.Take().kind=="firing","shooting edge");
        for(int n=0;n<400;n++) sensors.Shooting(target,true,3,2+n);Check(sensors.Count==0,"sustained shooting no flood");
        sensors.Shooting(target,false,4,450);sensors.Shooting(target,true,5,451);Check(sensors.Count==0,"short repeated edge bounded");
        sensors.Shooting(target,false,6,600);sensors.Shooting(target,true,7,601);Check(sensors.Take()!=null,"later shooting edge");sensors.Retire(target);sensors.Shooting(target,true,8,800);Check(sensors.Count==0,"restart shooting baseline");
        sensors.Reset();
        sensors.Sample(target,new StateSample {Health=100,Location="ZONE1",Activity="stationary",Presence="retained"},1,0);
        sensors.Sample(target,new StateSample {Health=100,Location="ZONE2",Activity="stationary",Presence="retained"},2,100);Check(sensors.Count==0,"location dwell pending");
        sensors.Sample(target,new StateSample {Health=100,Location="ZONE2",Activity="stationary",Presence="retained"},3,1100);Check(sensors.Take().kind=="location_changed","stable location edge");
        sensors.Sample(target,new StateSample {Health=100,Location="ZONE2",Vehicle=attacker,Driver=true,Activity="in_vehicle",Presence="promoted"},4,1200);
        Check(sensors.Take().kind=="vehicle_transition"&&sensors.Take().kind=="activity_changed"&&sensors.Take().kind=="presence_changed","vehicle activity presence facts");
        sensors.Vehicle(attacker,new VehicleSample(),1,1);Check(sensors.Count==0,"vehicle initial baseline");sensors.Vehicle(attacker,new VehicleSample {Engine=true,HealthBand=8,SpeedBand=2,Driver=target},2,2);Check(sensors.Take().kind=="vehicle_state","current vehicle state edge");
        sensors.Enabled=false;sensors.Sample(target,new StateSample {Dead=true},5,1300);Check(sensors.Count==0,"source disabled");sensors.Reset();sensors.Enabled=true;
        sensors.Damage("ped_damage",target,null,1,0,"unknown",1,1,false);Check(sensors.Take().producerSequence==1,"feature reset producer sequence");
        RadioTests(sensors,target);
        PipeTest();Console.WriteLine("PASS "+assertions+" production-source intelligence assertions");
    }
    static void RadioTests(SensorAdapters sensors,string target)
    {
        sensors.Reset();string v1=Guid.NewGuid().ToString("D"),v2=Guid.NewGuid().ToString("D");RawSignal radio;
        sensors.Radio(v1,"RADIO_TEST_A",1,1,1);sensors.Radio(v1,"RADIO_TEST_A",1,2,2);
        Check(sensors.Count==0 && sensors.RadioEdges==0,"radio baseline and stable track emit nothing");
        sensors.Radio(v1,"RADIO_TEST_A",2,3,3);radio=sensors.Take();
        Check(radio!=null && radio.producer=="radio" && radio.kind=="radio_changed" && !radio.Critical && radio.source==null && radio.target==v1 && radio.producerSequence==1 && (string)radio.facts["station"]=="RADIO_TEST_A" && (long)radio.facts["trackHash"]==2,"track change");
        sensors.Radio(v1,"RADIO_TEST_A",2,4,4);sensors.Radio(v1,"RADIO_TEST_B",9,5,5);radio=sensors.Take();
        Check(sensors.Count==0 && radio.kind=="radio_changed" && radio.producerSequence==2 && (string)radio.facts["station"]=="RADIO_TEST_B","station change");
        sensors.Radio(null,null,4,6,6);radio=sensors.Take();
        Check(radio.kind=="radio_stopped" && radio.target==null && radio.producerSequence==3 && (string)radio.facts["station"]=="" && (long)radio.facts["trackHash"]==0,"radio off");
        sensors.Radio(null,"",1,7,7);Check(sensors.Count==0,"off repeat emits nothing");
        sensors.Radio(v1,"RADIO_TEST_A",1,8,8);radio=sensors.Take();
        Check(radio.kind=="radio_changed" && radio.producerSequence==4,"start after off");
        sensors.Radio(v2,"RADIO_TEST_A",1,9,9);radio=sensors.Take();
        Check(radio.kind=="radio_changed" && radio.target==v2 && radio.producerSequence==5,"vehicle change");
        sensors.Reset();sensors.Radio(v2,"RADIO_TEST_A",1,10,10);sensors.Radio(v2,"RADIO_TEST_A",1,11,11);Check(sensors.Count==0,"reset clears radio baseline");
        sensors.Radio(v2,"RADIO_TEST_A",3,12,12);Check(sensors.Take().producerSequence==1,"radio producer sequence restarts after reset");
        sensors.Radio(v1,"RADIO_TEST_A",0,13,13);radio=sensors.Take();
        Check(radio.kind=="radio_changed" && (long)radio.facts["trackHash"]==0,"zero hash remains a track change");
        sensors.Radio(v1,"not a station",5,14,14);radio=sensors.Take();
        Check(radio.kind=="radio_stopped" && (string)radio.facts["station"]=="" && !radio.facts.ContainsValue("not a station"),"invalid station fails closed");
        sensors.Radio(v1,"RADIO_TEST_A",1,15,15);sensors.Take();sensors.Radio(v1,"radio_test_a",1,16,16);radio=sensors.Take();
        Check(radio.kind=="radio_stopped" && (string)radio.facts["station"]=="","lowercase station is not transmitted");
        sensors.Radio(v1,"RADIO_TEST_A",1,17,17);sensors.Take();sensors.Radio(v1,new string('A',65),1,18,18);radio=sensors.Take();
        Check(radio.kind=="radio_stopped" && ((string)radio.facts["station"]).Length==0,"overlong station is not transmitted");
        sensors.Radio(v1,"RADIO_TEST_A",1,19,19);sensors.Take();sensors.Radio(v1,"",0,20,20);radio=sensors.Take();
        Check(radio.kind=="radio_stopped" && radio.target==v1,"blank station stops on the same vehicle");
        sensors.Enabled=false;sensors.Radio(v1,"RADIO_TEST_A",4,21,21);Check(sensors.Count==0,"disabled radio emits nothing");sensors.Enabled=true;
        sensors.Reset();sensors.Radio(null,"",0,1,1);
        for(int n=0;n<64;n++) sensors.Damage("ped_damage",target,null,1,0,"unknown",1,1,true);
        bool on=true;for(int n=0;n<400;n++) { if(on) sensors.Radio(v1,"RADIO_TEST_A",1,(uint)(n+2),n+2); else sensors.Radio(null,"",0,(uint)(n+2),n+2); on=!on; Check(sensors.Count<=256,"radio queue stays capped"); }
        Check(sensors.RadioEdges==400 && sensors.Dropped>0,"radio edges count while routine drops increase");
        sensors.Damage("ped_damage",target,null,1,0,"unknown",1,1,true);
        int critical=0,routine=0;RawSignal item;while((item=sensors.Take())!=null) { if(item.Critical) critical++; else routine++; }
        Check(critical==65 && routine==191 && critical+routine==256,"radio cannot consume the critical reserve");
    }
    static void PipeTest()
    {
        var name="LSA.PS.Tests."+Guid.NewGuid().ToString("N");var epoch=Guid.NewGuid().ToString("D");var caps=new Dictionary<string,bool>();
        foreach(var k in new[]{"snapshot","pedDamage","playerDamage","vehicleDamage","shooting","state","action","playback","witness","awareness"}) caps[k]=false;
        using(var channel=new IntelligenceChannel(name,epoch,()=>caps)) {
            channel.Start();using(var client=new NamedPipeClientStream(".",name,PipeDirection.In)) {
                client.Connect(3000);var reader=new StreamReader(client);var json=new JavaScriptSerializer();var hello=json.Deserialize<Dictionary<string,object>>(reader.ReadLine());
                Check((string)hello["type"]=="hello"&&(string)hello["adapterEpoch"]==epoch,"live factual pipe hello");
                Check(channel.Send("retire",new {captureRef=Guid.NewGuid().ToString("D")}),"send retirement");var frame=json.Deserialize<Dictionary<string,object>>(reader.ReadLine());
                Check((int)frame["sequence"]==1&&(string)frame["streamId"]==(string)hello["streamId"],"ordered authenticated stream");
                Check(!client.CanWrite,"factual channel accepts no commands");
            }
        }
    }
    static void Serve(string name)
    {
        var caps=new Dictionary<string,bool>();foreach(var k in new[]{"snapshot","pedDamage","playerDamage","vehicleDamage","shooting","state","action","playback","witness","awareness"}) caps[k]=k=="shooting";
        using(var channel=new IntelligenceChannel(name,Guid.NewGuid().ToString("D"),()=>caps)) {
            channel.Start();Console.WriteLine("Interop server ready");
            var deadline=System.Diagnostics.Stopwatch.StartNew();bool sent=false;
            while(deadline.ElapsedMilliseconds<10000) {
                if(!sent&&channel.ConnectionVersion>0) {
                    sent=true;string player=Guid.NewGuid().ToString("D");
                    channel.Send("anchors",new[]{new {captureRef=player,kind="player",observer=false}});
                    channel.Send("signal",new {signalId=Guid.NewGuid().ToString("D"),producer="shooting",producerSequence=1,kind="firing",target=(string)null,source=player,gameTick=42,ageMs=0,facts=new {}});
                }Thread.Sleep(10);
            }
        }
    }
}
