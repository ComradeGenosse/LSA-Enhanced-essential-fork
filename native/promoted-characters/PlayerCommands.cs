using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Rage;
using Rage.Attributes;

namespace LSA.PromotedCharacters
{
    // Existing RAGE console input keeps live operations in a focused game. The
    // worker talks only to the loopback editor; it never reads/tasks a ped.
    // The UX bridge commands only submit strings to DomainHost; Essential's
    // Update fiber does all game work.
    public static class PlayerCommands
    {
        static string origin;
        static int pending;
        static volatile bool enabled;
        static volatile bool nativeReady;
        static readonly ConcurrentQueue<string> messages = new ConcurrentQueue<string>();
        static readonly object bridgeGate = new object();
        static DomainHost host;
        static BridgeJob job;
        // Written atomically by the companion when its loopback server listens.
        internal static string EndpointPath = DefaultEndpointPath();
        sealed class BridgeJob
        {
            public string Phrase, InspectId, GatesId, AskId, Inspect, Gates;
            public readonly Stopwatch Clock = Stopwatch.StartNew();
        }
        internal static void Initialize(int port)
        {
            if (port < 1024 || port > 65535) throw new ArgumentException("Invalid P2 editor port.");
            origin = "http://127.0.0.1:" + port; enabled = true;
            string name=typeof(PlayerCommands).Assembly.GetName().Name;
            Game.LogTrivial("[P2] console_frontend_domain="+AppDomain.CurrentDomain.FriendlyName+" loader_instances="+AppDomain.CurrentDomain.GetAssemblies().Count(a=>a.GetName().Name==name));
            // RAGE discovers the attributed methods when loading this plugin.
            // Explicit AddConsoleCommands creates a second set in this build.
        }
        internal static void SetNativeReady(bool value) {nativeReady=value;}
        internal static void SetNativeHost(DomainHost value) { lock (bridgeGate) { host = value; if (value == null) job = null; } }
        [ConsoleCommand(Name = "LSACharacters",Description = "Show the local P2 character editor URL.")] public static void Command_LSACharacters() { if (enabled) Game.Console.Print("P2 character editor: " + origin); }
        [ConsoleCommand(Name = "LSAPromote",Description = "Promote Essential's currently selected NPC.")] public static void Command_LSAPromote() => Send(null);
        [ConsoleCommand(Name = "LSAFollowPromoted",Description = "Ask the selected promoted character to follow.")] public static void Command_LSAFollowPromoted() => Send("follow");
        [ConsoleCommand(Name = "LSAWaitPromoted",Description = "Ask the selected promoted character to wait.")] public static void Command_LSAWaitPromoted() => Send("wait");
        [ConsoleCommand(Name = "LSADismissPromoted",Description = "Dismiss the selected promoted character without deleting its profile.")] public static void Command_LSADismissPromoted() => Send("dismiss");
        [ConsoleCommand(Name = "LSASummonCharacter",Description = "Summon a persistent character by the exact CharacterId shown in the editor.")] public static void Command_LSASummonCharacter(string characterId) => SendCharacter("summon",characterId);
        [ConsoleCommand(Name = "LSADespawnCharacter",Description = "Despawn an addon-created ped by the exact CharacterId shown in the editor.")] public static void Command_LSADespawnCharacter(string characterId) => SendCharacter("despawn",characterId);
        [ConsoleCommand(Name = "LSACurrentNpc",Description = "Show Essential's current NPC and input gates as the LSA command bridge sees them.")] public static void Command_LSACurrentNpc() => StartBridge(null);
        [ConsoleCommand(Name = "LSAAskCurrent",Description = "Send a typed request in quotes to Essential's current NPC through Essential's own text input.")] public static void Command_LSAAskCurrent(string phrase) => StartBridge(Unquote(phrase) ?? "");
        static void SendCharacter(string operation,string characterId)
        {
            if (!enabled) return;
            if (characterId == null || !Regex.IsMatch(characterId,"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) { Game.Console.Print("P2 needs the exact CharacterId shown in the editor."); return; }
            Send(operation,characterId);
        }
        static HttpWebRequest Request(string url)
        {
            var request = (HttpWebRequest)WebRequest.Create(url); request.Proxy = null; request.Timeout = 5000; request.ReadWriteTimeout = 5000; request.AllowAutoRedirect = false; return request;
        }
        static string Read(WebResponse response,int max)
        {
            using (var stream = response.GetResponseStream()) using (var output = new MemoryStream()) {
                var buffer = new byte[1024]; int bytes;
                while ((bytes = stream.Read(buffer,0,buffer.Length)) > 0) { if (output.Length + bytes > max) throw new InvalidDataException(); output.Write(buffer,0,bytes); }
                return Encoding.UTF8.GetString(output.ToArray());
            }
        }
        static string DefaultEndpointPath()
        {
            try { string root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); return string.IsNullOrEmpty(root) ? null : Path.Combine(root,"LSA Enhanced","control-endpoint.v1.json"); }
            catch { return null; }
        }
        // The endpoint file grants nothing beyond the page: any same-user process
        // can already GET / and read the token. It only replaces HTML scraping.
        internal static string EndpointToken(string address)
        {
            try {
                string file = EndpointPath; if (file == null || address == null) return null;
                var info = new FileInfo(file); if (!info.Exists || info.Length > 4096) return null;
                var value = new JavaScriptSerializer {MaxJsonLength = 8192,RecursionLimit = 4}.DeserializeObject(File.ReadAllText(info.FullName)) as Dictionary<string,object>;
                if (value == null || !value.TryGetValue("version",out var version) || !(version is int number) || number != 1) return null;
                if (!value.TryGetValue("url",out var url) || !(url is string text) || text != address) return null;
                return value.TryGetValue("token",out var token) && token is string secret && Regex.IsMatch(secret,"^[a-f0-9]{64}$") ? secret : null;
            } catch { return null; }
        }
        // Legacy handshake for companions that do not write the endpoint file yet.
        static string PageToken(string address)
        {
            string html; using (var page = Request(address).GetResponse()) html = Read(page,32768);
            var token = Regex.Match(html,"const auth=\"([a-f0-9]{64})\""); return token.Success ? token.Groups[1].Value : null;
        }
        static void Post(string address,string token,string body)
        {
            var request = Request(address + "/api"); request.Method = "POST"; request.ContentType = "application/json"; request.Headers["Origin"] = address; request.Headers["x-lsa-editor"] = token;
            var bytes = Encoding.UTF8.GetBytes(body); request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes,0,bytes.Length);
            // The editor has already completed the operation before its
            // success status. An idempotent promotion can return a large
            // stored memory profile; console input needs no content copy.
            using (var response = request.GetResponse()) { }
        }
        static bool Forbidden(WebException error)
        {
            var response = error.Response as HttpWebResponse; bool forbidden = response != null && response.StatusCode == HttpStatusCode.Forbidden;
            response?.Close(); return forbidden;
        }
        static void Send(string operation,string characterId = null)
        {
            if (!enabled) return;
            if (!nativeReady) {Game.Console.Print("P2 native host is unavailable. Use LSACharacters to open the character editor.");return;}
            if (Interlocked.CompareExchange(ref pending,1,0) != 0) return;
            string address = origin;
            ThreadPool.QueueUserWorkItem(_ => {
                try {
                    string body = operation == null ? "{\"action\":\"promote\"}" : characterId == null
                        ? "{\"action\":\"control_current\",\"operation\":\"" + operation + "\"}"
                        : "{\"action\":\"control\",\"characterId\":\"" + characterId + "\",\"operation\":\"" + operation + "\"}";
                    string token = EndpointToken(address); bool fromFile = token != null;
                    if (!fromFile) token = PageToken(address);
                    if (token == null || !enabled) throw new InvalidDataException();
                    // The editor checks the token before any work, so a 403 after a
                    // companion restart is safe to retry once with the page token.
                    try { Post(address,token,body); }
                    catch (WebException error) when (fromFile && Forbidden(error)) { Post(address,PageToken(address) ?? throw new InvalidDataException(),body); }
                    messages.Enqueue("P2 player character operation completed.");
                } catch { messages.Enqueue("P2 operation unavailable or deferred. Check selection, scripted state and the character editor."); }
                finally { Interlocked.Exchange(ref pending,0); }
            });
        }
        static string Unquote(string value) => value != null && value.Length >= 2 && value[0] == '"' && value[value.Length - 1] == '"' ? value.Substring(1,value.Length - 2) : value;
        static bool Phrase(string value) => value.Length >= 1 && value.Length <= 120 && value.Trim().Length > 0 && !value.Any(char.IsControl);
        static string NewId() => Guid.NewGuid().ToString("D");
        static string Envelope(string id,string command,string expectedEncounterId = null,string phrase = null)
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            object target = command == "gates.read" ? new {kind = "none"} : expectedEncounterId == null ? (object)new {kind = "current"} : new {kind = "current",expect = new {encounterId = expectedEncounterId}};
            object args = phrase == null ? (object)new Dictionary<string,object>() : new {phrase};
            return new JavaScriptSerializer().Serialize(new {v = 1,id,command,target,args,source = "console",issuedAtUtc = now,expiresAtUtc = now + 4000});
        }
        static void StartBridge(string phrase)
        {
            if (!enabled) return;
            if (phrase != null && !Phrase(phrase)) { Game.Console.Print("LSAAskCurrent needs a request of 1-120 characters, for example: LSAAskCurrent \"Follow me.\""); return; }
            lock (bridgeGate)
            {
                if (job != null) { Game.Console.Print("An LSA bridge request is already running."); return; }
                if (!nativeReady || host == null) { Game.Console.Print(Describe("native_unavailable")); return; }
                var next = new BridgeJob {Phrase = phrase,InspectId = NewId()};
                string reply;
                try {
                    reply = host.Submit(Envelope(next.InspectId,"current.inspect"));
                    if (reply == "accepted" && phrase == null) reply = host.Submit(Envelope(next.GatesId = NewId(),"gates.read"));
                } catch { reply = "native_unavailable"; }
                if (reply != "accepted") { Game.Console.Print(Describe(reply)); return; }
                job = next;
            }
        }
        static void PumpBridge()
        {
            lock (bridgeGate)
            {
                var current = job; if (current == null) return;
                if (host == null || !nativeReady) { job = null; Game.Console.Print(Describe("native_unavailable")); return; }
                try {
                    if (current.AskId != null) {
                        var asked = host.TryTakeResult(current.AskId);
                        if (asked != null) { job = null; Game.Console.Print(Ok(Parse(asked),out _,out string reason) ? "Sent your request to the current NPC through Essential's text input." : Describe(reason)); return; }
                    } else {
                        if (current.Inspect == null) current.Inspect = host.TryTakeResult(current.InspectId);
                        if (current.GatesId != null && current.Gates == null) current.Gates = host.TryTakeResult(current.GatesId);
                        if (current.Inspect != null && (current.GatesId == null || current.Gates != null)) { Advance(current); return; }
                    }
                } catch { job = null; Game.Console.Print(Describe("native_unavailable")); return; }
                if (current.Clock.ElapsedMilliseconds > 6000) { job = null; Game.Console.Print("The LSA request timed out. The game must be running, not paused."); }
            }
        }
        static void Advance(BridgeJob current)
        {
            job = null;
            if (!Ok(Parse(current.Inspect),out var npc,out string reason)) { Game.Console.Print(Describe(reason)); return; }
            if (npc == null || !(npc.TryGetValue("present",out var present) && present is bool selected)) { Game.Console.Print(Describe("invalid_result")); return; }
            if (!selected) { Game.Console.Print(Describe("no_current_npc")); return; }
            string encounterId = npc.TryGetValue("encounterId",out var value) ? value as string : null;
            if (encounterId == null || !Regex.IsMatch(encounterId,"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")) { Game.Console.Print(Describe("invalid_result")); return; }
            if (current.Phrase == null) {
                Game.Console.Print(DescribeCurrent(npc,encounterId));
                Game.Console.Print(Ok(Parse(current.Gates),out var gates,out reason) ? DescribeGates(gates) : Describe(reason));
                return;
            }
            current.AskId = NewId(); current.Clock.Restart();
            string reply;
            try { reply = host.Submit(Envelope(current.AskId,"npc.ask",encounterId,current.Phrase)); } catch { reply = "native_unavailable"; }
            if (reply == "accepted") job = current; else Game.Console.Print(Describe(reply));
        }
        static Dictionary<string,object> Parse(string text)
        {
            try { return text == null ? null : new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 8}.DeserializeObject(text) as Dictionary<string,object>; } catch { return null; }
        }
        static bool Ok(Dictionary<string,object> reply,out Dictionary<string,object> result,out string reason)
        {
            result = null; reason = "invalid_result";
            if (reply == null || !reply.TryGetValue("status",out var status)) return false;
            if (status as string == "ok") { reason = null; result = reply.TryGetValue("result",out var value) ? value as Dictionary<string,object> : null; return true; }
            reason = reply.TryGetValue("reason",out var code) && code is string text && Regex.IsMatch(text,"^[a-z][a-z0-9_]{0,63}$") ? text : "invalid_result";
            return false;
        }
        static bool Flag(Dictionary<string,object> value,string key) => value != null && value.TryGetValue(key,out var item) && item is bool flag && flag;
        static string DescribeCurrent(Dictionary<string,object> npc,string encounterId)
        {
            string ped = npc.TryGetValue("pedId",out var value) && value is string id && Regex.IsMatch(id,"^[0-9]{1,12}$") ? id : "?";
            string mode = npc.TryGetValue("mode",out var item) && (item as string == "follow" || item as string == "wait") ? (string)item : "unknown";
            return "Current NPC: ped " + ped + ", encounter " + encounterId.Substring(0,8) + ", " + (Flag(npc,"owned") ? "promoted (" + mode + (Flag(npc,"suspended") ? ", suspended" : "") + ")" : "not promoted")
                + ", " + (Flag(npc,"human") ? "human" : "not a valid human ped") + ", " + (Flag(npc,"safe") ? "P2 control allowed now." : "P2 control blocked now.");
        }
        static string DescribeGates(Dictionary<string,object> gates)
        {
            var scripted = new[] {"cutscene","playerSwitch","mission","online","loading"}.Where(key => Flag(gates,key)).ToArray();
            return "Input gates: text input " + (Flag(gates,"textInputOpen") ? "open" : "closed") + ", controls menu " + (Flag(gates,"controlsMenuOpen") ? "open" : "closed")
                + ", scripted state " + (scripted.Length == 0 ? "none" : string.Join(", ",scripted)) + ".";
        }
        // Fixed catalog: console text never comes from model or profile content.
        static string Describe(string reason)
        {
            switch (reason)
            {
                case "native_unavailable": return "LSA native host is unavailable.";
                case "no_current_npc": return "No current NPC. Mark or talk to an NPC first.";
                case "target_changed": return "The current NPC changed before the request ran. Try again.";
                case "input_busy": return "Essential's text input or controls menu is open.";
                case "scripted_state": return "Not available during cutscenes, missions, player switches, loading or scripted interactions.";
                case "ask_cooldown": return "Wait a moment before asking this NPC again.";
                case "native_stale": return "The LSA request expired. The game must be running, not paused.";
                case "queue_full": return "Too many LSA requests are pending. Try again.";
                default: return "LSA request failed (" + (reason != null && Regex.IsMatch(reason,"^[a-z][a-z0-9_]{0,63}$") ? reason : "invalid_result") + ").";
            }
        }
        internal static void Update() { while (messages.TryDequeue(out var message)) Game.Console.Print(message); PumpBridge(); }
        internal static void Shutdown() { enabled = false; nativeReady=false; SetNativeHost(null); }
    }
}
