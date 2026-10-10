using System;
using System.Collections.Generic;
using System.Text;
using System.Web.Script.Serialization;

namespace LSA.Intelligence
{
    // Closed first-party backend ownership vocabulary. No extra fields,
    // bool-as-number, floating point epoch or forged quiet inference.
    internal static class DirectorOriginalTurnReceiptCodec
    {
        static readonly string[] Keys={
            "version","type","source","sourceRun","ticketId","hostRunId",
            "worldEpoch","playerTurnVersion","revision","observationSerial","quiet"
        };
        static readonly JavaScriptSerializer Json=new JavaScriptSerializer {
            MaxJsonLength=8192,RecursionLimit=5
        };
        static bool Str(Dictionary<string,object> d,string key,out string value)
        {
            value=null;object input;
            return d.TryGetValue(key,out input)&&(value=input as string)!=null;
        }
        static bool Int(Dictionary<string,object> d,string key,out int value)
        {
            value=0;object input;
            if(!d.TryGetValue(key,out input))return false;
            if(input is int){value=(int)input;return true;}
            if(input is long && (long)input>=int.MinValue && (long)input<=int.MaxValue){
                value=(int)(long)input;return true;
            }
            return false;
        }
        static bool Long(Dictionary<string,object> d,string key,out long value)
        {
            value=0;object input;
            if(!d.TryGetValue(key,out input))return false;
            if(input is int){value=(int)input;return true;}
            if(input is long){value=(long)input;return true;}
            return false;
        }
        internal static bool TryDecode(string frame,out DirectorOriginalTurnReceipts.Evidence result)
        {
            result=null;
            if(frame==null || Encoding.UTF8.GetByteCount(frame)>8192)return false;
            try {
                var d=Json.DeserializeObject(frame) as Dictionary<string,object>;
                if(d==null || d.Count!=Keys.Length)return false;
                foreach(var key in Keys)if(!d.ContainsKey(key))return false;
                string type,source,sourceRun,ticket,host;
                int version,epoch,playerVersion;
                long revision,serial;
                object quiet;
                if(!Int(d,"version",out version)||version!=1 ||
                   !Str(d,"type",out type)||type!="director.original_owner_receipt"||
                   !Str(d,"source",out source) ||
                   !Str(d,"sourceRun",out sourceRun) ||
                   !Str(d,"ticketId",out ticket) ||
                   !Str(d,"hostRunId",out host) ||
                   !Int(d,"worldEpoch",out epoch) ||
                   !Int(d,"playerTurnVersion",out playerVersion) ||
                   !Long(d,"revision",out revision) ||
                   !Long(d,"observationSerial",out serial) ||
                   !d.TryGetValue("quiet",out quiet)||!(quiet is bool))return false;
                result=new DirectorOriginalTurnReceipts.Evidence {
                    Version=version,Source=source,SourceRun=sourceRun,
                    TicketId=ticket,HostRunId=host,WorldEpoch=epoch,
                    PlayerTurnVersion=playerVersion,Revision=revision,
                    ObservationSerial=serial,Quiet=(bool)quiet
                };
                return true;
            }catch{return false;}
        }
    }
}
