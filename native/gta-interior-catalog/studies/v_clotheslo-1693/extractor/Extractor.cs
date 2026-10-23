using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Security.Cryptography;
using CodeWalker.GameFiles;
using SharpDX;
// Read-only focused v_clotheslo geometry reader. Never saves any game resource.
class P
{
    static readonly HashSet<string> setModels = new();
    static JsonSerializerOptions opt = new() { IncludeFields = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals }; static StreamWriter output; static float[] V(Vector3 v) => new[] { v.X, v.Y, v.Z }; static float[] Q(Vector4 v) => new[] { v.X, v.Y, v.Z, v.W };
    static float[] Q(Quaternion v) => new[] { v.X, v.Y, v.Z, v.W }; static void W(object o) => output.WriteLine(JsonSerializer.Serialize(o, opt));
    static object D(CEntityDef d) => new { name = d.archetypeName.ToString(), hash = d.archetypeName.Hash, pos = V(d.position), rot = Q(d.rotation), d.scaleXY, d.scaleZ, d.parentIndex, d.numChildren, lod = d.lodLevel.ToString(), d.lodDist, d.childLodDist, d.flags, d.guid };
    static bool Near(Vector3 v, float r = 45) => Math.Abs(v.X - 1693.4592) < r && Math.Abs(v.Y - 4823.674) < r && Math.Abs(v.Z - 42) < 30;
    static void Bound(Bounds b, string file, string child)
    {
        if (b == null)
            return;
        if (!file.EndsWith("v_clotheslo.ybn") && !setModels.Contains(Path.GetFileNameWithoutExtension(file.Replace('\\', '/'))) && (b.BoxMax.X < 1680 || b.BoxMin.X > 1706 || b.BoxMax.Y < 4810 || b.BoxMin.Y > 4840 || b.BoxMax.Z < 40 || b.BoxMin.Z > 49))
            return;
        W(new
        {
            kind = "bound",
            file,
            child,
            type = b.GetType().Name,
            min = V(b.BoxMin),
            max = V(b.BoxMax),
            transform = b.Transform,
            b.CompositeFlags1,
            b.CompositeFlags2,
            b.MaterialIndex
        });
        if (b is BoundComposite c)
        {
            var a = c.Children?.data_items;
            if (a != null)
            for (int i = 0; i < a.Length; i++)
                Bound(a[i], file, child + "/" + i);
        }
        if (b is BoundGeometry g)
        {
            W(new
            {
                kind = "polys",
                file,
                child,
                center = V(g.CenterGeom),
                quantum = V(g.Quantum),
                vertices = g.Vertices?.Select(V),
                polygons = g.Polygons?.Select((p, i) => new { id = i, type = p.Type.ToString(), min = V(p.BoxMin), max = V(p.BoxMax), indices = p.VertexIndices, points = p.VertexPositions?.Select(V), materialIndex = p.MaterialIndex, material = p.Material.ToString() })
            });
        }
    }
    static void Main(string[] args)
    {
        var game = args[0];
        Directory.CreateDirectory(args[1]);
        output = new StreamWriter(Path.Combine(args[1], "focused.jsonl")) { AutoFlush = true };
        GTA5Keys.LoadFromPath(game, true, "");
        var roots = new List<RpfFile>();
        foreach (var f in Directory.GetFiles(game, "*.rpf", SearchOption.AllDirectories).OrderBy(x => x))
        {
            var r = new RpfFile(f, f.Substring(game.Length + 1));
            r.ScanStructure(s => { }, s => Console.Error.WriteLine(s));
            roots.Add(r);
        }
        var flat = new List<RpfFile>();
        void Add(RpfFile r)
        {
            flat.Add(r);
            if (r.Children != null)
            foreach (var c in r.Children)
                Add(c);
        }
        foreach (var r in roots)
            Add(r);
        var m = new RpfManager();
        m.Init(flat, true);
        var all = new List<RpfFileEntry>();
        foreach (var r in flat)
        if (r.AllEntries != null)
        foreach (var e in r.AllEntries)
        if (e is RpfFileEntry fe)
            all.Add(fe);
        all = all.OrderBy(e => e.Path).ToList();
        foreach (var e in all)
            JenkIndex.Ensure(Path.GetFileNameWithoutExtension(e.Name).ToLowerInvariant());
        W(new
        {
            kind = "run",
            utc = DateTime.UtcNow,
            game,
            rpfs = flat.Count,
            entries = all.Count
        });
        var names = new HashSet<uint>();
        var meshHashes = new HashSet<uint>();
        foreach (var e in all.Where(e => e.Name.EndsWith(".ymap") && (e.Name.Contains("cs2_01") || e.Name == "cs2_lod.ymap")))
        {
            try
            {
                var y = m.GetFile<YmapFile>(e);
                if (y.AllEntities == null)
                    continue;
                for (int i = 0; i < y.AllEntities.Length; i++)
                {
                    var d = y.AllEntities[i]._CEntityDef;
                    if (!Near(d.position) && e.Name != "cs2_lod.ymap" && e.Name != "cs2_01.ymap" && e.Name != "hei_cs2_01.ymap")
                        continue;
                    names.Add(d.archetypeName.Hash);
                    if (Near(d.position, 15))
                        meshHashes.Add(d.archetypeName.Hash);
                    W(new
                    {
                        kind = "placement",
                        localParentIndex = y.AllEntities[i].Parent?.Index,
                        localParentName = y.AllEntities[i].Parent?._CEntityDef.archetypeName.ToString(),
                        isMlo = y.AllEntities[i].IsMlo,
                        orientation = Q(y.AllEntities[i].Orientation),
                        file = e.Path,
                        index = i,
                        parent = y.CMapData.parent.ToString(),
                        entity = D(d)
                    });
                }
            }
            catch (Exception ex) { W(new { kind = "error", file = e.Path, error = ex.ToString() }); }
        }
        foreach (var e in all.Where(e => e.Name.EndsWith(".ytyp")))
        {
            try
            {
                var y = m.GetFile<YtypFile>(e);
                foreach (var a in y.AllArchetypes ?? Array.Empty<Archetype>())
                {
                    var d = a.BaseArchetypeDef;
                    if (!names.Contains(d.name.Hash) && d.name.ToString() != "v_clotheslo" && !d.name.ToString().StartsWith("v_51_"))
                        continue;
                    W(new
                    {
                        kind = "archetype",
                        file = e.Path,
                        name = d.name.ToString(),
                        hash = d.name.Hash,
                        asset = d.assetName.ToString(),
                        physics = d.physicsDictionary.ToString(),
                        dictionary = d.drawableDictionary.ToString(),
                        assetType = d.assetType.ToString(),
                        min = V(d.bbMin),
                        max = V(d.bbMax),
                        d.flags,
                        d.lodDist
                    });
                    if (a is MloArchetype ma)
                    {
                        if (Environment.GetEnvironmentVariable("X9_ENTITY_SETS") == "1" && d.name.ToString() == "v_clotheslo")
                            foreach (var set in ma.entitySets ?? Array.Empty<MCMloEntitySet>())
                                foreach (var en in set.Entities ?? Array.Empty<MCEntityDef>())
                                    setModels.Add(en.Data.archetypeName.ToString());
                        W(new
                        {
                            kind = "mlo",
                            file = e.Path,
                            rooms = ma.rooms?.Select((r, i) => new { index = i, name = r.RoomName, min = V(r.BBMin), max = V(r.BBMax), r.Data, r.AttachedObjects }),
                            portals = ma.portals?.Select((p, i) => new { index = i, p.Data, points = p.Corners?.Select(v => new[] { v.X, v.Y, v.Z }) }),
                            entities = ma.entities?.Select((en, i) => new { index = i, entity = D(en.Data) }),
                            sets = ma.entitySets?.Select(s => new { s.Name, s.Index, s.Locations, entities = s.Entities?.Select(en => D(en.Data)) })
                        });
                    }
                }
            }
            catch (Exception ex) { W(new { kind = "error", file = e.Path, error = ex.ToString() }); }
        }
        foreach (var fe in all.Where(e => e.Name.Contains("cs2_01") && (e.Name.EndsWith(".ydd") || e.Name.Contains("cloth"))))
            W(new
            {
                kind = "file",
                file = fe.Path,
                size = fe.GetFileSize()
            });
        var meshNames = new HashSet<string>(new[] { "cs2_01_clothshop", "cs2_01_clothshop_obja", "cs2_01_shop_dec2", "cs2_01_markets2", "cs2_01_markets2_obj1b", "cs2_01_shop_dec1" });
        foreach (var e in all)
        {
            var n = Path.GetFileNameWithoutExtension(e.Name).ToLowerInvariant();
            bool mesh = (e.Name.EndsWith(".yft") && setModels.Contains(n)) || e.Name.EndsWith(".ydr") && (setModels.Contains(n) || meshNames.Contains(n) || meshHashes.Contains(JenkHash.GenHash(n)) || n.StartsWith("v_51_") || n.Contains("cs2_01") && n.Contains("cloth"));
            bool col = false;
            if (!mesh && !col)
                continue;
            try
            {
                var bytes = m.GetFileData(e.Path);
                W(new
                {
                    kind = "asset",
                    file = e.Path,
                    size = e.GetFileSize(),
                    sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                });
                if (col)
                {
                    Bound(m.GetFile<YbnFile>(e).Bounds, e.Path, "root");
                    continue;
                }
                DrawableBase dr;
                if (e.Name.EndsWith(".yft"))
                {
                    var fragment = m.GetFile<YftFile>(e).Fragment;
                    dr = fragment.Drawable;
                    Bound(fragment.PhysicsLODGroup?.PhysicsLOD1?.Bound, e.Path, "fragment");
                }
                else
                {
                    var reader = new ResourceDataReader((RpfResourceFileEntry)e, bytes);
                    if (((RpfResourceFileEntry)e).Version == 165)
                        reader.IsGen9 = false;
                    dr = reader.ReadBlock<Drawable>();
                }
                W(new
                {
                    kind = "drawable",
                    file = e.Path,
                    min = V(dr.BoundingBoxMin),
                    max = V(dr.BoundingBoxMax),
                    dr.LodDistHigh,
                    dr.LodDistMed,
                    dr.LodDistLow,
                    dr.LodDistVlow
                });
                if (dr is Drawable drawable)
                    Bound(drawable.Bound, e.Path, "embedded");
                int mi = 0;
                foreach (var model in dr.AllModels ?? Array.Empty<DrawableModel>())
                {
                    int gi = 0;
                    foreach (var g in model.Geometries)
                    {
                        var vd = g.VertexData;
                        var points = vd == null ? null : Enumerable.Range(0, vd.VertexCount).Select(i => V(vd.GetVector3(i, 0))).ToArray();
                        W(new
                        {
                            kind = "mesh",
                            file = e.Path,
                            model = mi,
                            geometry = gi++,
                            shader = g.Shader?.Name.ToString(),
                            g.VerticesCount,
                            g.TrianglesCount,
                            points,
                            indices = g.IndexBuffer?.Indices
                        });
                    }
                    mi++;
                }
            }
            catch (Exception ex) { W(new { kind = "error", file = e.Path, error = ex.ToString() }); }
        }
        foreach (var e in all.Where(e => new[] { "cs2_01_slod1_children.ydd", "cs2_01_clotheslow_slod_children.ydd", "cs2_lod_123_slod2_children.ydd" }.Contains(e.Name)))
        {
            try
            {
                var bytes = m.GetFileData(e.Path);
                W(new
                {
                    kind = "asset",
                    file = e.Path,
                    size = e.GetFileSize(),
                    sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                });
                var y = m.GetFile<YddFile>(e);
                W(new
                {
                    kind = "dictionary",
                    file = e.Path,
                    items = y.Dict?.Select(p => new { hash = p.Key, name = JenkIndex.TryGetString(p.Key) })
                });
                foreach (var kv in y.Dict)
                {
                    if (!new uint[] { 1814693341, 1095778734, 1944137204 }.Contains(kv.Key))
                        continue;
                    var dr = kv.Value;
                    var nm = JenkIndex.TryGetString(kv.Key);
                    if (string.IsNullOrEmpty(nm))
                        nm = kv.Key.ToString();
                    W(new
                    {
                        kind = "drawable",
                        file = e.Path,
                        item = nm,
                        hash = kv.Key,
                        min = V(dr.BoundingBoxMin),
                        max = V(dr.BoundingBoxMax)
                    });
                    int mi = 0;
                    foreach (var model in dr.AllModels)
                    {
                        int gi = 0;
                        foreach (var g in model.Geometries)
                        {
                            var vd = g.VertexData;
                            W(new
                            {
                                kind = "mesh",
                                file = e.Path,
                                item = nm,
                                model = mi,
                                geometry = gi++,
                                shader = g.Shader?.Name.ToString(),
                                g.VerticesCount,
                                g.TrianglesCount,
                                points = Enumerable.Range(0, vd.VertexCount).Select(i => V(vd.GetVector3(i, 0))),
                                indices = g.IndexBuffer?.Indices
                            });
                        }
                        mi++;
                    }
                }
            }
            catch (Exception ex) { W(new { kind = "error", file = e.Path, error = ex.ToString() }); }
        }
        int parsed = 0, hits = 0, errors = 0;
        foreach (var e in all.Where(e => e.Name.EndsWith(".ybn")))
        {
            try
            {
                var y = m.GetFile<YbnFile>(e);
                parsed++;
                var b = y.Bounds;
                if (b == null)
                {
                    errors++;
                    W(new
                    {
                        kind = "collision_error",
                        file = e.Path,
                        error = "null bounds"
                    });
                    continue;
                }
                if (e.Name != "v_clotheslo.ybn" && (b.BoxMax.X < 1680 || b.BoxMin.X > 1706 || b.BoxMax.Y < 4810 || b.BoxMin.Y > 4840 || b.BoxMax.Z < 40 || b.BoxMin.Z > 49))
                    continue;
                hits++;
                var bytes = m.GetFileData(e.Path);
                W(new
                {
                    kind = "asset",
                    file = e.Path,
                    size = e.GetFileSize(),
                    sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                });
                Bound(b, e.Path, "root");
            }
            catch (Exception ex) { errors++; W(new { kind = "collision_error", file = e.Path, error = ex.Message }); }
        }
        W(new
        {
            kind = "collision_scan",
            parsed,
            hits,
            errors
        });
        output.Close();
    }
}
