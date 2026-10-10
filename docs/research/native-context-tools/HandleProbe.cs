// Investigation only. Compile against the RPH SDK, then load manually in RPH.
// No spawn/delete/task/persistence/integration requests or dialogue capture.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using Rage;
using Rage.Attributes;

[assembly: Plugin("Native Context Handle Probe", Description = "Read-only, bounded handle observations", Author = "LSA audit", EntryPoint = "NativeContextAudit.HandleProbe.Main")]

namespace NativeContextAudit
{
    public static class HandleProbe
    {
        const string EssentialHash = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
        sealed class Watched
        {
            public Ped Ped;
            public string Id;
            public string Model;
            public bool WasInvalid;
            public bool? LastExists;
        }
        static readonly List<Watched> Watches = new List<Watched>();
        static readonly HashSet<string> Reasons = new HashSet<string> {
            "before-travel", "after-travel", "before-stream-out", "after-stream-back",
            "before-release", "after-release", "recreated-candidate", "callout-persistent", "callout-ended"
        };
        static StreamWriter Writer;
        static bool Running;
        static FieldInfo StateStore, MemoryStore;

        public static void Main()
        {
            string folder = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "native-context-audit-logs");
            Directory.CreateDirectory(folder);
            string file = Path.Combine(folder, DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff", CultureInfo.InvariantCulture) + "-handles.csv");
            Writer = new StreamWriter(file, false);
            Writer.AutoFlush = true;
            Writer.WriteLine("timestampUtc,reason,pedId,pedModel,exists,dead,x25m,y25m,z25m,npcStateExists,continuityMemoryExists");
            // Resolve only already-loaded LSA, and only when it is the pinned DLL.
            // Read dictionary membership even for an invalid ped; public
            // HasState/TryGetMemory reject invalid peds before checking the key.
            // Never enumerate values or call GetState/GetPedData.
            try
            {
                Assembly lsa = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.GetName().Name == "LosSantosAlive");
                if (lsa != null)
                {
                    string hash;
                    using (SHA256 sha = SHA256.Create())
                        hash = BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(lsa.Location))).Replace("-", "").ToLowerInvariant();
                    if (hash == EssentialHash)
                    {
                        StateStore = lsa.ManifestModule.ResolveField(0x040002b4);
                        MemoryStore = lsa.ManifestModule.ResolveField(0x04000435);
                    }
                }
            }
            catch { /* Store status stays unknown; do not log exception contents. */ }
            Game.AddConsoleCommands();
            Running = true;
            try
            {
                while (Running)
                {
                    foreach (Watched w in Watches.ToArray()) Sample(w, "sample");
                    GameFiber.Sleep(500);
                }
            }
            finally { Writer.Dispose(); Writer = null; }
        }

        [ConsoleCommand(Description = "Watch nearest existing ped; maximum eight managed references. No persistence change.")]
        public static void Command_NativeAuditWatchNearest()
        {
            if (Writer == null || Watches.Count >= 8) return;
            Ped player = Game.LocalPlayer.Character;
            Ped ped = player.GetNearbyPeds(16).Where(p => p.Exists() && p != player)
                .OrderBy(p => p.Position.DistanceTo(player.Position)).FirstOrDefault();
            if (ped == null) return;
            string id = ped.Handle.ToString();
            Watched previous = Watches.FirstOrDefault(w => w.Id == id);
            // Seeing the same handle after an invalid sample is a candidate
            // reuse observation. This alone does not prove logical identity.
            string reason = previous != null && previous.WasInvalid ? "handle-seen-after-invalid" : "watch-nearest";
            if (previous != null && !previous.WasInvalid) { Sample(previous, reason); return; }
            Watched watch = new Watched { Ped = ped, Id = id, Model = ped.Model.Name ?? "unknown" };
            Watches.Add(watch);
            Sample(watch, reason);
        }

        [ConsoleCommand(Description = "Mark a fixed lifecycle reason for all watched peds. No free-form/private text.")]
        public static void Command_NativeAuditMark(string reason)
        {
            if (Writer == null || !Reasons.Contains(reason)) return;
            foreach (Watched w in Watches.ToArray()) Sample(w, reason);
        }

        [ConsoleCommand(Description = "Stop the observational probe and flush its CSV.")]
        public static void Command_NativeAuditStop() { Running = false; }

        static string StoreStatus(FieldInfo field, string pedId)
        {
            if (field == null) return "unknown";
            try
            {
                IDictionary dictionary = field.GetValue(null) as IDictionary;
                return dictionary == null ? "unknown" : (dictionary.Contains(pedId) ? "true" : "false");
            }
            catch { return "unknown"; }
        }

        static string Quote(string value) { return "\"" + (value ?? "").Replace("\"", "\"\"") + "\""; }
        static string Coarse(float coordinate) { return (Math.Round(coordinate / 25.0) * 25.0).ToString("0", CultureInfo.InvariantCulture); }
        static void Sample(Watched w, string reason)
        {
            string id = w.Id, model = w.Model, dead = "unknown", existsText = "unknown", x = "", y = "", z = "", state = "unknown", memory = "unknown";
            try
            {
                bool exists = w.Ped.Exists();
                existsText = exists ? "true" : "false";
                if (exists)
                {
                    id = w.Ped.Handle.ToString();
                    model = w.Ped.Model.Name ?? "unknown";
                    dead = w.Ped.IsDead ? "true" : "false";
                    Vector3 position = w.Ped.Position;
                    x = Coarse(position.X); y = Coarse(position.Y); z = Coarse(position.Z);
                    if (id != w.Id) reason = "live-handle-changed";
                    else if (w.LastExists == false) reason = "exists-after-invalid";
                }
                else w.WasInvalid = true;
                w.LastExists = exists;
            }
            catch { /* Only whitelisted observation fields are written. */ }
            state = StoreStatus(StateStore, id);
            memory = StoreStatus(MemoryStore, id);
            Writer.WriteLine(string.Join(",", new[] { Quote(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)), Quote(reason), Quote(id), Quote(model), existsText, dead, x, y, z, state, memory }));
        }
    }
}
