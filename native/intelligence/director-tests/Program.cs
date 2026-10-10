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
    // Independently supplied monotonic ALL-player-input ownership epoch.
    // The pinned Core's special counter is deliberately NOT this source.
    static long playerEpoch=1;
    static bool safe=true;
    static string host="a1111111-1111-4111-8111-111111111111";
    static int world=1;
    static DirectorAdmission New(bool enabled=true)
    {
        return new DirectorAdmission(()=>now,r=>safe,()=>host,()=>world,enabled,()=>special,()=>playerEpoch);
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
    static void OriginalTurnBindingFrameContract()
    {
        const string frame="{\"version\":1,\"type\":\"director.original_turn_bound\","+
            "\"ticketId\":\"b1111111-1111-4111-8111-000000000001\","+
            "\"sourceRun\":\"e1111111-1111-4111-8111-111111111111\","+
            "\"sourceRevision\":4,\"hostRunId\":\"a1111111-1111-4111-8111-111111111111\","+
            "\"worldEpoch\":1,\"speakerCaptureRef\":\"c1111111-1111-4111-8111-111111111111\","+
            "\"pedId\":\"17\",\"turnId\":\"source-turn-1\","+
            "\"generationId\":2147483648,\"sessionNonce\":3}";
        DirectorOriginalTurnBindingCodec.Frame original;
        Check(DirectorOriginalTurnBindingCodec.TryDecode(frame,out original),
              "exact source bound-turn identity frame decoded");
        Check(original.PedId=="17" && original.TurnId=="source-turn-1" &&
              original.GenerationId==2147483648L && original.SessionNonce==3,
              "64-bit generation and original nonce preserved");
        Check(!DirectorOriginalTurnBindingCodec.TryDecode(
              frame.Replace("\"sessionNonce\":3","\"sessionNonce\":0"),out original),
              "zero session nonce veto");
        Check(!DirectorOriginalTurnBindingCodec.TryDecode(
              frame.Replace("\"generationId\":2147483648","\"generationId\":9007199254740992"),out original),
              "non-exact generation veto");
        Check(!DirectorOriginalTurnBindingCodec.TryDecode(
              frame.Replace("\"pedId\":\"17\"","\"pedId\":\"17x\""),out original),
              "non-numeric stock ped veto");
        Check(!DirectorOriginalTurnBindingCodec.TryDecode(
              frame.Replace("\"sessionNonce\":3","\"sessionNonce\":\"3\""),out original),
              "string nonce coercion veto");
        Check(!DirectorOriginalTurnBindingCodec.TryDecode(
              frame.Replace("\"type\":\"director.original_turn_bound\"",
                            "\"type\":\"director.stock_intake\""),out original),
              "stock intake is not binding");
        Check(!DirectorOriginalTurnBindingCodec.TryDecode(
              frame.Substring(0,frame.Length-1)+",\"authorized\":true}",out original),
              "caller authorization flag is forbidden");
    }

    static void Run()
    {
        OriginalTurnBindingFrameContract();
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


        // 3A native submitted receipt cannot itself schedule stock speech.
        var stock=New();a=Request(101);
        Check(stock.SubmittedForStockIntake(a.TicketId)==null,"no unreserved stock dispatch");
        Check(stock.Handle(a).Status=="reserved","stock candidate reserved");
        Check(stock.SubmittedForStockIntake(a.TicketId)==null,"reserve not submit");
        Check(stock.Handle(Request(101,"submit")).Status=="submitted","stock native submit");
        Check(stock.SubmittedForStockIntake(a.TicketId)!=null,"exact submitted ticket");
        var claim=stock.TryClaimStockIntake(a.TicketId);
        Check(claim!=null&&claim.Operation=="submit","stock one-time native claim");
        Check(stock.TryClaimStockIntake(a.TicketId)==null,"stock duplicate claim veto");
        Check(stock.AbandonStockIntake(a.TicketId) && !stock.HasActive,
              "failed stock scheduler can retire reserved ticket without replay");
        Check(!stock.AbandonStockIntake(a.TicketId),
              "failed stock ticket retirement is exactly once");
        var changed=New();a=Request(103);
        Check(changed.Handle(a).Status=="reserved" &&
              changed.Handle(Request(103,"submit")).Status=="submitted",
              "takeover ticket staged before stock intake");
        playerEpoch++;
        Check(changed.TryClaimStockIntake(a.TicketId)==null&&!changed.HasActive,
              "changed native player epoch vetoes stock dispatch");
        playerEpoch--;
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
        Ps3ReceiptContract();
        SpecialTurnFences();
        PlayerPriorityFences();
        FailedCallbacks();
        C06Contract();
        CodecContract();
        OriginalOwnerReceiptsContract();
        ChannelRoundtrip();
    }

    static void Ps3ReceiptContract()
    {
        var req=Request(59);
        var receipts=new DirectorPs3Receipts(()=>now,()=>host,()=>world);
        var source=Guid.NewGuid().ToString("D");
        var observer=req.SpeakerCaptureRef;
        var challenge=receipts.Issue(observer,req.OwnerIncarnationId,req.ProofRevision,5);
        Check(challenge!=null,"source native P2 owner challenge created");
        Check(challenge==receipts.Issue(observer,req.OwnerIncarnationId,req.ProofRevision,6),
            "unchanged P2 incarnation source reuses bounded native challenge");
        receipts.SentSignal(source,new[]{observer});
        var proof=new DirectorPs3Receipts.Grant {
            Version=1,Source="original_companion_ps2_ps3",
            Challenge=challenge,TicketId=req.TicketId,HostRunId=host,WorldEpoch=world,
            SpeakerCaptureRef=observer,PlayerCaptureRef=req.PlayerCaptureRef,
            OwnerIncarnationId=req.OwnerIncarnationId,ProofRevision=req.ProofRevision,
            SituationRevision=6,SignalId=source,ObservationId=req.ObservationId,
            ObservationRevision=req.ObservationRevision,DecisionKey=req.DecisionKey,
            PolicyVersion=1,AgeMs=100
        };
        var serializer=new System.Web.Script.Serialization.JavaScriptSerializer();
        var wire=new System.Collections.Generic.Dictionary<string,object> {
          {"version",1},{"type","director.ps3_receipt"},
          {"source",proof.Source},{"challenge",proof.Challenge},{"ticketId",proof.TicketId},
          {"hostRunId",proof.HostRunId},{"worldEpoch",proof.WorldEpoch},
          {"speakerCaptureRef",proof.SpeakerCaptureRef},{"playerCaptureRef",proof.PlayerCaptureRef},
          {"ownerIncarnationId",proof.OwnerIncarnationId},{"proofRevision",proof.ProofRevision},
          {"situationRevision",proof.SituationRevision},{"signalId",proof.SignalId},
          {"observationId",proof.ObservationId},{"observationRevision",proof.ObservationRevision},
          {"decisionKey",proof.DecisionKey},{"policyVersion",proof.PolicyVersion},{"ageMs",proof.AgeMs}
        };
        var frame=serializer.Serialize(wire);
        DirectorPs3Receipts.Grant decoded;
        Check(DirectorPs3ReceiptCodec.TryDecode(frame,out decoded) && decoded.SignalId==source,
              "native original PS3 receipt codec requires exact closed source vocabulary");
        Check(!DirectorFrameCodec.TryDecode(frame,out var wrongKind),
              "PS3 source receipt can never be decoded as a speech request");
        wire["injectedApproval"]=true;
        Check(!DirectorPs3ReceiptCodec.TryDecode(serializer.Serialize(wire),out decoded),
              "extra untrusted grants are not accepted by strict source codec");
        wire.Remove("injectedApproval");
        wire["proofRevision"]=1.5;
        Check(!DirectorPs3ReceiptCodec.TryDecode(serializer.Serialize(wire),out decoded),
              "fractional native owner revision does not coerce");
        wire["proofRevision"]=req.ProofRevision;
        Check(receipts.Accept(proof),"independent original native signal and P2 challenge grant accepted");
        Check(!receipts.Accept(proof),"original native challenge and signal are one use");
        Check(receipts.Current(req) && receipts.OriginalFor(req)?.ObservationId==proof.ObservationId &&
              !ReferenceEquals(receipts.OriginalFor(req),proof),
            "source-origin PS3 sealed receipt is independently copied, never request-owned");
        var regressedAge=Request(59);regressedAge.AgeMs=99;
        Check(!receipts.Current(regressedAge) &&
              receipts.LastCurrentFailure=="grant_age_regressed",
            "native rejects an age genuinely older than the sealed original PS3 receipt");
        var advancedAge=Request(59);advancedAge.AgeMs=150;
        Check(receipts.Current(advancedAge),
            "native permits increasing age on the same exact original witness and ticket");
        Check(receipts.Reserve(req) && receipts.IsReserved(req),
            "one native ticket can claim original producer grant");
        Check(!receipts.Reserve(req),"already reserved original grant cannot be claimed twice");
        var forged=Request(59);forged.ObservationId=Guid.NewGuid().ToString("D");
        Check(!receipts.Current(forged),"matching ticket with forged PS2 observation ID denied");
        forged=Request(59);forged.DecisionKey="other-original-ps3-decision";
        Check(!receipts.Current(forged),"matching ticket with forged decision entitlement denied");
        forged=Request(59);forged.ProofRevision++;
        Check(!receipts.Current(forged),"stale native P2 owner revision denied");
        forged=Request(59);forged.PlayerCaptureRef=Guid.NewGuid().ToString("D");
        Check(!receipts.Current(forged),"other native player anchor denied");
        forged=Request(59);forged.WorldEpoch++;
        Check(!receipts.Current(forged),"other native world epoch denied");

        var unrelated=Guid.NewGuid().ToString("D");
        Check(receipts.Issue(unrelated,req.OwnerIncarnationId,0,10)==null,
              "zero P2 revision cannot mint a native proof");
        var absent=new DirectorPs3Receipts(()=>now,()=>host,()=>world);
        var bare=absent.Issue(observer,req.OwnerIncarnationId,req.ProofRevision,6);
        var copy=new DirectorPs3Receipts.Grant {
            Version=1,Source=proof.Source,Challenge=bare,TicketId=req.TicketId,
            HostRunId=host,WorldEpoch=world,SpeakerCaptureRef=observer,
            PlayerCaptureRef=req.PlayerCaptureRef,OwnerIncarnationId=req.OwnerIncarnationId,
            ProofRevision=req.ProofRevision,SituationRevision=6,
            SignalId=source,ObservationId=req.ObservationId,
            ObservationRevision=req.ObservationRevision,DecisionKey=req.DecisionKey,
            PolicyVersion=1,AgeMs=100
        };
        Check(!absent.Accept(copy),"matching companion claims without native sent signal fail");
        absent.SentSignal(source,new[]{unrelated});
        Check(!absent.Accept(copy),"native signal sent to another observer cannot be borrowed");
        absent.SentSignal(source,new[]{observer});
        copy.SituationRevision=7;
        Check(!absent.Accept(copy),"future unsampled native situation fails closed");
        copy.SituationRevision=6;copy.Challenge=Guid.NewGuid().ToString("D");
        Check(!absent.Accept(copy),"companion-created challenge cannot borrow native owner proof");
        copy.Challenge=bare;
        Check(absent.Accept(copy),"valid unique original signal, native challenge and source grant accepted");
        Check(absent.Current(req),"matching source-backed ticket is live before owner retirement");
        absent.Retire(req.OwnerIncarnationId);
        Check(!absent.Current(req),"retirement invalidates source grant regardless of ticket state");
        var afterReset=new DirectorPs3Receipts(()=>now,()=>host,()=>world);
        var same=afterReset.Issue(observer,req.OwnerIncarnationId,req.ProofRevision,6);
        afterReset.SentSignal(source,new[]{observer});
        copy.Challenge=same;copy.TicketId=req.TicketId;
        Check(afterReset.Accept(copy),"fixture accepts original native proof before epoch reset");
        afterReset.Reset();
        Check(!afterReset.Current(req) && afterReset.PendingGrants==0,
            "world/disconnect reset retires all original PS3 records");
        var expire=new DirectorPs3Receipts(()=>now,()=>host,()=>world);
        copy.Challenge=expire.Issue(observer,req.OwnerIncarnationId,req.ProofRevision,6);
        expire.SentSignal(source,new[]{observer});
        Check(expire.Accept(copy),"short-lived original producer grant fixture");
        now+=1901;
        Check(!expire.Current(req),"native host monotonic TTL cannot be extended by replayed request age");
        now-=1901;
    }
    static void SpecialTurnFences()
    {
        // Pinned Core version covers only special player turns, but a change
        // during a native PS6 ticket is an independent hard veto. It cannot
        // certify all other player text/mic turns idle.
        special=7;var a=Request(48);
        var stale=New();
        Check(stale.Handle(a).Status=="reserved","source revision available at reserve");
        special=8;
        Check(stale.Handle(Request(48,"submit")).Status=="unsafe",
              "player special-turn takeover between reserve and submit vetoes");
        Check(!stale.HasActive,"source version takeover retires active ticket");

        special=10;a=Request(49);var afterSubmit=New();
        Check(afterSubmit.Handle(a).Status=="reserved" &&
              afterSubmit.Handle(Request(49,"submit")).Status=="submitted",
              "stable special-turn revision admits original submit in isolated fixture");
        special=11;
        Check(!afterSubmit.BindActualTuple(a.TicketId,"17","stale-special",1,4),
              "player special-turn takeover between submit and Core bind vetoes");
        Check(!afterSubmit.HasActive,"post-submit takeover cancels original ticket");

        special=12;a=Request(50);var afterBind=New();
        Check(afterBind.Handle(a).Status=="reserved" &&
              afterBind.Handle(Request(50,"submit")).Status=="submitted" &&
              afterBind.BindActualTuple(a.TicketId,"17","bound-special",2,4),
              "bound special-turn baseline fixture");
        special=13;
        Check(!afterBind.NotePlaybackStarted(a.TicketId,"17","bound-special",2,4),
              "player takeover at actual Core playback start cannot grant start receipt");
        Check(!afterBind.HasActive,"started-callback takeover releases native ticket");

        special=14;a=Request(51);var afterStart=New();
        Check(afterStart.Handle(a).Status=="reserved" &&
              afterStart.Handle(Request(51,"submit")).Status=="submitted" &&
              afterStart.BindActualTuple(a.TicketId,"17","started-special",2,4) &&
              afterStart.NotePlaybackStarted(a.TicketId,"17","started-special",2,4),
              "original Core-start fixture with stable revision");
        special=15;
        Check(!afterStart.Complete(a.TicketId,"17","started-special",2,4,true,false,true,true),
              "version change before successful terminal cannot consume original PS3 grant");
        Check(!afterStart.HasActive,"Core completion with stale revision retires ticket");

        special=-1;a=Request(52);var unreadable=New();
        Check(unreadable.Handle(a).Status=="unsafe"&&!unreadable.HasActive,
              "negative Core revision cannot be assumed current");
        special=16;a=Request(53);
        var throwing=new DirectorAdmission(()=>now,r=>true,()=>host,()=>world,true,
            ()=>throw new InvalidOperationException("Core unavailable"));
        Check(throwing.Handle(a).Status=="unsafe"&&!throwing.HasActive,
              "throwing pinned Core revision read vetoes rather than guesses");
        var missing=new DirectorAdmission(()=>now,r=>true,()=>host,()=>world,true);
        Check(missing.Handle(Request(54)).Status=="unsafe",
              "even independently all-positive injected C06 cannot reserve without Core source");

        special=17;var racing=new DirectorAdmission(()=>now,
            (r,stage)=>{if(stage=="reserve")special++;return true;},
            ()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(racing.Handle(Request(55)).Status=="unsafe"&&!racing.HasActive,
              "Core revision increment *during* reserve check vetoes before accepting");
        special=18;a=Request(56);var recheck=new DirectorAdmission(()=>now,
            (r,stage)=>{if(stage=="submit")special++;return true;},
            ()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(recheck.Handle(a).Status=="reserved",
              "baseline before in-check special-turn takeover");
        Check(recheck.Handle(Request(56,"submit")).Status=="unsafe" && !recheck.HasActive,
              "Core revision increment *during* submit proof cannot sneak through");
        special=7;
    }

    static void PlayerPriorityFences()
    {
        // Player ownership transitions are independent of the narrower stock
        // special-turn counter; A->B->A must never revive the initial lease.
        playerEpoch=40;
        var a=Request(80);
        var fixture=New();
        Check(fixture.Handle(a).Status=="reserved","global player epoch source pins initial lease");
        // Player mic starts and ends before native submit; sampled 'idle'
        // returns to the identical state, but the source revision advanced.
        playerEpoch+=2;
        Check(fixture.Handle(Request(80,"submit")).Status=="unsafe"&&!fixture.HasActive,
              "mic busy-to-idle ABA invalidates native reservation");

        a=Request(81);fixture=New();
        Check(fixture.Handle(a).Status=="reserved" &&
              fixture.Handle(Request(81,"submit")).Status=="submitted",
              "global epoch baseline submits");
        playerEpoch+=2; // text start, text finished without a busy sample
        Check(!fixture.BindActualTuple(a.TicketId,"17","text-aba",1,1) && !fixture.HasActive,
              "text busy-to-idle ABA before actual binding invalidates ticket");

        a=Request(82);fixture=New();
        Check(fixture.Handle(a).Status=="reserved" &&
              fixture.Handle(Request(82,"submit")).Status=="submitted" &&
              fixture.BindActualTuple(a.TicketId,"17","mic-start",2,1),
              "global source baseline binds");
        playerEpoch++; // player takeover before playback start
        Check(!fixture.NotePlaybackStarted(a.TicketId,"17","mic-start",2,1) && !fixture.HasActive,
              "player microphone takeover before playback start rejects");

        a=Request(83);fixture=New();
        Check(fixture.Handle(a).Status=="reserved" &&
              fixture.Handle(Request(83,"submit")).Status=="submitted" &&
              fixture.BindActualTuple(a.TicketId,"17","playing",3,1) &&
              fixture.NotePlaybackStarted(a.TicketId,"17","playing",3,1),
              "already authorized NPC playback starts");
        Check(fixture.Complete(a.TicketId,"17","playing",3,1,true,false,true,true),
              "normal NPC completion accepted while global player epoch remains unchanged");

        a=Request(84);fixture=New();
        Check(fixture.Handle(a).Status=="reserved" &&
              fixture.Handle(Request(84,"submit")).Status=="submitted" &&
              fixture.BindActualTuple(a.TicketId,"17","taken-over",4,1) &&
              fixture.NotePlaybackStarted(a.TicketId,"17","taken-over",4,1),
              "player takeover completion fixture");
        playerEpoch+=2;
        Check(!fixture.Complete(a.TicketId,"17","taken-over",4,1,true,false,true,true) &&
              !fixture.HasActive,
              "normal-looking terminal receipt cannot mask player takeover ABA");

        playerEpoch=100;
        var withinCheck=new DirectorAdmission(()=>now,(r,stage)=>{
            if(stage=="reserve")playerEpoch+=2;
            return true;
        },()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(withinCheck.Handle(Request(85)).Status=="unsafe"&&!withinCheck.HasActive,
              "player text round trip during reserve callback cannot certify idle");
        playerEpoch=101;
        var missingSource=new DirectorAdmission(()=>now,r=>true,()=>host,()=>world,true,()=>special);
        Check(missingSource.Handle(Request(86)).Status=="unsafe"&&!missingSource.HasActive,
              "all-positive C06 fixture without independent global player source fails closed");
        var unreadable=new DirectorAdmission(()=>now,r=>true,()=>host,()=>world,true,
            ()=>special,()=>throw new InvalidOperationException("player source lost"));
        Check(unreadable.Handle(Request(87)).Status=="unsafe"&&!unreadable.HasActive,
              "unreadable player-ownership revision denies instead of inventing idle");
        // Test actual monotonic implementation rather than changing a mock
        // long by hand. A source not installed is unknown; successive
        // recorded original calls never re-use a prior stable revision.
        var source=new PlayerPriorityEpoch();
        Check(source.Revision==-1,"new source is not installed or falsely idle");
        source.Transition();
        Check(source.Revision==-1,"pre-install events cannot authorize");
        source.Installed();
        long baseline=source.Revision;
        Check(baseline==2,"installed source preserves original transition history");
        var checkedSource=new DirectorAdmission(()=>now,r=>true,()=>host,()=>world,
            true,()=>special,()=>source.Revision);
        a=Request(88);
        Check(checkedSource.Handle(a).Status=="reserved","real epoch-source baseline");
        source.Transition();source.Transition();
        Check(source.Revision==baseline+2 &&
              checkedSource.Handle(Request(88,"submit")).Status=="unsafe",
              "real source records rapid mic/text ABA without a busy sample");
        source.Unavailable();
        var lostSource=new DirectorAdmission(()=>now,r=>true,()=>host,()=>world,
            true,()=>special,()=>source.Revision);
        Check(lostSource.Handle(Request(89)).Status=="unsafe",
              "unavailable Core observer is negative, not zero epoch");
        playerEpoch=1;
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
        },()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(callbackFault.Handle(a).Status=="reserved","fault fixture reserve");
        Check(callbackFault.Handle(Request(31,"submit")).Status=="submitted","fault fixture submit");
        Check(callbackFault.BindActualTuple(a.TicketId,"17","callback-fault",4,5),"fault fixture bind");
        Check(callbackFault.NotePlaybackStarted(a.TicketId,"17","callback-fault",4,5),"fault fixture start");
        Check(!callbackFault.Complete(a.TicketId,"17","callback-fault",4,5,true,false,true,true),
              "throwing independent completion proof fails closed");
        Check(!callbackFault.HasActive,"throwing completion proof retires ticket");

        a=Request(32);var lostOwner=new DirectorAdmission(()=>now,(r,stage)=>
            stage!="playback_started",()=>host,()=>world,true,()=>special,()=>playerEpoch);
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
            TextInputKnown=true,TextInputIdle=true,ControlsInputKnown=true,ControlsInputIdle=true,
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
        proof.ConversationIdle=false;
        Check(!DirectorC06Policy.Safe(req,proof) &&
              DirectorC06Policy.CurrentPlayback(req,proof),
              "known active Core conversation vetoes new speech but does not invalidate already speaking actor");
        proof.ConversationIdle=true;
        proof.ConversationStateKnown=false;
        Check(!DirectorC06Policy.Safe(req,proof) &&
              !DirectorC06Policy.CurrentPlayback(req,proof),
              "unknown Core conversation status is not permission at any boundary");
        proof.ConversationStateKnown=true;
        proof.TextInputIdle=false;
        Check(!DirectorC06Policy.Safe(req,proof) && !DirectorC06Policy.CurrentPlayback(req,proof),
              "player text input takeover vetoes even a previously authorized NPC");
        proof.TextInputIdle=true;
        proof.ControlsInputIdle=false;
        Check(!DirectorC06Policy.Safe(req,proof) && !DirectorC06Policy.CurrentPlayback(req,proof),
              "Core controls menu retains priority over Director playback");
        proof.ControlsInputIdle=true;
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
        var admission=new DirectorAdmission(()=>now,r=>DirectorC06Policy.Safe(r,proof),()=>host,()=>world,true,()=>special,()=>playerEpoch);
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
            ()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(staged.Handle(playing).Status=="reserved","idle owner permits real ticket reserve");
        Check(staged.Handle(Request(24,"submit")).Status=="submitted","idle at submit");
        stagedProof.OwnerIdle=false;stagedProof.EssentialTurnIdle=false;stagedProof.PlaybackIdle=false;
        stagedProof.ConversationIdle=false; // Actual Core speaker is the speaking Director NPC.
        Check(staged.BindActualTuple(playing.TicketId,"17","essential-real-turn",7,3),
            "native binding rechecks current ownership while exact allocated turn is already busy");
        Check(staged.NotePlaybackStarted(playing.TicketId,"17","essential-real-turn",7,3),
            "owner-valid original-tuple native playback start");
        Check(!DirectorC06Policy.Safe(playing,stagedProof) &&
            DirectorC06Policy.CurrentPlayback(playing,stagedProof),
            "actively speaking is not idle but retains valid owner/currentness");
        Check(staged.Complete(playing.TicketId,"17","essential-real-turn",7,3,true,false,true,true),
            "matching complete actual playback can be acknowledged while Essential no longer idle");
        // A successful native-occupied Director turn can outlive the original
        // 250ms idle sample and 2s PS3 grant. Neither is a playback receipt.
        long lateClock=1000;
        var lateReq=Request(26);
        var lateProof=ReadyProof(lateReq);
        var late=new DirectorAdmission(()=>lateClock,(r,stage)=>
            stage=="bind" ? DirectorC06Policy.CurrentPlayback(r,lateProof) :
            stage=="playback_started" || stage=="complete" ?
                DirectorC06Policy.CurrentOccupiedPlayback(r,lateProof) :
                DirectorC06Policy.Safe(r,lateProof),
            ()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(late.Handle(lateReq).Status=="reserved","occupied-turn fixture reserve");
        Check(late.Handle(Request(26,"submit")).Status=="submitted","occupied-turn fixture submit");
        Check(late.BindActualTuple(lateReq.TicketId,"17","late-generated",99,4),
            "occupied-turn original binding");
        lateClock+=5000;
        lateProof.ObservationReceiptCurrent=false;lateProof.ResponseGrantCurrent=false;
        lateProof.PlayerTurnSourceCurrent=false;lateProof.EssentialTurnKnown=false;
        lateProof.PlaybackIdle=false;lateProof.EssentialTurnIdle=false;
        lateProof.OwnerIdle=false;lateProof.ConversationIdle=false;
        Check(!DirectorC06Policy.CurrentPlayback(lateReq,lateProof) &&
            DirectorC06Policy.CurrentOccupiedPlayback(lateReq,lateProof),
            "stale native PS3 grant does not invalidate the exact occupied stock turn");
        Check(late.NotePlaybackStarted(lateReq.TicketId,"17","late-generated",99,4),
            "real native playback may start after the short admission grant expires");
        lateClock+=60000;
        Check(late.Complete(lateReq.TicketId,"17","late-generated",99,4,true,false,true,true),
            "exact native completed playback is accepted inside its own 120s lease");
        Check(!late.HasActive,"completed occupied turn releases its global reservation");
        var lostReq=Request(27);
        long lostClock=1000;
        var lostProof=ReadyProof(lostReq);
        var lost=new DirectorAdmission(()=>lostClock,(r,stage)=>
            stage=="bind" ? DirectorC06Policy.CurrentPlayback(r,lostProof) :
            stage=="playback_started" || stage=="complete" ?
                DirectorC06Policy.CurrentOccupiedPlayback(r,lostProof) :
                DirectorC06Policy.Safe(r,lostProof),
            ()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(lost.Handle(lostReq).Status=="reserved","player-priority fixture reserve");
        Check(lost.Handle(Request(27,"submit")).Status=="submitted","player-priority fixture submit");
        Check(lost.BindActualTuple(lostReq.TicketId,"17","priority-turn",100,4),
            "player-priority fixture binding");
        lostClock+=4000;
        lostProof.TextInputIdle=false;
        Check(!lost.NotePlaybackStarted(lostReq.TicketId,"17","priority-turn",100,4),
            "real player text interrupts even an occupied Director turn");
        Check(!lost.HasActive,"playback takeover retires the original turn");
        var takeover=Request(25);
        var takeoverProof=ReadyProof(takeover);
        var interrupted=new DirectorAdmission(()=>now,(r,stage)=>
            stage=="bind" || stage=="playback_started" || stage=="complete" ? DirectorC06Policy.CurrentPlayback(r,takeoverProof)
                              : DirectorC06Policy.Safe(r,takeoverProof),
            ()=>host,()=>world,true,()=>special,()=>playerEpoch);
        Check(interrupted.Handle(takeover).Status=="reserved","player takeover fixture reserve");
        Check(interrupted.Handle(Request(25,"submit")).Status=="submitted","player takeover fixture submit");
        Check(interrupted.BindActualTuple(takeover.TicketId,"17","interrupted-turn",8,3),"player takeover fixture exact tuple");
        Check(interrupted.NotePlaybackStarted(takeover.TicketId,"17","interrupted-turn",8,3),"player takeover fixture real start");
        takeoverProof.PlayerTurnVersion++;
        Check(!interrupted.Complete(takeover.TicketId,"17","interrupted-turn",8,3,true,false,true,true),
            "changed player turn makes even complete playback receipt inadmissible");
        Check(!interrupted.HasActive,"player priority takeover frees exact native reservation");
    }

    static void OriginalOwnerReceiptsContract()
    {
        long previousNow=now,previousInput=playerEpoch;
        try {
            now=1000;playerEpoch=12;
            var request=Request(71);
            var source=new DirectorOriginalTurnReceipts.Evidence {
                Version=1,Source="original_essential_backend_lifecycle",
                SourceRun="51111111-1111-4111-8111-111111111111",
                TicketId=request.TicketId,HostRunId=host,WorldEpoch=world,
                PlayerTurnVersion=request.PlayerTurnVersion,
                Revision=4,ObservationSerial=1,Quiet=true
            };
            var sourceReader=new DirectorOriginalTurnReceipts(
                ()=>now,()=>host,()=>world,()=>playerEpoch);
            Check(sourceReader.OriginalFor(request)==null,
                "no original backend source observation means UNKNOWN");
            var json=new System.Web.Script.Serialization.JavaScriptSerializer();
            string Encode(DirectorOriginalTurnReceipts.Evidence e)=>json.Serialize(new {
                version=e.Version,type="director.original_owner_receipt",
                source=e.Source,sourceRun=e.SourceRun,ticketId=e.TicketId,
                hostRunId=e.HostRunId,worldEpoch=e.WorldEpoch,
                playerTurnVersion=e.PlayerTurnVersion,
                revision=e.Revision,observationSerial=e.ObservationSerial,quiet=e.Quiet
            });
            DirectorOriginalTurnReceipts.Evidence decoded;
            Check(DirectorOriginalTurnReceiptCodec.TryDecode(Encode(source),out decoded) &&
                decoded.Revision==4 && decoded.ObservationSerial==1 && decoded.Quiet,
                "strict original backend source envelope");
            Check(!DirectorOriginalTurnReceiptCodec.TryDecode(
                Encode(source).Replace("director.original_owner_receipt","control.raw"),out decoded),
                "source receipt vocabulary rejects arbitrary commands");
            Check(!DirectorOriginalTurnReceiptCodec.TryDecode(
                Encode(source).Replace("\"quiet\":true","\"quiet\":1"),out decoded),
                "source receipt rejects bool-number confusion");
            Check(!DirectorOriginalTurnReceiptCodec.TryDecode(
                Encode(source).Replace("\"revision\":4","\"revision\":4.2"),out decoded),
                "source receipt rejects floating-point epoch");
            Check(!DirectorOriginalTurnReceiptCodec.TryDecode(
                Encode(source).Replace("}",",\"extra\":true}"),out decoded),
                "source receipt refuses extra properties");
            Check(sourceReader.Accept(source),"first source-confirmed quiet observation accepted");
            var sealedSource=sourceReader.OriginalFor(request);
            Check(sealedSource!=null && sealedSource.SourceRun==source.SourceRun &&
                sealedSource.Revision==4 && !ReferenceEquals(sealedSource,source),
                "owner-fiber Core revision fences sealed original source");
            source.Revision=99;
            Check(sourceReader.OriginalFor(request).Revision==4,
                "mutable caller cannot alter sealed source evidence");
            source.Revision=4;
            Check(!sourceReader.Accept(source),"replayed original observation serial is rejected");
            source.ObservationSerial=2;
            Check(sourceReader.Accept(source),"fresh same source revision renews bounded receipt");
            playerEpoch++;
            Check(sourceReader.OriginalFor(request)==null,
                "native real input takeover revokes old backend quiet claim");
            playerEpoch--;
            source.ObservationSerial=3;source.Revision=5;
            Check(!sourceReader.Accept(source),
                "new backend revision invalidates existing native ticket");
            source.ObservationSerial=4;
            Check(!sourceReader.Accept(source) &&
                sourceReader.OriginalFor(request)==null,
                "changed lifecycle ticket is permanently poisoned, not rebased");
            var next=Request(72);
            source.TicketId=next.TicketId;
            source.ObservationSerial=5;
            Check(sourceReader.Accept(source),"independent new ticket may sample newer source");
            now+=DirectorOriginalTurnReceipts.LeaseMs+1;
            Check(sourceReader.OriginalFor(next)==null,
                "source sample expires on real monotonic owner time");
            sourceReader.Reset();
            source.SourceRun="61111111-1111-4111-8111-111111111111";
            source.ObservationSerial=1;
            Check(sourceReader.Accept(source),
                "reset permits genuinely new original source incarnation");
            var older=Request(73);source.TicketId=older.TicketId;
            source.ObservationSerial=2;source.Quiet=false;
            Check(!sourceReader.Accept(source),
                "busy original lifecycle cannot be claimed idle");
            source.Quiet=true;source.WorldEpoch=world+1;
            Check(!sourceReader.Accept(source),"stale source world cannot supply C-06");
            source.WorldEpoch=world;source.HostRunId="41111111-1111-4111-8111-111111111111";
            Check(!sourceReader.Accept(source),"foreign host original receipt rejected");
            sourceReader.Reset();
            Check(sourceReader.Pending==0,"reset retires all owner source epochs");
        } finally {now=previousNow;playerEpoch=previousInput;}
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
