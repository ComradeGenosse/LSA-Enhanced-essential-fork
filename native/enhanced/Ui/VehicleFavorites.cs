using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Ui
{
    // Pure, bounded, on-disk vehicle-model favorites. No game objects or NPC identities.
    public sealed class VehicleFavorites
    {
        public const int MaxFavorites = 32, MaxFileBytes = 8192;
        readonly string path;
        readonly List<string> models = new List<string>();
        public IReadOnlyList<string> Models => models.AsReadOnly();

        public VehicleFavorites(string pluginsPath)
        {
            path = Path.Combine(pluginsPath ?? throw new ArgumentNullException(nameof(pluginsPath)), "LSA.CheatFavorites.json");
            Load();
        }
        public static string Normalize(string model)
        {
            if (model == null) return null;
            string value = model.Trim().ToLowerInvariant();
            if (value.Length < 1 || value.Length > 32) return null;
            foreach (char ch in value)
                if (!(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '_')) return null;
            return value;
        }
        void Load()
        {
            try {
                var file = new FileInfo(path);
                if (!file.Exists || file.Length > MaxFileBytes) return;
                var root = new JavaScriptSerializer {MaxJsonLength = MaxFileBytes, RecursionLimit = 4}
                    .DeserializeObject(File.ReadAllText(path,Encoding.UTF8)) as Dictionary<string,object>;
                if (root == null || !(root.TryGetValue("version",out var version) && version is int n && n == 1)
                    || !(root.TryGetValue("vehicles",out var vehicles) && vehicles is object[] entries) || entries.Length > MaxFavorites) return;
                var loaded = new List<string>();
                foreach (object item in entries) {
                    var name = Normalize(item as string);
                    if (name == null || loaded.Contains(name)) return; // Fail closed on edited/corrupt content.
                    loaded.Add(name);
                }
                models.AddRange(loaded);
            } catch { /* Missing/malformed favorites do not stop the in-game menu. */ }
        }
        bool Save(List<string> next)
        {
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                string json = new JavaScriptSerializer().Serialize(new {version = 1, vehicles = next.ToArray()});
                if (Encoding.UTF8.GetByteCount(json) > MaxFileBytes) return false;
                File.WriteAllText(temp,json,new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temp,path,null);
                else File.Move(temp,path);
                return true;
            } catch { return false; }
            finally { try { if (File.Exists(temp)) File.Delete(temp); } catch {} }
        }
        public bool Add(string raw)
        {
            string model = Normalize(raw);
            if (model == null || models.Contains(model) || models.Count >= MaxFavorites) return false;
            var next = new List<string>(models) {model};
            if (!Save(next)) return false;
            models.Add(model);
            return true;
        }
        public bool Remove(string raw)
        {
            string model = Normalize(raw);
            if (model == null || !models.Contains(model)) return false;
            var next = new List<string>(models);
            next.Remove(model);
            if (!Save(next)) return false;
            models.Remove(model);
            return true;
        }
    }
}
