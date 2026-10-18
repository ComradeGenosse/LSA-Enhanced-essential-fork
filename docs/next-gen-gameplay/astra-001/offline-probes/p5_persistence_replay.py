#!/usr/bin/env python3
"""ASTRA-001 offline probe P5 -- persistence by event log vs snapshot.

NOT a GTA test. Damage events carry everything needed to regenerate geometry
(position quantised to 1 mm, normal, ammo/material ids, crater volume, RNG seed
derived from the quantised impact -- the Rainbow Six Siege determinism contract:
same inputs, same order => same result). We check:
  1. replaying the same log reproduces a bit-identical field (SHA-256),
  2. a reordered log does NOT (order is part of the contract),
  3. cost of replay vs loading a compressed snapshot, and storage sizes.
"""
import numpy as np, hashlib, json, time, zlib, struct, math

W, H, T = 1000, 300, 20

def seed_of(ev):
    q = struct.pack('<iiiHH', ev['x_mm'], ev['y_mm'], ev['z_mm'], ev['ammo'], ev['mat'])
    return int.from_bytes(hashlib.sha256(q).digest()[:8], 'little')

def apply(field, ev):
    rng = np.random.default_rng(seed_of(ev))
    x, y = ev['x_mm']//10, ev['y_mm']//10
    vol = ev['vol_cm3']*rng.uniform(0.8, 1.2)              # deterministic per-impact variation
    r = (3*vol/(2*math.pi))**(1/3); R = int(math.ceil(r))
    xs, ys = slice(max(0, x-R), min(W, x+R+1)), slice(max(0, y-R), min(H, y+R+1))
    gx, gy = np.mgrid[xs, ys]
    depth = np.sqrt(np.maximum(r*r-(gx-x)**2-(gy-y)**2, 0)).astype(np.float32)
    field[xs, ys] = np.maximum(field[xs, ys]-depth, 0)

def replay(log):
    f = np.full((W, H), np.float32(T))
    for ev in log: apply(f, ev)
    return f

def digest(f): return hashlib.sha256(f.tobytes()).hexdigest()[:16]

rng = np.random.default_rng(1)
def make_log(n):
    return [dict(x_mm=int(rng.uniform(0, W*10)), y_mm=int(rng.uniform(0, H*10)), z_mm=0, ammo=int(rng.integers(0, 4)),
                 mat=1, vol_cm3=160.0) for _ in range(n)]
res = {}
for n in (1000, 10000):
    log = make_log(n)
    t = time.perf_counter(); f1 = replay(log); t_replay = time.perf_counter()-t
    f2 = replay(log)
    shuffled = list(reversed(log)); f3 = replay(shuffled)
    snap = zlib.compress(np.round(f1*10).astype(np.uint8).tobytes(), 6)   # 1 mm thickness quantisation
    t = time.perf_counter(); g = np.frombuffer(zlib.decompress(snap), np.uint8).reshape(W, H); t_load = time.perf_counter()-t
    # integer (fixed-point, 0.1 mm) variant: order-independent and bit-exact by construction
    def apply_int(fi, ev):
        rng2 = np.random.default_rng(seed_of(ev)); x, y = ev['x_mm']//10, ev['y_mm']//10
        vol = ev['vol_cm3']*rng2.uniform(0.8, 1.2); r = (3*vol/(2*math.pi))**(1/3); R = int(math.ceil(r))
        xs, ys = slice(max(0, x-R), min(W, x+R+1)), slice(max(0, y-R), min(H, y+R+1)); gx, gy = np.mgrid[xs, ys]
        d = np.round(np.sqrt(np.maximum(r*r-(gx-x)**2-(gy-y)**2, 0))*100).astype(np.int32)
        fi[xs, ys] = np.maximum(fi[xs, ys]-d, 0)
    def rint(lg):
        fi = np.full((W, H), T*100, np.int32)
        for ev in lg: apply_int(fi, ev)
        return fi
    i1, i3 = rint(log), rint(shuffled)
    res[n] = dict(replay_s=round(t_replay, 3), identical_replay=digest(f1) == digest(f2),
                  reordered_identical=digest(f1) == digest(f3),
                  reordered_float_max_abs_diff_cm=float(np.abs(f1-f3).max()),
                  int_fixed_point_reordered_identical=bool((i1 == i3).all()),
                  log_bytes=n*20, snapshot_bytes=len(snap), snapshot_load_s=round(t_load, 4),
                  snapshot_max_abs_err_mm=float(np.abs(g/10.0-f1).max()*10))
print(json.dumps(res, indent=1))
