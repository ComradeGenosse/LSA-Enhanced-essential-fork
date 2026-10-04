using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;

namespace LSA.Enhanced.Settings
{
    // Plugins/LSA.Enhanced.json: player-owned, hot-reloaded settings for the
    // input router and the native menu. Input and UI are disabled by default.
    // An invalid file is rejected as a whole and the previous settings stay.
    public sealed class EnhancedSettings
    {
        public const int MaxFileBytes = 16384, MaxPhraseChars = 120;
        static readonly Regex LogicalName = new Regex("^[A-Za-z][A-Za-z0-9]{0,15}$"), BindingId = new Regex("^[a-z][a-zA-Z0-9_]{0,31}$");
        public bool InputEnabled {get;private set;}
        public bool UiEnabled {get;private set;}
        public IReadOnlyList<string> KeyNames {get;private set;}     // logical names, index = logical key
        public IReadOnlyList<int> KeyCodes {get;private set;}        // virtual-key codes by logical key
        public GestureTiming Timing {get;private set;}
        public int RelayPulseMs {get;private set;}
        public int CommandCooldownMs {get;private set;}
        public IReadOnlyList<GestureBinding> Bindings {get;private set;}
        public string OrdinaryNpc {get;private set;}                 // "ask" or "off"
        public IReadOnlyDictionary<string,string> Phrases {get;private set;}
        public string Hud {get;private set;}                         // "notification", "subtitle" or "off"
        public bool TalkEnabled {get;private set;}
        public int TalkKeyCode {get;private set;}
        public string TalkKeyName {get;private set;}
        public int TalkHoldMs {get;private set;} = 220;
        public int TalkCycleWindowMs {get;private set;} = 1500;
        public int TalkSelectionTimeoutMs {get;private set;} = 8000;
        public float TalkRadiusMeters {get;private set;} = 15f;
        public float TalkRetentionRadiusMeters {get;private set;} = 20f;
        public int TalkMaxCandidates {get;private set;} = 8;
        public bool TalkIndicator {get;private set;} = true;
        public string Revision {get;private set;}
        public string Phrase(string key) => key != null && Phrases.TryGetValue(key,out var phrase) ? phrase : null;
        public int KeyIndex(string name) { for (int index = 0; index < KeyNames.Count; index++) if (KeyNames[index] == name) return index; return -1; }

        public static readonly string DefaultJson = "{\"version\":1}";
        public static EnhancedSettings Defaults(CommandCatalog catalog) { TryParse(DefaultJson,catalog,out var settings,out _); settings.Revision = "defaults"; return settings; }
        public static bool TryParse(string json,CommandCatalog catalog,out EnhancedSettings settings,out string error)
        {
            settings = null;
            try { settings = Parse(json,catalog); error = null; return true; }
            catch (SettingsException failure) { error = failure.Message; return false; }
            catch { error = "invalid_json"; return false; }
        }
        sealed class SettingsException : Exception { public SettingsException(string message) : base(message) { } }
        static Exception Fail(string path,string problem) => new SettingsException(path + ": " + problem);
        static EnhancedSettings Parse(string json,CommandCatalog catalog)
        {
            if (json == null || Encoding.UTF8.GetByteCount(json) > MaxFileBytes) throw Fail("file","larger than 16 KiB");
            var root = new JavaScriptSerializer {MaxJsonLength = MaxFileBytes * 2,RecursionLimit = 8}.DeserializeObject(json) as Dictionary<string,object> ?? throw Fail("file","not a JSON object");
            Only(root,"$","version","input","quickCommands","ui","feedback","talkTargeting");
            if (!(root.TryGetValue("version",out var version) && version is int number && number == 1)) throw Fail("version","must be 1");
            var result = new EnhancedSettings();
            using (var hash = SHA256.Create()) result.Revision = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(json))).Replace("-","").ToLowerInvariant();
            var input = Section(root,"input"); Only(input,"input","enabled","keys","timing","bindings");
            result.InputEnabled = Flag(input,"enabled","input.enabled",false);

            var keys = input.ContainsKey("keys") ? input["keys"] as Dictionary<string,object> ?? throw Fail("input.keys","must be an object")
                : new Dictionary<string,object> {{"L4","F6"},{"R4","F8"},{"Menu","F11"}};
            if (keys.Count == 0 || keys.Count > 8) throw Fail("input.keys","needs 1 to 8 keys");
            var names = new List<string>(); var codes = new List<int>();
            foreach (var pair in keys) {
                if (!LogicalName.IsMatch(pair.Key)) throw Fail("input.keys." + pair.Key,"invalid logical key name");
                if (!(pair.Value is string physical) || !PhysicalKeys.TryParse(physical,out int vk)) throw Fail("input.keys." + pair.Key,"unknown key name");
                if (!PhysicalKeys.UsableAsRouterKey(vk)) throw Fail("input.keys." + pair.Key,PhysicalKeys.Name(vk) + " is reserved");
                if (codes.Contains(vk)) throw Fail("input.keys." + pair.Key,PhysicalKeys.Name(vk) + " is used twice");
                names.Add(pair.Key); codes.Add(vk);
            }
            result.KeyNames = names.AsReadOnly(); result.KeyCodes = codes.AsReadOnly();

            var timing = input.ContainsKey("timing") ? input["timing"] as Dictionary<string,object> ?? throw Fail("input.timing","must be an object") : new Dictionary<string,object>();
            Only(timing,"input.timing","chordWindowMs","holdMs","doubleTapMs","relayPulseMs","commandCooldownMs");
            int window = Integer(timing,"chordWindowMs","input.timing.chordWindowMs",120,40,250),holdMs = Integer(timing,"holdMs","input.timing.holdMs",600,300,3000);
            int doubleTapMs = Integer(timing,"doubleTapMs","input.timing.doubleTapMs",250,100,500);
            if (holdMs < window + 100) throw Fail("input.timing.holdMs","must be at least chordWindowMs + 100");
            result.Timing = new GestureTiming(window,holdMs,doubleTapMs);
            result.RelayPulseMs = Integer(timing,"relayPulseMs","input.timing.relayPulseMs",80,30,200);
            result.CommandCooldownMs = Integer(timing,"commandCooldownMs","input.timing.commandCooldownMs",750,250,3000);

            object[] bindings = input.ContainsKey("bindings") ? input["bindings"] as object[] ?? throw Fail("input.bindings","must be an array") : DefaultBindings(names);
            if (bindings.Length > 16) throw Fail("input.bindings","at most 16 bindings");
            var parsed = new List<GestureBinding>(); var seen = new HashSet<string>();
            for (int index = 0; index < bindings.Length; index++) {
                string path = "input.bindings[" + index + "]";
                var item = bindings[index] as Dictionary<string,object> ?? throw Fail(path,"must be an object");
                Only(item,path,"id","gesture","keys","command");
                if (!(item.TryGetValue("id",out var idValue) && idValue is string id && BindingId.IsMatch(id))) throw Fail(path + ".id","invalid id");
                if (parsed.Any(binding => binding.Id == id)) throw Fail(path + ".id","duplicate id " + id);
                if (!(item.TryGetValue("gesture",out var gestureValue) && gestureValue is string gestureText && GestureBinding.TryParseKind(gestureText,out var kind))) throw Fail(path + ".gesture","use tap, chord, hold, chordHold or doubleTap");
                var keyList = item.TryGetValue("keys",out var keysValue) ? keysValue as object[] : null;
                if (keyList == null || keyList.Length != GestureBinding.KeyCount(kind)) throw Fail(path + ".keys",kind == GestureKind.Chord || kind == GestureKind.ChordHold ? "needs two keys" : "needs one key");
                var indexes = new List<int>();
                foreach (var keyValue in keyList) {
                    int keyIndex = keyValue is string keyName ? names.IndexOf(keyName) : -1;
                    if (keyIndex < 0) throw Fail(path + ".keys","undefined logical key");
                    if (indexes.Contains(keyIndex)) throw Fail(path + ".keys","keys must differ");
                    indexes.Add(keyIndex);
                }
                if (!(item.TryGetValue("command",out var commandValue) && commandValue is string command)) throw Fail(path + ".command","missing");
                var info = catalog.Get(command);
                if (info == null) throw Fail(path + ".command","unknown command " + command);
                if (!info.Gesture) throw Fail(path + ".command",command + " cannot be bound to a gesture");
                var binding = new GestureBinding(id,kind,indexes.ToArray(),command);
                if (!seen.Add(kind + ":" + binding.Mask)) throw Fail(path,"duplicate gesture");
                parsed.Add(binding);
            }
            result.Bindings = parsed.AsReadOnly();

            var quick = Section(root,"quickCommands"); Only(quick,"quickCommands","ordinaryNpc","phrases");
            result.OrdinaryNpc = quick.TryGetValue("ordinaryNpc",out var mode) ? mode as string : "ask";
            if (result.OrdinaryNpc != "ask" && result.OrdinaryNpc != "off") throw Fail("quickCommands.ordinaryNpc","use ask or off");
            var phrases = new Dictionary<string,string> {{"follow","Follow me."},{"wait","Wait here."},{"dismiss","That's all, you can go."}};
            if (quick.ContainsKey("phrases")) {
                var custom = quick["phrases"] as Dictionary<string,object> ?? throw Fail("quickCommands.phrases","must be an object");
                Only(custom,"quickCommands.phrases","follow","wait","dismiss");
                foreach (var pair in custom) {
                    if (!(pair.Value is string phrase) || !ValidPhrase(phrase,pair.Key == "dismiss")) throw Fail("quickCommands.phrases." + pair.Key,"1-120 characters, no control characters");
                    phrases[pair.Key] = phrase;
                }
            }
            result.Phrases = phrases;

            var ui = Section(root,"ui"); Only(ui,"ui","enabled");
            result.UiEnabled = Flag(ui,"enabled","ui.enabled",false);
            var talk = Section(root,"talkTargeting");
            Only(talk,"talkTargeting","enabled","key","talkHoldMs","cycleWindowMs","selectionTimeoutMs","radiusMeters","retentionRadiusMeters","maxCandidates","indicator");
            result.TalkEnabled = Flag(talk,"enabled","talkTargeting.enabled",false);
            result.TalkHoldMs = Integer(talk,"talkHoldMs","talkTargeting.talkHoldMs",220,120,500);
            result.TalkCycleWindowMs = Integer(talk,"cycleWindowMs","talkTargeting.cycleWindowMs",1500,500,3000);
            result.TalkSelectionTimeoutMs = Integer(talk,"selectionTimeoutMs","talkTargeting.selectionTimeoutMs",8000,2000,30000);
            result.TalkRadiusMeters = (float)Number(talk,"radiusMeters","talkTargeting.radiusMeters",15,3,30);
            result.TalkRetentionRadiusMeters = (float)Number(talk,"retentionRadiusMeters","talkTargeting.retentionRadiusMeters",20,result.TalkRadiusMeters,50);
            if (result.TalkRetentionRadiusMeters < result.TalkRadiusMeters) throw Fail("talkTargeting.retentionRadiusMeters","must be at least radiusMeters");
            result.TalkMaxCandidates = Integer(talk,"maxCandidates","talkTargeting.maxCandidates",8,1,16);
            result.TalkIndicator = Flag(talk,"indicator","talkTargeting.indicator",true);
            if (talk.TryGetValue("key",out var talkKeyValue)) {
                if (!(talkKeyValue is string keyName) || !PhysicalKeys.TryParse(keyName,out int talkKey) || !PhysicalKeys.UsableAsRouterKey(talkKey)) throw Fail("talkTargeting.key","unknown or reserved key");
                if (codes.Contains(talkKey)) throw Fail("talkTargeting.key",PhysicalKeys.Name(talkKey) + " is already a router key");
                result.TalkKeyCode = talkKey; result.TalkKeyName = PhysicalKeys.Name(talkKey);
            } else if (result.TalkEnabled) throw Fail("talkTargeting.key","required when talk targeting is enabled");
            var feedback = Section(root,"feedback"); Only(feedback,"feedback","hud");
            result.Hud = feedback.TryGetValue("hud",out var hud) ? hud as string : "notification";
            if (result.Hud != "notification" && result.Hud != "subtitle" && result.Hud != "off") throw Fail("feedback.hud","use notification, subtitle or off");
            return result;
        }
        static object[] DefaultBindings(List<string> names)
        {
            var defaults = new List<object>();
            void Add(string id,string gesture,string command,params string[] keys) { if (keys.All(names.Contains)) defaults.Add(new Dictionary<string,object> {{"id",id},{"gesture",gesture},{"keys",keys.Cast<object>().ToArray()},{"command",command}}); }
            Add("mark","tap",CommandCatalog.EssentialMark,"L4");
            Add("text","tap",CommandCatalog.EssentialText,"R4");
            Add("follow","chord",CommandCatalog.CurrentFollow,"L4","R4");
            Add("quickMenu","chordHold",CommandCatalog.UiQuickMenu,"L4","R4");
            Add("menu","tap",CommandCatalog.UiMainMenu,"Menu");
            return defaults.ToArray();
        }
        // Empty is allowed only for dismiss: it turns off the optional dismissal ask.
        public static bool ValidPhrase(string phrase,bool allowEmpty = false)
        {
            if (phrase == null || phrase.Length > MaxPhraseChars) return false;
            if (phrase.Length == 0) return allowEmpty;
            if (phrase.Trim().Length == 0) return false;
            for (int index = 0; index < phrase.Length; index++) {
                char c = phrase[index];
                // U+FFFD is how net481's JavaScriptSerializer delivers an unpaired surrogate.
                if (char.IsControl(c) || c == '\uFFFD') return false;
                if (char.IsHighSurrogate(c)) { if (index + 1 >= phrase.Length || !char.IsLowSurrogate(phrase[index + 1])) return false; index++; }
                else if (char.IsLowSurrogate(c)) return false;
            }
            return true;
        }
        static Dictionary<string,object> Section(Dictionary<string,object> root,string name) =>
            !root.ContainsKey(name) ? new Dictionary<string,object>() : root[name] as Dictionary<string,object> ?? throw Fail(name,"must be an object");
        static void Only(Dictionary<string,object> value,string path,params string[] allowed)
        {
            foreach (var key in value.Keys) if (Array.IndexOf(allowed,key) < 0) throw Fail(path,"unknown setting " + key);
        }
        static bool Flag(Dictionary<string,object> value,string key,string path,bool fallback)
        {
            if (!value.TryGetValue(key,out var item)) return fallback;
            return item is bool flag ? flag : throw Fail(path,"must be true or false");
        }
        static int Integer(Dictionary<string,object> value,string key,string path,int fallback,int min,int max)
        {
            if (!value.TryGetValue(key,out var item)) return fallback;
            if (!(item is int number) || number < min || number > max) throw Fail(path,"must be an integer from " + min + " to " + max);
            return number;
        }
        static double Number(Dictionary<string,object> value,string key,string path,double fallback,double min,double max)
        {
            if (!value.TryGetValue(key,out var item)) return fallback;
            double number = item is int whole ? whole : item is long wide ? wide : item is decimal precise ? (double)precise : item is double floating ? floating : double.NaN;
            if (double.IsNaN(number) || double.IsInfinity(number) || number < min || number > max) throw Fail(path,"must be a number from " + min + " to " + max);
            return number;
        }
    }
}
