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
    static bool safe=true;
    static string host="a1111111-1111-4111-8111-111111111111";
    static int world=1;
    static DirectorAdmission New(bool enabled=true)
    {
        return new DirectorAdmission(()=>now,r=>safe,()=>host,()=>world,enabled);
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
        now+=10000;
        Check(speech.Handle(Request(18)).Status=="busy","bound playback survives source-time ticket expiry");
        Check(speech.Complete(a.TicketId,"17","native-long",1,3,true,false,true,true),"complete playback acknowledged beyond source TTL");
        Check(!speech.HasActive,"completed long playback releases single reservation");
        var neverEnding=New();a=Request(19);
        Check(neverEnding.Handle(a).Status=="reserved","stale playback reserve");
        Check(neverEnding.Handle(Request(19,"submit")).Status=="submitted","stale playback submit");
        Check(neverEnding.BindActualTuple(a.TicketId,"17","native-never",2,3),"stale playback bind");
        now+=120000;
        Check(!neverEnding.Complete(a.TicketId,"17","native-never",2,3,true,false,true,true),"expired playback lease cannot claim delivery");
        Check(!neverEnding.HasActive,"expired completion releases native ticket");
        CodecContract();
        ChannelRoundtrip();
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
