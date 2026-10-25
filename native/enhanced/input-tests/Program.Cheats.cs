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
        } finally {try {Directory.Delete(dir,true);} catch {}}
    }
}
