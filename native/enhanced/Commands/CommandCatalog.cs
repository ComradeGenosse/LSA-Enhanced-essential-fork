using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Commands
{
    public sealed class CommandInfo
    {
        public string Id, Class, Target, Executor, Hud, AskHud, Phrase;
        public bool Gesture;
    }
    // contracts/commands.v2.json, embedded into the loader at build time. The
    // companion test suite asserts the same SHA-256, so the two sides cannot drift.
    public sealed class CommandCatalog
    {
        public const string ResourceName = "LSA.Enhanced.commands.v2.json";
        public const string ContractSha256 = "07e0ad837bcbce8b6ff088a0b57ae6aad94e23cdbb5ac4a6bc4668a20b15d754";
        public const string EssentialMark = "essential.mark", EssentialText = "essential.text", CurrentFollow = "current.follow", CurrentWait = "current.wait",
            CurrentDismiss = "current.dismiss", CurrentPromote = "current.promote", NpcAsk = "npc.ask", UiMainMenu = "ui.mainMenu", UiQuickMenu = "ui.quickMenu",
            ActivityStatus = "activity.status", ActivityPause = "activity.pause", ActivityResume = "activity.resume", ActivityCancel = "activity.cancel",
            ActivityAssign = "activity.assign", ActivityHistory = "activity.history",
            CharacterSummon = "character.summon", CharacterFollow = "character.follow", CharacterWait = "character.wait", CharacterDismiss = "character.dismiss",
            CharacterDespawn = "character.despawn", CharacterRename = "character.rename", CharacterRelationship = "character.relationship",
            CharacterAvailability = "character.availability", CharacterMemorySelect = "character.memorySelect", CharacterMemoryAdd = "character.memoryAdd";
        static readonly string[] Classes = {"read","control","lifecycle","destructive","profile","ui"};
        static readonly string[] Targets = {"none","current","character"};
        static readonly string[] Executors = {"relay","loader","bridge","companion","ui"};
        static readonly Regex Code = new Regex("^[a-z][a-z0-9_]{0,63}$");
        readonly Dictionary<string,CommandInfo> commands;
        readonly Dictionary<string,string> reasons;
        CommandCatalog(Dictionary<string,CommandInfo> commands,Dictionary<string,string> reasons,string sha256) { this.commands = commands; this.reasons = reasons; Sha256 = sha256; }
        public string Sha256 {get;}
        public IEnumerable<CommandInfo> All => commands.Values;
        public static CommandCatalog LoadEmbedded()
        {
            using (var stream = typeof(CommandCatalog).Assembly.GetManifestResourceStream(ResourceName))
            using (var memory = new MemoryStream()) {
                if (stream == null) throw new InvalidDataException("command_catalog_missing");
                stream.CopyTo(memory); return Parse(memory.ToArray());
            }
        }
        public static CommandCatalog Parse(byte[] bytes)
        {
            string sha;
            using (var hash = SHA256.Create()) sha = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
            var root = new JavaScriptSerializer {MaxJsonLength = 65536,RecursionLimit = 8}.DeserializeObject(System.Text.Encoding.UTF8.GetString(bytes)) as Dictionary<string,object>;
            if (root == null || !(root.TryGetValue("version",out var version) && version is int number && number == 2)) throw new InvalidDataException("command_catalog_invalid");
            var commands = new Dictionary<string,CommandInfo>(StringComparer.Ordinal);
            foreach (var item in (root["commands"] as object[]) ?? throw new InvalidDataException("command_catalog_invalid")) {
                var value = item as Dictionary<string,object> ?? throw new InvalidDataException("command_catalog_invalid");
                var info = new CommandInfo {Id = Text(value,"id"),Class = Text(value,"class"),Target = Text(value,"target"),Executor = Text(value,"executor"),Hud = Text(value,"hud"),
                    AskHud = value.ContainsKey("askHud") ? Text(value,"askHud") : null,Phrase = value.ContainsKey("phrase") ? Text(value,"phrase") : null,
                    Gesture = value.TryGetValue("gesture",out var gesture) && gesture is bool flag && flag};
                if (!Regex.IsMatch(info.Id,"^[a-z]+\\.[a-zA-Z]+$") || !Classes.Contains(info.Class) || !Targets.Contains(info.Target) || !Executors.Contains(info.Executor) || commands.ContainsKey(info.Id)) throw new InvalidDataException("command_catalog_invalid");
                // Gestures may bind only read, control and ui commands (plan rule 4).
                if (info.Gesture && info.Class != "read" && info.Class != "control" && info.Class != "ui") throw new InvalidDataException("command_catalog_invalid");
                commands.Add(info.Id,info);
            }
            var reasons = new Dictionary<string,string>(StringComparer.Ordinal);
            foreach (var pair in (root["reasons"] as Dictionary<string,object>) ?? throw new InvalidDataException("command_catalog_invalid")) {
                if (!Code.IsMatch(pair.Key) || !(pair.Value is string text) || text.Length == 0 || text.Length > 80) throw new InvalidDataException("command_catalog_invalid");
                reasons.Add(pair.Key,text);
            }
            return new CommandCatalog(commands,reasons,sha);
        }
        static string Text(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is string text && text.Length > 0 && text.Length <= 80 ? text : throw new InvalidDataException("command_catalog_invalid");
        public CommandInfo Get(string id) => id != null && commands.TryGetValue(id,out var info) ? info : null;
        public bool HasReason(string code) => code != null && reasons.ContainsKey(code);
        // Player-facing text comes only from this catalog, never from model or profile text.
        public string Describe(string code) => code != null && reasons.TryGetValue(code,out var text) ? text : "Request failed (" + (code != null && Code.IsMatch(code) ? code : "unknown") + ")";
    }
}
