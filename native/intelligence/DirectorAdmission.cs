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
            public bool Used,NativePlaybackStarted,StockIntakeClaimed;
            public string TurnId;
            // Core NpcPlaybackStarted/EndedEvent.GenerationId is Int64.
            public long GenerationId;
            // Original Essential special-turn revision at native reserve time.
            // It is only a takeover veto; never a global idle permission.
            public long SpecialTurnVersion=-1;
            // Separately observed *global* player ownership revision; never
            // substitute the narrower Essential special-turn version.
            public long PlayerPriorityRevision=-1;
            public int SessionNonce;
            public string PedId;
            public long PlaybackExpiresAt;
        }

        internal const int MaxTickets=32;
        // The companion transports this tuple as a JS Number: values outside
        // this range cannot be matched exactly without changing the protocol.
        internal const long MaxExactWireGeneration=9007199254740991L;
        internal const long TicketTtlMs=2000;
        internal const int MaxAttempts=4;
        readonly Func<long> clock;
        readonly Func<Request,string,bool> independentlySafe;
        readonly Func<string> currentHost;
        readonly Func<int> currentWorld;
        readonly Func<long> specialTurnSource;
        readonly Func<long> playerPrioritySource;
        readonly Dictionary<string,Reservation> pending=new Dictionary<string,Reservation>();
        readonly Queue<long> attempts=new Queue<long>();
        readonly Dictionary<string,long> seen=new Dictionary<string,long>();
        readonly Queue<KeyValuePair<string,long>> seenOrder=new Queue<KeyValuePair<string,long>>();
        string activeTicket;
        bool enabled;

        internal DirectorAdmission(Func<long> clock,Func<Request,bool> independentlySafe,
          Func<string> currentHost,Func<int> currentWorld,bool enabled=false,
          Func<long> specialTurnSource=null,Func<long> playerPrioritySource=null)
          :this(clock,independentlySafe==null?null:
              new Func<Request,string,bool>((request,stage)=>independentlySafe(request)),
              currentHost,currentWorld,enabled,specialTurnSource,playerPrioritySource) {}
        internal DirectorAdmission(Func<long> clock,Func<Request,string,bool> independentlySafe,
          Func<string> currentHost,Func<int> currentWorld,bool enabled=false,
          Func<long> specialTurnSource=null,Func<long> playerPrioritySource=null)
        {
            this.clock=clock??throw new ArgumentNullException(nameof(clock));
            this.independentlySafe=independentlySafe??throw new ArgumentNullException(nameof(independentlySafe));
            this.currentHost=currentHost??throw new ArgumentNullException(nameof(currentHost));
            this.currentWorld=currentWorld??throw new ArgumentNullException(nameof(currentWorld));
            // Without the actual Core revision source, enabled tickets cannot
            // be reserved, submitted or marked delivered. Isolated tests inject
            // a deterministic source; production uses the pinned Core reader.
            this.specialTurnSource=specialTurnSource;
            // No proven end-to-end Essential text/mic/dialogue epoch source is
            // wired in production yet. Missing is a hard veto, not epoch zero.
            this.playerPrioritySource=playerPrioritySource;
            this.enabled=enabled;
        }
        static bool Uuid(string value)=>value!=null && Regex.IsMatch(value,
          "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          RegexOptions.CultureInvariant);
        static bool Key(string value)=>!string.IsNullOrWhiteSpace(value) &&
          value.Length<=160 && value.IndexOfAny(new[]{'\r','\n','\0'})<0;
        internal static bool Valid(Request r)=>r!=null && r.Version==1 &&
          (r.Operation=="reserve"||r.Operation=="submit"||r.Operation=="cancel") &&
          Uuid(r.TicketId) && r.DedupeKey=="ps:"+r.TicketId && Uuid(r.HostRunId) &&
          Uuid(r.SpeakerCaptureRef) && Uuid(r.PlayerCaptureRef) &&
          Uuid(r.OwnerIncarnationId) && Uuid(r.ObservationId) &&
          Key(r.DecisionKey) && r.WorldEpoch>0 && r.ProofRevision>0 &&
          r.PlayerTurnVersion>=0 && r.PolicyVersion==1 && r.ObservationRevision>0 &&
          r.AgeMs>=0 && r.AgeMs<=2000;
        bool Safe(Request r,string stage)
        {
            if(!enabled||!Valid(r)||r.HostRunId!=currentHost()||
                r.WorldEpoch!=currentWorld())return false;
            try {return independentlySafe(r,stage)==true;}catch{return false;}
        }
        bool ReadSpecial(out long version)
        {
            version=-1;
            if(specialTurnSource==null)return false;
            try {version=specialTurnSource();return version>=0;}
            catch {return false;}
        }
        bool ReadPlayerPriority(out long revision)
        {
            revision=-1;
            if(playerPrioritySource==null)return false;
            try {revision=playerPrioritySource();return revision>=0;}
            catch {return false;}
        }
        bool SafeReserved(Reservation original,string stage)
        {
            long specialBefore,specialAfter,playerBefore,playerAfter;
            return original!=null && original.SpecialTurnVersion>=0 &&
                original.PlayerPriorityRevision>=0 &&
                ReadSpecial(out specialBefore) && specialBefore==original.SpecialTurnVersion &&
                ReadPlayerPriority(out playerBefore) && playerBefore==original.PlayerPriorityRevision &&
                Safe(original.Request,stage) &&
                ReadPlayerPriority(out playerAfter) && playerAfter==original.PlayerPriorityRevision &&
                ReadSpecial(out specialAfter) && specialAfter==original.SpecialTurnVersion;
        }
        void Trim(long now)
        {
            while(attempts.Count>0 && attempts.Peek()<=now-60000)attempts.Dequeue();
            while(seenOrder.Count>0 && seenOrder.Peek().Value<=now-600000){
                var oldest=seenOrder.Dequeue();
                long recorded;if(seen.TryGetValue(oldest.Key,out recorded)&&recorded==oldest.Value)seen.Remove(oldest.Key);
            }
            foreach(var id in new List<string>(pending.Keys))
                if(now>= (pending[id].TurnId==null ? pending[id].ExpiresAt : pending[id].PlaybackExpiresAt)) {
                    if(activeTicket==id)activeTicket=null;
                    pending.Remove(id);
                }
        }
        internal void Reset(){pending.Clear();attempts.Clear();seen.Clear();seenOrder.Clear();activeTicket=null;}
        // Native P2 ownership retirement is an immediate hard cancellation.
        // Unrelated owners cannot cancel the active actor's original ticket.
        // Replay/attempt bookkeeping is intentionally retained.
        internal bool RevokeOwner(string incarnationId)
        {
            Reservation r;
            if(string.IsNullOrWhiteSpace(incarnationId) || activeTicket==null ||
                !pending.TryGetValue(activeTicket,out r) ||
                r.Request.OwnerIncarnationId!=incarnationId)return false;
            pending.Remove(activeTicket);activeTicket=null;
            return true;
        }
        internal void Disable(){enabled=false;Reset();}
        internal int PendingCount=>pending.Count;
        internal bool HasActive=>activeTicket!=null;
        internal Receipt Handle(Request request)
        {
            long now=clock();Trim(now);
            if(!Valid(request))return new Receipt(request?.TicketId,"invalid");
            if(request.Operation=="cancel") {
                Reservation old;
                var existed=pending.TryGetValue(request.TicketId,out old) && Same(old.Request,request);
                if(existed)pending.Remove(request.TicketId);
                if(existed && activeTicket==request.TicketId)activeTicket=null;
                return new Receipt(request.TicketId,existed?"cancelled":"not_found");
            }
            if(request.Operation=="reserve") {
                if(!enabled||activeTicket!=null||seen.ContainsKey(request.TicketId)||
                    pending.Count>=MaxTickets||attempts.Count>=MaxAttempts||seen.Count>=512)
                    return new Receipt(request.TicketId,"busy");
                attempts.Enqueue(now);seen.Add(request.TicketId,now);seenOrder.Enqueue(new KeyValuePair<string,long>(request.TicketId,now));
                long initial,after,playerInitial,playerAfter;
                if(!ReadSpecial(out initial) || !ReadPlayerPriority(out playerInitial) ||
                   !Safe(request,"reserve") ||
                   !ReadPlayerPriority(out playerAfter) || playerAfter!=playerInitial ||
                   !ReadSpecial(out after) || after!=initial)
                    return new Receipt(request.TicketId,"unsafe");
                pending[request.TicketId]=new Reservation{
                    Request=request,ExpiresAt=now+TicketTtlMs,
                    SpecialTurnVersion=initial,PlayerPriorityRevision=playerInitial
                };
                activeTicket=request.TicketId;
                return new Receipt(request.TicketId,"reserved");
            }
            Reservation reservation;
            if(!pending.TryGetValue(request.TicketId,out reservation)||
                activeTicket!=request.TicketId||reservation.Used||
                !Same(reservation.Request,request))return new Receipt(request.TicketId,"stale");
            if(!SafeReserved(reservation,"submit")) {
                pending.Remove(request.TicketId);activeTicket=null;
                return new Receipt(request.TicketId,"unsafe");
            }
            reservation.Used=true;
            // Submit authorizes exactly one already-checked intake attempt.
            // It does NOT allocate an Essential turn or certify playback.
            return new Receipt(request.TicketId,"submitted");
        }
        // #3A: one-shot native owner-fiber intake authorization, distinct
        // from submit acknowledgment. Claims are irrevocable even if Core
        // stock Submit returns false or throws. #3B alone will bind the real
        // Ped/TurnId/generation/session tuple afterward.
        // Peek only. The sender's ticket ID is NOT a source of any owner,
        // participant, source stamp or current C-06 entitlement.
        internal Request SubmittedForStockIntake(string ticket)
        {
            Reservation record;
            if(!enabled || ticket!=activeTicket ||
               !pending.TryGetValue(ticket,out record) ||
               !record.Used || record.StockIntakeClaimed ||
               record.TurnId!=null || clock()>=record.ExpiresAt)
                return null;
            return record.Request;
        }
        internal Request TryClaimStockIntake(string ticket)
        {
            Reservation record;
            if(!enabled || string.IsNullOrWhiteSpace(ticket) ||
               ticket!=activeTicket || !pending.TryGetValue(ticket,out record) ||
               !record.Used || record.StockIntakeClaimed || record.TurnId!=null ||
               clock()>=record.ExpiresAt)return null;
            if(!SafeReserved(record,"stock_intake")) {
                pending.Remove(ticket);activeTicket=null;
                return null;
            }
            record.StockIntakeClaimed=true;
            // Return a separate submit request so a caller cannot rewrite
            // the sealed reservation or borrow a different PS3 proof.
            var r=record.Request;
            return new Request {
                Version=r.Version,Operation="submit",TicketId=r.TicketId,
                DedupeKey=r.DedupeKey,HostRunId=r.HostRunId,
                WorldEpoch=r.WorldEpoch,SpeakerCaptureRef=r.SpeakerCaptureRef,
                PlayerCaptureRef=r.PlayerCaptureRef,OwnerIncarnationId=r.OwnerIncarnationId,
                ProofRevision=r.ProofRevision,PlayerTurnVersion=r.PlayerTurnVersion,
                PolicyVersion=r.PolicyVersion,ObservationId=r.ObservationId,
                ObservationRevision=r.ObservationRevision,DecisionKey=r.DecisionKey,
                AgeMs=r.AgeMs
            };
        }
        // Failed first stock scheduling attempt is final: free the global
        // reservation immediately while retaining anti-replay bookkeeping.
        internal bool AbandonStockIntake(string ticket)
        {
            Reservation r;
            if(ticket==null || ticket!=activeTicket ||
               !pending.TryGetValue(ticket,out r) || !r.StockIntakeClaimed ||
               r.TurnId!=null)return false;
            pending.Remove(ticket);activeTicket=null;return true;
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
        internal bool BindActualTuple(string ticket,string pedId,string turnId,long generationId,int nonce)
        {
            Reservation r;
            if(!enabled||ticket!=activeTicket||!pending.TryGetValue(ticket,out r)||
                !r.Used||r.TurnId!=null||clock()>=r.ExpiresAt||
                string.IsNullOrWhiteSpace(pedId)||!Key(turnId)||generationId<0||generationId>MaxExactWireGeneration||nonce<=0)
                return false;
            if(!SafeReserved(r,"bind")) {
                pending.Remove(ticket);activeTicket=null;return false;
            }
            r.PedId=pedId;r.TurnId=turnId;r.GenerationId=generationId;r.SessionNonce=nonce;
            // Ticket TTL guards pre-turn admission, not actual native TTS.
            // A separately bounded playback lease prevents a stuck turn from
            // holding the single global reservation forever.
            r.PlaybackExpiresAt=clock()+120000;
            return true;
        }
        // Separate, original-tuple native started receipt. A later terminal
        // callback cannot invent that a playback actually started.
        internal bool NotePlaybackStarted(string ticket,string pedId,string turnId,long generationId,int nonce)
        {
            Reservation r;
            if(ticket!=activeTicket || !pending.TryGetValue(ticket,out r) ||
                !r.Used || r.TurnId==null || r.NativePlaybackStarted ||
                r.PedId!=pedId || r.TurnId!=turnId ||
                r.GenerationId!=generationId || r.SessionNonce!=nonce ||
                clock()>=r.PlaybackExpiresAt)return false;
            if(!SafeReserved(r,"playback_started")) {
                pending.Remove(ticket);activeTicket=null;return false;
            }
            r.NativePlaybackStarted=true;
            return true;
        }
        // Core PlaybackStarted/Ended events carry PedId, TurnId and Int64
        // GenerationId, but NOT SessionNonce or any PS6 ticket ID. Only the
        // original native binding supplies those; never accept callbacks as a
        // new binding, infer nonce from a ped handle or borrow another actor's
        // owner proof. Called strictly from the owner fiber after exact anchor
        // identity validation, never directly from the Core event thread.
        internal bool ObserveCorePlaybackStarted(
          string speakerCaptureRef,string pedId,string turnId,long generationId)
        {
            Reservation r;
            if(!enabled || activeTicket==null ||
                !pending.TryGetValue(activeTicket,out r) ||
                r.Request.SpeakerCaptureRef!=speakerCaptureRef ||
                r.PedId!=pedId || r.TurnId!=turnId ||
                r.GenerationId!=generationId)return false;
            return NotePlaybackStarted(activeTicket,pedId,turnId,generationId,r.SessionNonce);
        }
        internal bool ObserveCorePlaybackEnded(
          string speakerCaptureRef,string pedId,string turnId,long generationId,
          string reason,bool interrupted,bool hadAudio,bool playbackStarted)
        {
            Reservation r;
            if(!enabled || activeTicket==null ||
                !pending.TryGetValue(activeTicket,out r) ||
                r.Request.SpeakerCaptureRef!=speakerCaptureRef ||
                r.PedId!=pedId || r.TurnId!=turnId ||
                r.GenerationId!=generationId)return false;
            return Complete(activeTicket,pedId,turnId,generationId,r.SessionNonce,
                reason=="completed",interrupted,hadAudio,playbackStarted);
        }
        internal bool Complete(string ticket,string pedId,string turnId,long generationId,int nonce,
          bool complete,bool interrupted,bool hadAudio,bool playbackStarted)
        {
            Reservation r;
            if(ticket!=activeTicket||!pending.TryGetValue(ticket,out r)||
                !r.Used||r.TurnId==null||r.PedId!=pedId||r.TurnId!=turnId||
                r.GenerationId!=generationId||r.SessionNonce!=nonce)return false;
            bool withinPlaybackLease=clock()<r.PlaybackExpiresAt;
            pending.Remove(ticket);activeTicket=null;
            // Only a matching native complete-playback receipt permits a
            // separate, checked PS3 ps6_ticket acknowledgement.
            return withinPlaybackLease&&r.NativePlaybackStarted&&complete&&!interrupted&&hadAudio&&playbackStarted&&SafeReserved(r,"complete");
        }
    }
}
