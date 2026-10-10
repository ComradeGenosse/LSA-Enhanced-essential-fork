using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using LSA.Intelligence;

class Program
{
    static int assertions;
    static long now=1000;
    static long special=7;
    static bool safe=true;
    static string host="a1111111-1111-4111-8111-111111111111";
    static int world=1;
    static DirectorAdmission New(bool enabled=true)
    {
        return new DirectorAdmission(()=>now,r=>safe,()=>host,()=>world,enabled,()=>special);
    }
    static void Check(bool value,string label)
    {
        if(!value)throw new Exception(label);
        assertions++;
    }
    static DirectorAdmission.Request Request(int index=1,string operation="reserve")
    {
        string ticket="b1111111-1111-4111-8111-"+index.ToString("D12");
        return new DirectorAdmission.Request{
            Version=1,Operation=operation,TicketId=ticket,DedupeKey="ps:"+ticket,
            HostRunId=host,WorldEpoch=world,
            SpeakerCaptureRef="c1111111-1111-4111-8111-111111111111",
            PlayerCaptureRef="d1111111-1111-4111-8111-111111111111",
            OwnerIncarnationId="e1111111-1111-4111-8111-111111111111",
            ObservationId="f1111111-1111-4111-8111-111111111111",
            DecisionKey="qualified-ps3-decision",ProofRevision=1,PlayerTurnVersion=2,
            PolicyVersion=1,ObservationRevision=1,AgeMs=100
        };
    }
    static void Main()
    {
        try {Run();Console.WriteLine("PASS "+assertions+" native PS6 admission assertions");}
        catch(Exception e){Console.Error.WriteLine(e);Environment.ExitCode=1;}
    }
    static void Run()
    {
        var off=New(false);
        Check(off.Handle(Request()).Status=="busy","default off rejects reserve");
        var shell=New();
        var a=Request();
        Check(shell.Handle(a).Status=="reserved","reserve valid");
        Check(shell.HasActive&&shell.PendingCount==1,"one active");
        Check(shell.Handle(a).Status=="busy","cannot replay reserve");
        Check(shell.Handle(Request(2)).Status=="busy","only one global turn");
        Check(shell.Handle(Request(1,"submit")).Status=="submitted","first submit");
        Check(shell.Handle(Request(1,"submit")).Status=="stale","one use submit");
        Check(shell.BindActualTuple(a.TicketId,"17","native-turn-1",4,2),"bind real tuple");
        Check(!shell.BindActualTuple(a.TicketId,"17","native-turn-2",4,2),"cannot rebind");
        Check(!shell.NotePlaybackStarted(a.TicketId,"17","native-turn-2",4,2),"wrong playback-start tuple veto");
        Check(shell.NotePlaybackStarted(a.TicketId,"17","native-turn-1",4,2),"native playback start correlated to original tuple");
        Check(!shell.NotePlaybackStarted(a.TicketId,"17","native-turn-1",4,2),"duplicate start is not a new receipt");
        Check(!shell.Complete(a.TicketId,"17","native-turn-1",5,2,true,false,true,true),"wrong generation veto");
        Check(shell.Complete(a.TicketId,"17","native-turn-1",4,2,true,false,true,true),"matching full playback success");
        Check(!shell.Complete(a.TicketId,"17","native-turn-1",4,2,true,false,true,true),"once-only terminal");
        Check(!shell.HasActive&&shell.PendingCount==0,"success releases reservation");

        var expiry=New();
        a=Request(3);
        Check(expiry.Handle(a).Status=="reserved","expiry reserve");
        now+=2000;
        Check(expiry.Handle(Request(3,"submit")).Status=="stale","pre-admission 2sec ttl");
        Check(expiry.PendingCount==0,"expired removed");

        now+=60000;
        for(int n=4;n<8;n++) {
            safe=false;
            Check(expiry.Handle(Request(n)).Status=="unsafe","unsafe attempt counts");
        }
        safe=true;
        Check(expiry.Handle(Request(8)).Status=="busy","four failures rate bound");
        now+=60001;
        a=Request(9);Check(expiry.Handle(a).Status=="reserved","quota resets after window");
        var modified=Request(9,"submit");modified.OwnerIncarnationId="a1111111-1111-4111-8111-111111111111";
        Check(expiry.Handle(modified).Status=="stale","owner change veto");
        modified=Request(9,"submit");modified.WorldEpoch=2;
        Check(expiry.Handle(modified).Status=="stale","epoch change veto");
        var originalEpochSubmit=Request(9,"submit");
        world=2;
        Check(expiry.Handle(originalEpochSubmit).Status=="unsafe","native world change veto");
        world=1;
        Check(expiry.PendingCount==0,"unsafe ticket retired");

        var fail=New();
        a=Request(10);Check(fail.Handle(a).Status=="reserved","failure reserve");
        Check(fail.Handle(Request(10,"submit")).Status=="submitted","failure submit");
        Check(fail.BindActualTuple(a.TicketId,"17","native-fail",1,1),"failure bind");
        Check(fail.NotePlaybackStarted(a.TicketId,"17","native-fail",1,1),"failure case starts original playback");
        Check(!fail.Complete(a.TicketId,"17","native-fail",1,1,true,true,true,true),"interrupted not consumed");
        Check(!fail.HasActive,"interrupted frees reservation");

        var cancel=New();a=Request(11);
        Check(cancel.Handle(a).Status=="reserved","cancel reserve");
        Check(cancel.Handle(Request(11,"cancel")).Status=="cancelled","cancel exact");
        Check(cancel.Handle(Request(11,"submit")).Status=="stale","cancellation terminal");
        Check(cancel.Handle(Request(11,"cancel")).Status=="not_found","cancel idempotence");

        var invalid=New();a=Request(12);a.TicketId="malformed";
        Check(invalid.Handle(a).Status=="invalid","reject malformed UUID");
        a=Request(13);a.DedupeKey="ps:other";
        Check(invalid.Handle(a).Status=="invalid","reject dedupe drift");
        a=Request(14);a.AgeMs=2001;
        Check(invalid.Handle(a).Status=="invalid","reject expired evidence");
        a=Request(15);a.Operation="effect";
        Check(invalid.Handle(a).Status=="invalid","no arbitrary native operation");

        invalid.Reset();Check(!invalid.HasActive,"reset cleanup");
        invalid.Disable();Check(invalid.Handle(Request(16)).Status=="busy","disable fail closed");
        // Source-time ticket is two seconds; the bound real native turn can
        // legitimately play for longer without an unrelated incoming frame
        // retiring its reservation. Its playback lease remains finite.
        var speech=New();a=Request(17);
        Check(speech.Handle(a).Status=="reserved","long speech reserve");
        Check(speech.Handle(Request(17,"submit")).Status=="submitted","long speech submit");
        Check(speech.BindActualTuple(a.TicketId,"17","native-long",1,3),"long speech bind");
        Check(speech.NotePlaybackStarted(a.TicketId,"17","native-long",1,3),"long speech playback began");
        now+=10000;
        Check(speech.Handle(Request(18)).Status=="busy","bound playback survives source-time ticket expiry");
        Check(speech.Complete(a.TicketId,"17","native-long",1,3,true,false,true,true),"complete playback acknowledged beyond source TTL");
        Check(!speech.HasActive,"completed long playback releases single reservation");
        var neverEnding=New();a=Request(19);
        Check(neverEnding.Handle(a).Status=="reserved","stale playback reserve");
        Check(neverEnding.Handle(Request(19,"submit")).Status=="submitted","stale playback submit");
        Check(neverEnding.BindActualTuple(a.TicketId,"17","native-never",2,3),"stale playback bind");
        Check(neverEnding.NotePlaybackStarted(a.TicketId,"17","native-never",2,3),"stale playback started");
        now+=120000;
        Check(!neverEnding.Complete(a.TicketId,"17","native-never",2,3,true,false,true,true),"expired playback lease cannot claim delivery");
        Check(!neverEnding.HasActive,"expired completion releases native ticket");
        // Pinned Core event GenerationId is Int64; never truncate to Int32
        // or accept a value the JS-number wire cannot represent exactly.
        var wide=New();a=Request(41);
        Check(wide.Handle(a).Status=="reserved" && wide.Handle(Request(41,"submit")).Status=="submitted",
              "Int64 generation fixture enters native contract");
        Check(!wide.BindActualTuple(a.TicketId,"17","native-wide",long.MaxValue,3),
              "unsafe JS-precision generation cannot bind");
        long generation=(long)int.MaxValue+1L;
        Check(wide.BindActualTuple(a.TicketId,"17","native-wide",generation,3),
              "native generation beyond Int32 does not truncate");
        Check(!wide.NotePlaybackStarted(a.TicketId,"17","native-wide",1L,3),
              "truncated generation callback cannot match original");
        Check(wide.NotePlaybackStarted(a.TicketId,"17","native-wide",generation,3),
              "original Int64 playback start matches");
        Check(!wide.Complete(a.TicketId,"17","native-wide",generation+1L,3,true,false,true,true),
              "adjacent 64-bit generation is not the original callback");
        Check(wide.Complete(a.TicketId,"17","native-wide",generation,3,true,false,true,true),
              "exact Int64 generation completes once");
        var upper=New();a=Request(42);
        Check(upper.Handle(a).Status=="reserved" &&
              upper.Handle(Request(42,"submit")).Status=="submitted",
              "maximum exact wire generation fixture reserved");
        Check(upper.BindActualTuple(a.TicketId,"17","native-upper",
              DirectorAdmission.MaxExactWireGeneration,3),
              "highest exactly representable JS generation allowed");
        Check(upper.NotePlaybackStarted(a.TicketId,"17","native-upper",
              DirectorAdmission.MaxExactWireGeneration,3),
              "maximum exact generation playback-start matches");
        Check(upper.Complete(a.TicketId,"17","native-upper",
              DirectorAdmission.MaxExactWireGeneration,3,true,false,true,true),
              "maximum exact generation callback completes");
        CorePlaybackContract();
        FailedCallbacks();
        C06Contract();
        CodecContract();
        ChannelRoundtrip();
    }

    static void CorePlaybackContract()
    {
        var original=Request(43);
        var correct=New();
        Check(!correct.ObserveCorePlaybackStarted(original.SpeakerCaptureRef,"17","core-turn",1),
            "Core callback without original native binding cannot allocate a ticket");
        Check(correct.Handle(original).Status=="reserved" &&
            correct.Handle(Request(43,"submit")).Status=="submitted",
            "Core callback test has authentic one-use reserved/submitted native ticket");
        Check(correct.BindActualTuple(original.TicketId,"17","core-turn",
            (long)int.MaxValue+2,3),"native full tuple bound before Core callbacks");
        Check(!correct.ObserveCorePlaybackStarted(Guid.NewGuid().ToString("D"),
            "17","core-turn",(long)int.MaxValue+2),"different anchor cannot borrow Core start");
        Check(!correct.ObserveCorePlaybackStarted(original.SpeakerCaptureRef,
            "18","core-turn",(long)int.MaxValue+2),"different ped ID vetoes Core start");
        Check(!correct.ObserveCorePlaybackStarted(original.SpeakerCaptureRef,
            "17","core-turn",1),"different generation vetoes Core start");
        Check(!correct.ObserveCorePlaybackStarted(original.SpeakerCaptureRef,
            "17","core-other",(long)int.MaxValue+2),"different turn vetoes Core start");
        Check(correct.ObserveCorePlaybackStarted(original.SpeakerCaptureRef,
            "17","core-turn",(long)int.MaxValue+2),"exact Core event binds to original ticket");
        Check(!correct.ObserveCorePlaybackStarted(original.SpeakerCaptureRef,
            "17","core-turn",(long)int.MaxValue+2),"duplicate Core start never regrants");
        Check(!correct.ObserveCorePlaybackEnded(Guid.NewGuid().ToString("D"),
            "17","core-turn",(long)int.MaxValue+2,"completed",false,true,true),
            "unrelated actor cannot close original Core playback ticket");
        Check(!correct.ObserveCorePlaybackEnded(original.SpeakerCaptureRef,
            "17","core-turn",7,"completed",false,true,true),
            "wrong Core generation cannot consume original ticket");
        Check(correct.ObserveCorePlaybackEnded(original.SpeakerCaptureRef,
            "17","core-turn",(long)int.MaxValue+2,"completed",false,true,true),
            "successful Core end consumes only exact original ticket");
        Check(!correct.ObserveCorePlaybackEnded(original.SpeakerCaptureRef,
            "17","core-turn",(long)int.MaxValue+2,"completed",false,true,true),
            "duplicate Core completion never consumes retired ticket");
        Check(!correct.HasActive,"original Core ticket retired after terminal callback");

        var failed=New();var request=Request(44);
        Check(failed.Handle(request).Status=="reserved" &&
            failed.Handle(Request(44,"submit")).Status=="submitted" &&
            failed.BindActualTuple(request.TicketId,"17","failed-core",0,4),
            "failed Core playback setup");
        Check(!failed.ObserveCorePlaybackEnded(request.SpeakerCaptureRef,"17",
            "failed-core",0,"completed",false,true,true),
            "Core terminal cannot fabricate a missing source playback-start event");
        Check(!failed.HasActive,"failed no-start Core terminal closes reservation");

        failed=New();request=Request(45);
        Check(failed.Handle(request).Status=="reserved" &&
            failed.Handle(Request(45,"submit")).Status=="submitted" &&
            failed.BindActualTuple(request.TicketId,"17","interrupted-core",0,4) &&
            failed.ObserveCorePlaybackStarted(request.SpeakerCaptureRef,"17","interrupted-core",0),
            "interruption Core callback fixture");
        Check(!failed.ObserveCorePlaybackEnded(request.SpeakerCaptureRef,"17",
            "interrupted-core",0,"interrupted",true,true,true),
            "interrupted Core playback never acknowledges PS3 grant");
        Check(!failed.HasActive,"Core interrupted ticket released");
        var retired=New();request=Request(47);
        Check(retired.Handle(request).Status=="reserved" &&
            retired.Handle(Request(47,"submit")).Status=="submitted" &&
            retired.BindActualTuple(request.TicketId,"17","owner-retired",5,4),
            "native original owner retirement fixture");
        Check(!retired.RevokeOwner(Guid.NewGuid().ToString("D")) && retired.HasActive,
            "unrelated native owner retirement cannot cancel the original ticket");
        Check(retired.RevokeOwner(request.OwnerIncarnationId),
            "exact P2 incarnation retirement immediately revokes pending ticket");
        Check(!retired.ObserveCorePlaybackStarted(request.SpeakerCaptureRef,
            "17","owner-retired",5) && !retired.HasActive,
            "late playback after source owner retirement cannot reopen ticket");
        Check(retired.Handle(request).Status=="busy",
            "retirement preserves original one-shot anti-replay bookkeeping");
        var reset=New();request=Request(46);
        Check(reset.Handle(request).Status=="reserved" &&
            reset.Handle(Request(46,"submit")).Status=="submitted" &&
            reset.BindActualTuple(request.TicketId,"17","reset-core",5,4),
            "reset Core playback fixture");
        reset.Reset();
        Check(!reset.ObserveCorePlaybackStarted(request.SpeakerCaptureRef,"17","reset-core",5),
            "world reset invalidates late Core callback");
    }
    static void FailedCallbacks()
    {
        var a=Request(30);
        var noStart=New();
        Check(noStart.Handle(a).Status=="reserved","no-start reserve");
        Check(noStart.Handle(Request(30,"submit")).Status=="submitted","no-start submit");
        Check(noStart.BindActualTuple(a.TicketId,"17","missing-start",3,4),"no-start bind");
        Check(!noStart.Complete(a.TicketId,"17","missing-start",3,4,true,false,true,true),
              "terminal callback cannot fabricate missing native playback start");
        Check(!noStart.HasActive,"missing start callback releases ticket");

        a=Request(31);var callbackFault=new DirectorAdmission(()=>now,(r,stage)=>{
            if(stage=="complete")throw new Exception("failed native callback");
            return true;
        },()=>host,()=>world,true,()=>special);
        Check(callbackFault.Handle(a).Status=="reserved","fault fixture reserve");
        Check(callbackFault.Handle(Request(31,"submit")).Status=="submitted","fault fixture submit");
        Check(callbackFault.BindActualTuple(a.TicketId,"17","callback-fault",4,5),"fault fixture bind");
        Check(callbackFault.NotePlaybackStarted(a.TicketId,"17","callback-fault",4,5),"fault fixture start");
        Check(!callbackFault.Complete(a.TicketId,"17","callback-fault",4,5,true,false,true,true),
              "throwing independent completion proof fails closed");
        Check(!callbackFault.HasActive,"throwing completion proof retires ticket");

        a=Request(32);var lostOwner=new DirectorAdmission(()=>now,(r,stage)=>
            stage!="playback_started",()=>host,()=>world,true,()=>special);
        Check(lostOwner.Handle(a).Status=="reserved","lost-owner reserve");
        Check(lostOwner.Handle(Request(32,"submit")).Status=="submitted","lost-owner submit");
        Check(lostOwner.BindActualTuple(a.TicketId,"17","owner-revoked",4,5),"lost-owner bind");
        Check(!lostOwner.NotePlaybackStarted(a.TicketId,"17","owner-revoked",4,5),
              "owner loss at native start vetoes callback");
        Check(!lostOwner.HasActive,"unsafe native start immediately releases reservation");
        a=Request(33);
        var reset=New();
        Check(reset.Handle(a).Status=="reserved","world reset fixture reserve");
        reset.Reset();
        Check(reset.Handle(Request(33,"submit")).Status=="stale","world reset removes original reservation");
        Check(!reset.HasActive,"world reset releases all reservations");
    }
    static DirectorC06Policy.Snapshot ReadyProof(DirectorAdmission.Request r)
    {
        return new DirectorC06Policy.Snapshot {
            HostRunId=r.HostRunId,WorldEpoch=r.WorldEpoch,
            SpeakerCaptureRef=r.SpeakerCaptureRef,PlayerCaptureRef=r.PlayerCaptureRef,
            OwnerIncarnationId=r.OwnerIncarnationId,OwnerProofRevision=r.ProofRevision,
            ObservationId=r.ObservationId,ObservationRevision=r.ObservationRevision,
            DecisionKey=r.DecisionKey,
            PlayerTurnVersion=r.PlayerTurnVersion,PolicyVersion=r.PolicyVersion,
            SpeakerAnchorCurrent=true,SpeakerOwned=true,SpeakerObserver=true,SpeakerAlive=true,
            PlayerAnchorCurrent=true,PlayerIsLocal=true,PlayerAlive=true,
            OwnerProofCurrent=true,OwnerPrimaryModeKnown=true,OwnerIdle=true,
            PlayerTurnSourceCurrent=true,PlayerTurnIdle=true,MicStateKnown=true,MicIdle=true,
            ConversationStateKnown=true,ConversationIdle=true,
            EssentialTurnKnown=true,EssentialTurnIdle=true,PlaybackKnown=true,PlaybackIdle=true,
            ScriptStateKnown=true,ScriptSafe=true,ActorReflexKnown=true,ActorReflexIdle=true,
            ObservationReceiptCurrent=true,ResponseGrantCurrent=true
        };
    }
    static void C06Contract()
    {
        var req=Request(23);
        var proof=ReadyProof(req);
        Check(DirectorC06Policy.Safe(req,proof),"complete authoritative same-host/owner C06 snapshot admits");
        // This Core API covers special turns only. Its status is diagnostic,
        // never a substitute for the mandatory *global* player-turn arbiter.
        Check(!proof.SpecialTurnVersionKnown && DirectorC06Policy.Safe(req,proof),
              "special-turn diagnostic unknown cannot veto otherwise independently proven fixture");
        proof.SpecialTurnVersionKnown=true;proof.SpecialTurnVersion=42;
        Check(DirectorC06Policy.Safe(req,proof),
              "special-turn diagnostic present cannot fabricate or replace global authority");
        proof.SpecialTurnVersionKnown=false;proof.SpecialTurnVersion=-1;
        foreach(var field in typeof(DirectorC06Policy.Snapshot).GetFields()) {
            if(field.FieldType!=typeof(bool) || field.Name=="SpecialTurnVersionKnown")continue;
            field.SetValue(proof,false);
            Check(!DirectorC06Policy.Safe(req,proof),"missing C06 native field denies: "+field.Name);
            field.SetValue(proof,true);
        }
        var changed=Request(23);changed.WorldEpoch++;
        Check(!DirectorC06Policy.Safe(changed,proof),"no world-epoch borrowing");
        changed=Request(23);changed.HostRunId=Guid.NewGuid().ToString("D");
        Check(!DirectorC06Policy.Safe(changed,proof),"no host-run borrowing");
        changed=Request(23);changed.PlayerCaptureRef=Guid.NewGuid().ToString("D");
        Check(!DirectorC06Policy.Safe(changed,proof),"no player anchor substitution");
        changed=Request(23);changed.PolicyVersion++;
        Check(!DirectorC06Policy.Safe(changed,proof),"no PS3 policy version borrowing");
        changed=Request(23);changed.ObservationId=null;
        proof.ObservationId=null;
        Check(!DirectorC06Policy.Safe(changed,proof),"two missing observation IDs cannot authorize speech");
        proof.ObservationId=req.ObservationId;
        changed=Request(23);changed.ProofRevision++;
        Check(!DirectorC06Policy.Safe(changed,proof),"no proof-revision borrowing");
        changed=Request(23);changed.PlayerTurnVersion++;
        Check(!DirectorC06Policy.Safe(changed,proof),"no player-turn borrowing");
        changed=Request(23);changed.SpeakerCaptureRef=Guid.NewGuid().ToString("D");
        Check(!DirectorC06Policy.Safe(changed,proof),"no speaker substitution");
        changed=Request(23);changed.OwnerIncarnationId=Guid.NewGuid().ToString("D");
        Check(!DirectorC06Policy.Safe(changed,proof),"no owner incarnation substitution");
        changed=Request(23);changed.ObservationId=Guid.NewGuid().ToString("D");
        Check(!DirectorC06Policy.Safe(changed,proof),"no PS3 observation substitution");
        changed=Request(23);changed.ObservationRevision++;
        Check(!DirectorC06Policy.Safe(changed,proof),"no PS3 revision substitution");
        changed=Request(23);changed.DecisionKey="same-actor-different-grant";
        Check(!DirectorC06Policy.Safe(changed,proof),"no PS3 decision grant substitution");
        proof.ObservationId=null;
        Check(!DirectorC06Policy.Safe(req,proof),"unavailable original PS3 observation denies");
        proof.ObservationId=req.ObservationId;
        proof.DecisionKey=null;
        Check(!DirectorC06Policy.Safe(req,proof),"unavailable original PS3 entitlement denies");
        proof.DecisionKey=req.DecisionKey;
        Check(!DirectorC06Policy.Safe(req,new DirectorC06Policy.Snapshot()),"unknown C06 truth denies");
        var admission=new DirectorAdmission(()=>now,r=>DirectorC06Policy.Safe(r,proof),()=>host,()=>world,true,()=>special);
        Check(admission.Handle(req).Status=="reserved","full native proof permits one reservation in isolated test only");
        proof.PlayerTurnIdle=false;
        Check(admission.Handle(Request(23,"submit")).Status=="unsafe","player takeover vetoes reserved Director before submit");
        Check(!admission.HasActive,"safety veto frees global reservation");
        proof.PlayerTurnIdle=true;
        Check(admission.Handle(req).Status=="busy","failed native ticket cannot replay after priority change");
        var playing=Request(24);
        var stagedProof=ReadyProof(playing);
        var staged=new DirectorAdmission(()=>now,(r,stage)=>
            stage=="bind" || stage=="playback_started" || stage=="complete" ? DirectorC06Policy.CurrentPlayback(r,stagedProof)
                              : DirectorC06Policy.Safe(r,stagedProof),
            ()=>host,()=>world,true,()=>special);
        Check(staged.Handle(playing).Status=="reserved","idle owner permits real ticket reserve");
        Check(staged.Handle(Request(24,"submit")).Status=="submitted","idle at submit");
        stagedProof.OwnerIdle=false;stagedProof.EssentialTurnIdle=false;stagedProof.PlaybackIdle=false;
        Check(staged.BindActualTuple(playing.TicketId,"17","essential-real-turn",7,3),
            "native binding rechecks current ownership while exact allocated turn is already busy");
        Check(staged.NotePlaybackStarted(playing.TicketId,"17","essential-real-turn",7,3),
            "owner-valid original-tuple native playback start");
        Check(!DirectorC06Policy.Safe(playing,stagedProof) &&
            DirectorC06Policy.CurrentPlayback(playing,stagedProof),
            "actively speaking is not idle but retains valid owner/currentness");
        Check(staged.Complete(playing.TicketId,"17","essential-real-turn",7,3,true,false,true,true),
            "matching complete actual playback can be acknowledged while Essential no longer idle");
        var takeover=Request(25);
        var takeoverProof=ReadyProof(takeover);
        var interrupted=new DirectorAdmission(()=>now,(r,stage)=>
            stage=="bind" || stage=="playback_started" || stage=="complete" ? DirectorC06Policy.CurrentPlayback(r,takeoverProof)
                              : DirectorC06Policy.Safe(r,takeoverProof),
            ()=>host,()=>world,true,()=>special);
        Check(interrupted.Handle(takeover).Status=="reserved","player takeover fixture reserve");
        Check(interrupted.Handle(Request(25,"submit")).Status=="submitted","player takeover fixture submit");
        Check(interrupted.BindActualTuple(takeover.TicketId,"17","interrupted-turn",8,3),"player takeover fixture exact tuple");
        Check(interrupted.NotePlaybackStarted(takeover.TicketId,"17","interrupted-turn",8,3),"player takeover fixture real start");
        takeoverProof.PlayerTurnVersion++;
        Check(!interrupted.Complete(takeover.TicketId,"17","interrupted-turn",8,3,true,false,true,true),
            "changed player turn makes even complete playback receipt inadmissible");
        Check(!interrupted.HasActive,"player priority takeover frees exact native reservation");
    }
    static void ChannelRoundtrip()
    {
        string name="LSA.PS6.CI."+Guid.NewGuid().ToString("N");
        using(var server=new IntelligenceChannel(name,Guid.NewGuid().ToString("D"),
            ()=>new {shooting=true},host,()=>world,true,true)) {
            server.Start();
            using(var client=new NamedPipeClientStream(".",name,PipeDirection.InOut)) {
                client.Connect(5000);
                var reader=new StreamReader(client,Encoding.UTF8,false,1024,true);
                var writer=new StreamWriter(client,new UTF8Encoding(false),1024,true){AutoFlush=true};
                var hello=reader.ReadLine();
                Check(hello!=null && hello.Contains("\"directorRequestVersion\":1"),
                    "explicit duplex capability in native hello");
                var frame=Wire(Request(22));
                writer.WriteLine(frame);
                string received=null;
                var deadline=DateTime.UtcNow.AddSeconds(3);
                while(DateTime.UtcNow<deadline && !server.TryTakeDirectorFrame(out received))Thread.Sleep(10);
                Check(received==frame,"same authenticated pipe bounded inbound frame");
                Check(!server.TryTakeDirectorFrame(out received),"single dequeue");
                Check(server.Send("diagnostics",new {test=true}),"original factual outbound path preserved");
                var outbound=reader.ReadLine();
                Check(outbound!=null && outbound.Contains("\"type\":\"diagnostics\""),
                    "factual frame still sent through same connection");
            }
        }
        // Legacy PS channels are unidirectional and do not advertise a new
        // permission merely because the Director test assembly is present.
        name="LSA.PS6.Legacy."+Guid.NewGuid().ToString("N");
        using(var legacy=new IntelligenceChannel(name,Guid.NewGuid().ToString("D"),
            ()=>new {shooting=true},host,()=>world,true)) {
            legacy.Start();
            using(var client=new NamedPipeClientStream(".",name,PipeDirection.In)) {
                client.Connect(5000);
                var reader=new StreamReader(client);
                var hello=reader.ReadLine();
                Check(hello!=null && !hello.Contains("directorRequestVersion"),
                    "default PS channel retains output-only contract");
                string missing;
                Check(!legacy.TryTakeDirectorFrame(out missing),
                    "legacy pipe rejects Director input");
            }
        }
    }

    static string Wire(DirectorAdmission.Request r)
    {
        return new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new {
            version=r.Version,type="director.request",operation=r.Operation,
            ticketId=r.TicketId,dedupeKey=r.DedupeKey,hostRunId=r.HostRunId,
            worldEpoch=r.WorldEpoch,speakerCaptureRef=r.SpeakerCaptureRef,
            playerCaptureRef=r.PlayerCaptureRef,ownerIncarnationId=r.OwnerIncarnationId,
            proofRevision=r.ProofRevision,playerTurnVersion=r.PlayerTurnVersion,
            policyVersion=r.PolicyVersion,observationId=r.ObservationId,
            observationRevision=r.ObservationRevision,decisionKey=r.DecisionKey,
            ageMs=r.AgeMs
        });
    }
    static void CodecContract()
    {
        var source=Request(21);
        string encoded=Wire(source);
        DirectorAdmission.Request decoded;
        Check(DirectorFrameCodec.TryDecode(encoded,out decoded),"strict frame decoder accepts matching v1");
        Check(decoded.DedupeKey==source.DedupeKey &&
              decoded.ProofRevision==source.ProofRevision &&
              decoded.WorldEpoch==source.WorldEpoch,"frame fields unchanged");
        Check(!DirectorFrameCodec.TryDecode(encoded.Replace("\"director.request\"","\"control.raw\""),out decoded),
              "reject unsupported operation vocabulary");
        Check(!DirectorFrameCodec.TryDecode(encoded.Replace("\"worldEpoch\":1","\"worldEpoch\":\"1\""),out decoded),
              "reject coerced number");
        Check(!DirectorFrameCodec.TryDecode(encoded.Substring(0,encoded.Length-1)+",\"unknown\":true}",out decoded),
              "reject extra wire fields");
        Check(!DirectorFrameCodec.TryDecode(encoded.Replace("\"version\":1","\"version\":2"),out decoded),
              "reject unsupported version");
        Check(!DirectorFrameCodec.TryDecode("{broken",out decoded),"reject malformed json");
    }

}
