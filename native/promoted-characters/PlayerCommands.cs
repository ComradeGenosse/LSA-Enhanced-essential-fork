using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Rage;
using Rage.Attributes;

namespace LSA.PromotedCharacters
{
    // Existing RAGE console input keeps live operations in a focused game. The
    // worker talks only to the loopback editor; it never reads/tasks a ped.
    public static class PlayerCommands
    {
        static string origin;
        static int pending;
        static volatile bool enabled;
        static readonly ConcurrentQueue<string> messages = new ConcurrentQueue<string>();
        internal static void Initialize(int port)
        {
            if (port < 1024 || port > 65535) throw new ArgumentException("Invalid P2 editor port.");
            // RAGE discovers the attributed commands when loading this plugin.
            // Initialization only enables them; registering again can produce
            // numbered aliases under another RAGE execution context.
            origin = "http://127.0.0.1:" + port; enabled = true;
        }
        [ConsoleCommand(Name = "LSACharacters",Description = "Show the local P2 character editor URL.")] public static void Command_LSACharacters() { if (enabled) Game.Console.Print("P2 character editor: " + origin); }
        [ConsoleCommand(Name = "LSAPromote",Description = "Promote Essential's currently selected NPC.")] public static void Command_LSAPromote() => Send(null);
        [ConsoleCommand(Name = "LSAFollowPromoted",Description = "Ask the selected promoted character to follow.")] public static void Command_LSAFollowPromoted() => Send("follow");
        [ConsoleCommand(Name = "LSAWaitPromoted",Description = "Ask the selected promoted character to wait.")] public static void Command_LSAWaitPromoted() => Send("wait");
        [ConsoleCommand(Name = "LSADismissPromoted",Description = "Dismiss the selected promoted character without deleting its profile.")] public static void Command_LSADismissPromoted() => Send("dismiss");
        [ConsoleCommand(Name = "LSASummonCharacter",Description = "Summon a persistent character by the exact CharacterId shown in the editor.")] public static void Command_LSASummonCharacter(string characterId) => SendCharacter("summon",characterId);
        [ConsoleCommand(Name = "LSADespawnCharacter",Description = "Despawn an addon-created ped by the exact CharacterId shown in the editor.")] public static void Command_LSADespawnCharacter(string characterId) => SendCharacter("despawn",characterId);
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
        static void Send(string operation,string characterId = null)
        {
            if (!enabled || Interlocked.CompareExchange(ref pending,1,0) != 0) return;
            string address = origin;
            ThreadPool.QueueUserWorkItem(_ => {
                try {
                    string html; using (var page = Request(address).GetResponse()) html = Read(page,32768);
                    var token = Regex.Match(html,"const auth=\"([a-f0-9]{64})\""); if (!token.Success || !enabled) throw new InvalidDataException();
                    var request = Request(address + "/api"); request.Method = "POST"; request.ContentType = "application/json"; request.Headers["Origin"] = address; request.Headers["x-lsa-editor"] = token.Groups[1].Value;
                    string body = operation == null ? "{\"action\":\"promote\"}" : characterId == null
                        ? "{\"action\":\"control_current\",\"operation\":\"" + operation + "\"}"
                        : "{\"action\":\"control\",\"characterId\":\"" + characterId + "\",\"operation\":\"" + operation + "\"}";
                    var bytes = Encoding.UTF8.GetBytes(body); request.ContentLength = bytes.Length;
                    using (var stream = request.GetRequestStream()) stream.Write(bytes,0,bytes.Length);
                    // The editor has already completed the operation before its
                    // success status. An idempotent promotion can return a large
                    // stored memory profile; console input needs no content copy.
                    using (var response = request.GetResponse()) { }
                    messages.Enqueue("P2 player character operation completed.");
                } catch { messages.Enqueue("P2 operation unavailable or deferred. Check selection, scripted state and the character editor."); }
                finally { Interlocked.Exchange(ref pending,0); }
            });
        }
        internal static void Update() { while (messages.TryDequeue(out var message)) Game.Console.Print(message); }
        internal static void Shutdown() { enabled = false; }
    }
}
