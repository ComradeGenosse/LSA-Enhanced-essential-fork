#!/usr/bin/env python3
"""ASTRA-001 offline probe P1b -- repeated-fire erosion ("rounds to breach").

NOT a GTA test. Voxel crater-accumulation model of an 8-in (20 cm) reinforced concrete
patch: 1 cm voxels, indestructible rebar mesh at mid-depth (15 cm pitch; FM: small-arms
rounds "cannot cut the reinforcing bars").

Calibration data, FM 3-06.11 (2002) Ch. 7, 8-in reinforced concrete:
  5.56 mm (25-100 m): initial penetration 35 rounds; loophole (~7 in) 250 rounds.
     Table 7-2 values as printed in The Black Vault's PDF of Ch. 7 ("Initial / Loophole -
     35 / 250"); the Internet Archive OCR keeps the fragment "Loophole 250". An earlier
     summarised copy collapsed the two stages; that misreading is superseded (doc 01 §7).
  7.62 mm ball (25 m): 7-in hole after 100 rounds (Table 7-5).
FM's breaching technique is "short bursts (three to five rounds) in a U-shaped pattern",
so the loophole case uses a U-shaped aim path, the initial-penetration case concentrated fire.

Model v1 (hemispherical craters, Gaussian aim, one constant eta fitted to the 5.56
initial-penetration count) is tested first and expected to fail; model v2 (cone/spall
craters with width:depth aspect k, two constants eta,k fitted to the TWO 5.56 data points,
FM's U-shaped burst pattern for loopholes) then PREDICTS the 7.62 count out of sample.
"""
import numpy as np, json, math, itertools

NX = NY = 60; NZ = 20
HOLE = 7*2.54                     # cm
E556 = 0.5*0.0040*860**2          # J (assumed ~60 m)
E762 = 0.5*0.0095*820**2          # J (assumed ~25 m)
SEEDS = range(5)

def make_wall():
    solid = np.ones((NX, NY, NZ), bool); rebar = np.zeros_like(solid)
    for c in range(7, NX, 15):
        rebar[c, :, 9:11] = True; rebar[:, c, 9:11] = True
    return solid, rebar

GX, GY, GZ = np.mgrid[0:NX, 0:NY, 0:NZ]
def bite(solid, rebar, x, y, vol, k):
    """Cone crater: depth d, surface radius a = k*d, volume (pi/3) a^2 d, cut from local surface."""
    col = solid[x, y, :]; z0 = int(np.argmax(col)) if col.any() else NZ-1
    d = (3*vol/(math.pi*k*k))**(1/3); a = k*d
    r = np.sqrt((GX-x)**2 + (GY-y)**2)
    m = (r <= a) & (GZ >= z0) & (GZ - z0 <= d*(1 - r/max(a, 1e-6)))
    solid[m & ~rebar] = False

def perforated(solid, rebar): return bool((~solid.any(axis=2)).any())
def hole_diam(solid, rebar):
    left = (solid & ~rebar).any(axis=2)
    return 2*math.sqrt(float((~left).sum())/math.pi)

def u_path(n, R=HOLE/2):
    """FM's U-shaped burst pattern around the patch centre: left leg down, bottom
    semicircle, right leg up; cycled for n rounds."""
    pts = [(-R, y) for y in np.linspace(R, 0, 6)]
    pts += [(R*math.cos(a), R*math.sin(a)) for a in np.linspace(math.pi, 2*math.pi, 12)]
    pts += [(R, y) for y in np.linspace(0, R, 6)]
    return [pts[i % len(pts)] for i in range(n)]

def bite_hemi(solid, rebar, x, y, vol):
    """Model v1: hemispherical crater (kept to document its falsification)."""
    col = solid[x, y, :]; z0 = int(np.argmax(col)) if col.any() else NZ-1
    r = (3*vol/(2*math.pi))**(1/3)
    m = (GX-x)**2 + (GY-y)**2 + (GZ-z0)**2 <= r*r
    solid[m & ~rebar] = False

def run_v1(eta, E, sig, seed, stop, cap=600):
    rng = np.random.default_rng(seed); solid, rebar = make_wall()
    for n in range(1, cap+1):
        dx, dy = rng.normal(0, sig, 2)
        x, y = int(np.clip(round(NX/2+dx), 0, NX-1)), int(np.clip(round(NY/2+dy), 0, NY-1))
        bite_hemi(solid, rebar, x, y, eta*E)
        if stop(solid, rebar): return n
    return cap

def run(eta, E, k, seed, mode, stop, cap=600):
    rng = np.random.default_rng(seed); solid, rebar = make_wall(); path = u_path(cap)
    for n in range(1, cap+1):
        if mode == 'concentrated': dx, dy = rng.normal(0, 2.0, 2)
        else: dx, dy = np.array(path[n-1]) + rng.normal(0, 1.5, 2)
        x, y = int(np.clip(round(NX/2+dx), 0, NX-1)), int(np.clip(round(NY/2+dy), 0, NY-1))
        bite(solid, rebar, x, y, eta*E, k)
        if stop(solid, rebar): return n
    return cap

def mean_runs(eta, E, k, mode, stop):
    return float(np.mean([run(eta, E, k, s, mode, stop) for s in SEEDS]))

def main(eta_grid, k_grid):
    first = perforated
    hole = lambda s, r: hole_diam(s, r) >= HOLE
    out = {'FM_targets': {'5.56_initial_penetration': 35, '5.56_loophole_7in': 250, '7.62_7in_hole': 100},
           'assumptions': {'E556_J': round(E556), 'E762_J': round(E762), 'rebar_pitch_cm': 15,
                           'concentrated_aim_sigma_cm': 2.0, 'U_pattern_radius_cm': round(HOLE/2, 1), 'U_jitter_sigma_cm': 1.5}}

    # --- v1: hemispherical craters + Gaussian aim, eta fitted to 35 rounds first perforation ---
    v1 = {}
    for sig in (2.5, 4.0):
        lo, hi = 0.0005, 2.0
        for _ in range(14):
            mid = math.sqrt(lo*hi)
            if np.mean([run_v1(mid, E556, sig, sd, first) for sd in SEEDS]) > 35: lo = mid
            else: hi = mid
        eta1 = math.sqrt(lo*hi)
        v1[sig] = dict(eta=round(eta1, 4),
                       n_first=float(np.mean([run_v1(eta1, E556, sig, sd, first) for sd in SEEDS])),
                       n556_hole=float(np.mean([run_v1(eta1, E556, sig, sd, hole) for sd in SEEDS])),
                       n762_hole=float(np.mean([run_v1(eta1, E762, sig, sd, hole) for sd in SEEDS])))
    out['v1_hemispherical_gaussian'] = v1

    # --- v2 calibration: grid over (eta, k) for the two 5.56 points (log-error objective) ---
    best = None; grid = []
    for eta, k in itertools.product(eta_grid, k_grid):
        n1 = mean_runs(eta, E556, k, 'concentrated', first)
        n2 = mean_runs(eta, E556, k, 'U', hole)
        err = abs(math.log(n1/35)) + abs(math.log(n2/250))
        grid.append(dict(eta=eta, k=k, n_first=n1, n_hole=n2, err=round(err, 3)))
        if best is None or err < best['err']: best = dict(eta=eta, k=k, n_first=n1, n_hole=n2, err=err)
    pred762 = mean_runs(best['eta'], E762, best['k'], 'U', hole)
    out['v2_best_fit'] = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in best.items()}
    out['v2_prediction_7.62_rounds_to_7in_hole'] = pred762
    out['v2_prediction_ratio_vs_FM_100'] = round(pred762/100, 2)
    out['v2_within_factor_1.5'] = 1/1.5 <= pred762/100 <= 1.5
    out['v2_grid'] = grid
    print(json.dumps(out, indent=1))

if __name__ == '__main__':
    import sys
    if '--extended' in sys.argv:
        main([0.01, 0.015, 0.02, 0.03, 0.04, 0.06], [4.0, 6.0, 8.0, 10.0, 14.0])
    else:
        main([0.01, 0.02, 0.04, 0.08, 0.16, 0.32], [1.0, 1.5, 2.0, 3.0, 4.0, 6.0])
