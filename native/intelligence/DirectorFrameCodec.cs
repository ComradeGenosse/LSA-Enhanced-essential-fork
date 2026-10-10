using System;
using System.Collections.Generic;
using System.Text;
using System.Web.Script.Serialization;

namespace LSA.Intelligence
{
    // A closed, versioned request vocabulary carried on the EXISTING PS pipe.
    // Decode is called only on the Core owner fiber after the bounded socket
    // reader; it never invokes Essential, native actions, or the model.
    internal static class DirectorFrameCodec
    {
        static readonly string[] Fields={
            "version","type","operation","ticketId","dedupeKey","hostRunId",
            "worldEpoch","speakerCaptureRef","playerCaptureRef",
            "ownerIncarnationId","proofRevision","playerTurnVersion",
            "policyVersion","observationId","observationRevision","decisionKey","ageMs"
        };
        static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=8192,RecursionLimit=6 };
        static bool String(Dictionary<string,object> values,string key,out string result)
        {
            result=null;object item;
            if(!values.TryGetValue(key,out item)||!(item is string))return false;
            result=(string)item;return true;
        }
        static bool Integer(Dictionary<string,object> values,string key,out int result)
        {
            result=0;object item;
            if(!values.TryGetValue(key,out item))return false;
            if(item is int){result=(int)item;return true;}
            if(item is long && (long)item<=int.MaxValue && (long)item>=int.MinValue){result=(int)(long)item;return true;}
            return false; // no coercion from string, boolean, fraction or null
        }
        public static bool TryDecode(string frame,out DirectorAdmission.Request value)
        {
            value=null;
            if(frame==null || Encoding.UTF8.GetByteCount(frame)>8192)return false;
            try {
                var fields=Json.DeserializeObject(frame) as Dictionary<string,object>;
                if(fields==null || fields.Count!=Fields.Length)return false;
                foreach(var key in Fields)if(!fields.ContainsKey(key))return false;
                string type,operation,ticket,dedupe,host,speaker,player,owner,observation,decision;
                int version,epoch,proof,turn,policy,revision,age;
                if(!Integer(fields,"version",out version)||version!=1||
                   !String(fields,"type",out type)||type!="director.request"||
                   !String(fields,"operation",out operation)||
                   !String(fields,"ticketId",out ticket)||
                   !String(fields,"dedupeKey",out dedupe)||
                   !String(fields,"hostRunId",out host)||
                   !String(fields,"speakerCaptureRef",out speaker)||
                   !String(fields,"playerCaptureRef",out player)||
                   !String(fields,"ownerIncarnationId",out owner)||
                   !String(fields,"observationId",out observation)||
                   !String(fields,"decisionKey",out decision)||
                   !Integer(fields,"worldEpoch",out epoch)||
                   !Integer(fields,"proofRevision",out proof)||
                   !Integer(fields,"playerTurnVersion",out turn)||
                   !Integer(fields,"policyVersion",out policy)||
                   !Integer(fields,"observationRevision",out revision)||
                   !Integer(fields,"ageMs",out age))return false;
                // Semantic UUID, lifetime, evidence and safety checks belong
                // to independent DirectorAdmission.Handle after decode.
                value=new DirectorAdmission.Request {
                    Version=version,Operation=operation,TicketId=ticket,DedupeKey=dedupe,
                    HostRunId=host,WorldEpoch=epoch,SpeakerCaptureRef=speaker,
                    PlayerCaptureRef=player,OwnerIncarnationId=owner,
                    ProofRevision=proof,PlayerTurnVersion=turn,PolicyVersion=policy,
                    ObservationId=observation,ObservationRevision=revision,
                    DecisionKey=decision,AgeMs=age
                };
                return true;
            }catch{return false;}
        }
    }
}
