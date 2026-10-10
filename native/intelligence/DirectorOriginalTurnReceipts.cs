using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace LSA.Intelligence
{
    // Owner-fiber sealed copy of a synchronous ORIGINAL backend lifecycle
    // observation, delivered on the same user-ACL pipe before a C-11 request.
    // It never substitutes for the live Core input epoch. It does not own
    // stock turns or authorize scheduling.
    internal sealed class DirectorOriginalTurnReceipts
    {
        internal sealed class Evidence
        {
            public int Version,WorldEpoch,PlayerTurnVersion;
            public string Source,SourceRun,TicketId,HostRunId;
            public long Revision,ObservationSerial;
            public bool Quiet;
        }
        sealed class Stored
        {
            internal Evidence Data;
            internal long NativeRevision,ExpiresAt;
        }
        // After the initial synchronized idle admission, retain only its
        // immutable source identity for stock generation binding. This is NOT
        // a renewed quiet proof. Core transition epoch still must match.
        readonly Dictionary<string,Stored> bindingClaims=new Dictionary<string,Stored>();
        internal const long BindLeaseMs=2000;
        internal const long LeaseMs=250;
        internal const int MaxTickets=32;
        internal const long MaxExactWireNumber=9007199254740991L;
        readonly Func<long> clock,inputEpoch;
        readonly Func<string> host;
        readonly Func<int> world;
        readonly Dictionary<string,Stored> tickets=new Dictionary<string,Stored>();
        readonly HashSet<string> poisonedTickets=new HashSet<string>();
        string originalSourceRun;
        long lastSerial;
        internal DirectorOriginalTurnReceipts(Func<long> clock,Func<string> host,
            Func<int> world,Func<long> inputEpoch)
        {
            this.clock=clock??throw new ArgumentNullException(nameof(clock));
            this.host=host??throw new ArgumentNullException(nameof(host));
            this.world=world??throw new ArgumentNullException(nameof(world));
            this.inputEpoch=inputEpoch??throw new ArgumentNullException(nameof(inputEpoch));
        }
        static bool Uuid(string s)=>s!=null && Regex.IsMatch(s,
            "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            RegexOptions.CultureInvariant);
        static Evidence Copy(Evidence e)=>new Evidence {
            Version=e.Version,Source=e.Source,SourceRun=e.SourceRun,TicketId=e.TicketId,
            HostRunId=e.HostRunId,WorldEpoch=e.WorldEpoch,
            PlayerTurnVersion=e.PlayerTurnVersion,
            Revision=e.Revision,ObservationSerial=e.ObservationSerial,Quiet=e.Quiet
        };
        void Trim()
        {
            long now=clock();
            foreach(var item in tickets.Where(pair=>pair.Value.ExpiresAt<=now).Select(pair=>pair.Key).ToArray())
                tickets.Remove(item);
        }
        internal bool Accept(Evidence incoming)
        {
            Trim();
            if(incoming==null || incoming.Version!=1 ||
                incoming.Source!="original_essential_backend_lifecycle" ||
                !Uuid(incoming.SourceRun)||!Uuid(incoming.TicketId)||
                !Uuid(incoming.HostRunId)||incoming.HostRunId!=host()||
                incoming.WorldEpoch<=0||incoming.WorldEpoch!=world()||
                incoming.PlayerTurnVersion<0||incoming.Revision<=0||
                incoming.Revision>MaxExactWireNumber||
                incoming.ObservationSerial<=0||
                incoming.ObservationSerial>MaxExactWireNumber||
                !incoming.Quiet||clock()<0||
                poisonedTickets.Contains(incoming.TicketId)||poisonedTickets.Count>=512)return false;
            // Every observation must be a strictly new original backend
            // sample on this authenticated channel, not a replay.
            if(originalSourceRun!=null && incoming.SourceRun!=originalSourceRun)return false;
            if(incoming.ObservationSerial<=lastSerial)return false;
            long current;
            try {current=inputEpoch();} catch {return false;}
            if(current<0)return false;
            Stored previous;
            if(tickets.TryGetValue(incoming.TicketId,out previous)) {
                // A changed backend lifecycle revision after reservation
                // must revoke it; a fresh quiet snapshot cannot rebase it.
                if(previous.Data.Revision!=incoming.Revision ||
                    previous.Data.SourceRun!=incoming.SourceRun ||
                    previous.Data.PlayerTurnVersion!=incoming.PlayerTurnVersion) {
                    tickets.Remove(incoming.TicketId);
                    poisonedTickets.Add(incoming.TicketId);
                    return false;
                }
            } else if(tickets.Count>=MaxTickets)return false;
            originalSourceRun=incoming.SourceRun;
            lastSerial=incoming.ObservationSerial;
            tickets[incoming.TicketId]=new Stored {
                Data=Copy(incoming),NativeRevision=current,ExpiresAt=clock()+LeaseMs
            };
            return true;
        }
        internal Evidence OriginalFor(DirectorAdmission.Request r)
        {
            Trim();Stored state;
            if(r==null || !DirectorAdmission.Valid(r) ||
                !tickets.TryGetValue(r.TicketId,out state) ||
                state.ExpiresAt<=clock() ||
                state.Data.HostRunId!=r.HostRunId ||
                state.Data.WorldEpoch!=r.WorldEpoch ||
                state.Data.PlayerTurnVersion!=r.PlayerTurnVersion ||
                state.Data.TicketId!=r.TicketId ||
                state.Data.SourceRun!=originalSourceRun)return null;
            long epoch;
            try {epoch=inputEpoch();}catch{return null;}
            if(epoch<0 || epoch!=state.NativeRevision)return null;
            return Copy(state.Data);
        }
        internal bool CaptureForBinding(DirectorAdmission.Request request)
        {
            var original=OriginalFor(request);
            if(original==null || bindingClaims.ContainsKey(request.TicketId) ||
               bindingClaims.Count>=MaxTickets)return false;
            long native;
            try {native=inputEpoch();}catch{return false;}
            if(native<0)return false;
            bindingClaims[request.TicketId]=new Stored {
                Data=original,NativeRevision=native,ExpiresAt=clock()+BindLeaseMs};
            return true;
        }
        internal Evidence SealedForBinding(DirectorAdmission.Request request)
        {
            Stored state;
            if(request==null || !DirectorAdmission.Valid(request) ||
               !bindingClaims.TryGetValue(request.TicketId,out state) ||
               clock()>=state.ExpiresAt ||
               request.HostRunId!=state.Data.HostRunId ||
               request.WorldEpoch!=state.Data.WorldEpoch ||
               request.PlayerTurnVersion!=state.Data.PlayerTurnVersion)
                return null;
            long epoch;
            try {epoch=inputEpoch();}catch{return null;}
            return epoch>=0 && epoch==state.NativeRevision ? Copy(state.Data):null;
        }
        internal void Retire(string ticket) {if(ticket!=null){tickets.Remove(ticket);bindingClaims.Remove(ticket);}}
        // Reset on disconnect, host/world replacement, or source fault. A
        // subsequent connection is a new authenticated producer incarnation.
        internal void Reset() {tickets.Clear();bindingClaims.Clear();poisonedTickets.Clear();originalSourceRun=null;lastSerial=0;}
        internal int Pending {get {Trim();return tickets.Count;} }
    }
}
