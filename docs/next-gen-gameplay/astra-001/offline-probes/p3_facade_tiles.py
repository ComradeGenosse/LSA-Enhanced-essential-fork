#!/usr/bin/env python3
"""ASTRA-001 offline probe P3 -- entity budget of a tile-kit destructible facade.

NOT a GTA test. Question: if a damaged wall is projected into GTA as pre-authored
props (no runtime mesh creation), how many entities does it need?
  naive    : one prop per remaining solid cell (uniform grid of resolution r)
  QT+MS    : quadtree-merged solid panels (power-of-two prefab sizes) plus one
             marching-squares boundary tile per mixed cell (16 cases, 6 unique
             shapes up to rotation) -- the 'Tessellated Facade Kit' idea.
Damage is accumulated on a 1 cm 'remaining thickness' field (crater model from P1b),
then sampled on the corner lattice of each resolution.
"""
import numpy as np, json, math

W, H, T = 1000, 300, 20                     # cm: 10 m x 3 m wall, 20 cm thick
rng = np.random.default_rng(7)

def crater(field, x, y, vol):
    r = (3*vol/(2*math.pi))**(1/3); R = int(math.ceil(r))
    xs, ys = slice(max(0, x-R), min(W, x+R+1)), slice(max(0, y-R), min(H, y+R+1))
    gx, gy = np.mgrid[xs, ys]
    depth = np.sqrt(np.maximum(r*r-(gx-x)**2-(gy-y)**2, 0))   # hemispherical bite
    field[xs, ys] = np.maximum(field[xs, ys]-depth, 0)

def scenario(name):
    f = np.full((W, H), float(T))
    if name in ('scatter100', 'combined'):
        for _ in range(100):
            crater(f, int(rng.uniform(0, W)), int(rng.uniform(0, H)), 160.0)
    if name in ('loophole60', 'combined'):
        for _ in range(60):
            x, y = np.clip(np.round(rng.normal([300, 150], 2.5)).astype(int), 0, [W-1, H-1]); crater(f, x, y, 160.0)
    if name in ('blast', 'combined'):
        gx, gy = np.mgrid[0:W, 0:H]; d = np.hypot(gx-650, gy-120)
        f[d < 75] = 0                                          # 1.5 m breach
        ring = (d >= 75) & (d < 110); f[ring] *= rng.uniform(0.2, 1.0, ring.sum())  # damaged rim
    return f

def counts(field, r, max_panel_cm=400):
    nx, ny = W//r, H//r
    # corner occupancy: solid if remaining thickness > 0 at the lattice point (sampled at cell corners)
    cx = np.clip(np.arange(nx+1)*r, 0, W-1); cy = np.clip(np.arange(ny+1)*r, 0, H-1)
    corner = field[np.ix_(cx, cy)] > 0
    case = (corner[:-1, :-1].astype(int) | corner[1:, :-1]*2 | corner[1:, 1:]*4 | corner[:-1, 1:]*8)
    full = case == 15; mixed = (case > 0) & (case < 15)
    naive = int(full.sum() + mixed.sum())
    # quadtree merge of full cells into power-of-two panels (greedy, aligned)
    used = np.zeros_like(full); panels = 0; kmax = int(math.log2(max(1, max_panel_cm//r)))
    for k in range(kmax, -1, -1):
        s = 2**k
        for i in range(0, nx-s+1, s):
            for j in range(0, ny-s+1, s):
                blk = full[i:i+s, j:j+s]
                if blk.all() and not used[i:i+s, j:j+s].any():
                    used[i:i+s, j:j+s] = True; panels += 1
    leftover = int((full & ~used).sum())
    return dict(res_cm=r, naive_props=naive, qt_panels=panels + leftover, ms_boundary_tiles=int(mixed.sum()),
                qt_ms_total=panels + leftover + int(mixed.sum()), open_area_m2=round(float((field == 0).sum())/1e4, 2))

out = {}
for sc in ['pristine', 'scatter100', 'loophole60', 'blast', 'combined']:
    f = np.full((W, H), float(T)) if sc == 'pristine' else scenario(sc)
    out[sc] = [counts(f, r) for r in (5, 10, 25)]
out['asset_kit_estimate'] = dict(ms_unique_shapes_up_to_rotation=6, panel_sizes_per_res='log2(400/r)+1',
                                 example='4 materials x 3 thicknesses x (6 + 5 panel sizes) = 132 prefab assets at 25 cm')
print(json.dumps(out, indent=1))

# ---- Variant: anisotropic kit (independent power-of-two widths/heights, max 4 m x 3.2 m) ----
def counts_aniso(field, r, maxw=400, maxh=320):
    nx, ny = W//r, H//r
    cx = np.clip(np.arange(nx+1)*r, 0, W-1); cy = np.clip(np.arange(ny+1)*r, 0, H-1)
    corner = field[np.ix_(cx, cy)] > 0
    case = (corner[:-1, :-1].astype(int) | corner[1:, :-1]*2 | corner[1:, 1:]*4 | corner[:-1, 1:]*8)
    full = case == 15; mixed = (case > 0) & (case < 15); used = np.zeros_like(full); panels = 0
    ws = [2**k for k in range(int(math.log2(max(1, maxw//r))), -1, -1)]
    hs = [2**k for k in range(int(math.log2(max(1, maxh//r))), -1, -1)]
    sizes = sorted({(w, h) for w in ws for h in hs}, key=lambda s: -s[0]*s[1])
    for (sw, sh) in sizes:
        for i in range(0, nx-sw+1):
            for j in range(0, ny-sh+1):
                if not used[i, j] and full[i:i+sw, j:j+sh].all() and not used[i:i+sw, j:j+sh].any():
                    used[i:i+sw, j:j+sh] = True; panels += 1
    return dict(res_cm=r, aniso_panels=panels, ms_boundary_tiles=int(mixed.sum()), total=panels+int(mixed.sum()),
                kit_panel_variants=len(sizes))
aniso = {}
for sc in ['pristine', 'blast', 'combined']:
    f = np.full((W, H), float(T)) if sc == 'pristine' else scenario(sc)
    aniso[sc] = [counts_aniso(f, r) for r in (10, 25)]
print(json.dumps({'anisotropic_kit_variant': aniso}, indent=1))
