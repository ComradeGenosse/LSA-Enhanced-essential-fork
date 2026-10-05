extern alias bridge;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.PromotedCharacters;
using Driver = bridge::LSA.BridgeTests.Driver;

// UX phase 1 command bridge, offline. Part one tests LocalCommandQueue directly.
// Part two runs the real DomainHost against the production runtime sources
// (RuntimeEntry, PromotedCharactersIntegration, NativeCommands, LocalCommandQueue)
// linked to game substitutes in a separate "Essential" AppDomain that has loaded,
// but never executes, the pinned LosSantosAlive.dll. Part three drives the real
// console frontend (PlayerCommands) through that bridge and its loopback handshake.
static class Program
{
    static int count;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object Current = new Dictionary<string,object> {{"kind","current"}};
    static readonly object None = new Dictionary<string,object> {{"kind","none"}};
    static readonly object Empty = new Dictionary<string,object>();
    static void Check(bool condition,string label) { count++; if (!condition) throw new Exception("UX bridge assertion " + count + " failed: " + label); }
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static string Id() => Guid.NewGuid().ToString("D");
    static string Envelope(string id,string command,object target,object args,long issued,long expires,string source = "console",object version = null) =>
        Json.Serialize(new Dictionary<string,object> {{"v",version ?? 1},{"id",id},{"command",command},{"target",target},{"args",args},{"source",source},{"issuedAtUtc",issued},{"expiresAtUtc",expires}});
    static string Inspect(string id,long now) => Envelope(id,"current.inspect",Current,Empty,now,now + 4000);
    static string GatesRead(string id,long now) => Envelope(id,"gates.read",None,Empty,now,now + 4000);
    static object Expect(string encounterId) => new Dictionary<string,object> {{"kind","current"},{"expect",new Dictionary<string,object> {{"encounterId",encounterId}}}};
    static string Ask(string id,string encounterId,string phrase,long now) => Envelope(id,"npc.ask",Expect(encounterId),new Dictionary<string,object> {{"phrase",phrase}},now,now + 4000);
    static Dictionary<string,object> Parse(string text) => text == null ? null : Json.DeserializeObject(text) as Dictionary<string,object>;
    static Dictionary<string,object> Result(Dictionary<string,object> reply) => reply?["result"] as Dictionary<string,object>;
    static string Reason(string text) { var reply = Parse(text); return reply == null ? "missing" : reply["status"] as string == "ok" ? "ok" : reply["reason"] as string; }
    static bool Uuid(object value) => value is string text && LocalCommandQueue.IsUuid(text);

    static int Main(string[] args)
    {
        string temp = Path.Combine(Path.GetTempPath(),"lsa-ux-bridge-" + Guid.NewGuid().ToString("N"));
        try {
            Directory.CreateDirectory(temp);
            QueueTests();
            SurfaceTests();
            CommandTests();
            EndpointTests(temp);
            EndToEnd(args.Length > 0 ? Path.GetFullPath(args[0]) : FindCore(),temp);
            HandshakeTests(temp);
            Console.WriteLine("UX phase 1 command bridge: " + count + " assertions passed; no game assemblies executed.");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { try { Directory.Delete(temp,true); } catch { } }
    }
    static string FindCore()
    {
        for (var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory); directory != null; directory = directory.Parent) {
            string candidate = Path.Combine(directory.FullName,"lsa-essential-e1-candidate","upstream","LosSantosAlive.dll");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("Pinned LosSantosAlive.dll not found; pass its path as the first argument.");
    }

    static void QueueTests()
    {
        long now = 1_800_000_000_000;
        var queue = new LocalCommandQueue();
        string first = Id();
        Check(queue.Submit(Inspect(first,now),now) == "accepted","valid current.inspect accepted");
        Check(queue.Submit(Inspect(first,now),now) == "duplicate_request","duplicate request id rejected");
        Check(queue.Submit(GatesRead(Id(),now),now) == "accepted","valid gates.read accepted");
        Check(queue.Submit(Ask(Id(),Id(),"Follow me.",now),now) == "accepted","valid npc.ask accepted");
        Check(queue.Submit(null,now) == "invalid_envelope","null envelope rejected");
        Check(queue.Submit(new string(' ',LocalCommandQueue.MaxEnvelopeChars + 1),now) == "envelope_too_large","8 KiB envelope cap");
        Check(queue.Submit("{not json",now) == "invalid_envelope" && queue.Submit("[]",now) == "invalid_envelope" && queue.Submit("\"text\"",now) == "invalid_envelope","malformed JSON rejected");
        var extra = Parse(Inspect(Id(),now)); extra["extra"] = 1;
        Check(queue.Submit(Json.Serialize(extra),now) == "invalid_envelope","unknown envelope field rejected");
        var missing = Parse(Inspect(Id(),now)); missing.Remove("source");
        Check(queue.Submit(Json.Serialize(missing),now) == "invalid_envelope","missing envelope field rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now,now + 4000,version: 2),now) == "invalid_envelope","unknown version rejected");
        Check(queue.Submit(Envelope(Id().ToUpperInvariant(),"current.inspect",Current,Empty,now,now + 4000),now) == "invalid_envelope","non-canonical UUID rejected");
        Check(queue.Submit(Envelope("ped17","current.inspect",Current,Empty,now,now + 4000),now) == "invalid_envelope","non-UUID id rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now,now + 4000,source: "web"),now) == "invalid_envelope","unknown source rejected");
        Check(queue.Submit(Envelope(Id(),"current.follow",Current,Empty,now,now + 4000),now) == "unsupported_command","command allowlist");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now - 1000,now),now) == "native_stale","expired envelope rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now,now + 5001),now) == "native_stale","expiry beyond 5 s rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now - 2000,now + 4000),now) == "native_stale","lifetime beyond 5 s rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now + 3000,now + 2000),now) == "native_stale","issue after expiry rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,Empty,now + 1500,now + 4000),now) == "native_stale","future issue rejected");
        Check(queue.Submit(Inspect(Id(),now).Replace("\"issuedAtUtc\":" + now,"\"issuedAtUtc\":" + now + ".5"),now) == "invalid_envelope","fractional times rejected");
        Check(queue.Submit(Envelope(Id(),"current.inspect",None,Empty,now,now + 4000),now) == "invalid_target","inspect targets the current NPC");
        Check(queue.Submit(Envelope(Id(),"gates.read",Current,Empty,now,now + 4000),now) == "invalid_target","gates.read takes no target");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Expect(Id()),Empty,now,now + 4000),now) == "invalid_target","inspect takes no expectation");
        Check(queue.Submit(Envelope(Id(),"current.inspect",new Dictionary<string,object> {{"kind","character"}},Empty,now,now + 4000),now) == "invalid_target","character targets stay on the P2 pipe");
        Check(queue.Submit(Envelope(Id(),"current.inspect",Current,new Dictionary<string,object> {{"phrase","x"}},now,now + 4000),now) == "invalid_arguments","inspect takes no arguments");
        Check(queue.Submit(Envelope(Id(),"npc.ask",Current,new Dictionary<string,object> {{"phrase","Hi"}},now,now + 4000),now) == "invalid_target","ask requires the player's expectation");
        Check(queue.Submit(Envelope(Id(),"npc.ask",new Dictionary<string,object> {{"kind","current"},{"expect",new Dictionary<string,object> {{"encounterId","ped17"}}}},new Dictionary<string,object> {{"phrase","Hi"}},now,now + 4000),now) == "invalid_target","expectation must be an encounter UUID");
        Check(queue.Submit(Envelope(Id(),"npc.ask",new Dictionary<string,object> {{"kind","current"},{"expect",new Dictionary<string,object> {{"encounterId",Id()},{"ownerAlias",null}}}},new Dictionary<string,object> {{"phrase","Hi"}},now,now + 4000),now) == "invalid_target","expectation has exactly one field");
        Check(queue.Submit(Envelope(Id(),"npc.ask",Expect(Id()),Empty,now,now + 4000),now) == "invalid_arguments","ask requires a phrase");
        foreach (var phrase in new[] {""," \t ",new string('a',121),"line\nbreak","nul\0","\ud800x","x\udc00"})
            Check(queue.Submit(Ask(Id(),Id(),phrase,now),now) == "invalid_arguments","phrase rejected: " + phrase.Length);
        var unbounded = new LocalCommandQueue();
        foreach (var phrase in new[] {"Wait here.",new string('a',120),"Warte hier \U0001F44B","¿Puedes esperar aquí?"})
            Check(unbounded.Submit(Ask(Id(),Id(),phrase,now),now) == "accepted","phrase accepted: " + phrase.Length);

        var results = new LocalCommandQueue();
        string inspected = Id(),shortLived = Id(),gated = Id();
        Check(results.Submit(Inspect(inspected,now),now) == "accepted" && results.Submit(Envelope(shortLived,"current.inspect",Current,Empty,now,now + 500),now) == "accepted" && results.Submit(GatesRead(gated,now),now) == "accepted","three commands queued");
        Check(results.TryTakeResult(inspected,now) == null,"no result before execution");
        Check(results.TryTake(now,out var taken) && taken.Id == inspected && taken.Command == "current.inspect" && taken.Source == "console","first in, first out");
        results.Complete(taken,null,new {present = false},now);
        var reply = Parse(results.TryTakeResult(inspected,now));
        Check((int)reply["v"] == 1 && (string)reply["id"] == inspected && (string)reply["command"] == "current.inspect" && (string)reply["status"] == "ok" && reply["reason"] == null && Result(reply)["present"] is bool present && !present,"result envelope");
        Check(results.TryTakeResult(inspected,now) == null,"results are delivered once");
        Check(results.TryTake(now + 600,out var later) && later.Id == gated,"expired command skipped at execution time");
        Check(Reason(results.TryTakeResult(shortLived,now + 600)) == "native_stale","expired command completes as native_stale");
        results.Complete(later,"Not A Code",new {secret = "x"},now + 600);
        var failed = Parse(results.TryTakeResult(gated,now + 600));
        Check((string)failed["reason"] == "native_operation_failed" && failed["result"] == null,"failure reasons are bounded codes without payload");
        string big = Id(); results.Submit(Inspect(big,now + 600),now + 600); results.TryTake(now + 600,out var bigCommand);
        results.Complete(bigCommand,null,new {text = new string('x',LocalCommandQueue.MaxResultChars)},now + 600);
        Check(Reason(results.TryTakeResult(big,now + 600)) == "native_result_limit","16 KiB result cap");
        string retained = Id(); results.Submit(Inspect(retained,now + 600),now + 600); results.TryTake(now + 600,out var retainedCommand); results.Complete(retainedCommand,null,null,now + 600);
        Check(results.TryTakeResult(retained,now + 600 + LocalCommandQueue.ResultRetentionMs) == null,"results expire after 30 s");
        Check(results.TryTakeResult("not-a-uuid",now) == null && results.TryTakeResult(null,now) == null,"malformed result ids ignored");

        var retention = new LocalCommandQueue(); var ids = new List<string>();
        for (int index = 0; index < 70; index++) { string id = Id(); ids.Add(id); retention.Submit(Inspect(id,now),now); retention.TryTake(now,out var command); retention.Complete(command,null,null,now); }
        Check(retention.TryTakeResult(ids[0],now) == null && retention.TryTakeResult(ids[5],now) == null && retention.TryTakeResult(ids[6],now) != null && retention.TryTakeResult(ids[69],now) != null,"at most 64 results; oldest evicted first");

        var full = new LocalCommandQueue(); int admitted = 0;
        for (int index = 0; index < LocalCommandQueue.Capacity; index++) if (full.Submit(Inspect(Id(),now),now) == "accepted") admitted++;
        string overflow = Id();
        Check(admitted == 16 && full.Submit(Inspect(overflow,now),now) == "queue_full","capacity of 16 pending commands");
        full.TryTake(now,out _);
        Check(full.Submit(Inspect(overflow,now),now) == "accepted","a refused id can be retried once space frees");

        var lifecycle = new LocalCommandQueue(); string pending = Id(),afterReset = Id();
        lifecycle.Submit(Inspect(pending,now),now); lifecycle.CancelPending("native_stale",now);
        Check(lifecycle.PendingCount == 0 && Reason(lifecycle.TryTakeResult(pending,now)) == "native_stale","a reset completes pending commands as native_stale");
        Check(lifecycle.Submit(Inspect(afterReset,now),now) == "accepted","the queue stays usable after a reset");
        lifecycle.Close("native_unavailable",now);
        Check(Reason(lifecycle.TryTakeResult(afterReset,now)) == "native_unavailable" && lifecycle.Submit(Inspect(Id(),now),now) == "native_unavailable","a closed queue completes and refuses work");

        var shared = new LocalCommandQueue(); int accepted = 0,refused = 0,errors = 0;
        var envelopes = Enumerable.Range(0,64).Select(_ => Inspect(Id(),now)).ToArray();
        Parallel.For(0,envelopes.Length,index => {
            try { var answer = shared.Submit(envelopes[index],now); if (answer == "accepted") Interlocked.Increment(ref accepted); else if (answer == "queue_full") Interlocked.Increment(ref refused); }
            catch { Interlocked.Increment(ref errors); }
        });
        Check(accepted == 16 && refused == 48 && errors == 0,"parallel submissions respect capacity without errors");

        var talk = new LocalCommandQueue();
        object talkTarget = new Dictionary<string,object> {{"kind","talk"}};
        var limits = new Dictionary<string,object> {{"radiusMeters",15},{"retentionRadiusMeters",20},{"maxCandidates",8},{"cycleWindowMs",1500},{"selectionTimeoutMs",8000},{"indicator",true}};
        Check(talk.Submit(Envelope(Id(),"talk.select_first",talkTarget,limits,now,now + 4000,source: "talk_input"),now) == "accepted","talk.select_first accepted");
        Check(talk.Submit(Envelope(Id(),"talk.select_next",talkTarget,limits,now,now + 4000,source: "console"),now) == "invalid_envelope","talk commands require talk_input");
        Check(talk.Submit(Envelope(Id(),"talk.select_first",Current,limits,now,now + 4000,source: "talk_input"),now) == "invalid_target","talk commands target kind talk");
        var extraLimit = new Dictionary<string,object>(limits) {{"phrase","Hi"}};
        Check(talk.Submit(Envelope(Id(),"talk.select_first",talkTarget,extraLimit,now,now + 4000,source: "talk_input"),now) == "invalid_arguments","talk select rejects extra arguments");
        var wide = new Dictionary<string,object>(limits); wide["radiusMeters"] = 31;
        Check(talk.Submit(Envelope(Id(),"talk.select_first",talkTarget,wide,now,now + 4000,source: "talk_input"),now) == "invalid_arguments","talk radius is bounded");
        Check(talk.Submit(Envelope(Id(),"talk.inspect",talkTarget,Empty,now,now + 4000,source: "talk_input"),now) == "accepted","talk.inspect accepted");
        Check(talk.Submit(Envelope(Id(),"talk.clear",talkTarget,Empty,now,now + 4000,source: "talk_input"),now) == "accepted","talk.clear accepted");
        Check(talk.Submit(Envelope(Id(),"talk.ptt_stop",talkTarget,new Dictionary<string,object> {{"generation",1}},now,now + 4000,source: "talk_input"),now) == "accepted","talk.ptt_stop accepted");
        Check(talk.Submit(Envelope(Id(),"talk.ptt_stop",talkTarget,Empty,now,now + 4000,source: "talk_input"),now) == "invalid_arguments","talk.ptt_stop requires a generation");
        var start = new Dictionary<string,object>(limits) {{"generation",4},{"selectFirst",true}};
        Check(talk.Submit(Envelope(Id(),"talk.ptt_start",talkTarget,start,now,now + 4000,source: "talk_input"),now) == "accepted","hold without a preview may select then commit");
        var committed = new Dictionary<string,object>(limits) {{"generation",5},{"selectFirst",false}};
        var expect = new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",Id()}}}};
        Check(talk.Submit(Envelope(Id(),"talk.ptt_start",expect,committed,now,now + 4000,source: "talk_input"),now) == "accepted","ptt start names the selection");
        var both = new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",Id()},{"encounterId",Id()}}}};
        Check(talk.Submit(Envelope(Id(),"talk.ptt_start",both,committed,now,now + 4000,source: "talk_input"),now) == "accepted","ptt start may also name the encounter");
        Check(talk.Submit(Envelope(Id(),"talk.ptt_start",talkTarget,committed,now,now + 4000,source: "talk_input"),now) == "invalid_target","a committed start without selectFirst needs a selection id");
        Check(talk.Submit(Envelope(Id(),"talk.ptt_start",expect,start,now,now + 4000,source: "talk_input"),now) == "invalid_target","selectFirst does not take an expectation");
    }

    static void SurfaceTests()
    {
        var allowed = new HashSet<Type> {typeof(string),typeof(int),typeof(bool),typeof(void)};
        var type = typeof(DomainHost);
        foreach (var member in type.GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)) {
            if (member.Name == "InitializeLifetimeService") continue; // remoting lifetime override only
            switch (member) {
                case MethodInfo method: Check(allowed.Contains(method.ReturnType) && method.GetParameters().All(parameter => allowed.Contains(parameter.ParameterType)),"DomainHost." + method.Name + " uses only string, int or bool"); break;
                case PropertyInfo property: Check(allowed.Contains(property.PropertyType),"DomainHost." + property.Name + " is string, int or bool"); break;
                case FieldInfo field: Check(field.IsLiteral && allowed.Contains(field.FieldType),"DomainHost." + field.Name + " is a constant"); break;
                case ConstructorInfo constructor: Check(constructor.GetParameters().Length == 0,"DomainHost has only its default constructor"); break;
                default: Check(false,"unexpected public DomainHost member " + member.Name); break;
            }
        }
        Check(type.GetMethod("Submit",new[] {typeof(string)})?.ReturnType == typeof(string) && type.GetMethod("TryTakeResult",new[] {typeof(string)})?.ReturnType == typeof(string)
            && type.GetMethod("Snapshot",Type.EmptyTypes)?.ReturnType == typeof(string) && type.GetMethod("RequestSnapshots",new[] {typeof(int)})?.ReturnType == typeof(void),"bridge members present");
        var references = type.Assembly.GetReferencedAssemblies().Select(reference => reference.Name).ToArray();
        Check(!references.Contains("RagePluginHook") && !references.Contains("LosSantosAlive") && !references.Contains("LSA.SessionIdentity") && !references.Contains("LSA.PromotedCharacters.Runtime") && !references.Contains("System.Web.Extensions"),"bootstrap stays free of game, runtime and serializer references");
    }

    static void CommandTests()
    {
        var names = typeof(PlayerCommands).GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Select(method => method.GetCustomAttribute<Rage.Attributes.ConsoleCommandAttribute>()).Where(attribute => attribute != null).Select(attribute => attribute.Name).ToArray();
        var expected = new[] {"LSACharacters","LSAPromote","LSAFollowPromoted","LSAWaitPromoted","LSADismissPromoted","LSASummonCharacter","LSADespawnCharacter","LSACurrentNpc","LSAAskCurrent","LSAMenu"};
        Check(names.Length == 10 && names.Distinct().Count() == 10 && expected.All(names.Contains),"ten canonical console commands (UX phase 3 adds LSAMenu), no aliases");
        Check(Rage.Game.RegistrationCalls == 0,"commands are discovered by attribute, never registered explicitly");
        // LSAMenu only queues a toggle for the enhanced host fiber and explains a refusal.
        PlayerCommands.Initialize(37921); ClearMessages();
        PlayerCommands.MenuRequested = null; PlayerCommands.Command_LSAMenu();
        string requested = null; PlayerCommands.MenuRequested = page => { requested = page; return "menu_off"; }; PlayerCommands.Command_LSAMenu();
        PlayerCommands.MenuRequested = page => "menu_unavailable"; PlayerCommands.Command_LSAMenu();
        PlayerCommands.MenuRequested = page => null; PlayerCommands.Command_LSAMenu();
        PlayerCommands.MenuRequested = page => throw new InvalidOperationException(); PlayerCommands.Command_LSAMenu();
        Check(requested == "main" && Messages().SequenceEqual(new[] {"LSA Enhanced input and menu are not running. See RagePluginHook.log.","The LSA menu is off. Set \"ui\": {\"enabled\": true} in Plugins/LSA.Enhanced.json.",
            "The LSA menu is unavailable (RAGENativeUI 1.9.3 not loaded). See RagePluginHook.log.","LSA Enhanced input and menu are not running. See RagePluginHook.log."}),"LSAMenu explains refusals and stays silent when it opens: " + string.Join(" | ",Messages()));
        PlayerCommands.MenuRequested = null; ClearMessages();
    }

    static void EndpointTests(string temp)
    {
        string file = Path.Combine(temp,"endpoint","LSA Enhanced","control-endpoint.v1.json"),url = "http://127.0.0.1:37921",token = new string('a',64);
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        PlayerCommands.EndpointPath = file;
        Check(PlayerCommands.EndpointToken(url) == null,"missing endpoint file");
        File.WriteAllText(file,Json.Serialize(new {version = 1,url,token,pid = 4242,startedAtUtc = "2026-10-03T20:44:06Z"}));
        Check(PlayerCommands.EndpointToken(url) == token,"valid endpoint file supplies the token");
        Check(PlayerCommands.EndpointToken("http://127.0.0.1:37922") == null,"endpoint must match the configured editor port");
        foreach (var bad in new object[] {new {version = 2,url,token},new {version = 1,url = "http://192.168.1.2:37921",token},new {version = 1,url,token = "ABC"},new {version = "1",url,token},new {url,token}}) {
            File.WriteAllText(file,Json.Serialize(bad));
            Check(PlayerCommands.EndpointToken(url) == null,"invalid endpoint file ignored");
        }
        File.WriteAllText(file,"{broken"); Check(PlayerCommands.EndpointToken(url) == null,"malformed endpoint file ignored");
        File.WriteAllText(file,Json.Serialize(new {version = 1,url,token,padding = new string(' ',5000)})); Check(PlayerCommands.EndpointToken(url) == null,"oversized endpoint file ignored");
        PlayerCommands.EndpointPath = null; Check(PlayerCommands.EndpointToken(url) == null,"no endpoint location");
    }

    static Dictionary<string,object> Run(DomainHost host,Driver driver,string envelope)
    {
        var parsed = Parse(envelope); string id = (string)parsed["id"];
        Check(host.Submit(envelope) == "accepted","bridge accepted " + parsed["command"]);
        driver.Tick();
        var text = host.TryTakeResult(id);
        Check(text != null,"result available after one Update");
        return Parse(text);
    }
    static string RunReason(DomainHost host,Driver driver,string envelope)
    {
        var reply = Run(host,driver,envelope);
        return (string)reply["status"] == "ok" ? "ok" : (string)reply["reason"];
    }
    static Dictionary<string,object> TalkLimits(int timeout = 8000,int max = 8) => new Dictionary<string,object> {{"radiusMeters",15},{"retentionRadiusMeters",20},{"maxCandidates",max},{"cycleWindowMs",1500},{"selectionTimeoutMs",timeout},{"indicator",true}};
    static object TalkKind = new Dictionary<string,object> {{"kind","talk"}};
    static string TalkCommand(string command,object target,object args,string source = "talk_input") { long now = Now; return Envelope(Id(),command,target,args,now,now + 4000,source); }
    static Dictionary<string,object> TalkRun(DomainHost host,Driver driver,string command,object args,object target = null)
    {
        var reply = Run(host,driver,TalkCommand(command,target ?? TalkKind,args));
        Check((string)reply["status"] == "ok","talk command ok: " + command + " " + reply["reason"]);
        return Result(reply);
    }
    static void TalkTargetBridge(DomainHost host,Driver driver)
    {
        long clock = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        driver.Clock(clock); driver.ResetTalkCounters(); driver.PlayerAt(0,0,0); driver.ClearNearby();
        driver.Nearby(20,8,0,0,960,540); driver.Nearby(10,5,0,0,1800,900); driver.Nearby(30,3,0,0, -100,-100);
        driver.GameTime = 4000; driver.PublishSnapshot(); driver.Select(10,0);
        int prompts = driver.PromptCount;
        var first = TalkRun(host,driver,"talk.select_first",TalkLimits());
        Check((bool)first["present"] && (string)first["pedId"] == "20" && (int)Convert.ToInt32(first["cycleIndex"]) == 1 && Convert.ToInt32(first["cycleCount"]) == 3 && driver.MicStarts == 0 && driver.ConversationSets == 0 && driver.ConversationHandle == 10,"first tap selects the on-screen center NPC and does not start the microphone or retarget Essential");
        string selectionB = (string)first["selectionId"], encounterB = (string)first["encounterId"];
        driver.Nearby(20,8,0,0,-100,-100); driver.Nearby(30,3,0,0,960,540); driver.PublishSnapshot();
        var second = TalkRun(host,driver,"talk.select_next",TalkLimits());
        Check((string)second["pedId"] == "10" && (string)second["selectionId"] != selectionB && Convert.ToInt32(second["cycleIndex"]) == 2,"cycling keeps the frozen order when scores change");
        var third = TalkRun(host,driver,"talk.select_next",TalkLimits());
        var wrapped = TalkRun(host,driver,"talk.select_next",TalkLimits());
        Check((string)third["pedId"] == "30" && (string)wrapped["pedId"] == "20" && Convert.ToInt32(wrapped["cycleIndex"]) == 1,"cycle wraps to the first candidate");
        driver.ClearNearby(); driver.Nearby(41,1,0,0,960,540);
        for (int handle = 42; handle <= 50; handle++) driver.Nearby(handle,handle - 40,0,0,960,540);
        driver.PublishSnapshot();
        var capped = TalkRun(host,driver,"talk.select_first",TalkLimits());
        var seen = new HashSet<string> {(string)capped["pedId"]};
        for (int step = 0; step < 7; step++) seen.Add((string)TalkRun(host,driver,"talk.select_next",TalkLimits())["pedId"]);
        Check(Convert.ToInt32(capped["cycleCount"]) == 8 && seen.Count == 8 && !seen.Contains("49") && !seen.Contains("50"),"candidate list is capped at 8");
        driver.ClearNearby(); driver.Nearby(61,4,0,0,960,540); driver.PublishSnapshot();
        var only = TalkRun(host,driver,"talk.select_first",TalkLimits());
        var again = TalkRun(host,driver,"talk.select_next",TalkLimits());
        Check((string)only["pedId"] == "61" && (string)again["pedId"] == "61" && (string)again["selectionId"] != (string)only["selectionId"] && driver.MicStarts == 0,"one candidate is reaffirmed without a microphone");
        driver.ClearNearby(); driver.PublishSnapshot();
        var none = TalkRun(host,driver,"talk.select_first",TalkLimits());
        Check(!(bool)none["present"] && (string)none["reason"] == "no_nearby_npc" && driver.MicStarts == 0,"no candidate does not start the microphone");
        driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot(); driver.SnapshotAge(5000);
        var stale = TalkRun(host,driver,"talk.select_first",TalkLimits());
        Check(!(bool)stale["present"] && (string)stale["reason"] == "selector_unavailable","a stale perception snapshot selects nobody");
        driver.PublishSnapshot();
        TalkRun(host,driver,"talk.select_first",TalkLimits());
        driver.Kill(20); driver.Tick();
        var dead = TalkRun(host,driver,"talk.inspect",Empty);
        Check(!(bool)dead["present"] && driver.MicStarts == 0,"a dead target is cleared and not replaced");
        driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot();
        TalkRun(host,driver,"talk.select_first",TalkLimits());
        driver.Retarget(20,99999); driver.Tick();
        var reused = TalkRun(host,driver,"talk.inspect",Empty);
        Check(!(bool)reused["present"],"the same handle at a new memory address is not the selected incarnation");
        driver.Retarget(20,20 * 16); driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot();
        driver.Clock(clock);
        TalkRun(host,driver,"talk.select_first",TalkLimits(2000));
        driver.Clock(clock + 2000); driver.Tick();
        var expired = TalkRun(host,driver,"talk.inspect",Empty);
        Check(!(bool)expired["present"],"an idle selection expires");
        driver.Clock(clock + 3000); driver.Nearby(20,8,0,0,960,540); driver.Nearby(10,5,0,0,1800,900); driver.PublishSnapshot(); driver.Select(10,0); driver.ResetTalkCounters();
        var chosen = TalkRun(host,driver,"talk.select_first",TalkLimits());
        string chosenId = (string)chosen["selectionId"], chosenEncounter = (string)chosen["encounterId"];
        var inspect = Result(Run(host,driver,Inspect(Id(),Now)));
        Check((string)inspect["pedId"] == "20" && (string)inspect["encounterId"] == chosenEncounter,"current NPC follows the explicit selection ahead of PlayerConversationPed");
        string captureText = driver.Capture();
        Check(captureText != null && !captureText.StartsWith("error:"),"capture/promote uses the highlighted NPC: " + captureText);
        var captured = Parse(captureText);
        Check((string)captured["pedId"] == "20" && (string)captured["encounterId"] == chosenEncounter,"capture names the selected encounter");
        Check(RunReason(host,driver,Ask(Id(),"00000000-0000-4000-8000-000000000001","Follow me.",Now)) == "target_changed" && driver.PromptCount == prompts,"a follow aimed at another encounter is not redirected");
        var startArgs = TalkLimits(); startArgs["generation"] = 3; startArgs["selectFirst"] = false;
        var startTarget = new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",chosenId},{"encounterId",chosenEncounter}}}};
        var started = TalkRun(host,driver,"talk.ptt_start",startArgs,startTarget);
        Check((bool)started["started"] && (string)started["pedId"] == "20" && driver.MicStarts == 1 && driver.LastMicHandle == 20 && driver.ConversationHandle == 20 && driver.ConversationSets == 1,"hold commits SetPlayerConversationPed and SendMicStart for the exact ped");
        driver.Select(99,0);
        var stopped = TalkRun(host,driver,"talk.ptt_stop",new Dictionary<string,object> {{"generation",3}});
        Check((bool)stopped["stopped"] && driver.MicStops == 1 && driver.ConversationHandle == 99 && driver.ConversationClears == 0,"stop ends only the UX4 mic and does not clear a newer conversation ped");
        var stoppedAgain = TalkRun(host,driver,"talk.ptt_stop",new Dictionary<string,object> {{"generation",3}});
        Check(!(bool)stoppedAgain["stopped"] && driver.MicStops == 1,"a repeated stop does not call SendMicStop again");

        driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.Nearby(30,4,0,0,1000,540); driver.PublishSnapshot(); driver.ResetTalkCounters();
        var ownerPick = TalkRun(host,driver,"talk.select_first",TalkLimits());
        var ownerArgs = new Dictionary<string,object>(TalkLimits()) {{"generation",4},{"selectFirst",false}};
        var ownerTarget = new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",(string)ownerPick["selectionId"]},{"encounterId",(string)ownerPick["encounterId"]}}}};
        Check((bool)TalkRun(host,driver,"talk.ptt_start",ownerArgs,ownerTarget)["started"],"ownership test starts UX4 mic");
        driver.ReplaceMic(30);
        var ownershipLost = TalkRun(host,driver,"talk.ptt_stop",new Dictionary<string,object> {{"generation",4}});
        Check(!(bool)ownershipLost["stopped"] && (bool)ownershipLost["released"] && (string)ownershipLost["reason"] == "ownership_lost" && driver.MicStops == 0 && driver.LastMicHandle == 30,"UX4 release never stops a later stock/MarkedTalk mic");

        driver.ResetTalkCounters(); driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot();
        var retryPick = TalkRun(host,driver,"talk.select_first",TalkLimits());
        var retryArgs = new Dictionary<string,object>(TalkLimits()) {{"generation",5},{"selectFirst",false}};
        var retryTarget = new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",(string)retryPick["selectionId"]},{"encounterId",(string)retryPick["encounterId"]}}}};
        Check((bool)TalkRun(host,driver,"talk.ptt_start",retryArgs,retryTarget)["started"],"stop-retry test starts UX4 mic");
        driver.FailMicStop(true);
        Check(RunReason(host,driver,TalkCommand("talk.ptt_stop",TalkKind,new Dictionary<string,object> {{"generation",5}})) == "native_operation_failed" && driver.MicIsCurrent(20),"a failed physical stop keeps UX4 ownership for retry");
        driver.FailMicStop(false);
        var retryStop = TalkRun(host,driver,"talk.ptt_stop",new Dictionary<string,object> {{"generation",5}});
        Check((bool)retryStop["stopped"] && driver.MicStops == 1 && !driver.MicIsCurrent(20),"the same generation can retry and finish the physical stop");

        driver.ResetTalkCounters(); driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot();
        var gatedPick = TalkRun(host,driver,"talk.select_first",TalkLimits());
        var gatedArgs = new Dictionary<string,object>(TalkLimits()) {{"generation",6},{"selectFirst",false}};
        var gatedTarget = new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",(string)gatedPick["selectionId"]},{"encounterId",(string)gatedPick["encounterId"]}}}};
        foreach (var gate in new[] {"text","controls","loading","cutscene","mission","online"}) {
            driver.Gates(gate == "text",gate == "controls",gate == "loading");
            if (gate == "cutscene") driver.Native("IS_CUTSCENE_ACTIVE",true);
            if (gate == "mission") driver.Native("GET_MISSION_FLAG",true);
            if (gate == "online") driver.Native("NETWORK_IS_SESSION_ACTIVE",true);
            string blocked = RunReason(host,driver,TalkCommand("talk.ptt_start",gatedTarget,gatedArgs));
            Check(blocked == (gate == "text" || gate == "controls" ? "input_busy" : "scripted_state") && driver.MicStarts == 0,"native PTT start rechecks gate: " + gate);
            driver.Gates(false,false,false); driver.Native("IS_CUTSCENE_ACTIVE",false); driver.Native("GET_MISSION_FLAG",false); driver.Native("NETWORK_IS_SESSION_ACTIVE",false);
            gatedArgs["generation"] = Convert.ToInt32(gatedArgs["generation"]) + 1;
        }

        int starts = driver.MicStarts;
        TalkRun(host,driver,"talk.ptt_stop",new Dictionary<string,object> {{"generation",7}});
        var cancelled = TalkRun(host,driver,"talk.ptt_start",new Dictionary<string,object>(TalkLimits()) {{"generation",7},{"selectFirst",true}});
        Check(!(bool)cancelled["started"] && (string)cancelled["reason"] == "cancelled" && driver.MicStarts == starts,"a stop that wins the race fences the generation");
        driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot(); driver.ResetTalkCounters();
        string queuedStart = TalkCommand("talk.ptt_start",TalkKind,new Dictionary<string,object>(TalkLimits()) {{"generation",8},{"selectFirst",true}});
        string queuedStop = TalkCommand("talk.ptt_stop",TalkKind,new Dictionary<string,object> {{"generation",8}});
        Check(host.Submit(queuedStart) == "accepted" && host.Submit(queuedStop) == "accepted","start and its release are both queued");
        driver.Tick();
        Check(driver.MicStarts == 1 && driver.MicStops == 1,"a release queued behind the start still closes the microphone");
        TalkRun(host,driver,"talk.clear",Empty);
        driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.PublishSnapshot(); driver.ResetTalkCounters();
        var holding = TalkRun(host,driver,"talk.ptt_start",new Dictionary<string,object>(TalkLimits()) {{"generation",9},{"selectFirst",true}});
        Check((bool)holding["started"] && driver.LastMicHandle == 20 && driver.MicIsCurrent(20),"hold with no preview selects the best NPC then starts its microphone");
        driver.Kill(20); driver.Tick();
        var lostView = TalkRun(host,driver,"talk.inspect",Empty);
        Check(driver.MicStops == 1 && !(bool)lostView["present"],"target loss while talking stops the UX4 microphone once");
        driver.Tick(); Check(driver.MicStops == 1,"a later tick does not stop the microphone again");
        driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.Nearby(30,6,0,0,1200,540); driver.PublishSnapshot(); driver.ResetTalkCounters();
        var before = TalkRun(host,driver,"talk.select_first",TalkLimits());
        string beforeId = (string)before["selectionId"], beforeEncounter = (string)before["encounterId"];
        driver.Kill(20);
        Check(RunReason(host,driver,TalkCommand("talk.ptt_start",new Dictionary<string,object> {{"kind","talk"},{"expect",new Dictionary<string,object> {{"selectionId",beforeId}}}},new Dictionary<string,object>(TalkLimits()) {{"generation",11},{"selectFirst",false}})) == "target_lost" && driver.MicStarts == 0,"a commit after the target dies does not retarget");
        driver.ClearNearby(); driver.Nearby(20,8,0,0,960,540); driver.Nearby(30,4,0,0,1000,540); driver.PublishSnapshot();
        var left = TalkRun(host,driver,"talk.select_first",TalkLimits());
        string leftEncounter = (string)left["encounterId"];
        string ask = Ask(Id(),leftEncounter,"Look here.",Now);
        string cycle = TalkCommand("talk.select_next",TalkKind,TalkLimits());
        Check(host.Submit(ask) == "accepted" && host.Submit(cycle) == "accepted","follow is queued before the next cycle");
        driver.Tick();
        Check(driver.LastPrompt == "20:Look here.","a queued follow keeps the NPC it captured");
        string rightEncounter = (string)TalkRun(host,driver,"talk.inspect",Empty)["encounterId"];
        Check(rightEncounter != leftEncounter && RunReason(host,driver,Ask(Id(),leftEncounter,"Look here.",Now)) == "target_changed" && driver.LastPrompt == "20:Look here.","changing the selection fails the old follow instead of retargeting it");
        driver.GameTime = 9000; driver.Tick(); driver.GameTime = 1000; driver.Tick();
        var reset = TalkRun(host,driver,"talk.inspect",Empty);
        Check(!(bool)reset["present"] && driver.Logs.Contains("[UX4] talk_target cleared reason=world_reset"),"a game-clock reset clears the selector");
        TalkRun(host,driver,"talk.clear",Empty);
        driver.ClearClock(); driver.ClearNearby(); driver.Select(505,0);
    }
    static void EndToEnd(string corePath,string temp)
    {
        string addon = Path.Combine(temp,"Plugins","LSA.PromotedCharacters"),harness = AppDomain.CurrentDomain.BaseDirectory,empty = Path.Combine(temp,"essential-domain");
        Directory.CreateDirectory(addon); Directory.CreateDirectory(empty);
        foreach (var name in new[] {"LSA.SessionIdentity.dll","LSA.PromotedCharacters.Runtime.dll"}) File.Copy(Path.Combine(harness,name),Path.Combine(addon,name));
        // The application base holds no runtime copy, so the real DomainHost and the
        // Driver share the single runtime instance loaded from the Plugins folder.
        var domain = AppDomain.CreateDomain("LosSantosAlive_AppDomain",null,new AppDomainSetup {ApplicationBase = empty});
        var driver = (Driver)domain.CreateInstanceFromAndUnwrap(Path.Combine(addon,"LSA.PromotedCharacters.Runtime.dll"),typeof(Driver).FullName);
        var host = (DomainHost)domain.CreateInstanceFromAndUnwrap(typeof(DomainHost).Assembly.Location,typeof(DomainHost).FullName);
        Check(host.CoreStatus == "core_missing" && !host.BridgeAvailable,"Essential test domain starts without Core or bridge");
        Check(host.Submit(Inspect(Id(),Now)) == "native_unavailable" && host.TryTakeResult(Id()) == null && host.Snapshot() == null,"bridge closed before the runtime starts");
        host.RequestSnapshots(1000);
        Check(host.Submit(null) == "invalid_envelope" && host.Submit(new string('x',DomainHost.MaxEnvelopeChars + 1)) == "envelope_too_large" && host.TryTakeResult("short") == null,"DomainHost bounds inputs before the runtime");
        Check(driver.LoadCore(corePath) && host.CoreStatus == "core_ready","pinned Essential core loaded, not executed");
        string suffix = Guid.NewGuid().ToString("N");
        string config = Json.Serialize(new {enabled = true,worldProfileId = "d7dfeaa1-13e8-4a7d-aff7-8e3fbb2ab4b5",pipeName = "LSA.P2.bridge." + suffix,identityPipeName = "LSA.P1.bridge." + suffix});
        Check(host.Start(Path.Combine(temp,"Plugins"),config) && host.Status == "starting" && host.BridgeAvailable,"real DomainHost starts the runtime and resolves the bridge");
        Check(driver.WaitForIntegration(5000),"lifetime fiber prepared and registered the integration");
        Check(!host.Ready && host.Submit(Inspect(Id(),Now)) == "native_unavailable","bridge refuses work until Core initializes P1/P2");
        driver.Tick();
        Check(host.Ready && driver.Ready,"ready after Core's first callback");
        driver.NativeCalls = 0;
        for (int tick = 0; tick < 5; tick++) driver.Tick();
        Check(driver.NativeCalls == 0 && host.Snapshot() == null,"an idle bridge makes no game or Essential reads");

        string waiting = Id();
        Check(host.Submit(Inspect(waiting,Now)) == "accepted" && host.TryTakeResult(waiting) == null,"queued command waits for Update");
        driver.Tick();
        var nobody = Parse(host.TryTakeResult(waiting));
        Check((string)nobody["status"] == "ok" && Result(nobody)["present"] is bool absent && !absent,"no current NPC reported read-only");

        driver.Select(101,0);
        var view = Result(Run(host,driver,Inspect(Id(),Now)));
        Check((bool)view["present"] && (string)view["pedId"] == "101" && Uuid(view["encounterId"]) && !(bool)view["owned"] && view["ownerAlias"] == null && view["mode"] == null && (bool)view["human"] && (bool)view["safe"] && !(bool)view["suspended"],"current.inspect describes an ordinary NPC");
        string encounter = (string)view["encounterId"];
        driver.Select(0,101);
        Check((string)Result(Run(host,driver,Inspect(Id(),Now)))["encounterId"] == encounter,"speaker fallback resolves the same encounter");
        driver.Select(101,0);
        Check(driver.PromptCount == 0,"inspection never starts a turn");

        Check(RunReason(host,driver,Ask(Id(),encounter,"Follow me.",Now)) == "ok" && driver.PromptCount == 1 && driver.LastPrompt == "101:Follow me.","npc.ask makes one stock typed turn");
        Check(RunReason(host,driver,Ask(Id(),encounter,"Wait here.",Now)) == "ask_cooldown" && driver.PromptCount == 1,"three-second cooldown per NPC");
        driver.Select(202,0);
        Check(RunReason(host,driver,Ask(Id(),encounter,"Follow me.",Now)) == "target_changed" && driver.PromptCount == 1,"changed current NPC is rejected");
        string second = (string)Result(Run(host,driver,Inspect(Id(),Now)))["encounterId"];
        Check(second != encounter,"a different NPC has a different encounter");
        driver.Gates(true,false,false);
        Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "input_busy","Essential text input blocks asks");
        driver.Gates(false,true,false);
        Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "input_busy","Essential controls menu blocks asks");
        driver.Gates(false,false,true);
        Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "scripted_state","loading screens block asks");
        driver.Gates(false,false,false);
        foreach (var native in new[] {"IS_CUTSCENE_ACTIVE","IS_CUTSCENE_PLAYING","IS_PLAYER_SWITCH_IN_PROGRESS","GET_MISSION_FLAG","NETWORK_IS_SESSION_ACTIVE"}) {
            driver.Native(native,true);
            Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "scripted_state","scripted state blocks asks: " + native);
            driver.Native(native,false);
        }
        driver.Directed(202);
        Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "scripted_state","directed interactions block asks");
        driver.Directed(0); driver.Human(202,false);
        Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "no_current_npc","non-human current peds are refused");
        driver.Human(202,true); driver.Select(0,0);
        Check(RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "no_current_npc","asks need a current NPC");
        driver.Select(202,0);
        Check(driver.PromptCount == 1,"no gated request reached Essential");
        Check(RunReason(host,driver,Ask(Id(),second,"Wait here.",Now)) == "ok" && driver.LastPrompt == "202:Wait here.","ungated ask succeeds");

        driver.Select(303,0);
        string third = (string)Result(Run(host,driver,Inspect(Id(),Now)))["encounterId"];
        driver.Kill(303);
        Check(RunReason(host,driver,Ask(Id(),third,"Hi.",Now)) == "no_current_npc","dead peds are refused");
        driver.Select(404,0);
        string fourth = (string)Result(Run(host,driver,Inspect(Id(),Now)))["encounterId"];
        driver.PromptFailure("invalid_operation");
        Check(RunReason(host,driver,Ask(Id(),fourth,"Hi.",Now)) == "native_operation_failed","Essential failures become bounded results");
        driver.PromptFailure("application");
        Check(RunReason(host,driver,Ask(Id(),fourth,"Hi.",Now)) == "native_operation_failed","non-operation failures are contained too");
        driver.PromptFailure(null);
        Check(driver.Available && driver.Ready && host.Ready,"a failing command never shuts down P2");
        Check(RunReason(host,driver,Ask(Id(),fourth,"Hi.",Now)) == "ok","a failed ask does not start the cooldown");

        driver.Gates(true,false,false); driver.Native("NETWORK_IS_SESSION_ACTIVE",true);
        var gates = Result(Run(host,driver,GatesRead(Id(),Now)));
        Check((bool)gates["textInputOpen"] && !(bool)gates["controlsMenuOpen"] && (bool)gates["online"] && !(bool)gates["cutscene"] && !(bool)gates["mission"] && !(bool)gates["playerSwitch"] && !(bool)gates["loading"] && !(bool)gates["inputFree"] && (bool)gates["scripted"],"gates.read reports Essential and game gates");
        driver.Gates(false,false,false); driver.Native("NETWORK_IS_SESSION_ACTIVE",false);

        var batch = Enumerable.Range(0,6).Select(_ => Id()).ToArray();
        foreach (var id in batch) Check(host.Submit(Inspect(id,Now)) == "accepted","batch command accepted");
        driver.Tick();
        var done = batch.Where(id => host.TryTakeResult(id) != null).ToList();
        Check(done.Count == 4,"one shared budget of four commands per Update");
        driver.Tick();
        Check(batch.Except(done).All(id => host.TryTakeResult(id) != null),"remaining commands run on the next Update");

        driver.Select(202,0); driver.NativeCalls = 0; driver.Tick();
        Check(host.Snapshot() == null && driver.NativeCalls == 0,"no snapshot without interest");
        host.RequestSnapshots(1000); driver.Tick();
        var snapshot = Parse(host.Snapshot());
        var snapshotCurrent = snapshot?["current"] as Dictionary<string,object>;
        Check(snapshot != null && (int)snapshot["v"] == 1 && Convert.ToInt64(snapshot["seq"]) == 1 && snapshotCurrent != null && (string)snapshotCurrent["encounterId"] == second && snapshot["gates"] is Dictionary<string,object> && snapshot["reason"] == null,"snapshot built while interest is active");
        driver.Tick();
        Check(Convert.ToInt64(Parse(host.Snapshot())["seq"]) == 1,"snapshot rebuilt at most every 250 ms");
        Thread.Sleep(300); driver.Tick();
        Check(Convert.ToInt64(Parse(host.Snapshot())["seq"]) == 2,"snapshot rebuilt after 250 ms");
        Thread.Sleep(1100); driver.Tick();
        Check(host.Snapshot() == null,"snapshot cleared once interest lapses");
        driver.NativeCalls = 0; driver.Tick();
        Check(driver.NativeCalls == 0,"no reads after interest lapses");

        var mixed = Enumerable.Range(0,3).Select(_ => Id()).ToArray();
        foreach (var id in mixed) host.Submit(Inspect(id,Now));
        driver.PushPipe("current",3); driver.Tick();
        var first = mixed.Where(id => host.TryTakeResult(id) != null).ToList();
        Check(driver.PipeOutcomes() == "ok,ok,ok" && first.Count == 1,"pipe requests run first and leave the rest of the budget to loader commands");
        driver.Tick();
        Check(mixed.Except(first).All(id => host.TryTakeResult(id) != null),"loader commands continue on the next Update");

        driver.FailNative("IS_ENTITY_A_MISSION_ENTITY");
        Check(RunReason(host,driver,Inspect(Id(),Now)) == "native_operation_failed","a throwing read fails only that command");
        driver.PushPipe("current",1); driver.Tick();
        Check(driver.PipeOutcomes() == "native_operation_failed","the current pipe op fails closed");
        host.RequestSnapshots(600); driver.Tick();
        var failedSnapshot = Parse(host.Snapshot());
        Check(failedSnapshot != null && failedSnapshot["current"] == null && failedSnapshot["gates"] == null && (string)failedSnapshot["reason"] == "native_operation_failed","snapshots report read failures");
        driver.FailNative("GET_MISSION_FLAG");
        Check(RunReason(host,driver,GatesRead(Id(),Now)) == "native_operation_failed" && RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "native_operation_failed","gate reads fail closed");
        driver.FailNative(null);
        Check(driver.Available && driver.Ready && host.Ready && !driver.Logs.Contains("[P2] optional_update_failed"),"read failures never shut down P2");
        Thread.Sleep(700); driver.Tick();
        Check(host.Snapshot() == null,"failure-test snapshot interest lapsed");

        var pipe = Parse(driver.PipeCurrent(false));
        Check(pipe != null && (bool)pipe["present"] && (string)pipe["encounterId"] == second && !(bool)pipe["owned"],"read-only current pipe op shares the view");
        Check(driver.PipeCurrent(true) == "error:invalid_owner_arguments","current pipe op takes no arguments");
        Check(driver.PromptCount == 3,"views never start turns");

        string shortLived = Id(); long issued = Now;
        Check(host.Submit(Envelope(shortLived,"current.inspect",Current,Empty,issued,issued + 150)) == "accepted","short-lived command accepted");
        Thread.Sleep(250); driver.Tick();
        Check(Reason(host.TryTakeResult(shortLived)) == "native_stale","commands expire instead of waiting for a paused game");

        driver.GameTime = 5000; driver.Tick();
        string beforeReset = Id(); host.RequestSnapshots(2000);
        Check(host.Submit(Inspect(beforeReset,Now)) == "accepted","command pending at reset");
        driver.GameTime = 1000; driver.Tick();
        Check(Reason(host.TryTakeResult(beforeReset)) == "native_stale" && host.Snapshot() == null,"game clock reset cancels pending commands and the snapshot");
        Check(driver.Logs.Contains("[P2] game_clock_reset") && driver.Available && driver.Ready,"P2 survives its clock reset");
        string renewed = (string)Result(Run(host,driver,Inspect(Id(),Now)))["encounterId"];
        Check(renewed != second && RunReason(host,driver,Ask(Id(),second,"Hi.",Now)) == "target_changed","a world reset invalidates old expectations");

        TalkTargetBridge(host,driver);
        ConsoleBridge(host,driver);

        string atShutdown = Id();
        Check(host.Submit(Inspect(atShutdown,Now)) == "accepted","command pending at shutdown");
        host.Stop();
        Check(host.Submit(Inspect(Id(),Now)) == "native_unavailable" && host.Snapshot() == null,"a stopping host refuses bridge work");
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (driver.Ready && DateTime.UtcNow < deadline) Thread.Sleep(20);
        Check(!driver.Ready,"lifetime fiber requested deferred shutdown");
        driver.Tick();
        Check(!driver.Available && Reason(host.TryTakeResult(atShutdown)) == "native_unavailable","Core retires P2 and completes pending bridge work");
        deadline = DateTime.UtcNow.AddSeconds(5);
        while (!driver.Logs.Contains("[P2] native_host_stopped") && DateTime.UtcNow < deadline) Thread.Sleep(20);
        Check(driver.Logs.Contains("[P2] native_host_stopped") && !host.Alive,"host lifetime finished");
    }

    static List<string> Messages() { lock (Rage.Game.Console.Messages) return Rage.Game.Console.Messages.ToList(); }
    static void ClearMessages() { lock (Rage.Game.Console.Messages) Rage.Game.Console.Messages.Clear(); }
    static List<string> Pump(Driver driver,int expected)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (Messages().Count < expected && DateTime.UtcNow < deadline) { PlayerCommands.Update(); driver.Tick(); PlayerCommands.Update(); }
        return Messages();
    }
    static void ConsoleBridge(DomainHost host,Driver driver)
    {
        PlayerCommands.Initialize(37921); PlayerCommands.SetNativeReady(true); PlayerCommands.SetNativeHost(host);
        driver.Select(505,0); ClearMessages();
        PlayerCommands.Command_LSACurrentNpc();
        var lines = Pump(driver,2);
        Check(lines.Count == 2 && lines[0].StartsWith("Current NPC: ped 505, encounter ") && lines[0].Contains("not promoted, human, P2 control allowed now.") && lines[1] == "Input gates: text input closed, controls menu closed, scripted state none.","LSACurrentNpc prints the bridge view: " + string.Join(" | ",lines));
        ClearMessages();
        int prompts = driver.PromptCount;
        PlayerCommands.Command_LSAAskCurrent("\"Wait here.\"");
        lines = Pump(driver,1);
        Check(lines.SequenceEqual(new[] {"Sent your request to the current NPC through Essential's text input."}) && driver.PromptCount == prompts + 1 && driver.LastPrompt == "505:Wait here.","LSAAskCurrent sends one stock typed turn: " + string.Join(" | ",lines));
        ClearMessages();
        PlayerCommands.Command_LSACurrentNpc(); PlayerCommands.Command_LSAAskCurrent("Hi.");
        Check(Messages().SequenceEqual(new[] {"An LSA bridge request is already running."}),"one console bridge request at a time");
        Pump(driver,3); ClearMessages();
        PlayerCommands.Command_LSAAskCurrent("Follow me.");
        Check(Pump(driver,1).SequenceEqual(new[] {"Wait a moment before asking this NPC again."}),"cooldown explained from the fixed catalog");
        ClearMessages(); driver.Select(606,0);
        PlayerCommands.Command_LSAAskCurrent("Hi.");
        PlayerCommands.Update(); driver.Tick(); driver.Select(707,0);
        Check(Pump(driver,1).SequenceEqual(new[] {"The current NPC changed before the request ran. Try again."}) && driver.PromptCount == prompts + 1,"selection change between inspect and ask is refused");
        ClearMessages(); driver.Select(0,0);
        PlayerCommands.Command_LSAAskCurrent("Hi.");
        Check(Pump(driver,1).SequenceEqual(new[] {"No current NPC. Mark or talk to an NPC first."}),"no current NPC explained");
        ClearMessages();
        PlayerCommands.Command_LSAAskCurrent(""); PlayerCommands.Command_LSAAskCurrent("bad\nphrase");
        Check(Messages().Count == 2 && Messages().All(line => line.StartsWith("LSAAskCurrent needs a request of 1-120 characters")),"invalid phrases never reach the bridge");
        ClearMessages(); PlayerCommands.SetNativeHost(null);
        PlayerCommands.Command_LSACurrentNpc();
        Check(Messages().SequenceEqual(new[] {"LSA native host is unavailable."}),"bridge unavailable without a host");
        ClearMessages(); PlayerCommands.SetNativeHost(host); PlayerCommands.SetNativeReady(false);
        PlayerCommands.Command_LSACurrentNpc();
        Check(Messages().SequenceEqual(new[] {"LSA native host is unavailable."}),"bridge unavailable until the host is ready");
        PlayerCommands.SetNativeReady(true); driver.Select(202,0);
    }

    static string Entry(string method,string path,string token,string origin,string type,string body) => string.Join(" ",method,path,token ?? "",origin ?? "",type ?? "",body ?? "");
    static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback,0); listener.Start();
        try { return ((IPEndPoint)listener.LocalEndpoint).Port; } finally { listener.Stop(); }
    }
    static string Await(string expected)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < deadline) {
            PlayerCommands.Update();
            var lines = Messages();
            if (lines.Count > 0) { Thread.Sleep(150); return lines.Last(); }
            Thread.Sleep(20);
        }
        return "timeout waiting for: " + expected;
    }
    static void HandshakeTests(string temp)
    {
        int port = FreePort(); string address = "http://127.0.0.1:" + port;
        string file = Path.Combine(temp,"handshake","LSA Enhanced","control-endpoint.v1.json"); Directory.CreateDirectory(Path.GetDirectoryName(file));
        string fileToken = new string('b',64),pageToken = new string('c',64),accepted = fileToken;
        var seen = new ConcurrentQueue<string>();
        PlayerCommands.Initialize(port); PlayerCommands.SetNativeReady(true); PlayerCommands.EndpointPath = file;
        using (var listener = new HttpListener()) {
            listener.Prefixes.Add(address + "/"); listener.Start();
            var serving = Task.Run(() => {
                while (listener.IsListening) {
                    HttpListenerContext context; try { context = listener.GetContext(); } catch { return; }
                    try {
                        var request = context.Request; string body; using (var reader = new StreamReader(request.InputStream)) body = reader.ReadToEnd();
                        seen.Enqueue(Entry(request.HttpMethod,request.Url.AbsolutePath,request.Headers["x-lsa-editor"],request.Headers["Origin"],request.ContentType,body));
                        string reply; int status;
                        if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/") { status = 200; reply = "<!doctype html><script>const auth=\"" + pageToken + "\",summonWaitMs=30000;</script>"; }
                        else if (request.HttpMethod == "POST" && request.Url.AbsolutePath == "/api" && request.Headers["x-lsa-editor"] == accepted) { status = 200; reply = "{}"; }
                        else { status = 403; reply = "{\"error\":\"editor_access_denied\"}"; }
                        var bytes = System.Text.Encoding.UTF8.GetBytes(reply);
                        context.Response.StatusCode = status; context.Response.ContentLength64 = bytes.Length; context.Response.OutputStream.Write(bytes,0,bytes.Length); context.Response.Close();
                    } catch { }
                }
            });
            File.WriteAllText(file,Json.Serialize(new {version = 1,url = address,token = fileToken,pid = 4242,startedAtUtc = "2026-10-03T20:44:06Z"}));
            ClearMessages(); PlayerCommands.Command_LSAPromote();
            Check(Await("promote") == "P2 player character operation completed.","promote completes with the endpoint-file token");
            Check(seen.SequenceEqual(new[] {Entry("POST","/api",fileToken,address,"application/json","{\"action\":\"promote\"}")}),"endpoint file replaces HTML scraping; body unchanged: " + string.Join(" | ",seen));
            while (seen.TryDequeue(out _)) { }
            accepted = pageToken; ClearMessages(); PlayerCommands.Command_LSAFollowPromoted();
            Check(Await("follow") == "P2 player character operation completed.","stale endpoint token falls back once to the page token");
            string follow = "{\"action\":\"control_current\",\"operation\":\"follow\"}";
            Check(seen.SequenceEqual(new[] {Entry("POST","/api",fileToken,address,"application/json",follow),Entry("GET","/",null,null,null,""),Entry("POST","/api",pageToken,address,"application/json",follow)}),"403 retry sequence: " + string.Join(" | ",seen));
            while (seen.TryDequeue(out _)) { }
            File.Delete(file); ClearMessages(); PlayerCommands.Command_LSAWaitPromoted();
            Check(Await("wait") == "P2 player character operation completed." && seen.SequenceEqual(new[] {Entry("GET","/",null,null,null,""),Entry("POST","/api",pageToken,address,"application/json","{\"action\":\"control_current\",\"operation\":\"wait\"}")}),"legacy page handshake still works without the endpoint file: " + string.Join(" | ",seen));
            while (seen.TryDequeue(out _)) { }
            accepted = "none"; ClearMessages(); PlayerCommands.Command_LSADismissPromoted();
            Check(Await("dismiss") == "P2 operation unavailable or deferred. Check selection, scripted state and the character editor.","refused operations report the existing failure text");
            listener.Stop();
            serving.Wait(2000);
        }
        PlayerCommands.Shutdown();
    }
}
