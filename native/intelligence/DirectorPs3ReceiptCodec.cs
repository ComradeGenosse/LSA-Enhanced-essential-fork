using System;
using System.Collections.Generic;
using System.Text;
using System.Web.Script.Serialization;

namespace LSA.Intelligence
{
    // Closed, separately versioned PS3 receipt vocabulary. Parse on native
    // owner fiber only. Authentication is the existing user-ACL PS pipe, and
    // provenance is verified *after* parsing by DirectorPs3Receipts.
    internal static class DirectorPs3ReceiptCodec
    {
        static readonly string[] Keys={
            "version","type","source","challenge","ticketId","hostRunId","worldEpoch",
            "speakerCaptureRef","playerCaptureRef","ownerIncarnationId","proofRevision",
            "situationRevision","signalId","observationId","observationRevision",
            "decisionKey","policyVersion","ageMs"
        };
        static readonly JavaScriptSerializer Json=new JavaScriptSerializer {
            MaxJsonLength=8192,RecursionLimit=5
        };
        static bool Str(Dictionary<string,object> d,string key,out string val)
        {
            val=null;object v;return d.TryGetValue(key,out v) && (val=v as string)!=null;
        }
        static bool Int(Dictionary<string,object> d,string key,out int val)
        {
            val=0;object v;
            if(!d.TryGetValue(key,out v))return false;
            if(v is int) {val=(int)v;return true;}
            if(v is long && (long)v>=int.MinValue && (long)v<=int.MaxValue) {
                val=(int)(long)v;return true;
            }
            return false;
        }
        internal static bool TryDecode(string frame,out DirectorPs3Receipts.Grant result)
        {
            result=null;
            if(frame==null||Encoding.UTF8.GetByteCount(frame)>8192)return false;
            try {
                var d=Json.DeserializeObject(frame) as Dictionary<string,object>;
                if(d==null||d.Count!=Keys.Length)return false;
                foreach(var k in Keys)if(!d.ContainsKey(k))return false;
                string type,source,challenge,ticket,host,speaker,player,owner,signal,observation,decision;
                int version,epoch,proof,situation,observationRevision,policy,age;
                if(!Int(d,"version",out version)||version!=1||
                   !Str(d,"type",out type)||type!="director.ps3_receipt"||
                   !Str(d,"source",out source)||
                   !Str(d,"challenge",out challenge)||
                   !Str(d,"ticketId",out ticket)||
                   !Str(d,"hostRunId",out host)||
                   !Int(d,"worldEpoch",out epoch)||
                   !Str(d,"speakerCaptureRef",out speaker)||
                   !Str(d,"playerCaptureRef",out player)||
                   !Str(d,"ownerIncarnationId",out owner)||
                   !Int(d,"proofRevision",out proof)||
                   !Int(d,"situationRevision",out situation)||
                   !Str(d,"signalId",out signal)||
                   !Str(d,"observationId",out observation)||
                   !Int(d,"observationRevision",out observationRevision)||
                   !Str(d,"decisionKey",out decision)||
                   !Int(d,"policyVersion",out policy)||
                   !Int(d,"ageMs",out age))return false;
                result=new DirectorPs3Receipts.Grant {
                    Version=version,Source=source,Challenge=challenge,
                    TicketId=ticket,HostRunId=host,WorldEpoch=epoch,
                    SpeakerCaptureRef=speaker,PlayerCaptureRef=player,
                    OwnerIncarnationId=owner,ProofRevision=proof,
                    SituationRevision=situation,SignalId=signal,
                    ObservationId=observation,ObservationRevision=observationRevision,
                    DecisionKey=decision,PolicyVersion=policy,AgeMs=age
                };
                return true;
            }catch{return false;}
        }
    }
}
