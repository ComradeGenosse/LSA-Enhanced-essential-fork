// X9 interior catalog extractor (read-only). Uses CodeWalker.Core (not redistributed) to read installed GTA V Enhanced archives.
// Usage: dotnet run -- <keyPath> <outDir> <gameDir> <mode> <shard> <nshards>
//   mode: ytyp  -> mlo-ytyp-<shard>.jsonl + archetypes-<shard>.tsv + files-<shard>.tsv(only shard 0)
//         ymap  -> mlo-inst-<shard>.jsonl + ents-<shard>.tsv + ymaps-<shard>.tsv  (needs archetypes-*.tsv from the ytyp stage)
// Output contains names, hashes, transforms, bounds and archive provenance only - never asset bytes.
using System; using System.IO; using System.Linq; using System.Collections.Generic; using System.Text; using System.Text.Json;
using System.Globalization;
using CodeWalker.GameFiles;

static class X {
  const string ExtractorVersion = "1";
  static string F(float v) => v.ToString("R", CultureInfo.InvariantCulture);
  static string[] V3(SharpDX.Vector3 v) => new[] { F(v.X), F(v.Y), F(v.Z) };
  static float[] A3(SharpDX.Vector3 v) => new[] { v.X, v.Y, v.Z };
  static string Nm(MetaHash h) { var s = h.ToString(); return s; }
  static bool Resolved(MetaHash h) { var s = h.ToString(); return !(s == h.Hash.ToString() || s.StartsWith("hash_", StringComparison.OrdinalIgnoreCase)); }
  static (string layer, string dlc) Layer(string path) {
    var p = path.ToLowerInvariant();
    string After(string key) { int i = p.IndexOf(key); if (i < 0) return ""; var r = p.Substring(i + key.Length); int j = r.IndexOf('\\'); return j < 0 ? r : r.Substring(0, j); }
    if (p.StartsWith("onigiri\\")) { var d = After("dlcpacks\\"); return ("onigiri-nve", d); }
    if (p.StartsWith("update\\")) {
      if (p.Contains("dlcpacks\\")) return ("update-dlcpack", After("dlcpacks\\"));
      if (p.Contains("dlc_patch\\")) return ("update-dlc_patch", After("dlc_patch\\"));
      return ("update-base", "");
    }
    return ("base", "");
  }
  static string TopRpf(string path) { int i = path.IndexOf(".rpf", StringComparison.OrdinalIgnoreCase); return i < 0 ? path : path.Substring(0, i + 4); }
  static string DirOf(string p) { int i = p.LastIndexOf('\\'); return i < 0 ? "" : p.Substring(0, i); }

  static void Main(string[] args) {
    string keyPath = args[0], outd = args[1], real = args[2], mode = args[3];
    int sh = int.Parse(args[4]), nsh = int.Parse(args[5]);
    Directory.CreateDirectory(outd);
    var log = new StreamWriter(Path.Combine(outd, $"run-{mode}-{sh}.log")) { AutoFlush = true };
    Action<string> st = s => { }; Action<string> er = s => log.WriteLine("E " + s);
    GTA5Keys.LoadFromPath(keyPath, true, "");
    var list = new List<RpfFile>();
    foreach (var f in Directory.GetFiles(real, "*.rpf", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal)) {
      var rel = f.Substring(real.Length + 1).Replace('/', '\\');
      try { var rf = new RpfFile(f, rel); rf.ScanStructure(st, er); list.Add(rf); } catch (Exception ex) { log.WriteLine("E open " + f + " " + ex.Message); }
    }
    var flat = new List<RpfFile>(); void Add(RpfFile r) { flat.Add(r); if (r.Children != null) foreach (var c in r.Children) Add(c); }
    foreach (var r in list) Add(r);
    var m = new RpfManager(); m.Init(flat, true);
    var all = new List<RpfFileEntry>();
    foreach (var r in flat) if (r.AllEntries != null) foreach (var e in r.AllEntries) if (e is RpfFileEntry fe) all.Add(fe);
    all = all.OrderBy(e => e.Path, StringComparer.Ordinal).ToList();
    log.WriteLine($"rpfs={flat.Count} entries={all.Count}");
    var jopt = new JsonSerializerOptions { WriteIndented = false };

    if (mode == "ytyp") {
      var ytyps = all.Where(e => e.Name.EndsWith(".ytyp", StringComparison.OrdinalIgnoreCase)).ToList();
      var tw = new StreamWriter(Path.Combine(outd, $"archetypes-{sh}.tsv")) { AutoFlush = false };
      var jw = new StreamWriter(Path.Combine(outd, $"mlo-ytyp-{sh}.jsonl")) { AutoFlush = true };
      var fileNames = new HashSet<string>();
      int n = 0;
      for (int yi = 0; yi < ytyps.Count; yi++) {
        if (yi % nsh != sh) continue; var e = ytyps[yi];
        try {
          var y = m.GetFile<YtypFile>(e); if (y == null || y.AllArchetypes == null) continue; n++;
          var (layer, dlc) = Layer(e.Path);
          foreach (var a in y.AllArchetypes) {
            var d = a.BaseArchetypeDef; var mn = d.bbMin; var mx = d.bbMax;
            bool isMlo = a is MloArchetype;
            tw.WriteLine(string.Join("\t", d.name.Hash, Nm(d.name), F(mn.X), F(mn.Y), F(mn.Z), F(mx.X), F(mx.Y), F(mx.Z), d.assetType, F(d.lodDist), d.flags, isMlo ? "MLO" : "-", layer, e.Path));
            if (!isMlo) continue;
            var ma = (MloArchetype)a;
            var rooms = new List<object>(); var portals = new List<object>(); var sets = new List<object>(); var ents = new List<object>();
            var entRoom = new Dictionary<int, int>();
            if (ma.rooms != null) for (int i = 0; i < ma.rooms.Length; i++) {
              var r = ma.rooms[i]; var rd = r.Data;
              if (r.AttachedObjects != null) foreach (var o in r.AttachedObjects) if (!entRoom.ContainsKey((int)o)) entRoom[(int)o] = i;
              rooms.Add(new { index = i, name = r.RoomName, bbMin = A3(r.BBMin), bbMax = A3(r.BBMax), flags = rd.flags, floorId = rd.floorId, portalCount = rd.portalCount, exteriorVisibilityDepth = rd.exteriorVisibiltyDepth, timecycle = Nm(rd.timecycleName), attachedObjects = r.AttachedObjects?.Length ?? 0 });
            }
            if (ma.portals != null) for (int i = 0; i < ma.portals.Length; i++) {
              var p = ma.portals[i]; var pd = p.Data;
              portals.Add(new { index = i, roomFrom = pd.roomFrom, roomTo = pd.roomTo, flags = pd.flags, opacity = pd.opacity, audioOcclusion = pd.audioOcclusion, center = A3(p.Center), cornerCount = p.Corners?.Length ?? 0, corners = p.Corners?.Select(c => new[] { c.X, c.Y, c.Z }).ToArray(), attachedObjects = p.AttachedObjects?.Length ?? 0 });
            }
            if (ma.entitySets != null) foreach (var s in ma.entitySets) sets.Add(new { index = s.Index, name = s.Name, entityCount = s.Entities?.Length ?? 0, locations = s.Locations?.Length ?? 0 });
            if (ma.entities != null) for (int i = 0; i < ma.entities.Length; i++) {
              var en = ma.entities[i]; var ed = en.Data;
              fileNames.Add(Nm(ed.archetypeName));
              ents.Add(new { index = i, archetype = Nm(ed.archetypeName), hash = ed.archetypeName.Hash, resolved = Resolved(ed.archetypeName), position = new[] { ed.position.X, ed.position.Y, ed.position.Z }, rotation = new[] { ed.rotation.X, ed.rotation.Y, ed.rotation.Z, ed.rotation.W }, scaleXY = ed.scaleXY, scaleZ = ed.scaleZ, flags = ed.flags, guid = ed.guid, parentIndex = ed.parentIndex, lodDist = ed.lodDist, room = entRoom.TryGetValue(i, out var rr) ? rr : -1 });
            }
            var rec = new {
              archetype = Nm(d.name), hash = d.name.Hash, resolved = Resolved(d.name), ytyp = e.Path, ytypFile = e.Name, topRpf = TopRpf(e.Path), layer, dlc,
              mloFlags = ma.MloArchetypeDef.MloArchetypeDef.mloFlags, lodDist = d.lodDist, flags = d.flags, bbMin = A3(mn), bbMax = A3(mx), bsCentre = A3(d.bsCentre), bsRadius = d.bsRadius,
              timeCycleModifiers = ma.timeCycleModifiers?.Length ?? 0, rooms, portals, entitySets = sets, entities = ents
            };
            jw.WriteLine(JsonSerializer.Serialize(rec, jopt));
          }
        } catch (Exception ex) { log.WriteLine("E ytyp " + e.Path + " " + ex.Message); }
      }
      tw.Flush(); tw.Close(); jw.Close();
      if (sh == 0) {
        // asset presence table (lowercase basename + extension) for ydr/yft/ydd/ybn/ymap, with layer
        using var fw = new StreamWriter(Path.Combine(outd, "files.tsv"));
        foreach (var e in all) {
          var ext = Path.GetExtension(e.Name).ToLowerInvariant();
          if (ext == ".ydr" || ext == ".yft" || ext == ".ydd" || ext == ".ybn" || ext == ".ymap" || ext == ".ytyp") {
            var (layer, dlc) = Layer(e.Path);
            fw.WriteLine(string.Join("\t", Path.GetFileNameWithoutExtension(e.Name).ToLowerInvariant(), ext, e.GetFileSize(), layer, dlc, e.Path));
          }
        }
      }
      log.WriteLine($"ytyp parsed={n}");
    } else if (mode == "ymap") {
      var dims = new Dictionary<uint, (float sx, float sy, float sz)>();
      var mloHash = new HashSet<uint>();
      foreach (var f in Directory.GetFiles(outd, "archetypes-*.tsv")) foreach (var line in File.ReadLines(f)) {
        var c = line.Split('\t'); if (c.Length < 14) continue;
        uint h = uint.Parse(c[0]); float sx = float.Parse(c[5], CultureInfo.InvariantCulture) - float.Parse(c[2], CultureInfo.InvariantCulture);
        float sy = float.Parse(c[6], CultureInfo.InvariantCulture) - float.Parse(c[3], CultureInfo.InvariantCulture); float sz = float.Parse(c[7], CultureInfo.InvariantCulture) - float.Parse(c[4], CultureInfo.InvariantCulture);
        dims[h] = (sx, sy, sz); if (c[11] == "MLO") mloHash.Add(h);
      }
      log.WriteLine($"archetype dims={dims.Count} mlo={mloHash.Count}");
      float minXY = float.Parse(Environment.GetEnvironmentVariable("X9_MIN_XY") ?? "6", CultureInfo.InvariantCulture);
      float minZ = float.Parse(Environment.GetEnvironmentVariable("X9_MIN_Z") ?? "2.5", CultureInfo.InvariantCulture);
      var ymaps = all.Where(e => e.Name.EndsWith(".ymap", StringComparison.OrdinalIgnoreCase)).ToList();
      var jw = new StreamWriter(Path.Combine(outd, $"mlo-inst-{sh}.jsonl")) { AutoFlush = true };
      var ew = new StreamWriter(Path.Combine(outd, $"ents-{sh}.tsv"));
      var yw = new StreamWriter(Path.Combine(outd, $"ymaps-{sh}.tsv"));
      int nHit = 0, nEnt = 0, nY = 0;
      for (int yi = 0; yi < ymaps.Count; yi++) {
        if (yi % nsh != sh) continue; var e = ymaps[yi];
        try {
          var y = m.GetFile<YmapFile>(e); if (y == null) continue; nY++;
          var (layer, dlc) = Layer(e.Path); var cm = y.CMapData;
          yw.WriteLine(string.Join("\t", yi, e.Path, layer, dlc, Nm(cm.name), Nm(cm.parent), cm.flags, cm.contentFlags));
          if (y.CMloInstanceDefs != null) for (int i = 0; i < y.CMloInstanceDefs.Length; i++) {
            var mi = y.CMloInstanceDefs[i]; var d = mi.CEntityDef; nHit++;
            var rec = new {
              archetype = Nm(d.archetypeName), hash = d.archetypeName.Hash, resolved = Resolved(d.archetypeName), ymap = e.Path, ymapName = e.Name, topRpf = TopRpf(e.Path), layer, dlc, instanceIndex = i,
              ymapParent = Nm(cm.parent), ymapFlags = cm.flags, ymapContentFlags = cm.contentFlags,
              position = new[] { d.position.X, d.position.Y, d.position.Z }, rotationRaw = new[] { d.rotation.X, d.rotation.Y, d.rotation.Z, d.rotation.W }, scaleXY = d.scaleXY, scaleZ = d.scaleZ,
              entityFlags = d.flags, guid = d.guid, lodLevel = d.lodLevel.ToString(), parentIndex = d.parentIndex, lodDist = d.lodDist,
              groupId = mi.groupId, floorId = mi.floorId, numExitPortals = mi.numExitPortals, mloInstFlags = mi.MLOInstflags,
              defaultEntitySets = mi.defaultEntitySets.GetItems(y.Meta)?.ToArray() ?? new uint[0],
              entitiesExtents = new { min = A3(cm.entitiesExtentsMin), max = A3(cm.entitiesExtentsMax) }
            };
            jw.WriteLine(JsonSerializer.Serialize(rec, jopt));
          }
          if (y.CEntityDefs != null) for (int i = 0; i < y.CEntityDefs.Length; i++) {
            var d = y.CEntityDefs[i]; if (mloHash.Contains(d.archetypeName.Hash)) { /* plain entity referencing MLO archetype */ }
            if (!dims.TryGetValue(d.archetypeName.Hash, out var dm)) continue;
            if (Math.Max(dm.sx, dm.sy) < minXY || dm.sz < minZ) continue;
            var lod = d.lodLevel.ToString(); if (lod == "LODTYPES_DEPTH_LOD" || lod.StartsWith("LODTYPES_DEPTH_SLOD") ) continue;
            var nm = Nm(d.archetypeName); if (nm.StartsWith("prop_", StringComparison.OrdinalIgnoreCase)) continue;
            ew.WriteLine(string.Join("\t", d.archetypeName.Hash, nm, F(d.position.X), F(d.position.Y), F(d.position.Z), F(d.rotation.X), F(d.rotation.Y), F(d.rotation.Z), F(d.rotation.W), yi, i, lod, d.flags, d.parentIndex)); nEnt++;
          }
        } catch (Exception ex) { log.WriteLine("E ymap " + e.Path + " " + ex.Message); }
      }
      jw.Close(); ew.Close(); yw.Close();
      log.WriteLine($"ymaps parsed={nY} mlo instances={nHit} big entities={nEnt}");
    }
    log.WriteLine("done");
  }
}
