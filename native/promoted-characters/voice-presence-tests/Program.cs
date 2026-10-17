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

    // ---- Level-driven mouth (Essential playout level) -------------------------------
    sealed class FakeLevels : IPlayoutLevelSource {
        public readonly System.Collections.Generic.Dictionary<int,float> Level=new System.Collections.Generic.Dictionary<int,float>();
        public readonly System.Collections.Generic.Dictionary<int,bool> Audible=new System.Collections.Generic.Dictionary<int,bool>();
        public readonly System.Collections.Generic.List<string> Requests=new System.Collections.Generic.List<string>();
        public bool Available {get;set;}=true;
        public bool Fail;
        public bool TryRead(Rage.Ped ped,string pedId,string turnId,long gen,out float level,out bool audible,out bool turnBuffered) {
            Requests.Add(ped.Handle+":"+pedId+":"+turnId+":"+gen);
            level=0;audible=false;turnBuffered=true;
            if(Fail)return false;
            Level.TryGetValue(ped.Handle,out level);
            Audible.TryGetValue(ped.Handle,out audible);
            return true;
        }
        public void Set(Rage.Ped p,float l,bool audible=true){Level[p.Handle]=l;Audible[p.Handle]=audible;}
    }
    static Rage.Ped NewPed(int handle,int address) =>
        new Rage.Ped {Handle=handle,MemoryAddress=new IntPtr(address),Position=new Rage.Vector3(handle,0,0)};
    static int Count(string cmd)=>Rage.Native.NativeFunction.Commands.Count(x=>x==cmd);
    static bool Sent(string prefix)=>Rage.Native.NativeFunction.Commands.Exists(x=>x.StartsWith(prefix));
    static void Reset() {
        Rage.Native.NativeFunction.Commands.Clear();Rage.Game.Log.Clear();
        Rage.Native.NativeFunction.Cutscene=false;
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=true;
        LosSantosAlive.Audio.NpcSpatialAudio.Audible=false;LosSantosAlive.Audio.NpcSpatialAudio.Rms=0;
        LosSantosAlive.Audio.NpcSpatialAudio.Throw=false;LosSantosAlive.Audio.NpcSpatialAudio.Buffered=false;
        LosSantosAlive.Audio.NpcSpatialAudio.Reads=0;
    }
    static NpcVoicePresenceObserver MouthObserver(FakeLevels levels,string mode="on",bool mouth=true,bool log=false,float open=0.015f) {
        var o=new NpcVoicePresenceObserver(mode,mouth,open,log,levels);o.Attach();return o;
    }
    static void Start(Rage.Ped p,string pedId,string turn,long gen)=>LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseStarted(p,pedId,turn,gen);
    static void End(Rage.Ped p,string pedId,string turn,long gen)=>LosSantosAlive.Audio.NpcPlaybackCoordinator.RaiseEnded(p,pedId,turn,gen);

    static void TestOptInMouth() {
        Reset();
        var player=NewPed(10,1000);var npc=NewPed(11,1100);
        Rage.Game.LocalPlayer.Character=player;
        var levels=new FakeLevels();levels.Set(npc,0.2f);

        var shadow=MouthObserver(levels,"shadow",true);
        Start(npc,"npc1","shadow",10);shadow.Update(5,100);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"shadow must never change actor appearance");
        Assert(levels.Requests.Count==0,"shadow without levelLog does not even read levels");
        shadow.Dispose();

        var disabled=MouthObserver(levels,"on",false);
        Start(npc,"npc1","disabled",11);disabled.Update(5,200);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"on mode still requires explicit mouth opt-in");
        disabled.Dispose();

        var on=MouthObserver(levels);
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=false;
        Start(npc,"npc1","first",12);on.Update(5,300);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"queued but not currently speaking must not animate");
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=true;
        levels.Set(npc,0f,false);
        on.Update(5,350);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"Essential 'speaking' with no audible playout level must NOT animate");
        levels.Set(npc,0.2f,true);
        on.Update(5,400);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"audible playout level opens the mouth once");
        on.Update(5,450);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"facial native is rate limited while open");
        Start(npc,"npc1","second",13);on.Update(5,500);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"replacement closes only previously applied facial overlay");
        End(npc,"npc1","first",12);on.Update(5,520);
        Assert(on.HasActiveTurn&&on.ActiveGeneration==13,"old end cannot stop replacement");
        End(npc,"npc1","second",13);on.Update(5,550);
        Assert(!on.HasActiveTurn,"replacement ends");
        // A delayed old START must not resurrect a finished generation.
        Start(npc,"npc1","first",12);on.Update(5,560);
        Assert(!on.HasActiveTurn,"late old START rejected after newer playback END");
        Start(npc,"npc1","second",13);on.Update(5,570);
        Assert(!on.HasActiveTurn,"exact duplicate START rejected after completed END");
        Rage.Native.NativeFunction.Commands.Clear();
        Start(npc,"npc1","third",14);on.Update(5,600);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"third turn opens from level");
        Rage.Native.NativeFunction.Commands.Clear();
        npc.MemoryAddress=new IntPtr(1101);on.Update(5,610);
        Assert(!on.HasActiveTurn&&!Sent("PLAY_FACIAL_ANIM"),"reused ped is never sent even a closing native");
        on.Dispose();
    }

    static void TestVolumesAndPauses() {
        Reset();
        var player=NewPed(20,2000);var npc=NewPed(21,2100);Rage.Game.LocalPlayer.Character=player;
        var levels=new FakeLevels();var o=MouthObserver(levels);
        Start(npc,"n","t",1);
        levels.Set(npc,0.005f);o.Update(1,1000);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"quiet speech below the open level keeps the mouth closed");
        levels.Set(npc,0.012f);o.Update(1,1050);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"a level between close and open thresholds does not open a closed mouth");
        levels.Set(npc,0.30f);o.Update(1,1100);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"loud speech opens");
        levels.Set(npc,0.012f);o.Update(1,1200);o.Update(1,1350);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==0,"hysteresis keeps a wavering level open");
        levels.Set(npc,0f,true);o.Update(1,1400);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==0,"short pause is held open (no flicker)");
        o.Update(1,1600);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"natural pause closes the mouth");
        levels.Set(npc,0.4f);o.Update(1,1650);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"reopen is held back by the minimum closed dwell");
        o.Update(1,1750);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==2,"next word reopens after dwell");
        levels.Set(npc,0.4f,false);o.Update(1,1800);o.Update(1,2000);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==2,"inaudible playout (e.g. muted or gap) immediately closes despite stale RMS");
        // Mouth never opens or closes faster than the dwell limits.
        Rage.Native.NativeFunction.Commands.Clear();
        for(long t=2100;t<3100;t+=10){levels.Set(npc,(t/10)%2==0?0.5f:0f);o.Update(1,t);}
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")+Count("PLAY_FACIAL_ANIM:mood_normal_1")<=10,"rapid level flapping cannot spam facial natives");
        o.Dispose();
    }

    static void TestStopsAndSpeakerChanges() {
        Reset();
        var player=NewPed(30,3000);var a=NewPed(31,3100);var b=NewPed(32,3200);Rage.Game.LocalPlayer.Character=player;
        var levels=new FakeLevels();levels.Set(a,0.3f);levels.Set(b,0.3f);
        var o=MouthObserver(levels);
        Start(a,"A","turnA",1);o.Update(1,100);o.Update(1,120);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1&&levels.Requests.TrueForAll(r=>r=="31:A:turnA:1"),
            "levels are requested only for the exact active turn/ped");
        // Natural speaker change A -> B: A's face is closed before B is ever read.
        Rage.Native.NativeFunction.Commands.Clear();levels.Requests.Clear();
        Start(b,"B","turnB",1);o.Update(1,130);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"speaker change closes the previous speaker immediately");
        Assert(levels.Requests.Count>0&&levels.Requests.TrueForAll(r=>r=="32:B:turnB:1"),"after the change only B's exact turn is read");
        o.Update(1,300);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"B opens from B's own level");
        End(a,"A","turnA",1);o.Update(1,310);
        Assert(o.HasActiveTurn&&o.ActiveHandle==32,"late end from A cannot stop B");
        // Interruption: Essential ends the turn while its tail is still audible.
        Rage.Native.NativeFunction.Commands.Clear();levels.Requests.Clear();
        End(b,"B","turnB",1);o.Update(1,320);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"interruption closes the mouth in the same update, ignoring dwell");
        Assert(!o.HasActiveTurn,"interrupted turn is gone");
        levels.Set(b,0.9f);Rage.Native.NativeFunction.Commands.Clear();o.Update(1,330);o.Update(1,500);
        Assert(!Sent("PLAY_FACIAL_ANIM")&&levels.Requests.Count==0,"audio tail after the turn ended is never attributed to anyone");
        // Essential stops speaking without an end event yet: close at once.
        Start(a,"A","turnA2",2);levels.Set(a,0.3f);o.Update(1,600);o.Update(1,620);
        Rage.Native.NativeFunction.Commands.Clear();
        LosSantosAlive.Audio.NpcPlaybackCoordinator.Talking=false;o.Update(1,630);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"speech stop closes the mouth immediately");
        o.Dispose();
    }

    static void TestFailSafeAndLifecycle() {
        Reset();
        var player=NewPed(40,4000);var npc=NewPed(41,4100);Rage.Game.LocalPlayer.Character=player;
        // Missing/changed Essential hook: production reader against the throwing stub.
        var real=new NpcVoicePresenceObserver("on",true,0.015f,false,new EssentialPlayoutLevelSource());real.Attach();
        LosSantosAlive.Audio.NpcSpatialAudio.Throw=true;
        Start(npc,"n","t",1);real.Update(1,100);real.Update(1,200);real.Update(1,300);
        Assert(real.HasActiveTurn,"observer keeps tracking the turn without a level hook");
        Assert(!Sent("PLAY_FACIAL_ANIM"),"missing renderer hook: mouth stays closed, nothing is estimated");
        Assert(Rage.Game.Log.Count(x=>x.Contains("playout_level=unavailable"))==1,"missing hook is logged once");
        LosSantosAlive.Audio.NpcSpatialAudio.Throw=false;LosSantosAlive.Audio.NpcSpatialAudio.Audible=true;LosSantosAlive.Audio.NpcSpatialAudio.Rms=0.5f;
        int reads=LosSantosAlive.Audio.NpcSpatialAudio.Reads;
        real.Update(1,400);
        Assert(!Sent("PLAY_FACIAL_ANIM")&&LosSantosAlive.Audio.NpcSpatialAudio.Reads==reads,"after a hook failure the reader stays off for the run");
        real.Dispose();

        // Production reader happy path through the Essential stub.
        Reset();
        LosSantosAlive.Audio.NpcSpatialAudio.Audible=true;LosSantosAlive.Audio.NpcSpatialAudio.Rms=0.2f;
        var live=new NpcVoicePresenceObserver("on",true,0.015f,false,new EssentialPlayoutLevelSource());live.Attach();
        Start(npc,"n","t2",2);live.Update(1,100);live.Update(1,150);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")==1,"Essential's getters drive the mouth");
        Rage.Native.NativeFunction.Commands.Clear();
        LosSantosAlive.Audio.NpcSpatialAudio.Rms=float.NaN;live.Update(1,400);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"non-finite level is treated as no signal and closes");
        live.Dispose();
        // Reader reports "no trustworthy reading" while the mouth is open: close, never hold.
        Reset();
        var flaky=new FakeLevels();flaky.Set(npc,0.3f);var fo=MouthObserver(flaky);
        Start(npc,"n","f",9);fo.Update(1,100);
        Rage.Native.NativeFunction.Commands.Clear();
        flaky.Fail=true;fo.Update(1,120);
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,
            "lost level proof closes immediately, even inside 150 ms open dwell");
        fo.Dispose();

        // Speech-state exception from Essential never escapes the observer.
        // World change: no native is sent on the old world's ped.
        Reset();
        var levels=new FakeLevels();levels.Set(npc,0.3f);var o=MouthObserver(levels);
        Start(npc,"n","w",1);o.Update(1,100);o.Update(1,150);
        Rage.Native.NativeFunction.Commands.Clear();
        o.Update(2,200);
        Assert(!o.HasActiveTurn&&!Sent("PLAY_FACIAL_ANIM"),"world epoch change drops the turn without touching the old ped");
        // The queued START belongs to the old epoch: it has no own stamp and
        // must not be interpreted as new-world speech after a clock reset.
        Start(npc,"n","queued-old-world",2);
        o.Update(3,220);
        Assert(!o.HasActiveTurn&&!Sent("PLAY_FACIAL_ANIM"),"old-world START discarded on epoch change");
        Start(npc,"n","fresh-world",1);
        o.Update(3,240);
        Assert(o.HasActiveTurn,"new-world generation begins after history reset");
        End(npc,"n","fresh-world",1);o.Update(3,260);
        Assert(!o.HasActiveTurn,"new world completes normally");
        // Despawned and recycled actors.
        Reset();
        Start(npc,"n","d",2);o.Update(3,300);o.Update(3,350);
        Rage.Native.NativeFunction.Commands.Clear();
        npc.Existing=false;o.Update(3,400);
        Assert(!o.HasActiveTurn&&!Sent("PLAY_FACIAL_ANIM"),"despawned ped gets no native call");
        npc.Existing=true;
        var recycled=NewPed(41,4100);Start(recycled,"n","r",3);o.Update(3,500);o.Update(3,550);
        Rage.Native.NativeFunction.Commands.Clear();
        recycled.Handle=77;o.Update(3,600);
        Assert(!o.HasActiveTurn&&!Sent("PLAY_FACIAL_ANIM"),"recycled handle gets no native call");
        // Authored cutscene: suppress, do not touch facial state.
        Reset();
        var fresh=NewPed(51,5100);levels.Set(fresh,0.3f);
        Rage.Native.NativeFunction.Cutscene=true;
        Start(fresh,"n","c",4);o.Update(3,700);o.Update(3,750);
        Assert(!Sent("PLAY_FACIAL_ANIM"),"authored cutscene suppresses the overlay");
        Rage.Native.NativeFunction.Cutscene=false;
        // Application shutdown while the mouth is open.
        Reset();
        o.Update(3,800);o.Update(3,1200);
        Assert(Count("PLAY_FACIAL_ANIM:mic_chatter")>=1,"mouth open before shutdown");
        Rage.Native.NativeFunction.Commands.Clear();
        o.Dispose();
        Assert(Count("PLAY_FACIAL_ANIM:mood_normal_1")==1,"shutdown closes the face exactly once");
        Start(fresh,"n","late",5);o.Update(3,1300);
        Assert(!o.HasActiveTurn&&!Sent("PLAY_FACIAL_ANIM:mic"),"events after shutdown are ignored");
    }

    static void TestProvidersAndLog() {
        // OpenAI / ElevenLabs / local TTS all arrive through Essential's one queue, so
        // the observer sees identical exact-turn events and identical levels.
        int[] counts=new int[3];string[] ids={"openai","elevenlabs","local"};
        for(int i=0;i<3;i++) {
            Reset();
            var player=NewPed(60,6000);var npc=NewPed(61,6100);Rage.Game.LocalPlayer.Character=player;
            var levels=new FakeLevels();levels.Set(npc,0.3f);var o=MouthObserver(levels);
            Start(npc,ids[i]+"-ped",ids[i]+"-turn",1);o.Update(1,100);o.Update(1,250);
            End(npc,ids[i]+"-ped",ids[i]+"-turn",1);o.Update(1,300);
            counts[i]=Rage.Native.NativeFunction.Commands.Count(x=>x.StartsWith("PLAY_FACIAL_ANIM"));
            o.Dispose();
        }
        Assert(counts[0]==2&&counts[1]==2&&counts[2]==2,"mouth behaviour is identical for every TTS provider");

        // Read-only calibration log: shadow mode, rate limited, never a facial native.
        Reset();
        var p=NewPed(70,7000);var n=NewPed(71,7100);n.Position=new Rage.Vector3(3,4,0);p.Position=new Rage.Vector3(0,0,0);
        Rage.Game.LocalPlayer.Character=p;
        var fl=new FakeLevels();fl.Set(n,0.1f);var sh=MouthObserver(fl,"shadow",false,true);
        Start(n,"n","log",1);
        for(long t=100;t<=1100;t+=50)sh.Update(1,t);
        var lines=Rage.Game.Log.FindAll(x=>x.StartsWith("[VP] level "));
        Assert(lines.Count>=3&&lines.Count<=5,"level log is rate limited (got "+lines.Count+")");
        Assert(lines[0].Contains("dist=5.0")&&lines[0].Contains("rms=0.1000")&&lines[0].Contains("audible=1"),"log carries distance and level");
        Assert(!Sent("PLAY_FACIAL_ANIM"),"calibration logging never changes the actor");
        var off=MouthObserver(fl,"off",false,true);
        Assert(true,"off mode constructs");
        sh.Dispose();
    }

    static void TestTrackerLevels() {
        var t=new VoicePresenceTurnTracker(0.02f);
        var k=new VoicePresenceTurnTracker.Key("p","t",1);
        Assert(t.Begin(k,1,0),"begin");
        Assert(t.Sample(k,1,10,0.019f)&&!t.MouthOpen,"below configured open level");
        Assert(t.Sample(k,1,20,0.021f)&&t.MouthOpen,"above configured open level");
        Assert(t.Sample(k,1,40,0.013f)&&t.MouthOpen,"hysteresis band stays open");
        Assert(t.Sample(k,1,60,0.011f)&&t.MouthOpen,"below close level holds during the silence window");
        Assert(t.Sweep(1,240,true)&&!t.MouthOpen,"sweep closes a pause without another sample");
        Assert(t.Sample(k,1,250,0.021f)&&t.MouthOpen,"reopens");
        t.Silence();Assert(!t.MouthOpen&&!t.HasPlayout&&t.Active,"Silence closes at once and keeps the turn");
        var bad=new VoicePresenceTurnTracker(float.NaN);Assert(bad.OpenLevel==VoicePresenceTurnTracker.OpenThreshold,"invalid open level falls back");
        var zero=new VoicePresenceTurnTracker(0f);Assert(zero.OpenLevel==VoicePresenceTurnTracker.OpenThreshold,"zero open level falls back");
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
        TestTrackerLevels();
        TestObserver();
        TestOptInMouth();
        TestVolumesAndPauses();
        TestStopsAndSpeakerChanges();
        TestFailSafeAndLifecycle();
        TestProvidersAndLog();
        Console.WriteLine("NPC voice presence policy + native event observer: "+count+" checks passed.");
    }
}
