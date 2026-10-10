using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.Activities;

class Program
{
    static int assertions;
    static void Check(bool condition, string name) { if (!condition) throw new Exception(name); assertions++; }
    static Dictionary<string,object> Decode(JavaScriptSerializer json,string text) => json.DeserializeObject(text) as Dictionary<string,object>;
    static string ContractPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null) { var path = Path.Combine(dir.FullName, "contracts", "activity-capabilities.v1.json"); if (File.Exists(path)) return path; dir = dir.Parent; }
        throw new FileNotFoundException("activity contract");
    }
    static string Id(char n) => n + "1111111-1111-4111-8111-111111111111";
    static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--serve-dialogue") { ServeDialogue(args[1]); return; }
        if (args.Length == 2 && args[0] == "--serve") { Serve(args[1]); return; }
        try { Run(); Console.WriteLine("PASS " + assertions + " ACT contract and shadow assertions"); }
        catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
    }
    static void Serve(string pipe)
    {
        var session = new ActivitySession(CapabilityTable.Parse(File.ReadAllBytes(ContractPath())));
        using (var channel = new ActivityChannel(pipe, session)) {
            channel.Start();
            while (true) {
                channel.Pump(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Thread.Sleep(10);
            }
        }
    }
    // Transport fixture: callback records are synthetic; no Essential/RAGE code.
    static void ServeDialogue(string pipe)
    {
        string host=Guid.NewGuid().ToString("D");int epoch=1;bool hold=false;
        var ring=new SupersessionMonitor();var commands=new System.Collections.Concurrent.ConcurrentQueue<string>();
        var reader=new Thread(()=>{string command;while((command=Console.ReadLine())!=null){if(command.Length>32)throw new Exception("Fixture command limit");commands.Enqueue(command);}}){IsBackground=true};reader.Start();
        var correlator=new DialogueActionCorrelator(host,epoch);ActivitySession session=null;
        session=new ActivitySession(CapabilityTable.Parse(File.ReadAllBytes(ContractPath())),null,host,()=>epoch,annotation=>{
            long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();var body=new object();
            if(!correlator.Accept(annotation,body,ring.CaptureSequence,100,now))return true;
            string action=(string)annotation["canonicalAction"];
            ring.Push(new CallbackRecord{PedReference=body,Name=action,Phase="before",Source="essential",GameMs=101});
            ring.Push(new CallbackRecord{PedReference=body,Name=action,Phase="executed",Source="essential",GameMs=102,Succeeded=action!="sitonground"});
            return true;
        },()=>{correlator.Reset();correlator=new DialogueActionCorrelator(host,epoch);});
        using(var channel=new ActivityChannel(pipe,session)){
            channel.Start();while(true){
                long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();channel.Pump(now);now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                string command;bool report=commands.TryDequeue(out command);
                if(report){
                    if(command=="hold")hold=true;
                    else if(command=="flush")hold=false;
                    else if(command=="world"){epoch++;session.WorldChanged(epoch,"clock_regression");channel.RefreshHello();channel.Flush();}
                    else if(command=="overflow"){for(int i=0;i<=ActivityContracts.CallbackRing;i++)ring.Push(new CallbackRecord{Name="foreign",Source="essential",Phase="before",GameMs=101});}
                    else if(command!="status")throw new Exception("Unknown fixture command");
                }
                if(!hold){
                    // Same owner-fiber ordering as ActivityCommands: overflow
                    // invalidates before any retained callback can be joined.
                    if(ring.Overflowing)correlator.Invalidate(now);
                    CallbackRecord record;while((record=ring.Drain())!=null){
                        var original=correlator.PendingForCallback(record);if(original==null)continue;
                        var binding=(Dictionary<string,object>)original["binding"];
                        var result=correlator.Match(record,(string)binding["captureRef"],binding.ContainsKey("encounterId")?(string)binding["encounterId"]:null,binding.ContainsKey("incarnationId")?(string)binding["incarnationId"]:null,host,epoch,102,now,false);
                        if(result!=null && !session.PublishDialogueReceipt(result))throw new Exception("Fixture receipt publication failed.");
                    }
                }
                if(report){Console.WriteLine(new JavaScriptSerializer().Serialize(new{command,epoch,pending=correlator.Count,callbacks=ring.Count,dropped=ring.Dropped}));Console.Out.Flush();}
                Thread.Sleep(10);
            }
        }
    }

    static void HostResetContract(CapabilityTable table)
    {
        var json=new JavaScriptSerializer();var host=Guid.NewGuid().ToString("D");int epoch=1;
        var session=new ActivitySession(table,null,host,()=>epoch);
        string Hello(string run,int world)=>json.Serialize(new {version=1,type="hello",contractSha256=CapabilityTable.ContractSha256,clientRun=Guid.NewGuid().ToString("D"),hostContextVersion=1,hostRunId=run,worldEpoch=world});
        var advertised=Decode(json,session.ServerHello());
        Check((string)advertised["hostRunId"]==host && (int)advertised["worldEpoch"]==1,"ACT independent host advertisement");
        session.OpenTransport();Check(!session.AcceptClient(Hello(Guid.NewGuid().ToString("D"),1)),"ACT rejects mixed host");
        session.OpenTransport();Check(!session.AcceptClient(Hello(host,2)),"ACT rejects stale world echo");
        session.OpenTransport();Check(session.AcceptClient(Hello(host,1)),"ACT matching host echo");
        epoch=2;session.WorldChanged(epoch,"timeline_change");
        var reset=Decode(json,session.TakeOutbound());
        Check(session.Closed && (string)reset["type"]=="world_epoch" && (string)reset["reason"]=="timeline_change" && (int)reset["epoch"]==2,"ACT reset closes admission and preserves reason");
        session.OpenTransport();Check(session.AcceptClient(Hello(host,2)),"ACT reconnect admits current world");
        session.WorldChanged(2,"timeline_change");Check(session.ClientReady && !session.Closed,"ACT repeated reset is idempotent");
        try {session.WorldChanged(1,"timeline_change");Check(false,"ACT regression accepted");} catch(ArgumentException) {Check(session.ClientReady,"ACT invalid reset leaves current session intact");}
    }
    static void Run()
    {
        var annotationJson=new JavaScriptSerializer();
        var annotation=Decode(annotationJson,"{\"version\":1,\"type\":\"dialogue.action.pending\",\"sequence\":1,\"dialogueActionVersion\":1,\"publicationId\":\""+Id('1')+"\",\"tuple\":{\"pedId\":\"17\",\"turnId\":\"turn\",\"generationId\":1,\"sessionNonce\":1},\"binding\":{\"captureRef\":\""+Id('6')+"\",\"encounterId\":\""+Id('2')+"\",\"incarnationId\":\""+Id('3')+"\",\"hostContext\":{\"hostContextVersion\":1,\"hostRunId\":\""+Id('4')+"\",\"worldEpoch\":1}},\"canonicalAction\":\"followtarget\",\"publishedAtMs\":1791500000000}");
        Check(ActivityContracts.DialogueActionAnnotation(annotation,1),"C05 exact annotation supports long publication timestamp");
        Check(!ActivityContracts.ExecutionFrame(annotation,1),"C05 annotation is not execution");
        Check(!ActivityContracts.DialogueActionAnnotation(annotation,2),"C05 sequence mismatch");
        annotation["leaseId"]=Id('5');Check(!ActivityContracts.DialogueActionAnnotation(annotation,1),"C05 extra authority field rejected");annotation.Remove("leaseId");
        annotation["publishedAtMs"]=1.5;Check(!ActivityContracts.DialogueActionAnnotation(annotation,1),"C05 fractional timestamp rejected");annotation["publishedAtMs"]=1791500000000L;
        annotation["canonicalAction"]="followtarget\n";Check(!ActivityContracts.DialogueActionAnnotation(annotation,1),"C05 newline canonical action rejected");annotation["canonicalAction"]="followtarget";
        annotation["dialogueActionVersion"]=2;Check(!ActivityContracts.DialogueActionAnnotation(annotation,1),"C05 unknown extension rejected");annotation["dialogueActionVersion"]=1;
        ((Dictionary<string,object>)annotation["tuple"])["sessionNonce"]=0;Check(!ActivityContracts.DialogueActionAnnotation(annotation,1),"C05 invalid turn lifetime rejected");
        var bytes = File.ReadAllBytes(ContractPath());
        string sha; using (var hash = SHA256.Create()) sha = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        Check(sha == CapabilityTable.ContractSha256, "pinned capability hash");
        var table = CapabilityTable.Parse(bytes);
        HostResetContract(table);
        Check(CapabilityTable.LoadEmbedded().Get("hold_position") != null, "embedded contract loads");
        Check(!table.Enabled("chase_person", "on", new Dictionary<string, bool> {{"chase_person", true}}, new[] {"chase_person"}, new string[0], null, null), "never capability stays disabled");
        Check(!table.Enabled("perform_activity", "on", new Dictionary<string, bool> {{"perform_activity", true}}, new[] {"perform_activity"}, new[] {"W1"}, null, null), "vestigial capability stays disabled");
        Check(!table.Enabled("attack", "on", new Dictionary<string, bool> {{"attack", true}}, new[] {"attack"}, new string[0], null, null), "excluded family stays disabled");
        Check(!table.Enabled("hold_position", "shadow", new Dictionary<string, bool> {{"hold_position", true}}, new[] {"hold_position"}, new[] {"Q1", "FR1"}, "player_ux", "player_direct"), "shadow cannot enable execution");
        Check(table.Enabled("hold_position", "on", new Dictionary<string, bool> {{"hold_position", true}}, new[] {"hold_position"}, new[] {"Q1", "FR1"}, "player_ux", "player_direct"), "hold can be enabled only with its probes");
        Check(table.NamesFor("follow_person").SequenceEqual(new[] {"followtarget", "FollowTarget"}) && table.NamesFor("hold_position").SequenceEqual(new[] {"waithere", "WaitHere"}), "canonical and executor names");
        var broken = (byte[])bytes.Clone(); broken[broken.Length - 3] ^= 1; try { CapabilityTable.Parse(broken); Check(false, "tampered contract accepted"); } catch (InvalidDataException) { Check(true, "tampered contract rejected"); }
        var machine = NewMachine(table);
        var actor = Id('a'); var incarnation = Id('b'); var other = Id('c');
        var follow = machine.ObserveCommand(actor, incarnation, true, "follow", 10);
        Check(follow.History.SequenceEqual(new[] {"REQUESTED", "VALIDATED", "DISPATCHED"}) && follow.State == "DISPATCHED" && machine.ActiveCount == 1, "shadow follow opens one pending receipt");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "FollowTarget", Phase = "before", GameMs = 11 }, false);
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "FollowTarget", Phase = "after", GameMs = 11 }, false);
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "FollowTarget", Phase = "executed", GameMs = 11 }, false);
        Check(follow.State == "DISPATCHED", "ACT shadow after modifier and unknown executed outcome never assert handler acceptance");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "followtarget", Phase = "executed", Succeeded = true, GameMs = 12 }, false);
        Check(follow.State == "HANDLER_ACCEPTED" && follow.History.Contains("HANDLER_ACCEPTED") && !machine.HasPhysicalCompletion, "canonical callback accepts without physical completion");
        var wait = machine.ObserveCommand(actor, incarnation, true, "wait", 20);
        Check(follow.State == "SUPERSEDED" && follow.Reason == "superseded_player" && follow.Terminal && wait.State == "DISPATCHED" && machine.ActiveCount == 1, "player wait supersedes follow and keeps one pending");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = other, Name = "waithere", Phase = "executed", Succeeded = true, GameMs = 21 }, false);
        Check(wait.State == "DISPATCHED" && machine.StaleReceipts == 1, "stale incarnation cannot accept");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "waithere", Phase = "executed", Succeeded = false, GameMs = 22 }, false);
        Check(wait.State == "FAILED" && wait.Reason == "handler_false", "handler false fails the receipt");
        var again = machine.ObserveCommand(actor, incarnation, true, "follow", 30);
        machine.ObserveReflex(actor, incarnation, false, 1, 31);
        machine.ObserveReflex(actor, incarnation, true, 2, 32);
        Check(again.State == "SUPERSEDED" && again.Reason == "superseded_reflex", "reflex rise supersedes without a modifier callback");
        var pending = machine.ObserveCommand(actor, incarnation, true, "follow", 40);
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "attacktarget", Phase = "executed", Succeeded = true, GameMs = 41 }, false);
        Check(pending.State == "SUPERSEDED" && pending.Reason == "superseded_essential" && machine.ActiveCount == 0, "foreign model action supersedes and is not dispatched by ACT");
        var dismissed = machine.ObserveCommand(actor, incarnation, true, "follow", 50);
        machine.ObserveCommand(actor, incarnation, true, "dismiss", 51);
        Check(dismissed.State == "SUPERSEDED" && machine.ActiveFor(actor) == null, "dismiss is supersession, not a new activity");
        var stale = machine.ObserveCommand(actor, incarnation, false, "follow", 60);
        Check(stale.State == "REJECTED" && stale.Reason == "epoch_changed" && machine.ActiveCount == 0, "stale epoch is rejected");
        var timed = machine.ObserveCommand(actor, incarnation, true, "wait", 0xfffffff0);
        machine.Tick(0x10, 0);
        Check(timed.State == "DISPATCHED", "wrap-safe short elapsed does not time out");
        machine.Tick(unchecked((uint)(0xfffffff0 + 2000)), 0);
        Check(timed.State == "TIMED_OUT" && timed.Reason == "accept_timeout", "wrap-safe accept deadline fires");
        machine.ClientHello(Id('d'), 1000, 5000);
        var leased = machine.ObserveCommand(actor, incarnation, true, "follow", 70);
        machine.Tick(71, 1000 + 5001);
        Check(leased.State == "DETACHED" && leased.Reason == "lease_lost" && machine.LeaseExpiries == 1 && !machine.Accepting, "lease TTL detaches and refuses new work");
        Check(machine.ObserveCommand(actor, incarnation, true, "follow", 72).Reason == "lease_lost", "expired lease rejects a new command");
        machine.ClientHello(Id('e'), 2000, 5000);
        var restarted = machine.ObserveCommand(actor, incarnation, true, "wait", 80);
        machine.ClientHello(Id('f'), 2100, 5000);
        Check(restarted.State == "DETACHED" && restarted.Terminal, "companion restart does not resume the old execution");
        machine.ClockReset();
        var after = machine.ObserveCommand(actor, incarnation, true, "follow", 5);
        machine.ClockReset();
        Check(after.Reason == "clock_reset" && after.State == "DETACHED", "clock reset detaches");
        machine.ObserveControlLost(after.ActorKey, after.IncarnationId, 6);
        var held = machine.ObserveCommand(actor, incarnation, true, "follow", 90);
        machine.ObserveControlLost(actor, incarnation, 91);
        Check(held.State == "DETACHED" && held.Reason == "control_released", "control loss detaches");
        var ring = new SupersessionMonitor();
        for (var n = 0; n < 64; n++) Check(ring.Push(new CallbackRecord { Name = "waithere" }), "ring accepts bounded callbacks");
        Check(!ring.Push(new CallbackRecord { Name = "followtarget" }) && ring.Dropped == 1 && ring.Overflowing, "ring overflow is counted");
        Check(ring.CaptureSequence==65,"C05 capture fence includes dropped callback attempt");
        var earlier=ring.Drain();Check(earlier.CaptureSequence==1 && earlier.CaptureSequence<=ring.CaptureSequence,"C05 pre-annotation callback retains earlier sequence");
        ring.ClearForWorldReset();Check(ring.Count==0 && !ring.Overflowing && ring.CaptureSequence==65,"C05 world reset discards pending callbacks without resetting source fence");
        Check(ring.Push(new CallbackRecord {Name="waithere"}) && ring.Drain().CaptureSequence==66,"C05 fresh-world callback retains distinct monotonic source sequence");
        var stampRing=new SupersessionMonitor();var body=new object();var reused=new CallbackRecord{PedReference=body,Name="waithere",Phase="executed",Succeeded=true,GameMs=uint.MaxValue};
        Check(stampRing.Push(reused),"C05 first source capture");var fence=stampRing.CaptureSequence;
        reused.Name="followtarget";reused.GameMs=0;Check(stampRing.Push(reused),"C05 second source capture across tick wrap");
        var capturedBefore=stampRing.Drain();var capturedAfter=stampRing.Drain();
        Check(capturedBefore.Name=="waithere" && capturedBefore.GameMs==uint.MaxValue && capturedBefore.CaptureSequence==fence && ReferenceEquals(capturedBefore.PedReference,body),"C05 ring snapshots source fields without resolving body");
        Check(capturedAfter.Name=="followtarget" && capturedAfter.GameMs==0 && capturedAfter.CaptureSequence>fence,"C05 source sequence disambiguates tick wrap");
        Check(stampRing.CaptureSequence==2 && stampRing.Count==0,"C05 drain does not reset capture ordering");
        Check(!stampRing.Push(null) && stampRing.CaptureSequence==2,"C05 null capture does not advance ordering");
        var session = new ActivitySession(table);
        int publications=0,publicationResets=0;
        var passive=new ActivitySession(table,null,Id('4'),()=>1,frame=>{publications++;return true;},()=>publicationResets++);
        var passiveHello=Decode(annotationJson,passive.ServerHello());
        Check(ActivityContracts.HelloNative(passiveHello,CapabilityTable.ContractSha256) && (int)passiveHello["dialogueActionVersion"]==1,"C05 opt-in hello advertises passive extension");
        passive.OpenTransport();Check(publicationResets==1,"C05 opening transport resets passive pending state");
        var passiveClient=new Dictionary<string,object>{{"version",1},{"type","hello"},{"contractSha256",CapabilityTable.ContractSha256},{"clientRun",Id('9')},{"hostContextVersion",1},{"hostRunId",Id('4')},{"worldEpoch",1},{"dialogueActionVersion",1}};
        Check(passive.AcceptClient(annotationJson.Serialize(passiveClient)),"C05 extension negotiated");
        ((Dictionary<string,object>)annotation["tuple"])["sessionNonce"]=1;
        Check(passive.AcceptClient(annotationJson.Serialize(annotation)) && publications==1 && passive.Machine.ActiveCount==0 && passive.Runner==null,"C05 shadow annotation has no execution effect");
        Check(passive.AcceptClient(annotationJson.Serialize(new{version=1,type="lease",sequence=2,leaseTtlMs=5000})),"C05 annotation shares client sequence with heartbeat");
        annotation["sequence"]=3;((Dictionary<string,object>)((Dictionary<string,object>)annotation["binding"])["hostContext"])["worldEpoch"]=2;
        Check(!passive.AcceptClient(annotationJson.Serialize(annotation)) && passive.Closed && publications==1,"C05 wrong epoch never reaches observer");
        passive.OpenTransport();passiveClient.Remove("dialogueActionVersion");
        Check(passive.AcceptClient(annotationJson.Serialize(passiveClient)),"C05 legacy handshake remains compatible");
        annotation["sequence"]=1;((Dictionary<string,object>)((Dictionary<string,object>)annotation["binding"])["hostContext"])["worldEpoch"]=1;
        Check(!passive.AcceptClient(annotationJson.Serialize(annotation)) && publications==1,"C05 legacy handshake cannot annotate");
        var correlator=new DialogueActionCorrelator(Id('4'),1);var receiptBody=new object();
        var capturedAnnotation=Decode(annotationJson,annotationJson.Serialize(annotation));
        Check(correlator.Accept(capturedAnnotation,receiptBody,10,uint.MaxValue-2,100),"C05 exact native pending publication");
        ((Dictionary<string,object>)capturedAnnotation["tuple"])["turnId"]="changed_after_capture";
        var callback=new CallbackRecord{PedReference=receiptBody,Name="followtarget",Phase="executed",Source="essential",Succeeded=true,GameMs=0,CaptureSequence=10};
        Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false)==null && correlator.Count==1,"C05 queued pre-annotation callback cannot join");
        callback.CaptureSequence=11;callback.PedReference=new object();Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false)==null,"C05 replacement body cannot join");callback.PedReference=receiptBody;
        Check(correlator.Match(callback,Id('6'),Id('2'),Id('5'),Id('4'),1,0,101,false)==null,"C05 wrong incarnation cannot join");
        Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),2,0,101,false)==null,"C05 wrong world cannot join");
        callback.Phase="after";Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false)==null,"C05 modifier phase is not handler evidence");callback.Phase="executed";
        Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false)==null,"C05 handler without post-annotation before phase cannot join");
        callback.Phase="before";callback.Succeeded=null;Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false)==null && correlator.Count==1,"C05 post-annotation modifier before arms only exact pending action");
        callback.Phase="executed";callback.Succeeded=true;callback.CaptureSequence=12;
        var matched=correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false);
        Check(matched!=null && (bool)matched["succeeded"] && (string)((Dictionary<string,object>)matched["tuple"])["turnId"]=="turn" && (long)matched["atGameTick"]==0,"C05 immutable exact annotation joins across unsigned tick wrap");
        passive.OpenTransport();passiveClient["dialogueActionVersion"]=1;Check(passive.AcceptClient(annotationJson.Serialize(passiveClient)),"C05 response session negotiation");
        Check(passive.PublishDialogueReceipt(matched),"C05 correlated receipt published on existing channel");var response=Decode(annotationJson,passive.TakeOutbound());
        Check(ActivityContracts.DialogueActionReceipt(response,1) && (string)response["nativeRun"]==passive.NativeRun && (string)response["adapterEpoch"]==passive.AdapterEpoch,"C05 response binds exact channel epochs");
        response["physicalCompletion"]=true;Check(!ActivityContracts.DialogueActionReceipt(response,1),"C05 response cannot invent physical completion");response.Remove("physicalCompletion");
        response["atGameTick"]=4294967296L;Check(!ActivityContracts.DialogueActionReceipt(response,1),"C05 response game tick is unsigned 32-bit");
        matched["succeeded"]=false;Check(passive.PublishDialogueReceipt(matched) && !(bool)Decode(annotationJson,passive.TakeOutbound())["succeeded"],"C05 failed handler response remains failure");
        Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,101,false)==null,"C05 duplicate callback cannot emit twice");
        Check(correlator.Accept(annotation,receiptBody,10,0,200),"C05 second native publication");
        var overlapping=Decode(annotationJson,annotationJson.Serialize(annotation));overlapping["publicationId"]=Id('5');
        Check(!correlator.Accept(overlapping,receiptBody,10,0,201) && correlator.Count==0,"C05 overlapping action invalidates native join");
        Check(!correlator.Accept(annotation,receiptBody,10,0,202),"C05 ambiguous window remains quarantined");
        correlator.Reset();Check(correlator.Accept(annotation,receiptBody,10,0,300),"C05 reset permits fresh capture");
        Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,301,true)==null && correlator.Count==0,"C05 overflow invalidates native joins");
        correlator.Reset();Check(correlator.Accept(annotation,receiptBody,10,0,400),"C05 capture before retirement");correlator.Retire(Id('2'),Id('3'));Check(correlator.Count==0,"C05 retirement removes exact native pending");
        Check(correlator.Accept(annotation,receiptBody,10,0,500),"C05 capture before expiry");Check(correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,5001,5501,false)==null && correlator.Count==0,"C05 expired callback cannot establish evidence");
        correlator.Reset();Check(correlator.Accept(annotation,receiptBody,10,0,600),"C05 capture before conflicting modifier sequence");callback.Phase="before";callback.CaptureSequence=11;callback.Succeeded=null;
        correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,601,false);callback.CaptureSequence=12;correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,602,false);
        Check(correlator.Count==0,"C05 multiple before callbacks invalidate ambiguous join");
        correlator.Reset();Check(correlator.Accept(annotation,receiptBody,10,0,700),"C05 capture before handler failure");callback.CaptureSequence=11;correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,701,false);callback.Phase="executed";callback.Succeeded=false;callback.CaptureSequence=12;
        Check((bool)correlator.Match(callback,Id('6'),Id('2'),Id('3'),Id('4'),1,0,702,false)["succeeded"]==false,"C05 failed handler remains failure");
        correlator.Reset();
        for(int pendingIndex=0;pendingIndex<33;pendingIndex++){
            var bounded=Decode(annotationJson,annotationJson.Serialize(annotation));bounded["publicationId"]=Guid.NewGuid().ToString("D");((Dictionary<string,object>)bounded["binding"])["encounterId"]=Guid.NewGuid().ToString("D");
            Check(correlator.Accept(bounded,receiptBody,10,0,800)==(pendingIndex<32),"C05 native pending capacity remains bounded");
        }
        Check(correlator.Count==32,"C05 native pending cap is 32");correlator.Reset();Check(correlator.Count==0,"C05 reset releases all pending body references");
        var ordinaryAnnotation=Decode(annotationJson,annotationJson.Serialize(annotation));var ordinaryBinding=(Dictionary<string,object>)ordinaryAnnotation["binding"];ordinaryBinding.Remove("encounterId");ordinaryBinding.Remove("incarnationId");
        Check(ActivityContracts.DialogueActionAnnotation(ordinaryAnnotation,1),"C05 ordinary annotation uses only exact C02 capture and host scope");
        ordinaryBinding["encounterId"]=Id('2');Check(!ActivityContracts.DialogueActionAnnotation(ordinaryAnnotation,1),"C05 partial ownership pair rejected");ordinaryBinding.Remove("encounterId");
        Check(correlator.Accept(ordinaryAnnotation,receiptBody,10,0,900),"C05 ordinary actor accepted without P2 ownership");callback.Phase="before";callback.Succeeded=null;callback.CaptureSequence=11;
        Check(correlator.Match(callback,Id('5'),null,null,Id('4'),1,0,901,false)==null,"C05 replaced ordinary capture cannot arm callback");
        correlator.Match(callback,Id('6'),null,null,Id('4'),1,0,901,false);callback.Phase="executed";callback.Succeeded=true;callback.CaptureSequence=12;
        var ordinaryResult=correlator.Match(callback,Id('6'),null,null,Id('4'),1,0,902,false);
        Check(ordinaryResult!=null && !((Dictionary<string,object>)ordinaryResult["binding"]).ContainsKey("encounterId"),"C05 ordinary receipt does not invent encounter identity");
        Check(correlator.Accept(ordinaryAnnotation,receiptBody,10,0,1000),"C05 ordinary pending before anchor retirement");correlator.RetireCapture(Id('6'));Check(correlator.Count==0,"C05 exact anchor retirement clears ordinary pending");
        var lifetimeCorrelator=new DialogueActionCorrelator(Id('4'),1);
        var lifecycleSession=new ActivitySession(table,null,Id('4'),()=>1,frame=>lifetimeCorrelator.Accept(frame,receiptBody,0,0,100),lifetimeCorrelator.Reset);
        lifecycleSession.OpenTransport();Check(lifecycleSession.AcceptClient(annotationJson.Serialize(passiveClient)),"C05 lifecycle session negotiation");
        Check(lifecycleSession.AcceptClient(annotationJson.Serialize(annotation)) && lifetimeCorrelator.Count==1,"C05 lifecycle session retains pending body");
        lifecycleSession.Close("lease_lost");Check(lifetimeCorrelator.Count==0,"C05 channel close releases pending body");
        lifecycleSession.OpenTransport();Check(lifecycleSession.AcceptClient(annotationJson.Serialize(passiveClient)),"C05 reconnect negotiates fresh state");
        Check(lifecycleSession.AcceptClient(annotationJson.Serialize(annotation)) && lifetimeCorrelator.Count==1,"C05 reconnect new publication");
        lifecycleSession.OpenTransport();Check(lifetimeCorrelator.Count==0,"C05 reopening transport invalidates old pending even without prior close");
        var faultedSession=new ActivitySession(table,null,Id('4'),()=>1,frame=>true,()=>{throw new InvalidOperationException("reset_fault");});
        faultedSession.OpenTransport();Check(!faultedSession.DialogueSupported && !Decode(annotationJson,faultedSession.ServerHello()).ContainsKey("dialogueActionVersion"),"C05 reset fault suspends only passive advertisement");
        var legacyClient=new Dictionary<string,object>(passiveClient);legacyClient.Remove("dialogueActionVersion");
        Check(faultedSession.AcceptClient(annotationJson.Serialize(legacyClient)),"C05 reset fault preserves legacy channel");
        Check(faultedSession.AcceptClient(annotationJson.Serialize(new{version=1,type="lease",sequence=1,leaseTtlMs=5000})),"C05 reset fault preserves ACT heartbeat authority");
        bool missingResetRejected=false;try{new ActivitySession(table,null,Id('4'),()=>1,frame=>true);}catch(ArgumentException){missingResetRejected=true;}Check(missingResetRejected,"C05 observer requires explicit reset lifecycle");
        var hello = session.ServerHello();
        var parsed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(hello);
        Check(ActivityContracts.HelloNative(parsed, CapabilityTable.ContractSha256), "native hello is closed and pinned");
        var client = Id('9');
        session.OpenTransport();
        Check(session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = client })), "client hello");
        Check(session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "lease", sequence = 1, leaseTtlMs = 5000 })), "lease");
        session.PublishDiagnosticsIfChanged(7, 2, 1000, true);
        var diagnostics = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(session.TakeOutbound());
        Check(ActivityContracts.Diagnostics(diagnostics) && Convert.ToInt32(diagnostics["callbackDropped"]) == 7 && Convert.ToInt32(diagnostics["breakerTrips"]) == 2, "diagnostics frame uses live callback and breaker counters");

        var observed = session.Machine.ObserveCommand(actor, incarnation, true, "follow", 100);
        session.Machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "followtarget", Phase = "executed", Succeeded = true, GameMs = 101 }, false);
        session.PublishDiagnosticsIfChanged(7, 2, 1300);
        var changed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(session.TakeOutbound());
        Check(Convert.ToInt32(changed["accepted"]) == 1, "receipt counter change publishes a later diagnostics frame");

        Check(!session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "lease", sequence = 3, leaseTtlMs = 5000 })) && session.SequenceGaps == 1 && session.Closed && observed.State == "DETACHED", "sequence gap closes only the transport and detaches old work");
        session.OpenTransport();
        Check(!session.Closed && session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = Id('8') })), "fresh transport reconnects after a sequence failure");
        Check(session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "lease", sequence = 1, leaseTtlMs = 5000 })), "reconnect resets client sequence");

        var fresh = new ActivitySession(table);
        fresh.OpenTransport();
        fresh.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = client }));
        var begun = fresh.Machine.ObserveCommand(actor, incarnation, true, "follow", 1);
        Check(!fresh.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "step.begin", sequence = 1, requestId = Id('1') })) && begun.State == "DETACHED", "ACT1 rejects step.begin and does not keep the execution");
        fresh.OpenTransport();
        Check(fresh.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = Id('7') })), "rejected execution frame does not poison future reconnect");
        Check(!fresh.Machine.HasPhysicalCompletion, "no physical completion was claimed");
        var root = Path.GetDirectoryName(Path.GetDirectoryName(ContractPath()));
        var sources = string.Join("\n", new[] {"ActivityContracts.cs","CapabilityTable.cs","ActivityChannel.cs","StepMachine.cs","SupersessionMonitor.cs"}.Select(name => File.ReadAllText(Path.Combine(root, "native", "activities", name))));
        sources += File.ReadAllText(Path.Combine(root, "native", "promoted-characters", "ActivityCommands.cs"));
        foreach (var forbidden in new[] {"QueueNpcAction", "NpcActions.", "TASK_", "CLEAR_PED", "CancelAll", "SetControlledBrain", "ReleaseExclusiveControl"}) Check(!sources.Contains(forbidden), "shadow sources do not " + forbidden);
        Act2(table);
    }
    static void Act2(CapabilityTable table)
    {
        var json = new JavaScriptSerializer();
        var world = new FakeWorld();
        var runner = new StepRunner(table); runner.Bind(world);
        var session = new ActivitySession(table, runner); runner.Session = session;
        var hello = Decode(json,session.ServerHello());
        var caps = hello["capabilities"] as Dictionary<string, object>;
        Check((bool)caps["hold_position"] && (bool)caps["follow_person"] && (bool)caps["resume_ambient"] && (bool)caps["sit_on_ground"] && !(bool)caps["walk_to"], "execute hello advertises only ACT2");
        session.OpenTransport();
        var client = Id('a');
        Check(session.AcceptClient(json.Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = client })), "ACT2 hello");
        var sequence = 1;
        string Send(object frame) { while (session.TakeOutbound() != null) { } var text = json.Serialize(frame); Check(session.AcceptClient(text), "frame accepted: " + text); return session.TakeOutbound(); }
        Dictionary<string,object> Args(string capability,string reference = null)
        {
            if (capability == "hold_position") return new Dictionary<string,object> {{"place",new Dictionary<string,object>{{"kind","place"},{"placeRef",reference}}}};
            if (capability == "follow_person") return new Dictionary<string,object> {{"target",new Dictionary<string,object>{{"kind","player"},{"captureRef",reference}}}};
            return new Dictionary<string,object>();
        }
        Dictionary<string,object> Completion(string capability)
        {
            var adapter = capability == "hold_position" ? "hold_mode" : capability == "follow_person" ? "follow_mode" : capability == "sit_on_ground" ? "pose_mode" : "resume_ambient";
            return new Dictionary<string,object> {{"adapter",adapter},{"until",capability == "resume_ambient" ? null : (object)new Dictionary<string,object>{{"kind","player_command"}}}};
        }
        Dictionary<string,object> Begin(int seq,string request,string execution,string capability,int epoch,string reference = null)
        {
            return new Dictionary<string,object> {
                {"version",1},{"type","step.begin"},{"sequence",seq},{"requestId",request},{"executionId",execution},{"activityId",Id('3')},{"stepId",Id('4')},{"attempt",1},
                {"encounterId",world.Encounter},{"leaseId",Id('e')},{"leaseEpoch",epoch},{"capability",capability},{"args",Args(capability,reference)},
                {"timeouts",new Dictionary<string,object>{{"acceptMs",2000},{"establishMs",5000},{"completeMs",capability == "resume_ambient" ? (object)45000 : null},{"holdMaxMs",capability == "resume_ambient" ? null : (object)1800000}}},
                {"completion",Completion(capability)},{"violated",new object[0]},{"onLeaseLoss","cancel_if_current"}
            };
        }

        Send(new { version = 1, type = "lease", sequence = sequence++, leaseTtlMs = 5000 });
        var acquired = Decode(json,Send(new { version = 1, type = "actor.acquire", sequence = sequence++, requestId = Id('b'), characterId = Id('c'), ownerAlias = "promoted." + Id('c'), ownershipToken = Id('d'), leaseId = Id('e') }));
        Check(acquired["type"] as string == "actor.acquired", "actor acquired");

        var anchorReply = Decode(json,Send(new {
            version = 1,type = "anchor.resolve",sequence = sequence++,requestId = Id('f'),encounterId = world.Encounter,leaseId = Id('e'),
            refs = new object[]{new Dictionary<string,object>{{"role","place"},{"slot",new Dictionary<string,object>{{"kind","place"},{"place",new Dictionary<string,object>{{"kind","here"}}}}}}}
        }));
        var anchorRows = anchorReply["results"] as object[];
        var anchor = ((Dictionary<string,object>)anchorRows[0])["ref"] as string;
        Check(ActivityContracts.IsUuid(anchor) && runner.Places.Count == 1, "here anchor captures a bounded place");

        world.Already = true;
        var preflight = Decode(json,Send(new {
            version = 1,type = "step.preflight",sequence = sequence++,requestId = Id('1'),encounterId = world.Encounter,leaseId = Id('e'),capability = "hold_position",
            args = Args("hold_position",anchor),preconditions = new object[]{"actor_owned"}
        }));
        Check((bool)preflight["alreadySatisfied"], "already satisfied without dispatch");
        Check(!world.Dispatched, "already satisfied does not dispatch");

        world.Already = false;
        var first = Id('2');
        Send(Begin(sequence++,Id('5'),first,"hold_position",1,anchor));
        Check(world.Dispatched && world.LastCapability == "hold_position" && runner.Active(world.Encounter).State == "DISPATCHED", "hold dispatches through the queue seam");
        Check(world.OwnershipSeenAtDispatch, "ownership is established before queue publication");
        runner.OnCallback(world.Encounter, world.Incarnation, "waithere", "after", null, 1090, 1900);
        runner.OnCallback(world.Encounter, world.Incarnation, "waithere", "executed", null, 1095, 1950);
        Check(runner.Active(world.Encounter).State == "DISPATCHED", "ACT production runner does not infer handler success from modifier or unknown execution");
        runner.OnCallback(world.Encounter, world.Incarnation, "waithere", "executed", true, 1100, 2000);
        Check(runner.Active(world.Encounter).State == "HANDLER_ACCEPTED", "handler acceptance is not completion");
        world.SampleState.FollowPaused = true; world.Now = 1200;
        runner.Tick(1200, 2500);
        Check(runner.Active(world.Encounter).State == "MODE_ESTABLISHED" && !runner.HasPhysicalCompletion, "hold mode is established without physical completion");
        Send(new { version = 1, type = "step.cancel", sequence = sequence++, requestId = Id('6'), executionId = first, mode = "detach" });
        Check(runner.Active(world.Encounter) == null, "pause detaches the execution");

        world.Dispatched = false;
        var second = Id('7');
        Send(Begin(sequence++,Id('8'),second,"hold_position",1,anchor));
        Check(second != first && runner.Active(world.Encounter).ExecutionId == second, "resume uses a new execution id");
        runner.Preempt(world.Encounter, world.Incarnation, "follow", 1300, 3000, session);
        Check(runner.Active(world.Encounter) == null, "P2 follow supersedes ACT");

        world.Same = false; world.Dispatched = false;
        var stale = Send(Begin(sequence++,Id('9'),Id('a'),"sit_on_ground",2));
        Check(stale != null && stale.Contains("epoch_changed") && !world.Dispatched, "stale incarnation is not tasked");
        world.Same = true;

        var targetReply = Decode(json,Send(new {
            version = 1,type = "anchor.resolve",sequence = sequence++,requestId = Id('b'),encounterId = world.Encounter,leaseId = Id('e'),
            refs = new object[]{new Dictionary<string,object>{{"role","target"},{"slot",new Dictionary<string,object>{{"kind","player"}}}}}
        }));
        var target = ((Dictionary<string,object>)((object[])targetReply["results"])[0])["ref"] as string;
        Send(Begin(sequence++,Id('c'),Id('d'),"follow_person",2,target));
        world.SampleState.TargetValid = false;
        runner.OnCallback(world.Encounter, world.Incarnation, "followtarget", "executed", false, 1400, 4000);
        Check(runner.Active(world.Encounter) == null, "handler false fails closed");

        world.SampleState.TargetValid = true; world.Dispatched = false;
        Send(Begin(sequence++,Id('e'),Id('f'),"resume_ambient",2));
        runner.OnCallback(world.Encounter, world.Incarnation, "resumeactivity", "executed", true, 1500, 5000);
        world.SampleState.ContinuityReached = true; world.SampleState.Wandering = false; world.Now = 1600;
        runner.Tick(1600, 5500);
        Check(runner.HasPhysicalCompletion, "resume completion requires strong continuity evidence");

        world.SampleState.ContinuityReached = false; world.SampleState.FollowPaused = false; world.Stopped = false; world.Dispatched = false;
        world.SampleState.X = 7; world.SampleState.Y = 0; world.SampleState.Z = 0;
        var displaced = Decode(json,Send(new {
            version = 1,type = "step.preflight",sequence = sequence++,requestId = Id('5'),encounterId = world.Encounter,leaseId = Id('e'),capability = "hold_position",
            args = Args("hold_position",anchor),preconditions = new object[]{"actor_owned"}
        }));
        Check(displaced["reason"] as string == "target_out_of_range", "hold_position remains tied to its captured here anchor");
        world.SampleState.X = 0;

        Send(Begin(sequence++,Id('1'),Id('2'),"hold_position",2,anchor));
        runner.Lease(1000,5000);
        runner.Tick(1700,7001);
        Check(runner.ActiveCount == 0 && world.Stopped && runner.LeaseExpiries == 1, "lease expiry cancels the current ACT-owned behavior");
        var noLease = Send(new { version = 1,type = "actor.acquire",sequence = sequence++,requestId = Id('3'),characterId = Id('c'),ownerAlias = "promoted." + Id('c'),ownershipToken = Id('d'),leaseId = Id('4') });
        Check(noLease != null && noLease.Contains("lease_lost"), "lease expiry refuses new work");
        runner.Lease(8000,5000);
        var stillNoLease = Send(new { version = 1,type = "actor.acquire",sequence = sequence++,requestId = Id('4'),characterId = Id('c'),ownerAlias = "promoted." + Id('c'),ownershipToken = Id('d'),leaseId = Id('5') });
        Check(stillNoLease != null && stillNoLease.Contains("lease_lost"), "late heartbeat cannot revive an expired runner without a fresh hello");

        runner.ClockReset(session);
        Check(runner.ActiveCount == 0, "clock reset drops executions");

        var malformed = new Dictionary<string,object> {
            {"version",1},{"type","actor.release"},{"sequence",sequence++},{"requestId",Id('6')},{"encounterId",world.Encounter},{"leaseId",Id('e')},{"extra",true}
        };
        Check(!session.AcceptClient(json.Serialize(malformed)) && session.Closed, "native ACT2 schema rejects extra execution fields");

        var dispatchRoot = Path.GetDirectoryName(Path.GetDirectoryName(ContractPath()));
        var dispatch = File.ReadAllText(Path.Combine(dispatchRoot, "native", "promoted-characters", "ActivityDispatch.cs"));
        foreach (var forbidden in new[] { "TASK_", "CLEAR_PED", "CancelAll", "ReleaseExclusiveControl", "SetControlledBrain" }) Check(!dispatch.Contains(forbidden), "dispatch does not " + forbidden);
    }
    static StepMachine NewMachine(CapabilityTable table) => new StepMachine(table.NamesFor, id => table.Get(id)?.AcceptMs ?? 2000, id => table.Get(id)?.HoldMaxMs ?? 0, id => table.Get(id)?.Mode == true);
}
sealed class FakeWorld : IActivityWorld
{
    public string Encounter = "22222222-2222-4222-8222-222222222222", Incarnation = "33333333-3333-4333-8333-333333333333";
    public ModeSample SampleState = new ModeSample { Alive = true, DistanceBand = "near", TargetValid = true, TargetSame = true };
    public bool Already, Dispatched, Same = true, Stopped, OwnershipSeenAtDispatch;
    public int Epoch = 1, Began, Ended;
    public string LastCapability;
    public uint Now = 1000;
    public uint GameTime => Now;
    public bool TryAcquire(string ownerAlias, string ownershipToken, out string encounterId, out string incarnationId, out string reason)
    { encounterId = Encounter; incarnationId = Incarnation; reason = null; return true; }
    public bool SameIncarnation(string encounterId, string incarnationId) => Same && encounterId == Encounter && incarnationId == Incarnation;
    public AnchorResult Resolve(string encounterId, string role, string slotKind) => new AnchorResult { Ok = true, Ref = slotKind == "player" ? "55555555-5555-4555-8555-555555555555" : "44444444-4444-4444-8444-444444444444", Band = "at", SlotKind = slotKind, Label = slotKind == "here" ? "here" : null, X = SampleState.X, Y = SampleState.Y, Z = SampleState.Z };
    public PreflightResult Preflight(string encounterId, string capability) => Already ? new PreflightResult { Already = true } : new PreflightResult { Ok = true };
    public bool Dispatch(string encounterId, string capability, string targetRef) { Dispatched = true; LastCapability = capability; OwnershipSeenAtDispatch = Began > Ended; return true; }
    public void NoteForeign(string encounterId) { }
    public void Cancel(string encounterId, string capability, bool stopIfCurrent) { if (stopIfCurrent) Stopped = true; }
    public ModeSample Sample(string encounterId) => SampleState;
    public void BeginOwnership(string encounterId) { Began++; }
    public void EndOwnership(string encounterId, bool preempted) { Ended++; }
    public bool AnchorLive(string captureRef) => true;
}
