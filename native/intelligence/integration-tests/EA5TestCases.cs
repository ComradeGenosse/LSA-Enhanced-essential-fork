using System;
using System.Reflection;
using LSA.Intelligence;
using Rage;
using Rage.Native;

internal static class EA5TestCases
{
    static long Revision(object payload)=>(long)payload.GetType().GetProperty("revision").GetValue(payload);
    static string Character(object payload)=>(string)payload.GetType().GetProperty("protagonist").GetValue(payload);
    internal static void Run(Action<bool,string> check)
    {
        var ped=new Ped {Handle=42,MemoryAddress=new IntPtr(42),NativeModel=GtaProtagonistReader.FranklinModel};
        Game.LocalPlayer.Character=ped;
        NativeFunction.PlayerIndex=0;NativeFunction.Playing=true;
        NativeFunction.OverridePlayerPed=null;NativeFunction.OverrideIndexedPed=null;
        NativeFunction.Scripted=false;NativeFunction.NetworkActive=false;
        NativeFunction.ThrowSafetyRead=false;
        check(GtaProtagonistReader.Read().Qualified &&
              GtaProtagonistReader.Name(GtaProtagonistReader.Read().ModelHash)=="franklin",
              "EA5 genuine player index + player ped + model source => Franklin");
        ped.NativeModel=GtaProtagonistReader.MichaelModel;
        check(GtaProtagonistReader.Name(GtaProtagonistReader.Read().ModelHash)=="michael",
            "EA5 player_zero is Michael, never metadata");
        ped.NativeModel=GtaProtagonistReader.TrevorModel;
        check(GtaProtagonistReader.Name(GtaProtagonistReader.Read().ModelHash)=="trevor",
            "EA5 player_two is Trevor");
        ped.NativeModel=0xFFFFFFFFU;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 unknown player model denies");
        ped.NativeModel=GtaProtagonistReader.FranklinModel;
        NativeFunction.OverridePlayerPed=123;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 wrong native player ped denies");
        NativeFunction.OverridePlayerPed=null;NativeFunction.OverrideIndexedPed=123;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 wrong indexed player ped denies");
        NativeFunction.OverrideIndexedPed=null;
        NativeFunction.PlayerIndex=-1;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 invalid player index denies");
        NativeFunction.PlayerIndex=0;NativeFunction.Playing=false;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 nonplaying player denies");
        NativeFunction.Playing=true;NativeFunction.Scripted=true;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 cutscene/switch denies");
        NativeFunction.Scripted=false;NativeFunction.NetworkActive=true;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 online unsupported denies");
        NativeFunction.NetworkActive=false;NativeFunction.ThrowSafetyRead=true;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 missing native state evidence denies");
        NativeFunction.ThrowSafetyRead=false;
        ped.MemoryAddress=IntPtr.Zero;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 missing real ped memory denies");
        ped.MemoryAddress=new IntPtr(42);ped.Existing=false;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 invalid ped denies");
        ped.Existing=true;ped.IsDead=true;
        check(!GtaProtagonistReader.Read().Qualified,"EA5 dead ped denies");
        ped.IsDead=false;

        var sensor=new NativeProtagonistSensor();
        var run=Guid.NewGuid().ToString("D");
        Func<NativePlayerModelEvidence> current=()=>GtaProtagonistReader.Read();
        object first=sensor.Sample(true,1,run,1,100,current);
        check(first!=null && Character(first)=="franklin" && Revision(first)>0,
            "EA5 authenticated stream receives real source-qualified sample");
        long initial=Revision(first);
        check(sensor.Sample(true,1,run,1,200,current)==null,
            "EA5 bounded heartbeat avoids per-frame channel flooding");
        var heartbeat=sensor.Sample(true,1,run,1,400,current);
        check(heartbeat!=null && Revision(heartbeat)==initial,
            "EA5 same character heartbeat preserves stable revision");
        ped.NativeModel=GtaProtagonistReader.MichaelModel;
        var michael=sensor.Sample(true,1,run,1,500,current);
        check(Character(michael)=="michael" && Revision(michael)>initial,
            "EA5 Franklin to Michael advances revision");
        ped.NativeModel=GtaProtagonistReader.FranklinModel;
        var again=sensor.Sample(true,1,run,1,600,current);
        check(Character(again)=="franklin" && Revision(again)>Revision(michael),
            "EA5 Franklin Michael Franklin ABA advances revision twice");
        NativeFunction.Scripted=true;
        var unknown=sensor.Sample(true,1,run,1,700,current);
        check(Character(unknown)=="unknown" && Revision(unknown)>Revision(again),
            "EA5 source revocation emits unknown, not cached Franklin");
        NativeFunction.Scripted=false;
        var restored=sensor.Sample(true,1,run,1,800,current);
        check(Character(restored)=="franklin" && Revision(restored)>Revision(unknown),
            "EA5 evidence restoration needs new revision");
        check(sensor.Sample(false,1,run,1,900,current)==null,"EA5 disconnected source retires");
        var reconnect=sensor.Sample(true,2,run,1,1000,current);
        check(Character(reconnect)=="franklin" && Revision(reconnect)>Revision(restored),
            "EA5 reconnect never reuses old revision");
        var epoch=sensor.Sample(true,2,run,2,1100,current);
        check(Character(epoch)=="franklin" && Revision(epoch)>Revision(reconnect),
            "EA5 world epoch advances revision");
        var otherHost=sensor.Sample(true,3,Guid.NewGuid().ToString("D"),1,1200,current);
        check(Revision(otherHost)>Revision(epoch),"EA5 producer host replacement fences old revision");
        var regression=sensor.Sample(true,3,run,1,100,current);
        check(regression==null && sensor.Current=="unknown","EA5 backward clock rejects evidence");
        NativeFunction.OverridePlayerPed=null;NativeFunction.OverrideIndexedPed=null;
        NativeFunction.Playing=true;NativeFunction.Scripted=false;NativeFunction.NetworkActive=false;
        NativeFunction.ThrowSafetyRead=false;
    }
}
