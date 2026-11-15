"""
SYNOR - Complete Realistic 3D Space Simulator Intro Cutscene
Duration: ~37.5s (Frames 1-900 @ 24 FPS) | Resolution: 1920x1080
Visual Direction: Premium realistic 3D space simulator (cinematic spacecraft simulation)
Scenes:
  1. The Rocket Flyby (Frames 1-280) - Pure pitch-black space, extreme close flyby past camera
  2. Journey Towards Mars (Frames 281-580) - Rear tracking shot following the rocket towards Mars
  3. Landing on Mars (Frames 581-900) - Retro burn, gear deploy, dust touchdown on pad
"""

import bpy
import math
import random
import os

# ─────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────
PROJECT_DIR = "/Users/vanshranag/Desktop/Mars_Animations"
BLEND_FILE  = os.path.join(PROJECT_DIR, "scene_01_realistic_intro.blend")
EXPORT_DIR  = os.path.join(PROJECT_DIR, "exports", "realistic_intro")
FRAMES_DIR  = os.path.join(EXPORT_DIR, "frames")
os.makedirs(FRAMES_DIR, exist_ok=True)

# ─────────────────────────────────────────────
# RESET SCENE
# ─────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "SYNOR_Intro_Realistic"

# ─────────────────────────────────────────────
# RENDER SETTINGS (Cinematic 3D EEVEE / Metal)
# ─────────────────────────────────────────────
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 900
scene.render.engine = 'BLENDER_EEVEE'
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'

# ─────────────────────────────────────────────
# WORLD (Deep Realistic Space: Void Black)
# ─────────────────────────────────────────────
world = bpy.data.worlds.new("World_SpaceSimulator")
scene.world = world
world.use_nodes = True
wnt = world.node_tree
wnt.nodes.clear()

bg_node = wnt.nodes.new('ShaderNodeBackground')
# True deep space black (tiny physical ambient)
bg_node.inputs['Color'].default_value = (0.0003, 0.0004, 0.0008, 1.0)
bg_node.inputs['Strength'].default_value = 1.0

out_node = wnt.nodes.new('ShaderNodeOutputWorld')
wnt.links.new(bg_node.outputs['Background'], out_node.inputs['Surface'])

# ─────────────────────────────────────────────
# COLLECTIONS
# ─────────────────────────────────────────────
def get_col(name):
    if name in bpy.data.collections:
        col = bpy.data.collections[name]
    else:
        col = bpy.data.collections.new(name)
    if name not in [c.name for c in scene.collection.children]:
        scene.collection.children.link(col)
    return col

col_space     = get_col("Environment_Space")
col_stars     = get_col("Realistic_Stars")
col_mars      = get_col("Mars_Globe")
col_pad       = get_col("Mars_Landing_Facility")
col_rocket    = get_col("SYNOR_Spacecraft")
col_cameras   = get_col("Cameras_Cinematic")
col_lighting  = get_col("Lighting")

def link_to(obj, col):
    for c in list(bpy.data.collections):
        if obj.name in c.objects:
            c.objects.unlink(obj)
    if obj.name in scene.collection.objects:
        scene.collection.objects.unlink(obj)
    col.objects.link(obj)

def mat_builder(name, blend='OPAQUE'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    if blend != 'OPAQUE':
        mat.blend_method = blend
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    return mat, nodes, links

def get_fcurves(action):
    fcurves = []
    if hasattr(action, 'layers'):
        for layer in action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    fcurves.extend(cb.fcurves)
    elif hasattr(action, 'fcurves'):
        fcurves = list(action.fcurves)
    return fcurves

def set_interp(obj, interp='BEZIER'):
    if obj.animation_data and obj.animation_data.action:
        for fc in get_fcurves(obj.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = interp

def smooth_mesh(obj):
    for p in obj.data.polygons:
        p.use_smooth = True

# ─────────────────────────────────────────────
# 1. REALISTIC DISTANT STARS (Subtle Pinpoint Dots)
# ─────────────────────────────────────────────
rng = random.Random(777)
star_verts = []
for _ in range(750):
    theta = rng.uniform(0, 2 * math.pi)
    phi   = rng.uniform(-math.pi / 2, math.pi / 2)
    r     = rng.uniform(380, 500)
    x = r * math.cos(phi) * math.cos(theta)
    y = r * math.cos(phi) * math.sin(theta)
    z = r * math.sin(phi)
    star_verts.append((x, y, z))

star_mesh = bpy.data.meshes.new("Realistic_Stars_Mesh")
star_mesh.from_pydata(star_verts, [], [])
star_mesh.update()
stars_obj = bpy.data.objects.new("Realistic_Stars", star_mesh)
link_to(stars_obj, col_stars)

star_mat, sn, sl = mat_builder("MAT_RealisticStarPoint")
s_emit = sn.new('ShaderNodeEmission')
s_emit.inputs['Color'].default_value = (0.94, 0.96, 1.0, 1.0)
s_emit.inputs['Strength'].default_value = 9.0
s_out = sn.new('ShaderNodeOutputMaterial')
sl.new(s_emit.outputs['Emission'], s_out.inputs['Surface'])
stars_obj.data.materials.append(star_mat)

gn_stars = stars_obj.modifiers.new("StarGN", type='NODES')
ng_s = bpy.data.node_groups.new("StarGN_Tree", 'GeometryNodeTree')
gn_stars.node_group = ng_s
ng_s.interface.new_socket('Geometry', in_out='INPUT',  socket_type='NodeSocketGeometry')
ng_s.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')

sn_in   = ng_s.nodes.new('NodeGroupInput')
sn_out  = ng_s.nodes.new('NodeGroupOutput')
sn_pts  = ng_s.nodes.new('GeometryNodeMeshToPoints')
sn_pts.inputs['Radius'].default_value = 0.20
sn_inst = ng_s.nodes.new('GeometryNodeInstanceOnPoints')
sn_ico  = ng_s.nodes.new('GeometryNodeMeshCircle')
sn_ico.inputs['Vertices'].default_value = 4
sn_ico.inputs['Radius'].default_value = 0.28
sn_ico.fill_type = 'NGON'
sn_mat  = ng_s.nodes.new('GeometryNodeSetMaterial')
sn_mat.inputs['Material'].default_value = star_mat

ng_s.links.new(sn_in.outputs['Geometry'],  sn_pts.inputs['Mesh'])
ng_s.links.new(sn_pts.outputs['Points'],   sn_inst.inputs['Points'])
ng_s.links.new(sn_ico.outputs['Mesh'],     sn_mat.inputs['Geometry'])
ng_s.links.new(sn_mat.outputs['Geometry'], sn_inst.inputs['Instance'])
ng_s.links.new(sn_inst.outputs['Instances'], sn_out.inputs['Geometry'])

# ─────────────────────────────────────────────
# 2. LIGHTING (Hard Sun in Deep Space + Mars Sun)
# ─────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(100, -80, 60))
sun_space = bpy.context.active_object
sun_space.name = "Sun_KeyLight"
sun_space.data.energy = 5.5
sun_space.data.color  = (1.0, 0.98, 0.95)
sun_space.rotation_euler = (math.radians(55), math.radians(15), math.radians(-40))
link_to(sun_space, col_lighting)

bpy.ops.object.light_add(type='SUN', location=(-50, 100, -20))
sun_mars_fill = bpy.context.active_object
sun_mars_fill.name = "Sun_MarsFill"
sun_mars_fill.data.energy = 0.35
sun_mars_fill.data.color  = (0.55, 0.25, 0.15)
sun_mars_fill.rotation_euler = (math.radians(-40), math.radians(-30), math.radians(130))
link_to(sun_mars_fill, col_lighting)

# ─────────────────────────────────────────────
# 3. DETAILED 3D ROCKET ("SYNOR Ares IV Mars Transport")
# ─────────────────────────────────────────────
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
rocket_root = bpy.context.active_object
rocket_root.name = "SYNOR_Ares_Rocket"
link_to(rocket_root, col_rocket)

# Materials
hull_steel, hsn, hsl = mat_builder("MAT_Rocket_Steel")
bsdf_steel = hsn.new('ShaderNodeBsdfPrincipled')
bsdf_steel.inputs['Metallic'].default_value  = 0.92
bsdf_steel.inputs['Roughness'].default_value = 0.24
bsdf_steel.inputs['Base Color'].default_value = (0.88, 0.90, 0.93, 1.0)
out_steel = hsn.new('ShaderNodeOutputMaterial')
hsl.new(bsdf_steel.outputs['BSDF'], out_steel.inputs['Surface'])

heat_shield_mat, hsn2, hsl2 = mat_builder("MAT_HeatShield_Tiles")
bsdf_tile = hsn2.new('ShaderNodeBsdfPrincipled')
bsdf_tile.inputs['Metallic'].default_value  = 0.05
bsdf_tile.inputs['Roughness'].default_value = 0.78
bsdf_tile.inputs['Base Color'].default_value = (0.05, 0.05, 0.06, 1.0)
out_tile = hsn2.new('ShaderNodeOutputMaterial')
hsl2.new(bsdf_tile.outputs['BSDF'], out_tile.inputs['Surface'])

dark_alloy_mat, dan, dal = mat_builder("MAT_DarkAlloy")
bsdf_alloy = dan.new('ShaderNodeBsdfPrincipled')
bsdf_alloy.inputs['Metallic'].default_value  = 0.85
bsdf_alloy.inputs['Roughness'].default_value = 0.40
bsdf_alloy.inputs['Base Color'].default_value = (0.16, 0.18, 0.22, 1.0)
out_alloy = dan.new('ShaderNodeOutputMaterial')
dal.new(bsdf_alloy.outputs['BSDF'], out_alloy.inputs['Surface'])

nozzle_mat, nzn, nzl = mat_builder("MAT_Raptor_Nozzle")
bsdf_nozzle = nzn.new('ShaderNodeBsdfPrincipled')
bsdf_nozzle.inputs['Metallic'].default_value  = 0.95
bsdf_nozzle.inputs['Roughness'].default_value = 0.32
bsdf_nozzle.inputs['Base Color'].default_value = (0.45, 0.38, 0.32, 1.0)
out_nozzle = nzn.new('ShaderNodeOutputMaterial')
nzl.new(bsdf_nozzle.outputs['BSDF'], out_nozzle.inputs['Surface'])

throat_mat, thn, thl = mat_builder("MAT_EngineThroat_Glow")
th_emit = thn.new('ShaderNodeEmission')
th_emit.inputs['Color'].default_value = (1.0, 0.65, 0.25, 1.0)
th_emit.inputs['Strength'].default_value = 15.0
out_th = thn.new('ShaderNodeOutputMaterial')
thl.new(th_emit.outputs['Emission'], out_th.inputs['Surface'])

plume_mat, pln, pll = mat_builder("MAT_RocketExhaust_Flame", blend='BLEND')
tc_pl   = pln.new('ShaderNodeTexCoord')
grad_pl = pln.new('ShaderNodeTexGradient')
grad_pl.gradient_type = 'LINEAR'
cr_pl   = pln.new('ShaderNodeValToRGB')
cr_pl.color_ramp.elements[0].position = 0.0
cr_pl.color_ramp.elements[0].color    = (0.0, 0.0, 0.0, 0.0)
cr_pl.color_ramp.elements.new(0.2)
cr_pl.color_ramp.elements[1].position = 0.2
cr_pl.color_ramp.elements[1].color    = (0.12, 0.35, 1.0, 0.3)
cr_pl.color_ramp.elements.new(0.65)
cr_pl.color_ramp.elements[2].position = 0.65
cr_pl.color_ramp.elements[2].color    = (0.35, 0.75, 1.0, 0.85)
cr_pl.color_ramp.elements[3].position = 1.0
cr_pl.color_ramp.elements[3].color    = (1.0,  0.95, 0.85, 1.0)

emit_pl   = pln.new('ShaderNodeEmission')
emit_pl.inputs['Strength'].default_value = 18.0
transp_pl = pln.new('ShaderNodeBsdfTransparent')
mix_pl    = pln.new('ShaderNodeMixShader')
out_pl    = pln.new('ShaderNodeOutputMaterial')

pll.new(tc_pl.outputs['Generated'],   grad_pl.inputs['Vector'])
pll.new(grad_pl.outputs['Fac'],       cr_pl.inputs['Fac'])
pll.new(cr_pl.outputs['Color'],       emit_pl.inputs['Color'])
pll.new(cr_pl.outputs['Alpha'],       mix_pl.inputs['Fac'])
pll.new(transp_pl.outputs['BSDF'],    mix_pl.inputs[1])
pll.new(emit_pl.outputs['Emission'],  mix_pl.inputs[2])
pll.new(mix_pl.outputs['Shader'],     out_pl.inputs['Surface'])

def create_part(mesh_fn, name, loc, scale, rot, mat):
    mesh_fn(location=(0,0,0))
    obj = bpy.context.active_object
    obj.name = name
    obj.location = loc
    obj.scale = scale
    obj.rotation_euler = rot
    obj.parent = rocket_root
    obj.data.materials.append(mat)
    smooth_mesh(obj)
    link_to(obj, col_rocket)
    return obj

# A. Fuselage (Radius 1.4m, Length 9.0m)
fuselage = create_part(
    lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=1.4, depth=9.0, vertices=48, **kw),
    "Rocket_Fuselage",
    loc=(0, 0, 0),
    scale=(1, 1, 1),
    rot=(0, 0, 0),
    mat=hull_steel
)

# B. Heat Shield
heat_shield = create_part(
    lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=1.42, depth=8.95, vertices=48, **kw),
    "Rocket_HeatShield_Tiles",
    loc=(-0.05, 0, 0),
    scale=(0.55, 1.01, 1.0),
    rot=(0, 0, 0),
    mat=heat_shield_mat
)

# C. Nose Cone
nose_cone = create_part(
    lambda **kw: bpy.ops.mesh.primitive_cone_add(radius1=1.4, radius2=0.08, depth=4.2, vertices=48, **kw),
    "Rocket_NoseCone",
    loc=(0, 0, 6.6),
    scale=(1, 1, 1),
    rot=(0, 0, 0),
    mat=hull_steel
)

nose_tip = create_part(
    lambda **kw: bpy.ops.mesh.primitive_uv_sphere_add(radius=0.22, segments=24, ring_count=16, **kw),
    "Rocket_NoseCap_RCC",
    loc=(0, 0, 8.7),
    scale=(1, 1, 1.2),
    rot=(0, 0, 0),
    mat=heat_shield_mat
)

# D. Forward Canards
for side_name, y_dir in [("Port", 1.45), ("Stbd", -1.45)]:
    create_part(
        lambda **kw: bpy.ops.mesh.primitive_cube_add(size=1.0, **kw),
        f"Rocket_CanardFlap_{side_name}",
        loc=(0.1, y_dir, 5.8),
        scale=(0.9, 0.12, 1.2),
        rot=(0, math.radians(12), 0),
        mat=dark_alloy_mat
    )

# E. Aft Flaps
for side_name, y_dir in [("Port", 1.55), ("Stbd", -1.55)]:
    create_part(
        lambda **kw: bpy.ops.mesh.primitive_cube_add(size=1.0, **kw),
        f"Rocket_AftFlap_{side_name}",
        loc=(0.15, y_dir, -2.8),
        scale=(1.4, 0.15, 2.2),
        rot=(0, math.radians(8), 0),
        mat=dark_alloy_mat
    )

# F. Engine Skirt
create_part(
    lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=1.45, depth=1.2, vertices=48, **kw),
    "Rocket_EngineSkirt",
    loc=(0, 0, -4.9),
    scale=(1, 1, 1),
    rot=(0, 0, 0),
    mat=dark_alloy_mat
)

# G. Engine Cluster (Ring of 6 + 3 Center)
engine_nozzles = []
engine_plumes  = []
engine_offsets = []
for i in range(6):
    ang = i * (2 * math.pi / 6)
    engine_offsets.append((0.85 * math.cos(ang), 0.85 * math.sin(ang), -5.4, 0.36, 1.1))
for i in range(3):
    ang = i * (2 * math.pi / 3) + math.pi / 6
    engine_offsets.append((0.38 * math.cos(ang), 0.38 * math.sin(ang), -5.3, 0.32, 1.0))

for idx, (ex, ey, ez, n_rad, n_len) in enumerate(engine_offsets):
    nz = create_part(
        lambda **kw: bpy.ops.mesh.primitive_cone_add(radius1=n_rad * 0.45, radius2=n_rad, depth=n_len, vertices=24, **kw),
        f"Engine_Bell_{idx:02d}",
        loc=(ex, ey, ez),
        scale=(1, 1, 1),
        rot=(0, math.radians(180), 0),
        mat=nozzle_mat
    )
    engine_nozzles.append(nz)

    create_part(
        lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=n_rad * 0.48, depth=0.25, vertices=16, **kw),
        f"Engine_Throat_{idx:02d}",
        loc=(ex, ey, ez + (n_len * 0.45)),
        scale=(1, 1, 1),
        rot=(0, 0, 0),
        mat=throat_mat
    )

    plume = create_part(
        lambda **kw: bpy.ops.mesh.primitive_cone_add(radius1=n_rad * 0.9, radius2=n_rad * 2.2, depth=4.5, vertices=24, **kw),
        f"Engine_Plume_{idx:02d}",
        loc=(ex, ey, ez - (n_len * 0.5) - 2.2),
        scale=(1, 1, 1),
        rot=(0, 0, 0),
        mat=plume_mat
    )
    engine_plumes.append(plume)

bpy.ops.object.light_add(type='POINT', location=(0, 0, -6.8))
engine_light = bpy.context.active_object
engine_light.name = "Light_EngineExhaust"
engine_light.parent = rocket_root
engine_light.data.energy = 450.0
engine_light.data.color  = (0.35, 0.70, 1.0)
link_to(engine_light, col_rocket)

# H. 4 Landing Legs
landing_legs = []
for leg_idx, angle_deg in enumerate([45, 135, 225, 315]):
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)

    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(1.35 * cos_a, 1.35 * sin_a, -4.2))
    leg_root = bpy.context.active_object
    leg_root.name = f"LandingLeg_Root_{leg_idx}"
    leg_root.parent = rocket_root
    link_to(leg_root, col_rocket)
    landing_legs.append(leg_root)

    strut = create_part(
        lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=0.10, depth=2.8, vertices=16, **kw),
        f"Leg_Strut_{leg_idx}",
        loc=(0, 0, -1.3),
        scale=(1, 1, 1),
        rot=(0, 0, 0),
        mat=dark_alloy_mat
    )
    strut.parent = leg_root

    piston = create_part(
        lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=0.06, depth=1.8, vertices=12, **kw),
        f"Leg_Piston_{leg_idx}",
        loc=(-0.25 * cos_a, -0.25 * sin_a, -0.9),
        scale=(1, 1, 1),
        rot=(0, 0, 0),
        mat=hull_steel
    )
    piston.parent = leg_root

    footpad = create_part(
        lambda **kw: bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=0.15, vertices=24, **kw),
        f"Leg_Footpad_{leg_idx}",
        loc=(0, 0, -2.7),
        scale=(1, 1, 1),
        rot=(0, 0, 0),
        mat=dark_alloy_mat
    )
    footpad.parent = leg_root

# ─────────────────────────────────────────────
# 4. MARS GLOBE (Used in Scene 2)
# ─────────────────────────────────────────────
# Placed dead ahead of Camera 2 at (0, 140, 0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=26.0, segments=128, ring_count=64, location=(0, 140, 0))
mars_planet = bpy.context.active_object
mars_planet.name = "Mars_CelestialGlobe"
smooth_mesh(mars_planet)
link_to(mars_planet, col_mars)

mars_mat, mn, ml = mat_builder("MAT_Mars_Photoreal")
tc_m = mn.new('ShaderNodeTexCoord')
mp_m = mn.new('ShaderNodeMapping')
mp_m.inputs['Scale'].default_value = (3.0, 3.0, 3.0)

n_canyons = mn.new('ShaderNodeTexNoise')
n_canyons.inputs['Scale'].default_value     = 3.5
n_canyons.inputs['Detail'].default_value    = 8.0
n_canyons.inputs['Roughness'].default_value = 0.7
n_craters = mn.new('ShaderNodeTexVoronoi')
n_craters.inputs['Scale'].default_value     = 18.0

cr_mars = mn.new('ShaderNodeValToRGB')
cr_mars.color_ramp.elements[0].position = 0.22
cr_mars.color_ramp.elements[0].color    = (0.18, 0.07, 0.04, 1.0)
cr_mars.color_ramp.elements.new(0.48)
cr_mars.color_ramp.elements[1].position = 0.48
cr_mars.color_ramp.elements[1].color    = (0.58, 0.22, 0.09, 1.0)
cr_mars.color_ramp.elements.new(0.74)
cr_mars.color_ramp.elements[2].position = 0.74
cr_mars.color_ramp.elements[2].color    = (0.78, 0.34, 0.14, 1.0)
cr_mars.color_ramp.elements[3].position = 0.94
cr_mars.color_ramp.elements[3].color    = (0.90, 0.52, 0.22, 1.0)

mix_geo = mn.new('ShaderNodeMixRGB')
mix_geo.blend_type = 'MULTIPLY'
mix_geo.inputs['Fac'].default_value = 0.65

bsdf_mars = mn.new('ShaderNodeBsdfPrincipled')
bsdf_mars.inputs['Roughness'].default_value = 0.88

fres_mars = mn.new('ShaderNodeFresnel')
fres_mars.inputs['IOR'].default_value = 1.10
cr_haze   = mn.new('ShaderNodeValToRGB')
cr_haze.color_ramp.elements[0].position = 0.70
cr_haze.color_ramp.elements[0].color    = (0.0, 0.0, 0.0, 0.0)
cr_haze.color_ramp.elements[1].position = 0.98
cr_haze.color_ramp.elements[1].color    = (0.85, 0.40, 0.18, 0.45)

emit_haze = mn.new('ShaderNodeEmission')
emit_haze.inputs['Strength'].default_value = 1.5
mix_atm   = mn.new('ShaderNodeMixShader')
out_mars  = mn.new('ShaderNodeOutputMaterial')

ml.new(tc_m.outputs['Generated'],     mp_m.inputs['Vector'])
ml.new(mp_m.outputs['Vector'],        n_canyons.inputs['Vector'])
ml.new(mp_m.outputs['Vector'],        n_craters.inputs['Vector'])
ml.new(n_canyons.outputs['Fac'],      cr_mars.inputs['Fac'])
ml.new(cr_mars.outputs['Color'],      mix_geo.inputs['Color1'])
ml.new(n_craters.outputs['Distance'], mix_geo.inputs['Color2'])
ml.new(mix_geo.outputs['Color'],      bsdf_mars.inputs['Base Color'])
ml.new(fres_mars.outputs['Fac'],      cr_haze.inputs['Fac'])
ml.new(cr_haze.outputs['Color'],      emit_haze.inputs['Color'])
ml.new(cr_haze.outputs['Alpha'],      mix_atm.inputs['Fac'])
ml.new(bsdf_mars.outputs['BSDF'],     mix_atm.inputs[1])
ml.new(emit_haze.outputs['Emission'], mix_atm.inputs[2])
ml.new(mix_atm.outputs['Shader'],     out_mars.inputs['Surface'])
mars_planet.data.materials.append(mars_mat)

# Mars is hidden during Scene 1 (pure deep black space), revealed in Scene 2 & 3
mars_planet.hide_render = True
mars_planet.keyframe_insert('hide_render', frame=1)
mars_planet.keyframe_insert('hide_render', frame=280)
mars_planet.hide_render = False
mars_planet.keyframe_insert('hide_render', frame=281)

# ─────────────────────────────────────────────
# 5. MARS LANDING FACILITY & TERRAIN (Scene 3)
# ─────────────────────────────────────────────
PAD_ORIGIN = (0, 0, -200)

bpy.ops.mesh.primitive_grid_add(x_subdivisions=80, y_subdivisions=80, size=240, location=PAD_ORIGIN)
terrain = bpy.context.active_object
terrain.name = "Mars_GroundTerrain"
smooth_mesh(terrain)
link_to(terrain, col_pad)

terrain_mat, tn, tl = mat_builder("MAT_MartianSurface")
tc_t = tn.new('ShaderNodeTexCoord')
n_t  = tn.new('ShaderNodeTexNoise')
n_t.inputs['Scale'].default_value     = 6.0
n_t.inputs['Detail'].default_value    = 8.0
n_t.inputs['Roughness'].default_value = 0.75
cr_t = tn.new('ShaderNodeValToRGB')
cr_t.color_ramp.elements[0].position = 0.35
cr_t.color_ramp.elements[0].color    = (0.35, 0.14, 0.06, 1.0)
cr_t.color_ramp.elements[1].position = 0.70
cr_t.color_ramp.elements[1].color    = (0.70, 0.28, 0.11, 1.0)
bsdf_t = tn.new('ShaderNodeBsdfPrincipled')
bsdf_t.inputs['Roughness'].default_value = 0.95
out_t  = tn.new('ShaderNodeOutputMaterial')
tl.new(tc_t.outputs['Generated'], n_t.inputs['Vector'])
tl.new(n_t.outputs['Fac'],        cr_t.inputs['Fac'])
tl.new(cr_t.outputs['Color'],     bsdf_t.inputs['Base Color'])
tl.new(bsdf_t.outputs['BSDF'],    out_t.inputs['Surface'])
terrain.data.materials.append(terrain_mat)

disp_mod = terrain.modifiers.new("TerrainDisplace", type='DISPLACE')
tex_disp = bpy.data.textures.new("Tex_TerrainDisplace", 'CLOUDS')
tex_disp.noise_scale = 1.2
disp_mod.texture = tex_disp
disp_mod.strength = 3.5

# Octagonal Landing Pad Platform
bpy.ops.mesh.primitive_cylinder_add(radius=16.0, depth=1.6, vertices=8, location=(PAD_ORIGIN[0], PAD_ORIGIN[1], PAD_ORIGIN[2] + 0.8))
pad_platform = bpy.context.active_object
pad_platform.name = "Industrial_LandingPlatform"
smooth_mesh(pad_platform)
link_to(pad_platform, col_pad)

pad_mat, pn, pl = mat_builder("MAT_LandingPlatform_Steel")
bsdf_pad = pn.new('ShaderNodeBsdfPrincipled')
bsdf_pad.inputs['Metallic'].default_value  = 0.82
bsdf_pad.inputs['Roughness'].default_value = 0.45
bsdf_pad.inputs['Base Color'].default_value = (0.28, 0.30, 0.34, 1.0)
out_pad  = pn.new('ShaderNodeOutputMaterial')
pl.new(bsdf_pad.outputs['BSDF'], out_pad.inputs['Surface'])
pad_platform.data.materials.append(pad_mat)

# Hazard Ring
bpy.ops.mesh.primitive_cylinder_add(radius=8.5, depth=0.08, vertices=32, location=(PAD_ORIGIN[0], PAD_ORIGIN[1], PAD_ORIGIN[2] + 1.65))
pad_ring = bpy.context.active_object
pad_ring.name = "Pad_HazardRing"
link_to(pad_ring, col_pad)

ring_mat, rn2, rl2 = mat_builder("MAT_Pad_HazardStripe")
bsdf_ring = rn2.new('ShaderNodeBsdfPrincipled')
bsdf_ring.inputs['Base Color'].default_value = (0.85, 0.65, 0.08, 1.0)
bsdf_ring.inputs['Roughness'].default_value  = 0.6
out_ring = rn2.new('ShaderNodeOutputMaterial')
rl2.new(bsdf_ring.outputs['BSDF'], out_ring.inputs['Surface'])
pad_ring.data.materials.append(ring_mat)

# Floodlight Towers
floodlight_mat, fln, fll = mat_builder("MAT_Floodlight_Fixture")
fl_emit = fln.new('ShaderNodeEmission')
fl_emit.inputs['Color'].default_value    = (1.0, 0.92, 0.82, 1.0)
fl_emit.inputs['Strength'].default_value = 25.0
out_fl = fln.new('ShaderNodeOutputMaterial')
fll.new(fl_emit.outputs['Emission'], out_fl.inputs['Surface'])

for tower_idx, (tx, ty) in enumerate([(18, 18), (-18, 18), (-18, -18), (18, -18)]):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=8.0, vertices=12, location=(PAD_ORIGIN[0] + tx, PAD_ORIGIN[1] + ty, PAD_ORIGIN[2] + 4.0))
    tower = bpy.context.active_object
    tower.name = f"Pad_FloodlightTower_{tower_idx}"
    tower.data.materials.append(dark_alloy_mat)
    link_to(tower, col_pad)

    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(PAD_ORIGIN[0] + tx, PAD_ORIGIN[1] + ty, PAD_ORIGIN[2] + 8.2))
    lum = bpy.context.active_object
    lum.name = f"Pad_Luminaire_{tower_idx}"
    lum.data.materials.append(floodlight_mat)
    link_to(lum, col_pad)

    bpy.ops.object.light_add(type='SPOT', location=(PAD_ORIGIN[0] + tx, PAD_ORIGIN[1] + ty, PAD_ORIGIN[2] + 8.2))
    spot = bpy.context.active_object
    spot.name = f"Light_FloodSpot_{tower_idx}"
    spot.data.energy = 2200.0
    spot.data.spot_size = math.radians(65)
    spot.data.spot_blend = 0.35
    spot.data.color = (1.0, 0.94, 0.88)
    dx, dy, dz = -tx, -ty, -6.6
    rot_y = math.atan2(math.sqrt(dx*dx + dy*dy), -dz)
    rot_z = math.atan2(dy, dx)
    spot.rotation_euler = (0, rot_y, rot_z - math.pi/2)
    link_to(spot, col_pad)

# Billowing Dust Ring
bpy.ops.mesh.primitive_torus_add(major_radius=9.0, minor_radius=1.8, location=(PAD_ORIGIN[0], PAD_ORIGIN[1], PAD_ORIGIN[2] + 1.2))
dust_ring = bpy.context.active_object
dust_ring.name = "Mars_TouchdownDustCloud"
smooth_mesh(dust_ring)
link_to(dust_ring, col_pad)

dust_mat, dsn, dsl = mat_builder("MAT_MartianDustCloud", blend='BLEND')
tc_d   = dsn.new('ShaderNodeTexCoord')
noise_d= dsn.new('ShaderNodeTexNoise')
noise_d.inputs['Scale'].default_value = 4.5
cr_d   = dsn.new('ShaderNodeValToRGB')
cr_d.color_ramp.elements[0].position = 0.35
cr_d.color_ramp.elements[0].color    = (0.75, 0.32, 0.12, 0.0)
cr_d.color_ramp.elements[1].position = 0.80
cr_d.color_ramp.elements[1].color    = (0.65, 0.28, 0.10, 0.55)
bsdf_d  = dsn.new('ShaderNodeBsdfTransparent')
emit_d  = dsn.new('ShaderNodeEmission')
emit_d.inputs['Color'].default_value    = (0.80, 0.35, 0.14, 1.0)
emit_d.inputs['Strength'].default_value = 0.4
mix_d   = dsn.new('ShaderNodeMixShader')
out_d   = dsn.new('ShaderNodeOutputMaterial')
dsl.new(tc_d.outputs['Generated'],  noise_d.inputs['Vector'])
dsl.new(noise_d.outputs['Fac'],     cr_d.inputs['Fac'])
dsl.new(cr_d.outputs['Alpha'],      mix_d.inputs['Fac'])
dsl.new(bsdf_d.outputs['BSDF'],     mix_d.inputs[1])
dsl.new(emit_d.outputs['Emission'], mix_d.inputs[2])
dsl.new(mix_d.outputs['Shader'],    out_d.inputs['Surface'])
dust_ring.data.materials.append(dust_mat)

# ─────────────────────────────────────────────
# 6. CAMERAS & TIMELINE CUTS
# ─────────────────────────────────────────────
# Camera 1: Scene 1 Flyby Shot (Points +Y from (0, -6, 0))
c1_data = bpy.data.cameras.new("CamData_Scene1_Flyby")
c1_data.lens = 32.0

cam1 = bpy.data.objects.new("Cam_Scene1_Flyby", c1_data)
cam1.location = (0, -6.0, 0)
cam1.rotation_euler = (math.radians(90), 0, 0)
scene.collection.objects.link(cam1)
link_to(cam1, col_cameras)

# Camera 2: Scene 2 Transit Shot (Follows behind rocket looking at Mars)
c2_data = bpy.data.cameras.new("CamData_Scene2_Transit")
c2_data.lens = 40.0

cam2 = bpy.data.objects.new("Cam_Scene2_Transit", c2_data)
cam2.location = (2.2, -14.0, 3.5)
# Orientation looking towards (0, 10, 0.5)
cam2.rotation_euler = (math.radians(78), 0, math.radians(10))
scene.collection.objects.link(cam2)
link_to(cam2, col_cameras)

# Camera 3: Scene 3 Ground Landing Shot (Wide ground angle tracking descent)
c3_data = bpy.data.cameras.new("CamData_Scene3_Landing")
c3_data.lens = 32.0

cam3 = bpy.data.objects.new("Cam_Scene3_Landing", c3_data)
cam3.location = (-16.0, -28.0, -192.0)
cam3.rotation_euler = (math.radians(76), 0, math.radians(-30))
scene.collection.objects.link(cam3)
link_to(cam3, col_cameras)

# Camera 4: Scene 3 Hero Ground Shot (Wide establishing angle)
c4_data = bpy.data.cameras.new("CamData_Scene3_Hero")
c4_data.lens = 28.0

cam4 = bpy.data.objects.new("Cam_Scene3_Hero", c4_data)
cam4.location = (20.0, -20.0, -195.0)
cam4.rotation_euler = (math.radians(78), 0, math.radians(45))
scene.collection.objects.link(cam4)
link_to(cam4, col_cameras)

# Bind Timeline Markers
scene.timeline_markers.clear()
m1 = scene.timeline_markers.new("Marker_Scene1_Flyby",   frame=1)
m1.camera = cam1
m2 = scene.timeline_markers.new("Marker_Scene2_Transit", frame=281)
m2.camera = cam2
m3 = scene.timeline_markers.new("Marker_Scene3_Landing", frame=581)
m3.camera = cam3
m4 = scene.timeline_markers.new("Marker_Scene3_Hero",    frame=800)
m4.camera = cam4

scene.camera = cam1

# ─────────────────────────────────────────────
# 7. ANIMATION KEYFRAMES (Frames 1 – 900)
# ─────────────────────────────────────────────

# ==========================================
# SCENE 1: THE ROCKET FLYBY (Frames 1 – 280)
# ==========================================
# Rocket flies from right (X=12) across camera center-front (X=0.2, Y=-3.2, dist=2.8m!) to left (X=-18)
# Nose points along velocity vector: rotation_euler approx (0, -78 deg, -68 deg)
sc1_kfs = [
    # (frame, location, rotation_euler)
    (1,   (18.0, 10.0, 1.8),   (math.radians(-65), math.radians(18), math.radians(-70))),
    (45,  (10.0, 3.0, 1.0),    (math.radians(-68), math.radians(16), math.radians(-70))),
    (85,  (3.0, -0.5, 0.4),    (math.radians(-72), math.radians(14), math.radians(-70))),
    (115, (0.2, -3.2, 0.0),    (math.radians(-75), math.radians(12), math.radians(-70))), # CLOSEST FLYBY! (2.8m from camera!)
    (150, (-4.0, 0.5, -0.3),   (math.radians(-78), math.radians(10), math.radians(-70))),
    (240, (-18.0, 24.0, -1.0), (math.radians(-80), math.radians(8),  math.radians(-70))),
    (280, (-26.0, 42.0, -1.5), (math.radians(-82), math.radians(6),  math.radians(-70))),
]
for fr, loc, rot in sc1_kfs:
    rocket_root.location = loc
    rocket_root.rotation_euler = rot
    rocket_root.keyframe_insert('location', frame=fr)
    rocket_root.keyframe_insert('rotation_euler', frame=fr)

# Camera 1 subtle pan
cam1.location = (0, -6.0, 0)
cam1.keyframe_insert('location', frame=1)
cam1.location = (0.4, -5.7, 0.1)
cam1.keyframe_insert('location', frame=280)
cam1.rotation_euler = (math.radians(90), 0, 0)
cam1.keyframe_insert('rotation_euler', frame=1)
cam1.rotation_euler = (math.radians(91), 0, math.radians(-4))
cam1.keyframe_insert('rotation_euler', frame=280)

# ==========================================
# SCENE 2: JOURNEY TOWARDS MARS (Frames 281 – 580)
# ==========================================
# Rocket flies along +Y from (0, 0, 0) to (0, 75, 0) towards Mars at (0, 140, 0)
sc2_kfs = [
    (281, (0.0, 0.0, 0.0),    (math.radians(90), 0, 0)),
    (380, (0.0, 25.0, 0.4),   (math.radians(90), 0, 0)),
    (480, (0.0, 52.0, 0.8),   (math.radians(90), 0, 0)),
    (580, (0.0, 78.0, 1.2),   (math.radians(90), 0, 0)),
]
for fr, loc, rot in sc2_kfs:
    rocket_root.location = loc
    rocket_root.rotation_euler = rot
    rocket_root.keyframe_insert('location', frame=fr)
    rocket_root.keyframe_insert('rotation_euler', frame=fr)

# Camera 2 tracks right behind rocket
cam2_kfs = [
    (281, (2.2, -14.0, 3.5), (math.radians(78), 0, math.radians(10))),
    (380, (2.2, 11.0, 3.9),  (math.radians(78), 0, math.radians(10))),
    (480, (2.2, 38.0, 4.3),  (math.radians(78), 0, math.radians(10))),
    (580, (2.2, 64.0, 4.7),  (math.radians(78), 0, math.radians(10))),
]
for fr, loc, rot in cam2_kfs:
    cam2.location = loc
    cam2.rotation_euler = rot
    cam2.keyframe_insert('location', frame=fr)
    cam2.keyframe_insert('rotation_euler', frame=fr)

# ==========================================
# SCENE 3: LANDING ON MARS (Frames 581 – 900)
# ==========================================
# Rocket descends vertically onto pad at PAD_ORIGIN = (0, 0, -200)
# Touchdown height: rocket center at Z = -192.5
PAD_TOUCHDOWN_Z = -192.5

sc3_kfs = [
    # 1. Approach from Martian sky
    (581, (0.0, 0.0, -160.0),                 (0, 0, 0)),
    # 2. Descending vertically, braking
    (670, (0.0, 0.0, -178.0),                 (0, 0, 0)),
    # 3. Flare retro-burn above pad
    (740, (0.0, 0.0, -188.0),                 (0, 0, 0)),
    # 4. Final vertical touchdown
    (780, (0.0, 0.0, PAD_TOUCHDOWN_Z),        (0, 0, 0)),
    # 5. Suspension compression settle
    (792, (0.0, 0.0, PAD_TOUCHDOWN_Z - 0.25), (0, 0, 0)),
    (805, (0.0, 0.0, PAD_TOUCHDOWN_Z),        (0, 0, 0)),
    # 6. Stationary resting hero pose
    (900, (0.0, 0.0, PAD_TOUCHDOWN_Z),        (0, 0, 0)),
]
for fr, loc, rot in sc3_kfs:
    rocket_root.location = loc
    rocket_root.rotation_euler = rot
    rocket_root.keyframe_insert('location', frame=fr)
    rocket_root.keyframe_insert('rotation_euler', frame=fr)

# Cam 3 smooth tracking tilt
cam3.location = (-16.0, -28.0, -192.0)
cam3.keyframe_insert('location', frame=581)
cam3.rotation_euler = (math.radians(82), 0, math.radians(-30)) # looks up at descending rocket
cam3.keyframe_insert('rotation_euler', frame=581)
cam3.rotation_euler = (math.radians(74), 0, math.radians(-30)) # levels out at touchdown
cam3.keyframe_insert('rotation_euler', frame=780)

# Landing Legs Deployment (Frames 660 to 715)
for leg_obj in landing_legs:
    leg_obj.rotation_euler = (0, 0, 0)
    leg_obj.keyframe_insert('rotation_euler', frame=1)
    leg_obj.keyframe_insert('rotation_euler', frame=660)
    leg_obj.rotation_euler = (math.radians(38), 0, 0) # Deployed outward!
    leg_obj.keyframe_insert('rotation_euler', frame=715)
    leg_obj.keyframe_insert('rotation_euler', frame=900)

# Engine Plumes Scaling across Timeline
for p_obj in engine_plumes:
    p_obj.scale = (1, 1, 1)
    p_obj.keyframe_insert('scale', frame=1)
    p_obj.keyframe_insert('scale', frame=280)
    p_obj.scale = (0.75, 0.75, 0.75)
    p_obj.keyframe_insert('scale', frame=281)
    p_obj.keyframe_insert('scale', frame=580)
    p_obj.scale = (1.15, 1.15, 1.25) # Retro burn!
    p_obj.keyframe_insert('scale', frame=680)
    p_obj.scale = (1.35, 1.35, 1.4)
    p_obj.keyframe_insert('scale', frame=760)
    p_obj.scale = (0.35, 0.35, 0.35)
    p_obj.keyframe_insert('scale', frame=785)
    p_obj.scale = (0.001, 0.001, 0.001) # OFF at frame 805!
    p_obj.keyframe_insert('scale', frame=805)
    p_obj.keyframe_insert('scale', frame=900)

# Engine light intensity
engine_light.data.energy = 550.0
engine_light.data.keyframe_insert('energy', frame=1)
engine_light.data.keyframe_insert('energy', frame=280)
engine_light.data.energy = 350.0
engine_light.data.keyframe_insert('energy', frame=281)
engine_light.data.keyframe_insert('energy', frame=580)
engine_light.data.energy = 950.0 # Intense retro-illumination
engine_light.data.keyframe_insert('energy', frame=760)
engine_light.data.energy = 120.0
engine_light.data.keyframe_insert('energy', frame=790)
engine_light.data.energy = 0.0   # Engines shut down!
engine_light.data.keyframe_insert('energy', frame=808)
engine_light.data.keyframe_insert('energy', frame=900)

# Touchdown Dust Cloud Animation (Frames 740 to 880)
dust_ring.scale = (0.01, 0.01, 0.01)
dust_ring.keyframe_insert('scale', frame=1)
dust_ring.keyframe_insert('scale', frame=740)
dust_ring.scale = (1.8, 1.8, 1.4) # Expands as exhaust hits ground
dust_ring.keyframe_insert('scale', frame=785)
dust_ring.scale = (2.5, 2.5, 1.0)
dust_ring.keyframe_insert('scale', frame=830)
dust_ring.scale = (3.0, 3.0, 0.4) # Dissipates into thin air
dust_ring.keyframe_insert('scale', frame=880)

# Interpolations
set_interp(rocket_root, 'BEZIER')
for leg_obj in landing_legs:
    set_interp(leg_obj, 'BEZIER')
set_interp(dust_ring, 'BEZIER')
set_interp(cam3, 'BEZIER')

# ─────────────────────────────────────────────
# 8. COMPOSITING (Realistic Glare Bloom & Lens Quality)
# ─────────────────────────────────────────────
comp_tree = bpy.data.node_groups.new("SYNOR_Realistic_Comp", 'CompositorNodeTree')
comp_tree.interface.new_socket('Image', in_out='INPUT',  socket_type='NodeSocketColor')
comp_tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')

cp_in  = comp_tree.nodes.new('NodeGroupInput')
cp_in.location  = (-600, 0)
cp_out = comp_tree.nodes.new('NodeGroupOutput')
cp_out.location = (400, 0)

rl_node = comp_tree.nodes.new('CompositorNodeRLayers')
rl_node.location = (-600, -200)

glare_node = comp_tree.nodes.new('CompositorNodeGlare')
glare_node.location = (-220, 0)
glare_node.inputs['Type'].default_value    = 'Fog Glow'
glare_node.inputs['Quality'].default_value = 'High'
glare_node.inputs['Threshold'].default_value = 0.85
glare_node.inputs['Size'].default_value    = 5.0

lens_node = comp_tree.nodes.new('CompositorNodeLensdist')
lens_node.location = (80, 0)
lens_node.inputs['Distortion'].default_value = -0.005
lens_node.inputs['Dispersion'].default_value = 0.003

comp_tree.links.new(rl_node.outputs['Image'],    glare_node.inputs['Image'])
comp_tree.links.new(glare_node.outputs['Image'], lens_node.inputs['Image'])
comp_tree.links.new(lens_node.outputs['Image'],  cp_out.inputs['Image'])

scene.compositing_node_group = comp_tree

# ─────────────────────────────────────────────
# 9. SAVE PROJECT
# ─────────────────────────────────────────────
bpy.ops.wm.save_as_mainfile(filepath=BLEND_FILE)
print(f"\n✅ Realistic 3D Project saved → {BLEND_FILE}")

# ─────────────────────────────────────────────
# 10. RENDER KEY REVIEW FRAMES (Explicit Camera Selection)
# ─────────────────────────────────────────────
def get_camera_for_frame(fr):
    if fr <= 280:
        return cam1
    elif fr <= 580:
        return cam2
    elif fr <= 780:
        return cam3
    else:
        return cam4

test_review_frames = [
    # Scene 1: Close Flyby
    (85,  "scene1_flyby_approach"),
    (115, "scene1_flyby_closeup"),
    # Scene 2: Transit towards Mars
    (380, "scene2_transit_rear"),
    (480, "scene2_transit_mars_approaching"),
    # Scene 3: Landing on Mars
    (680, "scene3_landing_geardeploy"),
    (760, "scene3_landing_retrobarn"),
    (785, "scene3_landing_touchdown"),
    (860, "scene3_landing_hero_pose")
]

for fr, tag in test_review_frames:
    scene.frame_set(fr)
    target_cam = get_camera_for_frame(fr)
    scene.camera = target_cam
    out_img = os.path.join(EXPORT_DIR, f"review_{tag}_f{fr:03d}.png")
    scene.render.filepath = out_img
    bpy.ops.render.render(write_still=True)
    print(f"✅ Rendered Review Frame {fr:03d} (Camera: {target_cam.name}) -> {out_img}")

print("\n🚀 SYNOR Realistic 3D Intro Cutscene Build & Test Renders COMPLETE!")
