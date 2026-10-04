using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace LSA.Enhanced.Input
{
    public enum EssentialKeyState { Bound, Unbound, Unknown }
    public sealed class EssentialKey
    {
        public EssentialKey(string setting,string value,int vk,EssentialKeyState state) { Setting = setting; Value = value; Vk = vk; State = state; }
        public string Setting {get;}
        public string Value {get;}    // the configured name, for display
        public int Vk {get;}          // 0 unless Bound
        public EssentialKeyState State {get;}
        public string Display => State == EssentialKeyState.Bound ? PhysicalKeys.Name(Vk) : State == EssentialKeyState.Unbound ? "None" : "Unknown (" + Value + ")";
    }
    // Read-only view of Essential's own key settings in
    // plugins/LosSantosAlive/LosSantosAlive.config ("Name=Value" lines, '#'
    // comments). Essential's F7 menu stays the only writer. Only the four key
    // settings' values are ever turned into strings; the rest of every other line,
    // including the ApiKey value (the stock Gemini credential), is skipped
    // character by character while reading the file.
    public sealed class EssentialBindings
    {
        public static readonly string[] Settings = {"TalkKey","TextKey","MarkPedKey","MarkedPedTalkKey"};
        readonly Dictionary<string,EssentialKey> keys;
        EssentialBindings(Dictionary<string,EssentialKey> keys,bool available) { this.keys = keys; Available = available; }
        public bool Available {get;}
        public EssentialKey Talk => keys["TalkKey"];
        public EssentialKey Text => keys["TextKey"];
        public EssentialKey Mark => keys["MarkPedKey"];
        public EssentialKey MarkedTalk => keys["MarkedPedTalkKey"];
        public IEnumerable<EssentialKey> All { get { foreach (var setting in Settings) yield return keys[setting]; } }
        public static EssentialBindings Unavailable()
        {
            var keys = new Dictionary<string,EssentialKey>();
            foreach (var setting in Settings) keys[setting] = new EssentialKey(setting,"",0,EssentialKeyState.Unknown);
            return new EssentialBindings(keys,false);
        }
        public static EssentialBindings Parse(IEnumerable<string> lines)
        {
            var keys = new Dictionary<string,EssentialKey>();
            foreach (var raw in lines) {
                if (raw == null) continue;
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == '#' || line[0] == ';') continue;
                int split = line.IndexOf('=');
                if (split <= 0) continue;
                string name = line.Substring(0,split).Trim();
                string setting = Array.Find(Settings,candidate => string.Equals(candidate,name,StringComparison.OrdinalIgnoreCase));
                if (setting == null) continue; // ApiKey and every other value are never read
                keys[setting] = Key(setting,line.Substring(split + 1).Trim());
            }
            foreach (var setting in Settings) if (!keys.ContainsKey(setting)) keys[setting] = new EssentialKey(setting,"",0,EssentialKeyState.Unknown);
            return new EssentialBindings(keys,true);
        }
        static EssentialKey Key(string setting,string value)
        {
            string shown = value.Length > 24 ? value.Substring(0,24) : value;
            if (value.Length == 0 || string.Equals(value,"None",StringComparison.OrdinalIgnoreCase)) return new EssentialKey(setting,"None",0,EssentialKeyState.Unbound);
            // Essential also accepts numeric virtual-key codes.
            if (int.TryParse(value,NumberStyles.Integer,CultureInfo.InvariantCulture,out int code)) return code > 0 && code < 0xFF ? new EssentialKey(setting,shown,code,EssentialKeyState.Bound) : new EssentialKey(setting,shown,0,EssentialKeyState.Unknown);
            return PhysicalKeys.TryParse(value,out int vk) ? new EssentialKey(setting,shown,vk,EssentialKeyState.Bound) : new EssentialKey(setting,shown,0,EssentialKeyState.Unknown);
        }
        // Null when the file is momentarily unreadable (Essential's F7 menu may be
        // rewriting it): the caller keeps its current bindings and retries on its
        // next poll. Never sleeps; this runs on the game thread.
        public static EssentialBindings Load(string path)
        {
            try {
                var info = new FileInfo(path);
                if (!info.Exists || info.Length > 65536) return Unavailable();
                using (var stream = new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(stream,Encoding.UTF8,true)) return Parse(new List<string>(KeyLines(reader)));
            } catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch { return Unavailable(); }
        }
        // Yields "Name=Value" only for the four key settings. Any other line is read
        // up to '=' (at most 64 characters of its name) and then skipped unread.
        public static IEnumerable<string> KeyLines(TextReader reader)
        {
            var name = new StringBuilder();
            var value = new StringBuilder();
            while (true) {
                name.Clear();
                int c;
                while ((c = reader.Read()) != -1 && c != '=' && c != '\n') if (name.Length < 64) name.Append((char)c);
                if (c == -1 && name.Length == 0) yield break;
                string key = name.ToString().Trim();
                if (c == '=' && Array.Exists(Settings,setting => string.Equals(setting,key,StringComparison.OrdinalIgnoreCase))) {
                    value.Clear();
                    while ((c = reader.Read()) != -1 && c != '\n') if (value.Length < 64) value.Append((char)c);
                    yield return key + "=" + value;
                } else while (c != -1 && c != '\n') c = reader.Read();
                if (c == -1) yield break;
            }
        }
        // A router key equal to an Essential key would double-fire.
        public EssentialKey ConflictWith(int vk)
        {
            foreach (var key in All) if (key.State == EssentialKeyState.Bound && key.Vk == vk) return key;
            return null;
        }
    }
}
