using System;
using LSA.Intelligence;
using LSA.Intelligence.MemoryM3;

internal static class Program
{
    static int failures;
    static void Check(bool condition,string name)
    {
        if(!condition){Console.Error.WriteLine("FAIL "+name);failures++;}
        else Console.WriteLine("PASS "+name);
    }
    static string Id()=>Guid.NewGuid().ToString("D");
    static void Main()
    {
        var run=Id();var adapter=Id();var signal=Id();
        var a=Id();var b=Id();var aInc=Id();var bInc=Id();
        var aEnc=Id();var bEnc=Id();var aAlias="promoted."+Id();
        var bAlias="promoted."+Id();
        uint tick=100;
        int epoch=2;
        var aliases=new System.Collections.Generic.Dictionary<string,SourceTimeOwner>{
          {a,new SourceTimeOwner(a,aAlias,aInc,aEnc)},
          {b,new SourceTimeOwner(b,bAlias,bInc,bEnc)}
        };
        var ledger=new SourceTimeWitnessLedger(()=>run,()=>epoch,()=>adapter,()=>tick,
          observer=>aliases.ContainsKey(observer)?aliases[observer]:null);
        WitnessReceipt Witness(string observer)=>new WitnessReceipt {
          Observer=observer,SampledGameTick=tick,Status="witnessed",
          Channel="visual",Basis="sampled_state"
        };
        Check(ledger.Record(signal,Witness(a)),"first owner at exact source tick");
        Check(ledger.Record(signal,Witness(b)),"second owner same native signal");
        Check(!ledger.Record(signal,Witness(a)),"replayed native signal is duplicate");
        var batch=ledger.PeekBatch();
        Check(batch!=null&&batch.proofs.Length==2,"two immutable independent proofs");
        Check(batch.proofs[0].observerCaptureRef==a &&
          batch.proofs[1].observerCaptureRef==b,"no observer cross attribution");
        Check(batch.proofs[0].ownerAlias==aAlias&&batch.proofs[1].ownerAlias==bAlias,
          "aliases reflect sampled native owners");
        Check(!ledger.AcknowledgeQueued(null),"cannot acknowledge without batch");
        Check(ledger.PeekBatch().proofs.Length==2,"unacked payload retained");
        Check(ledger.AcknowledgeQueued(batch),"success ack after native channel send");
        Check(ledger.PeekBatch()==null,"ack removes only sent records");
        tick=102;
        var delayed=Witness(a);delayed.SampledGameTick=100;
        Check(!ledger.Record(Id(),delayed),"delayed source cannot backdate new identity");
        var miss=Witness(a);miss.Status="did_not_witness";
        Check(!ledger.Record(Id(),miss),"no negative from sampled witness omission");
        var report=Witness(a);report.Channel="report";report.Basis="dialogue_report";
        Check(!ledger.Record(Id(),report),"report cannot be forged as witnessed");
        var changed=Witness(a);
        aliases[a]=new SourceTimeOwner(a,aAlias,Id(),aEnc);
        Check(!ledger.Record(Id(),changed),"recycled native incarnation revoked");
        aliases[a]=new SourceTimeOwner(a,aAlias,aInc,aEnc);
        var newWitness=Witness(a);
        Check(ledger.Record(Id(),newWitness),"original incarnation restored in fixture");
        epoch=3;
        Check(!ledger.Record(Id(),newWitness),"host epoch cannot silently rebase ledger");
        Check(ledger.PeekBatch()==null,"host epoch retires old evidence");
        Check(ledger.Record(Id(),newWitness),"fresh host context can begin new ledger");
        ledger.Retire();Check(ledger.PeekBatch()==null,"owner retirement removes unqueued proofs");
        for(var i=0;i<2050;i++)CheckQuiet(ledger.Record(Id(),newWitness),"bounded");
        Check(ledger.Overflow==2,"native queue bounded with explicit overflow count");
        Check(ledger.PeekBatch().proofs.Length==16,"pipe frame batch maximum");
        Check(failures==0,"all native W02 policies passed");
        if(failures!=0)Environment.ExitCode=1;
    }
    static void CheckQuiet(bool condition,string name){if(!condition){Console.Error.WriteLine("FAIL "+name);failures++;}}
}
