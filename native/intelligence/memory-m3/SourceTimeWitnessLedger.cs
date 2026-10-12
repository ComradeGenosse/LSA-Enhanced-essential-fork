using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Intelligence.MemoryM3
{
    // W02 native-only positive source ledger. This class must be constructed on
    // the existing Intelligence owner fiber with authentic Host/P2 resolvers.
    // K must call Record ONLY inside the original witness source callback,
    // never when a later PS2 observation arrives. No JS-origin registration.
    public sealed class SourceTimeOwner
    {
        public readonly string ObserverCaptureRef, OwnerAlias, IncarnationId, EncounterId;
        public SourceTimeOwner(string observer, string alias, string incarnation, string encounter)
        { ObserverCaptureRef=observer; OwnerAlias=alias; IncarnationId=incarnation; EncounterId=encounter; }
    }

    public sealed class SourceTimeWitnessLedger
    {
        const int Capacity=2048, MaxFrameProofs=8; // K also checks serialized 8192-byte limit
        readonly Func<string> run, adapterEpoch;
        readonly Func<int> worldEpoch;
        readonly Func<uint> nativeGameTick;
        readonly Func<string,SourceTimeOwner> resolveP2AtSource;
        readonly Func<string,SourceTimeParticipant> resolveParticipantAtSource;
        readonly Dictionary<string,SourceTimeWitnessProof> retained=new Dictionary<string,SourceTimeWitnessProof>();
        readonly Queue<string> order=new Queue<string>();
        readonly Dictionary<string,string> sourceLifetime=new Dictionary<string,string>();
        string sourceContext;
        public long Accepted {get;private set;}
        public long Denied {get;private set;}
        public long Overflow {get;private set;}
        public long Duplicates {get;private set;}
        public long Retired {get;private set;}
        public SourceTimeWitnessLedger(Func<string> run,Func<int> worldEpoch,Func<string> adapterEpoch,
            Func<uint> nativeGameTick,Func<string,SourceTimeOwner> resolveP2AtSource,
            Func<string,SourceTimeParticipant> resolveParticipantAtSource=null)
        {
            if(run==null||worldEpoch==null||adapterEpoch==null||nativeGameTick==null||
                resolveP2AtSource==null)throw new ArgumentNullException("native_source_ports");
            this.run=run;this.worldEpoch=worldEpoch;this.adapterEpoch=adapterEpoch;
            this.nativeGameTick=nativeGameTick;this.resolveP2AtSource=resolveP2AtSource;
            this.resolveParticipantAtSource=resolveParticipantAtSource;
        }
        static bool Id(string s) {Guid parsed;return s!=null&&Guid.TryParseExact(s,"D",out parsed)&&
            parsed.ToString("D")==s;}
        static bool Alias(string s)=>s!=null&&s.StartsWith("promoted.",StringComparison.Ordinal)&&
            s.Length==45&&Id(s.Substring(9));
        static bool Modality(WitnessReceipt r)=>
            (r.Channel=="visual"&&(r.Basis=="sampled_state"||r.Basis=="native_awareness"))||
            (r.Channel=="auditory"&&(r.Basis=="audibility_model"||r.Basis=="native_awareness"))||
            (r.Channel=="self"&&(r.Basis=="sampled_state"||r.Basis=="native_callback"))||
            (r.Channel=="report"&&r.Basis=="dialogue_report");
        static string Key(string run,int epoch,string signal,string refId)=>
            run+"|"+epoch+"|"+signal+"|"+refId;
        // Witness receipt is created by WitnessPolicy on the original native
        // sample. Source tick must equal the native clock NOW: a delayed callback
        // cannot use its old signal.gameTick to backdate a new owner lookup.
        public bool Record(string signalId,WitnessReceipt witness)
        { return RecordCore(signalId,witness,null,null); }
        // RawSignal sources and witness flags are original native source data,
        // NOT claimed participant identities sent by PS2 or the model.
        public bool Record(RawSignal signal,WitnessReceipt witness)
        { return RecordCore(signal==null?null:signal.signalId,witness,
            signal==null?null:signal.source,signal==null?null:signal.target); }
        bool RecordCore(string signalId,WitnessReceipt witness,string sourceRef,string targetRef)
        {
            if(witness==null||
                !((witness.Status=="witnessed"&&witness.Channel!="report")||
                  (witness.Status=="reported"&&witness.Channel=="report"))||
                !Modality(witness)||
                !Id(signalId)||!Id(witness.Observer)||
                nativeGameTick()!=witness.SampledGameTick){Denied++;return false;}
            var host=run();var epoch=worldEpoch();var adapter=adapterEpoch();
            if(!Id(host)||epoch<=0||!Id(adapter)){Denied++;return false;}
            SourceTimeOwner owner=null;
            try{owner=resolveP2AtSource(witness.Observer);}catch{}
            if(owner==null||owner.ObserverCaptureRef!=witness.Observer||
                !Alias(owner.OwnerAlias)||!Id(owner.IncarnationId)||!Id(owner.EncounterId)||
                run()!=host||worldEpoch()!=epoch||adapterEpoch()!=adapter||
                nativeGameTick()!=witness.SampledGameTick){Denied++;return false;}
            var context=host+"|"+epoch+"|"+adapter;
            if(sourceContext!=null&&sourceContext!=context){Retire();Denied++;return false;}
            sourceContext=context;
            var lifetime=owner.OwnerAlias+"|"+owner.IncarnationId+"|"+owner.EncounterId;
            string established;
            if(sourceLifetime.TryGetValue(owner.ObserverCaptureRef,out established)&&
                established!=lifetime){Denied++;return false;}
            sourceLifetime[owner.ObserverCaptureRef]=lifetime;
            var key=Key(host,epoch,signalId,witness.Observer);
            if(retained.ContainsKey(key)){Duplicates++;return false;}
            var participants=new List<SourceTimeParticipant>();
            if(resolveParticipantAtSource!=null) {
                var refs=new List<string>();
                if(witness.KnowsSource&&sourceRef!=null)refs.Add(sourceRef);
                if(witness.KnowsTarget&&targetRef!=null&&!refs.Contains(targetRef))refs.Add(targetRef);
                foreach(var target in refs.Take(2)) {
                    if(!Id(target))continue;
                    SourceTimeParticipant participant=null;
                    try{participant=resolveParticipantAtSource(target);}catch{}
                    if(participant==null||participant.captureRef!=target||
                       !((participant.subjectKind=="protagonist"&&
                         (participant.subjectKey=="franklin"||participant.subjectKey=="michael"||
                          participant.subjectKey=="trevor"))||
                         (participant.subjectKind=="character"&&Id(participant.subjectKey))))
                        continue;
                    participants.Add(participant);
                }
                if(run()!=host||worldEpoch()!=epoch||adapterEpoch()!=adapter||
                    nativeGameTick()!=witness.SampledGameTick){Denied++;return false;}
            }
            var proof=new SourceTimeWitnessProof {
                sourceReceiptId=Guid.NewGuid().ToString("D"),signalId=signalId,
                source="original_native_ps2_witness_sample",
                hostRunId=host,worldEpoch=epoch,adapterEpoch=adapter,
                observerCaptureRef=owner.ObserverCaptureRef,
                ownerAlias=owner.OwnerAlias,incarnationId=owner.IncarnationId,
                encounterId=owner.EncounterId,sampledGameTick=witness.SampledGameTick,
                status=witness.Channel=="report"?"reported":"witnessed",
                channel=witness.Channel,basis=witness.Basis,
                participants=participants.ToArray()
            };
            if(retained.Count>=Capacity) {
                var evicted=order.Dequeue();retained.Remove(evicted);Overflow++;
            }
            retained.Add(key,proof);order.Enqueue(key);Accepted++;
            return true;
        }
        // Only a bounded batch crosses the 8192-byte original pipe.
        // Source evidence is copied (not retroactively recomputed on demand).
        // K MUST check the actual serialized byte length and Send() success,
        // fail closed on connection loss and never ack an untransmitted proof.
        public SourceTimeWitnessBatch PeekBatch()
        {
            if(order.Count==0)return null;
            var first=retained[order.Peek()];
            var batch=new List<SourceTimeWitnessProof>();
            foreach(var key in order) {
                var row=retained[key];
                if(batch.Count>=MaxFrameProofs||
                    row.hostRunId!=first.hostRunId||row.worldEpoch!=first.worldEpoch||
                    row.adapterEpoch!=first.adapterEpoch)break;
                batch.Add(row);
            }
            return new SourceTimeWitnessBatch {
                sourceProofVersion=1,hostRunId=first.hostRunId,
                worldEpoch=first.worldEpoch,proofs=batch.ToArray()
            };
        }
        // Only after original channel Send returned true. Retain failed batch
        // for retry; pipe ACK is still NOT SQLite durability confirmation.
        public bool AcknowledgeQueued(SourceTimeWitnessBatch batch)
        {
            if(batch==null||batch.proofs==null||batch.proofs.Length<1||
                batch.proofs.Length>MaxFrameProofs||order.Count<batch.proofs.Length)return false;
            var expected=order.Take(batch.proofs.Length).ToArray();
            for(int i=0;i<expected.Length;i++)
                if(!Object.ReferenceEquals(retained[expected[i]],batch.proofs[i]))return false;
            foreach(var key in expected){order.Dequeue();retained.Remove(key);}
            return true;
        }
        public void Retire(){Retired+=retained.Count;retained.Clear();order.Clear();sourceLifetime.Clear();sourceContext=null;}
        public object Diagnostics()=>new {accepted=Accepted,denied=Denied,duplicate=Duplicates,
            overflow=Overflow,retired=Retired,queued=retained.Count,
            negativeCoverageAvailable=false,prepromotionAvailable=false};
    }

    // Immutable after Record: one exact native source-tick observation lifetime,
    // never current-owner lookup and never a guessed participant/protagonist.
    // Strictly source-tick-verified participant identity. No current model/name
    // lookup is sufficient. K must supply this optional native resolver.
    public sealed class SourceTimeParticipant
    {
        public readonly string captureRef,subjectKind,subjectKey;
        public SourceTimeParticipant(string refId,string kind,string key)
        {captureRef=refId;subjectKind=kind;subjectKey=key;}
    }
    public sealed class SourceTimeWitnessBatch
    {
        public int sourceProofVersion,worldEpoch;
        public string hostRunId;
        public SourceTimeWitnessProof[] proofs;
    }
    public sealed class SourceTimeWitnessProof
    {
        public string sourceReceiptId,signalId,source,hostRunId,adapterEpoch;
        public int worldEpoch;
        public string observerCaptureRef,ownerAlias,incarnationId,encounterId;
        public uint sampledGameTick;
        public string status,channel,basis;
        public SourceTimeParticipant[] participants;
    }
}
