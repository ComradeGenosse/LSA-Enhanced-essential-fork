using System;
using System.Collections.Generic;

namespace LSA.Activities
{
    // Owner-fiber passive C-05 correlation; no Rage calls or execution authority.
    public sealed class DialogueActionCorrelator
    {
        sealed class Pending
        {
            public Dictionary<string,object> Annotation;
            public object Body;
            public string CaptureRef,Encounter,Incarnation,Action;
            public long Fence,AtWall,Before;
            public uint AtGame;
        }
        readonly List<Pending> pending=new List<Pending>();
        readonly string hostRun;
        readonly int worldEpoch;
        long unsafeUntil=-1;
        public int Count => pending.Count;
        public DialogueActionCorrelator(string hostRun,int worldEpoch){if(!ActivityContracts.IsUuid(hostRun) || worldEpoch<1)throw new ArgumentException("invalid_host_context");this.hostRun=hostRun;this.worldEpoch=worldEpoch;}
        static Dictionary<string,object> Copy(Dictionary<string,object> source){var copy=new Dictionary<string,object>();foreach(var pair in source)copy[pair.Key]=pair.Value is Dictionary<string,object> child?Copy(child):pair.Value;return copy;}
        void Expire(uint game,long wall){pending.RemoveAll(row=>wall<row.AtWall || wall-row.AtWall>5000 || unchecked(game-row.AtGame)>5000);}
        public bool Accept(Dictionary<string,object> annotation,object exactBody,long captureFence,uint game,long wall)
        {
            if(annotation==null || !annotation.ContainsKey("sequence") || !(annotation["sequence"] is int sequence) || !ActivityContracts.DialogueActionAnnotation(annotation,sequence) || exactBody==null || captureFence<0 || wall<0)return false;
            var binding=(Dictionary<string,object>)annotation["binding"];var context=(Dictionary<string,object>)binding["hostContext"];
            if((string)context["hostRunId"]!=hostRun || (int)context["worldEpoch"]!=worldEpoch)return false;
            Expire(game,wall);if(wall<=unsafeUntil)return false;
            var captureRef=(string)binding["captureRef"];var encounter=binding.ContainsKey("encounterId")?(string)binding["encounterId"]:null;var incarnation=binding.ContainsKey("incarnationId")?(string)binding["incarnationId"]:null;var action=(string)annotation["canonicalAction"];
            if(pending.Exists(row=>Equals(row.Annotation["publicationId"],annotation["publicationId"])))return false;
            if(pending.Exists(row=>row.CaptureRef==captureRef && row.Encounter==encounter && row.Incarnation==incarnation && row.Action==action)){
                // Ambiguous native action callbacks have no source publication id.
                // Invalidate all pending joins for this bounded window; never pick latest.
                Invalidate(wall);return false;
            }
            if(pending.Count>=32)return false;
            pending.Add(new Pending{Annotation=Copy(annotation),Body=exactBody,CaptureRef=captureRef,Encounter=encounter,Incarnation=incarnation,Action=action,Fence=captureFence,AtGame=game,AtWall=wall});return true;
        }
        public Dictionary<string,object> Match(CallbackRecord record,string captureRef,string encounter,string incarnation,string currentHost,int currentWorld,uint game,long wall,bool overflowed)
        {
            if(wall<0)return null;
            if(overflowed){Invalidate(wall);return null;}
            Expire(game,wall);
            if(record==null || record.Source!="essential" || (record.Phase!="executed" && record.Phase!="before") || currentHost!=hostRun || currentWorld!=worldEpoch)return null;
            var row=pending.Find(candidate=>candidate.CaptureRef==captureRef && candidate.Encounter==encounter && candidate.Incarnation==incarnation && ReferenceEquals(candidate.Body,record.PedReference) && candidate.Action==record.Name && record.CaptureSequence>candidate.Fence && unchecked(record.GameMs-candidate.AtGame)<=5000);
            if(row==null)return null;
            if(record.Phase=="before"){
                if(row.Before!=0){Invalidate(wall);return null;}
                row.Before=record.CaptureSequence;return null;
            }
            if(!record.Succeeded.HasValue || row.Before<=row.Fence || record.CaptureSequence<=row.Before)return null;
            pending.Remove(row);var result=Copy(row.Annotation);result["succeeded"]=record.Succeeded.Value;result["atGameTick"]=(long)record.GameMs;return result;
        }
        public Dictionary<string,object> PendingForCallback(CallbackRecord record)
        {
            if(record==null || record.Source!="essential" || (record.Phase!="before" && record.Phase!="executed"))return null;
            var row=pending.Find(candidate=>ReferenceEquals(candidate.Body,record.PedReference) && candidate.Action==record.Name && record.CaptureSequence>candidate.Fence);
            return row==null?null:Copy(row.Annotation);
        }
        public void Invalidate(long wall){pending.Clear();unsafeUntil=Math.Max(unsafeUntil,wall>long.MaxValue-5000?long.MaxValue:wall+5000);}
        public void RetireCapture(string captureRef){pending.RemoveAll(row=>row.CaptureRef==captureRef);}
        public void Retire(string encounter,string incarnation){pending.RemoveAll(row=>row.Encounter==encounter && row.Incarnation==incarnation);}
        public void Reset(){pending.Clear();unsafeUntil=-1;}
    }

    public sealed class CallbackRecord
    {
        // PedReference is deliberately opaque here so the ACT transport/core layer
        // has no Rage dependency. The promoted-character owner resolves it only
        // when draining the ring on Essential's update fiber.
        public object PedReference;
        public string ActorKey, IncarnationId, Name, Phase, Source;
        public bool? Succeeded;
        public uint GameMs;
        public long CaptureSequence;
    }

    // Callback producers may run outside the update fiber. They only append a
    // bounded record; the update fiber resolves Ped/incarnation state later.
    public sealed class SupersessionMonitor
    {
        readonly object gate = new object();
        readonly Queue<CallbackRecord> ring = new Queue<CallbackRecord>();
        int dropped;
        bool overflowing;
        long captureSequence;

        public int Dropped { get { lock (gate) return dropped; } }
        public bool Overflowing { get { lock (gate) return overflowing; } }
        public int Count { get { lock (gate) return ring.Count; } }
        // Sample this fence on the owner fiber when accepting a C-05 annotation.
        // A callback captured at/before it cannot belong to that publication.
        public long CaptureSequence { get { lock (gate) return captureSequence; } }

        public bool Push(CallbackRecord record)
        {
            if (record == null) return false;
            lock (gate) {
                if(captureSequence==long.MaxValue){dropped++;overflowing=true;return false;}
                var sequence=++captureSequence;
                if (ring.Count >= ActivityContracts.CallbackRing) { dropped++; overflowing = true; return false; }
                // Keep source-time fields stable even if a producer reuses its
                // record object. Ped remains opaque; no native/state reads here.
                ring.Enqueue(new CallbackRecord{PedReference=record.PedReference,ActorKey=record.ActorKey,IncarnationId=record.IncarnationId,Name=record.Name,Phase=record.Phase,Source=record.Source,Succeeded=record.Succeeded,GameMs=record.GameMs,CaptureSequence=sequence});
                return true;
            }
        }

        // World/host resets must discard queued callbacks before a fresh actor can
        // be registered. Retain the monotonic capture sequence: old fences must
        // never be reused, even across a GTA clock regression.
        public void ClearForWorldReset()
        {
            lock (gate) { ring.Clear(); overflowing = false; }
        }

        public CallbackRecord Drain()
        {
            lock (gate) {
                if (ring.Count == 0) return null;
                var record = ring.Dequeue();
                if (ring.Count == 0) overflowing = false;
                return record;
            }
        }
    }
}
