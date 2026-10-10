using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.Intelligence
{
    // The backend transports content but NEVER native authority. The owner
    // fiber recovers request identity only from its already submitted native
    // reservation, and independently rechecks original PS3/C-06 again.
    internal static class DirectorStockIntakeCodec
    {
        internal sealed class Frame
        {
            internal string TicketId,DedupeKey,Context;
        }
        static readonly JavaScriptSerializer Json=new JavaScriptSerializer {
            MaxJsonLength=8192,RecursionLimit=4
        };
        internal static bool TryDecode(string line,out Frame value)
        {
            value=null;
            if(line==null || Encoding.UTF8.GetByteCount(line)>8192)return false;
            try {
                var fields=Json.DeserializeObject(line) as Dictionary<string,object>;
                if(fields==null || fields.Count!=6 ||
                   !fields.ContainsKey("version") || !(fields["version"] is int) ||
                   (int)fields["version"]!=1 ||
                   !fields.ContainsKey("type") ||
                   !string.Equals(fields["type"] as string,"director.stock_intake",StringComparison.Ordinal) ||
                   !fields.ContainsKey("ticketId") ||
                   !fields.ContainsKey("dedupeKey") ||
                   !fields.ContainsKey("context") ||
                   !fields.ContainsKey("reason"))return false;
                var ticket=fields["ticketId"] as string;
                var dedupe=fields["dedupeKey"] as string;
                var context=fields["context"] as string;
                if(ticket==null || !Regex.IsMatch(ticket,
                    "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    RegexOptions.CultureInvariant) ||
                   dedupe!="ps:"+ticket ||
                   fields["reason"] as string!="ps6_observer" ||
                   !DirectorStockTurnRequest.ValidContext(context))return false;
                value=new Frame{TicketId=ticket,DedupeKey=dedupe,Context=context};
                return true;
            }catch{return false;}
        }
    }
}
