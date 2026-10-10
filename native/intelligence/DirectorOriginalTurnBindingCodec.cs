using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.Intelligence
{
    // 13a/3B: only the original backend can report a generated stock turn.
    // This wire shape carries identity, NOT authorization. The receiving owner
    // fiber must separately prove the native ticket, source and live anchors.
    internal static class DirectorOriginalTurnBindingCodec
    {
        internal sealed class Frame
        {
            internal string TicketId,SourceRun,HostRunId,SpeakerCaptureRef,PedId,TurnId;
            internal int WorldEpoch,SessionNonce;
            internal long SourceRevision,GenerationId;
        }
        static readonly string[] Keys={
            "version","type","ticketId","sourceRun","sourceRevision",
            "hostRunId","worldEpoch","speakerCaptureRef","pedId",
            "turnId","generationId","sessionNonce"
        };
        static readonly JavaScriptSerializer Json=new JavaScriptSerializer {
            MaxJsonLength=8192,RecursionLimit=5
        };
        static bool Str(Dictionary<string,object> d,string key,out string value)
        {
            object item;value=null;
            return d.TryGetValue(key,out item) && (value=item as string)!=null;
        }
        static bool Number(Dictionary<string,object> d,string key,out long value)
        {
            value=0;object item;
            if(!d.TryGetValue(key,out item))return false;
            if(item is int)value=(int)item;
            else if(item is long)value=(long)item;
            else return false;
            return value>=0 && value<=DirectorAdmission.MaxExactWireGeneration;
        }
        internal static bool TryDecode(string input,out Frame result)
        {
            result=null;
            if(input==null||Encoding.UTF8.GetByteCount(input)>8192)return false;
            try {
                var values=Json.DeserializeObject(input) as Dictionary<string,object>;
                if(values==null||values.Count!=Keys.Length)return false;
                foreach(var key in Keys)if(!values.ContainsKey(key))return false;
                string type,ticket,run,host,capture,ped,turn;
                long version,revision,epoch,generation,nonce;
                if(!Number(values,"version",out version)||version!=1 ||
                   !Str(values,"type",out type)||type!="director.original_turn_bound" ||
                   !Str(values,"ticketId",out ticket) ||
                   !Str(values,"sourceRun",out run) ||
                   !Str(values,"hostRunId",out host) ||
                   !Str(values,"speakerCaptureRef",out capture) ||
                   !Str(values,"pedId",out ped) ||
                   !Str(values,"turnId",out turn) ||
                   !Number(values,"sourceRevision",out revision)||revision==0 ||
                   !Number(values,"worldEpoch",out epoch)||epoch==0||epoch>int.MaxValue ||
                   !Number(values,"generationId",out generation) ||
                   !Number(values,"sessionNonce",out nonce)||nonce==0||nonce>int.MaxValue ||
                   // Decode bounded hex-shaped PoolHandle string without numeric conversion.
                   !Regex.IsMatch(ped,@"\A[0-9a-fA-F]{1,16}\z") ||
                   string.IsNullOrWhiteSpace(turn)||turn.Length>128)return false;
                result=new Frame {
                    TicketId=ticket,SourceRun=run,SourceRevision=revision,
                    HostRunId=host,WorldEpoch=(int)epoch,
                    SpeakerCaptureRef=capture,PedId=ped,TurnId=turn,
                    GenerationId=generation,SessionNonce=(int)nonce
                };
                return true;
            }catch{return false;}
        }
    }
}
