using System; using System.IO; using System.Linq; using System.Collections.Generic; using System.Text;
using CodeWalker.GameFiles;
class P{
 static StreamWriter log, o;
 static void W(string s){ o.WriteLine(s); }
 static void Main(string[] args){
 string gta=args[0], outd=args[1], real=args[2];
 Directory.CreateDirectory(outd);
 log=new StreamWriter(outd+"/run.log"){AutoFlush=true};
 o=new StreamWriter(outd+"/result.txt"){AutoFlush=true};
 Action<string> st=s=>{}; Action<string> er=s=>log.WriteLine("E "+s);
 GTA5Keys.LoadFromPath(gta,true,"");
 var list=new List<RpfFile>();
 foreach(var f in Directory.GetFiles(real,"*.rpf",SearchOption.AllDirectories)){
  var rel=f.Substring(real.Length+1).Replace('/','\\');
  try{ var rf=new RpfFile(f,rel); rf.ScanStructure(st,er); list.Add(rf);}catch(Exception ex){log.WriteLine("E open "+f+" "+ex.Message);} }
 var flat=new List<RpfFile>(); void Add(RpfFile r){ flat.Add(r); if(r.Children!=null) foreach(var c in r.Children) Add(c);} foreach(var r in list) Add(r);
 var m=new RpfManager(); m.Init(flat,true);
 log.WriteLine("rpfs="+flat.Count);
 var names=(Environment.GetEnvironmentVariable("X9NAMES")??"sp1_03_wall_01_o").Split(',');
 var hashes=new Dictionary<uint,string>(); foreach(var n in names){ JenkIndex.Ensure(n); hashes[JenkHash.GenHash(n)]=n; }
 var all=new List<RpfFileEntry>(); foreach(var r in flat) if(r.AllEntries!=null) foreach(var e in r.AllEntries) if(e is RpfFileEntry fe) all.Add(fe);
 log.WriteLine("entries="+all.Count);
 var wanted=names.SelectMany(n=>new[]{n,n+"_lod",n+"_slod",n+"_childr"}).Select(x=>x.ToLower()).ToHashSet();
 // 1. file entries by name
 W("## FILES by name (ydr/yft/ydd/ybn with candidate basename)");
 foreach(var e in all){ var nm=e.Name.ToLower(); var b=Path.GetFileNameWithoutExtension(nm); if(wanted.Contains(b)) W("FILE\t"+e.Path+"\t"+e.GetFileSize()); }
 // 2. ytyp
 W("## YTYP archetypes");
 var ytypDirs=new HashSet<string>();
 foreach(var e in all.Where(e=>e.Name.EndsWith(".ytyp",StringComparison.OrdinalIgnoreCase)).OrderBy(e=>e.Path)){
  try{ var y=m.GetFile<YtypFile>(e); if(y==null||y.AllArchetypes==null) continue;
   foreach(var a in y.AllArchetypes){ var d=a.BaseArchetypeDef; if(!hashes.ContainsKey(d.name.Hash)) continue;
    ytypDirs.Add(Path.GetDirectoryName(e.Path));
    W("ARCH\t"+hashes[d.name.Hash]+"\t"+e.Path+"\ttype="+a.GetType().Name+"\tassetType="+d.assetType+"\tassetName="+d.assetName+"\ttxd="+d.textureDictionary+"\tdrawDict="+d.drawableDictionary+"\tphys="+d.physicsDictionary+"\tbbMin="+d.bbMin+"\tbbMax="+d.bbMax+"\tbsC="+d.bsCentre+"\tbsR="+d.bsRadius+"\tlodDist="+d.lodDist+"\tflags="+d.flags+"\tspecial="+d.specialAttribute+"\thdTexDist="+d.hdTextureDist);
   }
  }catch(Exception ex){ log.WriteLine("E ytyp "+e.Path+" "+ex.Message);} }
 // 3. ymaps
 W("## YMAP placements");
 var ymapEntries=all.Where(e=>e.Name.EndsWith(".ymap",StringComparison.OrdinalIgnoreCase)).OrderBy(e=>e.Path).ToList();
 log.WriteLine("ymaps="+ymapEntries.Count);
 var hitYmaps=new List<(RpfFileEntry e,YmapFile y)>(); var basePos=new Dictionary<string,SharpDX.Vector3>();
 var byHash=new Dictionary<uint,List<RpfFileEntry>>(); foreach(var e in ymapEntries){ var h=JenkHash.GenHash(Path.GetFileNameWithoutExtension(e.Name).ToLower()); if(!byHash.TryGetValue(h,out var l)) byHash[h]=l=new List<RpfFileEntry>(); l.Add(e);}
 int cnt=0;
 foreach(var e in ymapEntries){ cnt++; if(cnt%2000==0) log.WriteLine("ymap "+cnt);
  try{ var y=m.GetFile<YmapFile>(e); if(y==null||y.AllEntities==null) continue; bool hit=false;
   for(int i=0;i<y.AllEntities.Length;i++){ var en=y.AllEntities[i]; var d=en._CEntityDef; if(!hashes.ContainsKey(d.archetypeName.Hash)) continue; hit=true;
    if(!e.Path.StartsWith("update")&&!e.Path.StartsWith("onigiri")) basePos[hashes[d.archetypeName.Hash]]=d.position;
    W("PLACE\t"+hashes[d.archetypeName.Hash]+"\t"+e.Path+"\tidx="+i+"\tpos="+d.position+"\trotQ="+d.rotation+"\tscaleXY="+d.scaleXY+"\tscaleZ="+d.scaleZ+"\tflags="+d.flags+"\tguid="+d.guid+"\tlodLevel="+d.lodLevel+"\tparentIdx="+d.parentIndex+"\tnumChildren="+d.numChildren+"\tlodDist="+d.lodDist+"\tchildLodDist="+d.childLodDist+"\tpriority="+d.priorityLevel+"\tymapParent="+y.CMapData.parent+"\tymapFlags="+y.CMapData.flags+"\tymapContent="+y.CMapData.contentFlags+"\tentExt="+y.CMapData.entitiesExtentsMin+".."+y.CMapData.entitiesExtentsMax+"\tstrExt="+y.CMapData.streamingExtentsMin+".."+y.CMapData.streamingExtentsMax);
   }
   if(hit) hitYmaps.Add((e,y));
  }catch(Exception ex){ log.WriteLine("E ymap "+e.Path+" "+ex.Message);} }
 W("## YMAP hit count: "+hitYmaps.Count);
 // 4. LOD chain + neighbours for each hit
 var nr=float.Parse(Environment.GetEnvironmentVariable("X9RADIUS")??"15");
 foreach(var (e,y) in hitYmaps){
  for(int i=0;i<y.AllEntities.Length;i++){ var en=y.AllEntities[i]; var d=en._CEntityDef; if(!hashes.ContainsKey(d.archetypeName.Hash)) continue;
   W("## CHAIN "+hashes[d.archetypeName.Hash]+" "+e.Path+" idx="+i);
   if(d.parentIndex>=0 && y.CMapData.parent.Hash!=0){
     if(byHash.TryGetValue(y.CMapData.parent.Hash,out var plist)) foreach(var pe in plist){ try{ var py=m.GetFile<YmapFile>(pe); if(py?.AllEntities==null||d.parentIndex>=py.AllEntities.Length) continue; var pd=py.AllEntities[d.parentIndex]._CEntityDef;
        W("PARENT\t"+pe.Path+"\tidx="+d.parentIndex+"\tarch="+pd.archetypeName+"\tpos="+pd.position+"\tlodLevel="+pd.lodLevel+"\tnumChildren="+pd.numChildren+"\tlodDist="+pd.lodDist+"\tchildLodDist="+pd.childLodDist+"\tparentIdx="+pd.parentIndex);
        // siblings in this ymap that share the parent
        for(int j=0;j<y.AllEntities.Length;j++){ var sd=y.AllEntities[j]._CEntityDef; if(sd.parentIndex==d.parentIndex) W("SIBLING\tidx="+j+"\tarch="+sd.archetypeName+"\tpos="+sd.position+"\tlodLevel="+sd.lodLevel); }
       }catch(Exception ex){ W("PARENT ERR "+ex.Message);} }
     else W("PARENT ymap not found hash="+y.CMapData.parent);
   } else W("NO PARENT (parentIdx="+d.parentIndex+")");
   // other ymaps (any) that have entities named cand_lod near pos
   W("NEIGHBOURS within "+nr+"m in same ymap:");
   var pos=d.position;
   for(int j=0;j<y.AllEntities.Length;j++){ if(j==i) continue; var nd=y.AllEntities[j]._CEntityDef; var dx=nd.position.X-pos.X; var dy=nd.position.Y-pos.Y; var dz=nd.position.Z-pos.Z; if(dx*dx+dy*dy+dz*dz<=nr*nr) W("NB\tidx="+j+"\tarch="+nd.archetypeName+"\tpos="+nd.position+"\trotQ="+nd.rotation+"\tlodLevel="+nd.lodLevel+"\tparentIdx="+nd.parentIndex+"\tflags="+nd.flags); }
  }
 }


 var insp=(Environment.GetEnvironmentVariable("X9INSPECT")??"").Split(new[]{','},StringSplitOptions.RemoveEmptyEntries);
 foreach(var n in insp){
  W("## INSPECT "+n);
  var ye=all.Where(e=>!e.Path.StartsWith("update")&&!e.Path.StartsWith("onigiri")&&e.Name.Equals(n+".ydr",StringComparison.OrdinalIgnoreCase)).FirstOrDefault();
  if(ye==null){ W("no base ydr"); continue; }
  W("YDR\t"+ye.Path+"\tsize="+ye.GetFileSize());
  var dir=ye.Path.Substring(0,ye.Path.LastIndexOf((char)92)); string DirOf(string p){ int i=p.LastIndexOf((char)92); return i<0?"":p.Substring(0,i);}
  var sib=all.Where(e=>DirOf(e.Path)==dir).ToList();
  W("rpf dir has "+sib.Count+" entries: ybn="+sib.Count(e=>e.Name.EndsWith(".ybn"))+" ydr="+sib.Count(e=>e.Name.EndsWith(".ydr"))+" ytd="+sib.Count(e=>e.Name.EndsWith(".ytd")));
  SharpDX.Vector3 wmin=default,wmax=default; bool haveW=false;
  try{
   var y=m.GetFile<YdrFile>(ye); var dr=y.Drawable;
   W("loaded="+y.Loaded+" bbmin="+dr.BoundingBoxMin+" bbmax="+dr.BoundingBoxMax+" bc="+dr.BoundingCenter+" r="+dr.BoundingSphereRadius+" LodDist H/M/L/VL="+dr.LodDistHigh+"/"+dr.LodDistMed+"/"+dr.LodDistLow+"/"+dr.LodDistVlow);
   W("modelPtrs H/M/L/VL = "+(dr.DrawableModelsHighPointer!=0)+"/"+(dr.DrawableModelsMediumPointer!=0)+"/"+(dr.DrawableModelsLowPointer!=0)+"/"+(dr.DrawableModelsVeryLowPointer!=0)+" embeddedBound="+(dr.Bound==null?"NONE":dr.Bound.GetType().Name));
   var cells=new Dictionary<(int,int),int>(); float cs=2.0f; long tv=0, ti=0; float mnx=1e9f,mny=1e9f,mnz=1e9f,mxx=-1e9f,mxy=-1e9f,mxz=-1e9f;
   var zh=new SortedDictionary<int,int>();
   int mi=0; foreach(var mdl in dr.AllModels){ int gi=0; foreach(var g in mdl.Geometries){ var vd=g.VertexData; tv+=g.VerticesCount; ti+=g.IndicesCount;
     W("  GEOM m"+mi+" g"+gi+" verts="+g.VerticesCount+" tris="+g.TrianglesCount+" stride="+g.VertexStride+" shader="+g.Shader?.Name+" aabb="+g.AABB.Min+".."+g.AABB.Max);
     if(vd!=null){ var vb=vd.VertexBytes??vd.G9_VertexBytes; int vst=vd.VertexStride; if(vb!=null&&vst>=12) for(int v=0;v<vd.VertexCount;v++){ float x=BitConverter.ToSingle(vb,v*vst), yy=BitConverter.ToSingle(vb,v*vst+4), z=BitConverter.ToSingle(vb,v*vst+8); if(float.IsNaN(x)||Math.Abs(x)>1e5) continue; mnx=Math.Min(mnx,x);mxx=Math.Max(mxx,x);mny=Math.Min(mny,yy);mxy=Math.Max(mxy,yy);mnz=Math.Min(mnz,z);mxz=Math.Max(mxz,z); var c=((int)Math.Floor(x/cs),(int)Math.Floor(yy/cs)); cells[c]=cells.TryGetValue(c,out var k)?k+1:1; var zb=(int)Math.Floor(z/1.0f); zh[zb]=zh.TryGetValue(zb,out var kz)?kz+1:1; } }
     gi++; } mi++; }
   W("totals verts="+tv+" idx="+ti+" models="+dr.AllModels.Length);
   W("VERTEX AABB min=("+mnx+","+mny+","+mnz+") max=("+mxx+","+mxy+","+mxz+") size=("+(mxx-mnx)+","+(mxy-mny)+","+(mxz-mnz)+")");
   W("occupied "+cs+"m XY cells="+cells.Count+" of bbox cells="+(Math.Ceiling((mxx-mnx)/cs)*Math.Ceiling((mxy-mny)/cs)));
   // connected components of occupied cells
   var seen=new HashSet<(int,int)>(); var comps=new List<(int cnt,int vcount,int x0,int y0,int x1,int y1)>();
   foreach(var c0 in cells.Keys){ if(seen.Contains(c0)) continue; var q=new Queue<(int,int)>(); q.Enqueue(c0); seen.Add(c0); int cc=0,vv=0,x0=int.MaxValue,y0=int.MaxValue,x1=int.MinValue,y1=int.MinValue; while(q.Count>0){ var c=q.Dequeue(); cc++; vv+=cells[c]; x0=Math.Min(x0,c.Item1);x1=Math.Max(x1,c.Item1);y0=Math.Min(y0,c.Item2);y1=Math.Max(y1,c.Item2); for(int dx=-1;dx<=1;dx++)for(int dy=-1;dy<=1;dy++){ var nb=(c.Item1+dx,c.Item2+dy); if(cells.ContainsKey(nb)&&seen.Add(nb)) q.Enqueue(nb);} } comps.Add((cc,vv,x0,y0,x1,y1)); }
   W("connected XY components (2m cells, 8-neigh) = "+comps.Count);
   foreach(var c in comps.OrderByDescending(c=>c.vcount).Take(12)) W("  comp cells="+c.cnt+" verts="+c.vcount+" extentX=["+c.x0*cs+","+(c.x1+1)*cs+"] extentY=["+c.y0*cs+","+(c.y1+1)*cs+"]");
   W("Z histogram (1m bins: vertCount): "+string.Join(" ",zh.Select(kv=>kv.Key+":"+kv.Value)));
   if(basePos.TryGetValue(n,out var bp)){ wmin=new SharpDX.Vector3(bp.X+mnx,bp.Y+mny,bp.Z+mnz); wmax=new SharpDX.Vector3(bp.X+mxx,bp.Y+mxy,bp.Z+mxz); haveW=true; W("WORLD AABB (pos+verts) min="+wmin+" max="+wmax+" pos="+bp); }
  }catch(Exception ex){ W("YDR ERR "+ex); }
  // YBN scan: ybns in same rpf dir and any whose name starts with area prefix
  var area=dir.Substring(0,dir.LastIndexOf((char)92)); // .../sanpedro_01
  var prefix=n.Split((char)95)[0]+"_"+n.Split((char)95)[1];
  var ybns=all.Where(e=>e.Name.EndsWith(".ybn",StringComparison.OrdinalIgnoreCase)&&(DirOf(e.Path)==dir||DirOf(e.Path).StartsWith(area)||e.Name.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))).ToList();
  W("YBN candidates (same rpf / same area folder / name prefix "+prefix+"): "+ybns.Count);
  int parsed=0, ovl=0;
  foreach(var be in ybns){ try{ var yb=m.GetFile<YbnFile>(be); var bd=yb?.Bounds; if(bd==null) continue; parsed++;
    bool overlap=haveW&&bd.BoxMin.X<=wmax.X&&bd.BoxMax.X>=wmin.X&&bd.BoxMin.Y<=wmax.Y&&bd.BoxMax.Y>=wmin.Y&&bd.BoxMin.Z<=wmax.Z&&bd.BoxMax.Z>=wmin.Z;
    if(!overlap) continue; ovl++;
    W("YBN\t"+be.Path+"\ttype="+bd.GetType().Name+"\tbox="+bd.BoxMin+".."+bd.BoxMax);
    var comp=bd as BoundComposite; if(comp==null){ W("  non-composite"); continue; }
    var ch=comp.Children?.data_items; W("  composite children="+(ch==null?0:ch.Length));
    int shown=0; if(ch!=null) for(int i=0;i<ch.Length;i++){ var c=ch[i]; if(c==null) continue; var mn=c.BoxMin; var mx=c.BoxMax; bool ov=mn.X<=wmax.X&&mx.X>=wmin.X&&mn.Y<=wmax.Y&&mx.Y>=wmin.Y&&mn.Z<=wmax.Z&&mx.Z>=wmin.Z; if(!ov) continue; if(shown++>40) continue;
      var geo=c as BoundGeometry; W("  CHILD "+i+" "+c.GetType().Name+" box="+mn+".."+mx+" size=("+(mx.X-mn.X)+","+(mx.Y-mn.Y)+","+(mx.Z-mn.Z)+")"+(geo!=null?" verts="+geo.VerticesCount+" polys="+geo.PolygonsCount+" mats="+geo.MaterialsCount:"")+" matIdx="+c.MaterialIndex);}
    W("  children overlapping wall AABB: "+shown);
   }catch(Exception ex){ log.WriteLine("YBN ERR "+be.Path+" "+ex.Message);} }
  W("YBN parsed="+parsed+" overlapping="+ovl);
 }
 W("done"); o.Flush();
 }
}
