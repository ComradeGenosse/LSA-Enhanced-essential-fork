using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Ui
{
    // Candidate vehicle names, not proof that optional DLC/addon models are loaded.
    public sealed class VehicleCatalogEntry
    {
        public string Model, Label;
        public bool Favorite, Custom;
    }
    public sealed class VehicleCatalogPage
    {
        public string Query;
        public int Page, Pages, Total;
        public VehicleCatalogEntry[] Items;
    }
    public sealed class VehicleCatalog
    {
        public const int PageSize = 12, MaxCustom = 128, MaxFileBytes = 16384;
        const string Resource = "LSA.Enhanced.vehicle_models.txt";
        readonly string path;
        readonly VehicleFavorites favorites;
        readonly SortedDictionary<string,string> stock = new SortedDictionary<string,string>(StringComparer.Ordinal);
        readonly List<string> custom = new List<string>();

        public VehicleCatalog(string pluginsPath,VehicleFavorites favoritesStore)
        {
            favorites = favoritesStore ?? throw new ArgumentNullException(nameof(favoritesStore));
            path = Path.Combine(pluginsPath ?? throw new ArgumentNullException(nameof(pluginsPath)), "LSA.VehicleCatalog.json");
            using (var stream = typeof(VehicleCatalog).Assembly.GetManifestResourceStream(Resource)) {
                if (stream == null) throw new InvalidDataException("vehicle_catalog_resource_missing");
                using (var reader = new StreamReader(stream)) {
                    string line;
                    while ((line = reader.ReadLine()) != null) {
                        int separator = line.IndexOf('|');
                        if (separator <= 0) continue;
                        string name = VehicleFavorites.Normalize(line.Substring(0,separator));
                        string label = line.Substring(separator + 1);
                        if (name != null && label.Length > 0 && label.Length <= 64
                            && !label.Any(char.IsControl) && !stock.ContainsKey(name)) stock.Add(name,label);
                    }
                }
            }
            LoadCustom();
        }
        public int StockCount => stock.Count;
        public IReadOnlyList<string> CustomModels => custom.AsReadOnly();

        static string SearchTerm(string raw)
        {
            string search = (raw ?? "").Trim().ToLowerInvariant();
            return search.Length <= 48 && !search.Any(char.IsControl) ? search : null;
        }
        static int Relevance(VehicleCatalogEntry item,string term)
        {
            if (term.Length == 0) return 0;
            string label = item.Label.ToLowerInvariant();
            string compact = term.Replace(" ","").Replace("-","").Replace("_","");
            if (item.Model == compact || label == term) return 0;
            if (item.Model.StartsWith(compact,StringComparison.Ordinal) ||
                label.StartsWith(term,StringComparison.Ordinal)) return 1;
            string[] pieces = term.Split(new[] {' ','-','_'},StringSplitOptions.RemoveEmptyEntries);
            return pieces.Length > 0 && pieces.All(piece =>
                item.Model.Contains(piece) || label.Contains(piece)) ? 2 : -1;
        }
        public VehicleCatalogPage Search(string search,int requestedPage)
        {
            string term = SearchTerm(search);
            var all = new Dictionary<string,VehicleCatalogEntry>(StringComparer.Ordinal);
            foreach (var row in stock) all.Add(row.Key,new VehicleCatalogEntry {Model=row.Key,Label=row.Value});
            foreach (string name in custom)
                if (!all.ContainsKey(name)) all.Add(name,new VehicleCatalogEntry {Model=name,Label=name,Custom=true});
            foreach (string name in favorites.Models) {
                if (!all.ContainsKey(name)) all.Add(name,new VehicleCatalogEntry {Model=name,Label=name,Custom=true});
                all[name].Favorite = true;
            }
            var matches = (term == null ? Enumerable.Empty<VehicleCatalogEntry>()
                : all.Values.Where(item => Relevance(item,term) >= 0))
                .OrderBy(item => Relevance(item,term ?? ""))
                .ThenBy(item => item.Favorite ? 0 : 1)
                .ThenBy(item => item.Label,StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Model,StringComparer.Ordinal).ToArray();
            int pages = Math.Max(1,(matches.Length + PageSize - 1) / PageSize);
            int page = Math.Max(0,Math.Min(pages-1,requestedPage));
            return new VehicleCatalogPage {
                Query=term ?? "",Page=page,Pages=pages,Total=matches.Length,
                Items=matches.Skip(page*PageSize).Take(PageSize).ToArray()
            };
        }
        void LoadCustom()
        {
            try {
                var file = new FileInfo(path);
                if (!file.Exists || file.Length > MaxFileBytes) return;
                var data = new JavaScriptSerializer {MaxJsonLength=MaxFileBytes,RecursionLimit=4}
                    .DeserializeObject(File.ReadAllText(path,Encoding.UTF8)) as Dictionary<string,object>;
                if (data == null || !data.TryGetValue("version",out var version) || !(version is int n) || n != 1
                    || !data.TryGetValue("models",out var value) || !(value is object[] entries)
                    || entries.Length > MaxCustom) return;
                var parsed = new List<string>();
                foreach (object entry in entries) {
                    string model = VehicleFavorites.Normalize(entry as string);
                    if (model == null || parsed.Contains(model) || stock.ContainsKey(model)) return;
                    parsed.Add(model);
                }
                custom.AddRange(parsed);
            } catch { /* Missing or malformed edits leave the built-in catalogue available. */ }
        }
        public bool AddCustom(string raw)
        {
            string model = VehicleFavorites.Normalize(raw);
            if (model == null || stock.ContainsKey(model) || custom.Contains(model) || custom.Count >= MaxCustom) return false;
            var next = new List<string>(custom) {model};
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                string json = new JavaScriptSerializer().Serialize(new {version=1,models=next.ToArray()});
                if (Encoding.UTF8.GetByteCount(json) > MaxFileBytes) return false;
                File.WriteAllText(temporary,json,new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary,path,null);
                else File.Move(temporary,path);
                custom.Add(model);
                return true;
            } catch {return false;}
            finally {try {if (File.Exists(temporary)) File.Delete(temporary);} catch {}}
        }
    }
}
