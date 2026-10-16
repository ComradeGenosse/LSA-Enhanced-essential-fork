using System;
using System.Linq;
using LSA.PromotedCharacters;
static class Program {
    static int count;
    static void Assert(bool ok,string why) {count++;if(!ok)throw new Exception(why);}
    static void TestObserver() {
        var player=new Rage.Ped {Handle=1,MemoryAddress=new IntPtr(100)};
        var ped=new Rage.Ped {Handle=2,MemoryAddress=new IntPtr(200)};
        var swap=new Rage.Ped {Handle=3,MemoryAddress=new IntPtr(300)};
        Rage.Game.LocalPlayer.Character=player;
        var observer=new NpcVoicePresenceObserver("shadow");
        observer.Attach();
        int before=Rage.Ped.Reads;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(ped,"pedA","turnA",1);
        Assert(Rage.Ped.Reads==before,"event callback does not access game");
        observer.Update(1,100);
        Assert(observer.HasActiveTurn&&observer.ActiveGeneration==1&&observer.ActiveHandle==2,"native start");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(swap,"pedA","turnA",1);
        observer.Update(1,110);
        Assert(observer.ActiveHandle==2,"duplicate turn never changes actor");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(swap,"pedA","turnA0",0);
        observer.Update(1,120);
        Assert(observer.ActiveHandle==2,"old generation rejected");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(swap,"pedA","turnB",2);
        observer.Update(1,130);
        Assert(observer.ActiveGeneration==2&&observer.ActiveHandle==3,"new generation replaces");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseEnded(ped,"pedA","turnA",1);
        observer.Update(1,140);
        Assert(observer.ActiveGeneration==2,"late old end ignored");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseEnded(swap,"pedA","turnB",2);
        observer.Update(1,150);
        Assert(!observer.HasActiveTurn,"exact end");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(ped,"pedA","turnC",3);
        observer.Update(1,160);observer.Update(2,180);
        Assert(!observer.HasActiveTurn,"epoch change clears");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(ped,"pedA","turnD",4);
        observer.Update(2,190);ped.IsDead=true;observer.Update(2,195);
        Assert(!observer.HasActiveTurn,"dead actor retired");
        ped.IsDead=false;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(ped,"pedA","turnE",5);
        observer.Update(2,200);ped.MemoryAddress=new IntPtr(250);observer.Update(2,210);
        Assert(!observer.HasActiveTurn,"reused handle address invalidated");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(player,"player","turnF",6);
        observer.Update(2,215);
        Assert(!observer.HasActiveTurn,"no player mouth takeover");
        observer.Dispose();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(swap,"pedA","turnG",7);
        observer.Update(2,220);
        Assert(!observer.HasActiveTurn,"unsubscribe and cleanup");
        var on=new NpcVoicePresenceObserver("on");
        on.Attach();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(swap,"pedA","turnH",8);
        on.Update(2,225);
        Assert(on.HasActiveTurn,"on mode remains observational pending renderer proof");
        on.Dispose();
    }
    static void TestOptInMouth() {
        var player=new Rage.Ped {Handle=10,MemoryAddress=new IntPtr(1000)};
        var npc=new Rage.Ped {Handle=11,MemoryAddress=new IntPtr(1100)};
        Rage.Game.LocalPlayer.Character=player;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=true;
        Rage.Native.NativeFunction.Commands.Clear();

        var shadow=new NpcVoicePresenceObserver("shadow",true);
        shadow.Attach();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(npc,"npc1","shadow",10);
        shadow.Update(5,100);
        Assert(!Rage.Native.NativeFunction.Commands.Exists(x=>x.StartsWith("PLAY_FACIAL_ANIM")),
            "shadow must never change actor appearance");
        shadow.Dispose();

        var disabled=new NpcVoicePresenceObserver("on",false);
        disabled.Attach();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(npc,"npc1","disabled",11);
        disabled.Update(5,200);
        Assert(!Rage.Native.NativeFunction.Commands.Exists(x=>x.StartsWith("PLAY_FACIAL_ANIM")),
            "on mode still requires explicit mouth opt-in");
        disabled.Dispose();

        var on=new NpcVoicePresenceObserver("on",true);
        on.Attach();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=false;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(npc,"npc1","first",12);
        on.Update(5,300);
        Assert(!Rage.Native.NativeFunction.Commands.Exists(x=>x.StartsWith("PLAY_FACIAL_ANIM")),
            "queued but not currently speaking must not animate");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=true;
        on.Update(5,350);
        Assert(Rage.Native.NativeFunction.Commands.Contains("PLAY_FACIAL_ANIM:mic_chatter"),
            "native-speaking turn drives gated facial-only animation");
        var played=Rage.Native.NativeFunction.Commands.Count(x=>x=="PLAY_FACIAL_ANIM:mic_chatter");
        on.Update(5,370);
        Assert(Rage.Native.NativeFunction.Commands.Count(x=>x=="PLAY_FACIAL_ANIM:mic_chatter")==played,
            "facial native is rate limited");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(npc,"npc1","second",13);
        on.Update(5,400);
        Assert(Rage.Native.NativeFunction.Commands.Contains("PLAY_FACIAL_ANIM:mood_normal_1"),
            "replacement closes only previously applied facial overlay");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseEnded(npc,"npc1","first",12);
        on.Update(5,420);
        Assert(on.HasActiveTurn && on.ActiveGeneration==13,"old end cannot stop replacement");

        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseEnded(npc,"npc1","second",13);
        on.Update(5,450);
        Assert(!on.HasActiveTurn,"replacement ends");
        Rage.Native.NativeFunction.Commands.Clear();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(npc,"npc1","third",14);
        on.Update(5,500);
        Assert(Rage.Native.NativeFunction.Commands.Contains("PLAY_FACIAL_ANIM:mic_chatter"),"third starts");
        Rage.Native.NativeFunction.Commands.Clear();
        npc.MemoryAddress=new IntPtr(1101);
        on.Update(5,510);
        Assert(!on.HasActiveTurn&&!Rage.Native.NativeFunction.Commands.Exists(x=>x.StartsWith("PLAY_FACIAL_ANIM")),
            "reused ped is never sent even a closing native");
        on.Dispose();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=false;
    }
    static void Main() {
        var s=new VoicePresenceTurnTracker();
        var a=new VoicePresenceTurnTracker.Key("ped1","turnA",1);
        var b=new VoicePresenceTurnTracker.Key("ped2","turnB",2);
        Assert(!s.Begin(new VoicePresenceTurnTracker.Key("","",0),1,1),"invalid key");
        Assert(s.Begin(a,1,100),"start");Assert(s.Begin(a,1,101),"duplicate start");
        Assert(!s.End(b,1),"unrelated end");
        Assert(!s.HasPlayout&&!s.MouthOpen,"no false mouth");
        Assert(!s.Sample(b,1,120,.7f),"foreign sample");
        Assert(!s.Sample(a,1,120,float.NaN),"nonfinite sample");
        Assert(s.Sample(a,1,120,.8f)&&s.MouthOpen,"loud opens");
        Assert(s.Sample(a,1,150,0f)&&s.MouthOpen,"short pause holds");
        Assert(s.Sample(a,1,310,0f)&&!s.MouthOpen,"silence closes");
        Assert(s.Sample(a,1,330,.7f)&&s.MouthOpen,"reopen");
        Assert(s.Sweep(1,350,true),"live owner");
        Assert(s.Sweep(1,600,true)&&!s.MouthOpen&&!s.HasPlayout,"stale sample closes");
        Assert(s.Begin(b,1,700),"B replaces A");
        Assert(!s.End(a,1)&&s.ActiveKey.Equals(b),"late A end cannot stop B");
        Assert(!s.Sample(a,1,710,1f),"late A sample");
        Assert(!s.Sweep(2,720,true)&&!s.Active,"world epoch reset");
        Assert(s.Begin(a,3,1),"new world");
        Assert(!s.Sweep(3,2,false)&&!s.Active,"ped lifetime loss");
        Assert(s.Begin(b,4,10)&&s.End(b,4)&&!s.Active,"exact completion");
        Assert(s.Begin(b,5,10),"timeout start");
        Assert(!s.Sweep(5,10+VoicePresenceTurnTracker.MaxTurnMs+1,true),"timeout cleanup");
        Assert(s.Begin(a,6,100),"start again");
        Assert(!s.Sample(a,6,99,.2f),"early sample");
        Assert(!s.Sample(a,6,102,1.2f),"invalid level");
        Assert(s.Sample(a,6,110,.5f),"ordered sample");
        Assert(!s.Sample(a,6,109,.5f),"out of order");
        s.Clear();Assert(!s.Active&&!s.HasPlayout&&!s.MouthOpen,"cleanup");
        TestObserver();
        TestOptInMouth();
        Console.WriteLine("NPC voice presence policy + native event observer: "+count+" checks passed.");
    }
}
