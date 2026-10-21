"""Original corrugated fence twin. Blender 5.2.2 + Sollumz 2.9.
Measured reference dimensions from X5 and local vanilla inspection, no Rockstar geometry/textures copied.
"""
import bpy, importlib, pathlib, json, struct, math, random, runpy
sz='bl_ext.user_default.sollumz'
S=importlib.import_module(sz+'.sollumz_properties');B=importlib.import_module(sz+'.tools.blenderhelper')
shader=importlib.import_module(sz+'.ydr.shader_materials');col=importlib.import_module(sz+'.ybn.collision_materials');prefs=importlib.import_module(sz+'.sollumz_preferences')
out=pathlib.Path(__file__).resolve().parent/'assets';out.mkdir(exist_ok=True)
W,H=2.536,2.351;SHEET_H=H-.22;CW,CH=W/6,SHEET_H/5
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
arm=bpy.data.armatures.new('lsa_x6_corrugated');frag=bpy.data.objects.new(arm.name,arm);bpy.context.collection.objects.link(frag);frag.sollum_type=S.SollumType.FRAGMENT
bpy.context.view_layer.objects.active=frag;frag.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
root=arm.edit_bones.new('root');root.head=(0,0,0);root.tail=(0,.1,0)
cells=[]
for j in range(5):
 for i in range(6):
  name=f'sheet_{i}_{j}';b=arm.edit_bones.new(name);b.head=(-W/2+(i+.5)*CW,0,(j+.5)*CH);b.tail=(b.head.x,.1,b.head.z);b.parent=root;cells.append((name,i,j))
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.bones:
 b.sollumz_use_physics=True;b.bone_properties.use_manual_tag=False;b.bone_properties.flags_enum={'RotX','RotY','RotZ','TransX','TransY','TransZ'}
 g=b.group_properties;g.strength=35;g.min_damage_force=5;g.damage_health=25;g.force_transmission_scale_up=.25;g.force_transmission_scale_down=.25
for b in arm.bones:
 if b.name=='root':
  g=b.group_properties;g.strength=10000000;g.min_damage_force=10000000;g.damage_health=10000000
D=B.create_empty_object(S.SollumType.DRAWABLE,'fence.drawable');D.parent=frag
C=B.create_empty_object(S.SollumType.BOUND_COMPOSITE,'fence.col');C.parent=frag
mat=shader.create_shader('default.sps');cm=col.create_collision_material_from_index(next(i for i,m in enumerate(col.collisionmats) if m.name=='METAL_CORRUGATED_IRON'))
# Original deterministic weathered galvanized texture; corrugation is modeled, not painted on.
rng=random.Random(6001);N=256
spots=[(rng.random(),rng.random(),rng.uniform(.002,.008),rng.uniform(.005,.03)) for _ in range(500)]
pix=bytearray()
for y in range(N):
 v=y/(N-1)
 for x in range(N):
  u=x/(N-1);noise=rng.uniform(-13,13);mottle=8*math.sin(u*63+math.sin(v*37))*math.cos(v*51)
  rust=0
  for sx,sy,rx,ry in spots:
   q=((u-sx)/rx)**2+((v-sy)/ry)**2
   if q<4:rust=max(rust,math.exp(-q*1.5))
  streak=(max(0,math.sin(u*157+1))**18)*max(0,(v-.76)/.24)*.65
  rust=min(1,rust+streak);base=130+noise+mottle-19*(1-v)
  rgb=[base*(1-rust)+r*rust for r in (91,57,30)]
  pix.extend(bytes([max(0,min(255,int(c))) for c in rgb]+[255]))
header=[124,0x100F,N,N,N*4,0,0]+[0]*11+[32,0x41,0,32,0xff,0xff00,0xff0000,0xff000000]+[0x1000,0,0,0,0]
tex=out/'lsa_x6_galvanized.dds';tex.write_bytes(b'DDS '+struct.pack('<31I',*header)+pix)
img=bpy.data.images.load(str(tex));img.pack()
for node in mat.node_tree.nodes:
 if node.type=='TEX_IMAGE':node.image=img;node.texture_properties.embedded=True

def setup(o,typ,parent,material,bone):
 o.sollum_type=typ;o.parent=parent;o.data.materials.append(material);B.add_child_of_bone_constraint(o,frag,bone)
 if typ==S.SollumType.DRAWABLE_MODEL:
  o.sollumz_is_physics_child_mesh=False;o.sz_lods.get_lod(S.LODLevel.HIGH).mesh=o.data
  uv=o.data.uv_layers.new(name='UVMap 0')
  for p in o.data.polygons:
   for li in p.loop_indices:
    v=o.data.vertices[o.data.loops[li].vertex_index].co+arm.bones[bone].head_local
    uv.data[li].uv=((v.x+W/2)/W,v.z/H)
  color=o.data.color_attributes.new(name='Color 1',type='BYTE_COLOR',domain='CORNER')
  for c in color.data:c.color=(1,1,1,1)
 return o

def box(name,center,size,typ,parent,material,bone):
 bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.name=name
 for v in o.data.vertices:
  for k in range(3):v.co[k]=v.co[k]*size[k]+center[k]-arm.bones[bone].head_local[k]
 # remove default cube UV because setup creates our continuous global UV
 for uv in list(o.data.uv_layers):o.data.uv_layers.remove(uv)
 return setup(o,typ,parent,material,bone)

def flags(c,mass):
 c.child_properties.mass=mass
 for f in (c.composite_flags1,c.composite_flags2):
  for key in ('map_dynamic','object','vehicle_bvh','vehicle_not_bvh','ped','ragdoll','map_weapon','projectile','explosion','test_weapon','test_camera','test_ai','test_script'):
   if hasattr(f,key):setattr(f,key,True)
# Narrow anchored end post, no full panel collision at root.
box('end_post.mesh',(-W/2+.025,0,H/2),(.05,.07,H),S.SollumType.DRAWABLE_MODEL,D,mat,'root')
flags(box('end_post.col',(-W/2+.025,0,H/2),(.05,.07,H),S.SollumType.BOUND_BOX,C,cm,'root'),8)
for name,i,j in cells:
 x0=-W/2+i*CW;x1=x0+CW;z0=j*CH;z1=z0+CH
 # Closed, thin folded sheet with 4 samples per corrugation. Two overlapping sheet seams.
 n=32;verts=[]
 for side in (-1,1):
  for z in (z0,z1):
   for k in range(n+1):
    x=x0+(x1-x0)*k/n;y=.022*math.cos((x+W/2)*2*math.pi/(W/20))+side*.004
    seam=-.006 if x<0 else .006
    verts.append((x-arm.bones[name].head_local.x,y+seam,z-arm.bones[name].head_local.z))
 faces=[];r=n+1
 for k in range(n):
  faces.extend([(k,k+1,r+k+1,r+k),(2*r+k,3*r+k,3*r+k+1,2*r+k+1),(k,2*r+k,2*r+k+1,k+1),(r+k,r+k+1,3*r+k+1,3*r+k)])
 faces.extend([(0,r,3*r,2*r),(n,2*r+n,3*r+n,r+n)])
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name+'.mesh',mesh);bpy.context.collection.objects.link(o);setup(o,S.SollumType.DRAWABLE_MODEL,D,mat,name)
 flags(box(name+'.col',((x0+x1)/2,0,(z0+z1)/2),(CW,.07,CH),S.SollumType.BOUND_BOX,C,cm,name),4.5)
 # Rail sections break with the sheet directly beneath them.
 if j in (1,4):box(name+'.rail',((x0+x1)/2,.04,z1-.055),(CW,.045,.045),S.SollumType.DRAWABLE_MODEL,D,mat,name)
yt=bpy.context.scene.ytyps.add();yt.name='lsa_x6';a=yt.new_archetype();a.name=frag.name;a.asset=frag;a.asset_type=S.AssetType.FRAGMENT;a.asset_name=frag.name;a.flags.total='131072';a.texture_dictionary=frag.name;a.physics_dictionary=''
a.bb_min=(-W/2,-.07,0);a.bb_max=(W/2,.07,H);a.bs_center=(0,0,H/2);a.bs_radius=1.74
bpy.context.view_layer.update();bpy.ops.wm.save_as_mainfile(filepath=str(out/'lsa_x6_corrugated.blend'))
p=prefs.get_export_settings();p.target_versions={'GEN9'};p.target_formats={'NATIVE','CWXML'};p.limit_to_selected=False;p.export_ytyps=True
print(bpy.ops.sollumz.export_assets(directory=str(out),direct_export=True))
runpy.run_path(str(out.parent/'finalize_bounds.py'))['finalize'](out)
(out/'authoring.json').write_text(json.dumps({'dimensions':[W,.14,H],'sheet_chunks':30,'groups':31,'sheet_chunk_mass_kg':4.5,'sheet_height':SHEET_H,'native_strength':35,'min_damage_force':5,'damage_health':25,'root':'narrow end post, native fixed joint','material':'METAL_CORRUGATED_IRON','corrugations':20,'texture':'original procedural galvanized grey with rust','blender':bpy.app.version_string},indent=2))
