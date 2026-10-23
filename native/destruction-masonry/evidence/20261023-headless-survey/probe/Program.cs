using System; using System.IO; using System.Linq; using System.Collections.Generic; using System.Text;
using CodeWalker.GameFiles;
class P{
 static StreamWriter log;
 static void Main(string[] args){
 string gta=args[0], outd=args[1], real=args[2]; string mode=args[3]; int sh=int.Parse(args[4]), nsh=int.Parse(args[5]);
 Directory.CreateDirectory(outd);
 log=new StreamWriter(outd+"/run"+sh+".log"){AutoFlush=true};
 Action<string> st=s=>{}; Action<string> er=s=>log.WriteLine("E "+s);
 GTA5Keys.LoadFromPath(gta,true,"");
 var list=new List<RpfFile>();
 foreach(var f in Directory.GetFiles(real,"*.rpf",SearchOption.AllDirectories)){
  var rel=f.Substring(real.Length+1).Replace('/','\\');
  try{ var rf=new RpfFile(f,rel); rf.ScanStructure(st,er); list.Add(rf);}catch(Exception ex){log.WriteLine("E open "+f+" "+ex.Message);} }
 var flat=new List<RpfFile>(); void Add(RpfFile r){ flat.Add(r); if(r.Children!=null) foreach(var c in r.Children) Add(c);} foreach(var r in list) Add(r);
 var m=new RpfManager(); m.Init(flat,true);
 log.WriteLine("rpfs="+flat.Count);
 var names=(Environment.GetEnvironmentVariable("X9NAMES")??"prop_wallbrick_01,prop_wallbrick_02,prop_wallbrick_03,prop_barier_conc_01a").Split(',');
 var hashes=names.ToDictionary(n=>JenkHash.GenHash(n),n=>n);
 foreach(var n in names) JenkIndex.Ensure(n);
 var all=new List<RpfFileEntry>(); foreach(var r in flat) if(r.AllEntries!=null) foreach(var e in r.AllEntries) if(e is RpfFileEntry fe) all.Add(fe);
 if(mode=="arch"){
  using var w=new StreamWriter(outd+"/arch"+sh+".tsv"){AutoFlush=true}; int qi=0;
  foreach(var e in all.Where(e=>e.Name.EndsWith(".ytyp",StringComparison.OrdinalIgnoreCase)).OrderBy(e=>e.Path)){ if((qi++)%nsh!=sh) continue;
   try{ var y=m.GetFile<YtypFile>(e); if(y==null||y.AllArchetypes==null) continue;
    foreach(var a in y.AllArchetypes){ var d=a.BaseArchetypeDef; var nm=d.name.ToString(); var mn=d.bbMin; var mx=d.bbMax;
      if((mx.Z-mn.Z)>=1.2f) w.WriteLine(string.Join("\t",nm,e.Path,mn.X,mn.Y,mn.Z,mx.X,mx.Y,mx.Z,d.assetType,d.flags,d.lodDist,a.GetType().Name)); }
   }catch(Exception ex){ log.WriteLine("E arch "+e.Path+" "+ex.Message);} }
 }
 if(mode=="ydr"){
  using var w=new StreamWriter(outd+"/ydr.txt"){AutoFlush=true};
  foreach(var e in all.Where(e=>names.Any(n=>e.Name.Equals(n+".ydr",StringComparison.OrdinalIgnoreCase)))){
   w.WriteLine("=== "+e.Path+" size="+e.GetFileSize());
   try{ var y=m.GetFile<YdrFile>(e); var dr=y.Drawable; w.WriteLine("  loaded="+y.Loaded+" drawable="+(dr!=null));
    if(dr!=null){ w.WriteLine("  bbmin="+dr.BoundingBoxMin+" bbmax="+dr.BoundingBoxMax+" bs="+dr.BoundingCenter+" r="+dr.BoundingSphereRadius);
     w.WriteLine("  bound="+(dr.Bound==null?"NONE":dr.Bound.GetType().Name+" min="+dr.Bound.BoxMin+" max="+dr.Bound.BoxMax));
     var bc=dr.Bound as BoundComposite; if(bc!=null){ w.WriteLine("  composite children="+bc.Children?.data_items?.Length); if(bc.Children?.data_items!=null) foreach(var c in bc.Children.data_items) w.WriteLine("   child "+(c==null?"null":c.GetType().Name+" min="+c.BoxMin+" max="+c.BoxMax+" pos="+c.Position+" mat="+c.MaterialIndex)); }
    }
   }catch(Exception ex){ w.WriteLine("  ERR "+ex.Message); } }
 }
 if(mode=="ymap"){
  using var w=new StreamWriter(outd+"/placements"+sh+".tsv"){AutoFlush=true};
  int qi=0; foreach(var e in all.Where(e=>{var nm=e.Name.ToLower(); return nm.EndsWith(".ymap")&&!nm.Contains("lod")&&!nm.Contains("occl")&&!nm.Contains("_long")&&!nm.Contains("milo");}).OrderBy(e=>e.Path)){ if((qi++)%nsh!=sh) continue;
   try{ var y=m.GetFile<YmapFile>(e); if(y==null||y.AllEntities==null) continue;
    foreach(var en in y.AllEntities){ var h=en._CEntityDef.archetypeName.Hash; if(hashes.ContainsKey(h)){
      var d=en._CEntityDef; w.WriteLine(string.Join("\t",hashes[h],e.Path,d.position.X,d.position.Y,d.position.Z,d.rotation.X,d.rotation.Y,d.rotation.Z,d.rotation.W,d.scaleXY,d.scaleZ,d.flags,d.lodLevel,d.parentIndex,d.guid)); } }
   }catch(Exception ex){ log.WriteLine("E ymap "+e.Path+" "+ex.Message);} }
 }
 log.WriteLine("done");
}
}
