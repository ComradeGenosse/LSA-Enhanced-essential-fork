"""Blender 5.2 / Sollumz 2.9: deterministic original concrete fragment wall."""
import bpy, importlib, pathlib, json, struct
from mathutils import Matrix
sz='bl_ext.user_default.sollumz'
S=importlib.import_module(sz+'.sollumz_properties')
B=importlib.import_module(sz+'.tools.blenderhelper')
shader=importlib.import_module(sz+'.ydr.shader_materials')
col=importlib.import_module(sz+'.ybn.collision_materials')
prefs=importlib.import_module(sz+'.sollumz_preferences')
out=pathlib.Path(__file__).resolve().parent/'assets';out.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
arm=bpy.data.armatures.new('lsa_x2_concrete');frag=bpy.data.objects.new('lsa_x2_concrete',arm);bpy.context.collection.objects.link(frag);frag.sollum_type=S.SollumType.FRAGMENT
bpy.context.view_layer.objects.active=frag;frag.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
root=arm.edit_bones.new('root');root.head=(0,0,0);root.tail=(0,.1,0)
# 6 columns x 5 rows, complete 3 x 2.5 x .2 m panel. Root owns the two outer columns.
cells=[]
for j in range(5):
 for i in range(6):
  name=f'chunk_{i}_{j}';b=arm.edit_bones.new(name);b.head=(-1.25+i*.5,0,.25+j*.5);b.tail=(-1.25+i*.5,.1,.25+j*.5);b.parent=root
  cells.append((name,i,j))
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.bones:
 b.sollumz_use_physics=True;b.bone_properties.use_manual_tag=False;b.bone_properties.flags_enum={'RotX','RotY','RotZ','TransX','TransY','TransZ'}
 g=b.group_properties;g.strength=10000000 if b.name=='root' else 5000
 g.min_damage_force=2000;g.damage_health=100
 g.force_transmission_scale_up=.25;g.force_transmission_scale_down=.25
arm.bones['root'].group_properties.min_damage_force=10000000
arm.bones['root'].group_properties.damage_health=10000000
# Outside columns are deliberately reinforced, but remain native groups for measurement.
for name,i,j in cells:
 if i in (0,5):
  g=arm.bones[name].group_properties;g.strength=10000000;g.min_damage_force=10000000;g.damage_health=10000000
D=B.create_empty_object(S.SollumType.DRAWABLE,'concrete.drawable');D.parent=frag
C=B.create_empty_object(S.SollumType.BOUND_COMPOSITE,'concrete.col');C.parent=frag
mat=shader.create_shader('default.sps');cm=col.create_collision_material_from_index(1)
# Original RGBA8 DDS; Sollumz embeds DDS data, not unsaved GENERATED image pixels.
header=[124,0x100F,16,16,64,0,0]+[0]*11+[32,0x41,0,32,0xff,0xff00,0xff0000,0xff000000]+[0x1000,0,0,0,0]
tex=out/'lsa_x2_concrete_diff.dds';tex.write_bytes(b'DDS '+struct.pack('<31I',*header)+bytes([133,128,120,255])*256)
img=bpy.data.images.load(str(tex));img.pack()
for node in mat.node_tree.nodes:
 if node.type=='TEX_IMAGE':node.image=img;node.texture_properties.embedded=True

def box(name,center,size,typ,parent,material,bone):
 bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0));o=bpy.context.object;o.name=name
 # Center each primitive at its bone; asymmetric box bounds are not a translated box.
 for v in o.data.vertices:
  v.co.x=v.co.x*size[0];v.co.y=v.co.y*size[1];v.co.z=v.co.z*size[2]
 o.location=tuple(center[k]-arm.bones[bone].head_local[k] for k in range(3))
 o.sollum_type=typ;o.parent=parent;o.data.materials.append(material)
 B.add_child_of_bone_constraint(o,frag,bone)
 return o
# Small root footing fits inside the panel, no hidden full-wall collision.
rootcol=box('root.col',(0,0,.025),(.01,.2,.05),S.SollumType.BOUND_BOX,C,cm,'root');rootcol.child_properties.mass=1
for name,i,j in cells:
 center=(-1.25+i*.5,0,.25+j*.5);size=(.5,.2,.5)
 o=box(name+'.mesh',center,size,S.SollumType.DRAWABLE_MODEL,D,mat,name)
 o.sollumz_is_physics_child_mesh=False;o.sz_lods.get_lod(S.LODLevel.HIGH).mesh=o.data
 o.data.uv_layers[0].name='UVMap 0'
 color=o.data.color_attributes.new(name='Color 1',type='BYTE_COLOR',domain='CORNER')
 for c in color.data:c.color=(1,1,1,1)
 c=box(name+'.col',center,size,S.SollumType.BOUND_BOX,C,cm,name);c.child_properties.mass=.5*.2*.5*2400
 # General object collision flags.
 for flags in (c.composite_flags1,c.composite_flags2):
  for key in ('map_dynamic','object','vehicle_bvh','vehicle_not_bvh','ped','ragdoll','map_weapon','projectile','explosion','test_weapon','test_camera','test_ai','test_script'):
   if hasattr(flags,key):setattr(flags,key,True)
yt=bpy.context.scene.ytyps.add();yt.name='lsa_x2';a=yt.new_archetype();a.name=frag.name;a.asset=frag;a.asset_type=S.AssetType.FRAGMENT;a.asset_name=frag.name;a.flags.total='131072';a.texture_dictionary=frag.name;a.physics_dictionary=''
a.bb_min=(-1.5,-.1,0);a.bb_max=(1.5,.1,2.5);a.bs_center=(0,0,1.25);a.bs_radius=1.96
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'lsa_x2_concrete.blend'))
p=prefs.get_export_settings();p.target_versions={'GEN9'};p.target_formats={'NATIVE','CWXML'};p.limit_to_selected=False;p.export_ytyps=True
print(bpy.ops.sollumz.export_assets(directory=str(out),direct_export=True))
(out/'authoring.json').write_text(json.dumps({'dimensions':[3,0.2,2.5],'chunks':30,'groups':31,'density':2400,'anchoring':'root static by test; reinforced outer columns; default group force transmission .25','normal_physics':{k:getattr(arm.bones['chunk_1_0'].group_properties,k) for k in ('strength','min_damage_force','damage_health','force_transmission_scale_up','force_transmission_scale_down')},'blender':bpy.app.version_string},indent=2))















