using System;
using LSA.PromotedCharacters;
static class Program {
    static int count;
    static void Assert(bool ok,string why) {count++;if(!ok)throw new Exception(why);}
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
        Console.WriteLine("NPC voice presence policy: "+count+" checks passed.");
    }
}
