using System;
using System.IO;
using System.Linq;
using LSA.Enhanced.Ui;

static partial class Program
{
    static void CheatFavoritesTests()
    {
        string dir = Path.Combine(Path.GetTempPath(),"lsa-cheat-favorites-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try {
            var store = new VehicleFavorites(dir);
            Check(store.Models.Count == 0,"new favorites file starts empty");
            Check(store.Add("  COMET2  ") && store.Add("sultanrs"),"favorites accept normalized models");
            Check(!store.Add("comet2") && !store.Add("../escape") && !store.Add("bad~name"),"duplicate and hostile model names rejected");
            var reload = new VehicleFavorites(dir);
            Check(reload.Models.SequenceEqual(new[] {"comet2","sultanrs"}),"favorites survive a reload in insertion order");
            Check(reload.Remove("COMET2") && !reload.Remove("comet2"),"removal is persistent and duplicate removal fails");
            Check(new VehicleFavorites(dir).Models.SequenceEqual(new[] {"sultanrs"}),"removal survives reload");
            File.WriteAllText(Path.Combine(dir,"LSA.CheatFavorites.json"),"{broken");
            Check(new VehicleFavorites(dir).Models.Count == 0,"corrupt favorites fail closed without crashing");
            File.WriteAllText(Path.Combine(dir,"LSA.CheatFavorites.json"),"{\"version\":1,\"vehicles\":[\"adder\",\"adder\"]}");
            Check(new VehicleFavorites(dir).Models.Count == 0,"duplicate file entries rejected");
            var favs = new VehicleFavorites(dir);
            var catalog = new VehicleCatalog(dir,favs);
            Check(catalog.StockCount >= 800,"bundled GTA vehicle reference list indexed");
            Check(catalog.Search("",0).Total >= 800 && catalog.Search("",500).Page > 0,"unfiltered catalogue pages and bounds");
            Check(catalog.Search("comet2",0).Items.Any(x => x.Model == "comet2"),"exact model auto-suggestion");
            Check(catalog.Search("Comet 2",0).Items.Any(x => x.Model == "comet2"),"human-friendly vehicle names searchable");
            Check(catalog.Search("sultan",0).Items.Any(x => x.Model == "sultanrs"),"partial search finds variants");
            Check(catalog.Search("zzzz-no-vehicle",0).Total == 0,"nonmatching query does not fabricate results");
            Check(catalog.AddCustom(" custom_super_2026 ") && !catalog.AddCustom("CUSTOM_SUPER_2026"),"addon names normalize and deduplicate");
            Check(!catalog.AddCustom("../not_a_model") && !catalog.AddCustom("adder"),"invalid and built-in addon duplicates rejected");
            Check(new VehicleCatalog(dir,favs).Search("custom_super",0).Items.Any(x => x.Model == "custom_super_2026"),"addon model survives reload and is searchable");
            Check(favs.Add("custom_super_2026") && catalog.Search("custom_super",0).Items.First().Favorite,"saved favorites are highlighted in search");
            File.WriteAllText(Path.Combine(dir,"LSA.VehicleCatalog.json"),"{broken");
            Check(new VehicleCatalog(dir,favs).StockCount >= 800,"corrupt addon catalogue cannot break stock list");
        } finally {try {Directory.Delete(dir,true);} catch {}}
    }
}
