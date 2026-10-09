using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace LSA.Intelligence
{
    // C-11 native PS6 policy. The host owner fiber is the ONLY caller of these
    // methods. No RAGE/Essential call, model call, TASK, or async callback lives
    // here. Unknown admission state is a veto, never a permission.
    internal sealed class DirectorAdmission
    {
        internal sealed class Request
        {
            public int Version;
            public string Operation,TicketId,DedupeKey,HostRunId,SpeakerCaptureRef,PlayerCaptureRef;
            public string OwnerIncarnationId,DecisionKey,ObservationId;
            public int WorldEpoch,ProofRevision,PlayerTurnVersion,PolicyVersion,ObservationRevision;
            public long AgeMs;
        }
        internal sealed class Receipt
        {
            public readonly string TicketId,Status;
            public Receipt(string id,string status){TicketId=id;Status=status;}
        }
        internal sealed class Reservation
        {
            public Request Request;
            public long ExpiresAt;
            public bool Used;
            public string TurnId;
            public int GenerationId,SessionNonce;
            public string PedId;
        }

        internal const int MaxTickets=32;
        internal const long TicketTtlMs=2000;
        internal const int MaxAttempts=4;
        readonly Func<long> clock;
        readonly Func<Request,bool> independentlySafe;
        readonly Func<string> currentHost;
        readonly Func<int> currentWorld;
        readonly Dictionary<string,Reservation> pending=new Dictionary<string,Reservation>();
        readonly Queue<long> attempts=new Queue<long>();
        readonly HashSet<string> seen=new HashSet<string>();
        string activeTicket;
        bool enabled;

        internal DirectorAdmission(Func<long> clock,Func<Request,bool> independentlySafe,
          Func<string> currentHost,Func<int> currentWorld,bool enabled=false)
        {
            this.clock=clock??throw new ArgumentNullException(nameof(clock));
            this.independentlySafe=independentlySafe??throw new ArgumentNullException(nameof(independentlySafe));
            this.currentHost=currentHost??throw new ArgumentNullException(nameof(currentHost));
            this.currentWorld=currentWorld??throw new ArgumentNullException(nameof(currentWorld));
            this.enabled=enabled;
        }
        static bool Uuid(string value)=>value!=null && Regex.IsMatch(value,
          "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          RegexOptions.CultureInvariant);
        static bool Key(string value)=>!string.IsNullOrWhiteSpace(value) &&
          value.Length<=160 && value.IndexOfAny(new[]{'\r','\n','\0'})<0;
        static bool Valid(Request r)=>r!=null && r.Version==1 &&
          (r.Operation=="reserve"||r.Operation=="submit"||r.Operation=="cancel") &&
          Uuid(r.TicketId) && r.DedupeKey=="ps:"+r.TicketId && Uuid(r.HostRunId) &&
          Uuid(r.SpeakerCaptureRef) && Uuid(r.PlayerCaptureRef) &&
          Uuid(r.OwnerIncarnationId) && Uuid(r.ObservationId) &&
          Key(r.DecisionKey) && r.WorldEpoch>0 && r.ProofRevision>0 &&
          r.PlayerTurnVersion>=0 && r.PolicyVersion==1 && r.ObservationRevision>0 &&
          r.AgeMs>=0 && r.AgeMs<=2000;
        bool Safe(Request r)
        {
            if(!enabled||!Valid(r)||r.HostRunId!=currentHost()||
                r.WorldEpoch!=currentWorld())return false;
            try {return independentlySafe(r)==true;}catch{return false;}
        }
        void Trim(long now)
        {
            while(attempts.Count>0 && attempts.Peek()<=now-60000)attempts.Dequeue();
            foreach(var id in new List<string>(pending.Keys))
                if(now>=pending[id].ExpiresAt) {
                    if(activeTicket==id)activeTicket=null;
                    pending.Remove(id);
                }
        }
        internal void Reset(){pending.Clear();attempts.Clear();seen.Clear();activeTicket=null;}
        internal void Disable(){enabled=false;Reset();}
        internal int PendingCount=>pending.Count;
        internal bool HasActive=>activeTicket!=null;
        internal Receipt Handle(Request request)
        {
            long now=clock();Trim(now);
            if(!Valid(request))return new Receipt(request?.TicketId,"invalid");
            if(request.Operation=="cancel") {
                var existed=pending.Remove(request.TicketId);
                if(activeTicket==request.TicketId)activeTicket=null;
                return new Receipt(request.TicketId,existed?"cancelled":"not_found");
            }
            if(request.Operation=="reserve") {
                if(!enabled||activeTicket!=null||seen.Contains(request.TicketId)||
                    pending.Count>=MaxTickets||attempts.Count>=MaxAttempts)
                    return new Receipt(request.TicketId,"busy");
                attempts.Enqueue(now);seen.Add(request.TicketId);
                if(!Safe(request))return new Receipt(request.TicketId,"unsafe");
                pending[request.TicketId]=new Reservation{
                    Request=request,ExpiresAt=now+TicketTtlMs
                };
                activeTicket=request.TicketId;
                return new Receipt(request.TicketId,"reserved");
            }
            Reservation reservation;
            if(!pending.TryGetValue(request.TicketId,out reservation)||
                activeTicket!=request.TicketId||reservation.Used||
                !Same(reservation.Request,request))return new Receipt(request.TicketId,"stale");
            if(!Safe(request)) {
                pending.Remove(request.TicketId);activeTicket=null;
                return new Receipt(request.TicketId,"unsafe");
            }
            reservation.Used=true;
            // Submit authorizes exactly one already-checked intake attempt.
            // It does NOT allocate an Essential turn or certify playback.
            return new Receipt(request.TicketId,"submitted");
        }
        static bool Same(Request a,Request b)=>
            a.TicketId==b.TicketId && a.DedupeKey==b.DedupeKey &&
            a.HostRunId==b.HostRunId && a.WorldEpoch==b.WorldEpoch &&
            a.SpeakerCaptureRef==b.SpeakerCaptureRef &&
            a.PlayerCaptureRef==b.PlayerCaptureRef &&
            a.OwnerIncarnationId==b.OwnerIncarnationId &&
            a.ProofRevision==b.ProofRevision &&
            a.PlayerTurnVersion==b.PlayerTurnVersion &&
            a.PolicyVersion==b.PolicyVersion &&
            a.ObservationId==b.ObservationId &&
            a.ObservationRevision==b.ObservationRevision &&
            a.DecisionKey==b.DecisionKey;
        internal bool BindActualTuple(string ticket,string pedId,string turnId,int generationId,int nonce)
        {
            Reservation r;
            if(!enabled||ticket!=activeTicket||!pending.TryGetValue(ticket,out r)||
                !r.Used||r.TurnId!=null||clock()>=r.ExpiresAt||
                string.IsNullOrWhiteSpace(pedId)||!Key(turnId)||generationId<0||nonce<=0)
                return false;
            if(!Safe(r.Request))return false;
            r.PedId=pedId;r.TurnId=turnId;r.GenerationId=generationId;r.SessionNonce=nonce;
            return true;
        }
        internal bool Complete(string ticket,string pedId,string turnId,int generationId,int nonce,
          bool complete,bool interrupted,bool hadAudio,bool playbackStarted)
        {
            Reservation r;
            if(ticket!=activeTicket||!pending.TryGetValue(ticket,out r)||
                !r.Used||r.TurnId==null||r.PedId!=pedId||r.TurnId!=turnId||
                r.GenerationId!=generationId||r.SessionNonce!=nonce)return false;
            pending.Remove(ticket);activeTicket=null;
            // Only a matching native complete-playback receipt permits a
            // separate, checked PS3 ps6_ticket acknowledgement.
            return complete&&!interrupted&&hadAudio&&playbackStarted&&Safe(r.Request);
        }
    }
}
