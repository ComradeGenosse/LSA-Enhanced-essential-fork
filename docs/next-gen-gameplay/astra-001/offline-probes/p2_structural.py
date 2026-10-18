#!/usr/bin/env python3
"""ASTRA-001 offline probe P2 -- structural consequence solver feasibility.

NOT a GTA test. A 3D Euler-Bernoulli space frame (6 DOF/node) stands in for a
"structural skeleton" inferred from a building. Questions:
 (a) Does a removal-driven, load-redistributing solve produce causally different
     outcomes (bridging vs progressive collapse) for different structures and
     damage, rather than a canned animation?  (UFC 4-023-03 alternate-path idea:
     dynamic increase factor DIF=2 applied to bays adjacent to removed columns.)
 (b) What does one sparse solve cost as structures grow (sandbox: 2 vCPU Xeon,
     SciPy SuperLU with symmetric minimum-degree ordering; no CHOLMOD/PARDISO)?
Failure criteria: 'nominal' (engineering-style RC section capacities) or
'baseline' (The Finals-style: capacity = intact demand + break offset).
Sanity checks: global vertical equilibrium of the intact frame.
"""
import numpy as np, scipy.sparse as sp, scipy.sparse.linalg as spla, time, json
from collections import deque

E, G, FC = 30e9, 12.5e9, 30e6
COL = (0.5, 0.5); BEAM = (0.35, 0.60)

def sec(b, h):
    A = b*h; Iy = b*h**3/12; Iz = h*b**3/12
    a, c = max(b, h), min(b, h)
    J = a*c**3*(1/3-0.21*(c/a)*(1-(c/a)**4/12))
    return A, Iy, Iz, J

def caps(b, h):
    A = b*h; d = 0.9*h
    return 0.85*FC*A, 0.15*FC*b*d*d, 2*0.17*np.sqrt(FC/1e6)*b*d*1e6   # N, M, V

def local_k(L, A, Iy, Iz, J):
    k = np.zeros((12, 12)); EA, GJ = E*A/L, G*J/L
    k[0,0]=k[6,6]=EA; k[0,6]=k[6,0]=-EA; k[3,3]=k[9,9]=GJ; k[3,9]=k[9,3]=-GJ
    for (i1,i2,r1,r2,EI,s) in [(1,7,5,11,E*Iz,1),(2,8,4,10,E*Iy,-1)]:
        a=12*EI/L**3; b=6*EI/L**2; c=4*EI/L; d=2*EI/L
        k[i1,i1]=k[i2,i2]=a; k[i1,i2]=k[i2,i1]=-a
        k[i1,r1]=k[r1,i1]=s*b; k[i1,r2]=k[r2,i1]=s*b
        k[i2,r1]=k[r1,i2]=-s*b; k[i2,r2]=k[r2,i2]=-s*b
        k[r1,r1]=k[r2,r2]=c; k[r1,r2]=k[r2,r1]=d
    return k

def rot(p1, p2):
    x = (p2-p1)/np.linalg.norm(p2-p1)
    ref = np.array([0,0,1.0]) if abs(x[2]) < 0.9 else np.array([1.0,0,0])
    y = np.cross(ref, x); y /= np.linalg.norm(y); z = np.cross(x, y)
    R = np.vstack([x, y, z]); T = np.zeros((12, 12))
    for i in range(4): T[3*i:3*i+3, 3*i:3*i+3] = R
    return T

def build(nx, ny, nz, bay=6.0, storey=3.5, w_int=50.7e3):
    """w_int = (1.2*6 kPa + 0.5*2.5 kPa) * 6 m tributary -> ~50.7 kN/m on interior beams."""
    nid = {}; P = []
    for k in range(nz+1):
        for j in range(ny+1):
            for i in range(nx+1):
                nid[(i,j,k)] = len(P); P.append((i*bay, j*bay, k*storey))
    P = np.array(P); mem = []
    for k in range(nz):
        for j in range(ny+1):
            for i in range(nx+1):
                mem.append(dict(kind='col', a=nid[(i,j,k)], b=nid[(i,j,k+1)], w=0.0, plan=(i, j), lvl=k))
    for k in range(1, nz+1):
        for j in range(ny+1):
            for i in range(nx):
                mem.append(dict(kind='beam', a=nid[(i,j,k)], b=nid[(i+1,j,k)], w=w_int*(0.5 if j in (0, ny) else 1.0), plan=(i+0.5, j), lvl=k))
        for j in range(ny):
            for i in range(nx+1):
                mem.append(dict(kind='beam', a=nid[(i,j,k)], b=nid[(i,j+1,k)], w=w_int*(0.5 if i in (0, nx) else 1.0), plan=(i, j+0.5), lvl=k))
    ground = np.where(P[:,2] == 0)[0]
    return P, mem, ground, nid

def solve(P, mem, alive, ground, scale, beam):
    n = len(P); adj = [[] for _ in range(n)]
    for e, m in enumerate(mem):
        if alive[e]: adj[m['a']].append(m['b']); adj[m['b']].append(m['a'])
    seen = np.zeros(n, bool); dq = deque(ground); seen[ground] = True
    while dq:
        u = dq.popleft()
        for v in adj[u]:
            if not seen[v]: seen[v] = True; dq.append(v)
    rows, cols, vals = [], [], []; F = np.zeros(6*n); cache = {}; total_load = 0.0
    for e, m in enumerate(mem):
        a, b = m['a'], m['b']
        if not alive[e] or not (seen[a] and seen[b]): continue
        bh = COL if m['kind'] == 'col' else beam
        L = float(np.linalg.norm(P[b]-P[a])); key = (m['kind'], round(L, 3), bh)
        if key not in cache: cache[key] = local_k(L, *sec(*bh))
        T = rot(P[a], P[b]); kg = T.T @ cache[key] @ T
        dofs = np.r_[6*a:6*a+6, 6*b:6*b+6]; rr, cc = np.meshgrid(dofs, dofs, indexing='ij')
        rows.append(rr.ravel()); cols.append(cc.ravel()); vals.append(kg.ravel())
        if m['w']:
            q = m['w']*scale[e]; total_load += q*L; R3 = T[:3,:3]
            # equivalent nodal loads, local (w1,thy1,w2,thy2) = (-qL/2, +qL^2/12, -qL/2, -qL^2/12)
            F[6*a+2] -= q*L/2; F[6*b+2] -= q*L/2
            F[6*a+3:6*a+6] += R3.T @ np.array([0, q*L*L/12, 0]); F[6*b+3:6*b+6] += R3.T @ np.array([0, -q*L*L/12, 0])
    if not rows:
        return dict(u=np.zeros(6*n), dt=0.0, ndof=0, seen=seen, total_load=0.0, vert_reaction=0.0)
    K = sp.csc_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(6*n, 6*n))
    free = np.ones(6*n, bool)
    for g in ground: free[6*g:6*g+6] = False
    for i in np.where(~seen)[0]: free[6*i:6*i+6] = False
    idx = np.where(free)[0]
    Kf = (K[idx][:, idx] + sp.identity(len(idx))*1e-3).tocsc()
    t0 = time.perf_counter(); u = np.zeros(6*n); u[idx] = spla.splu(Kf, permc_spec='MMD_AT_PLUS_A').solve(F[idx]); dt = time.perf_counter()-t0
    R = K @ u - F                                   # reactions at fixed DOFs
    vert_reaction = float(sum(R[6*g+2] for g in ground))
    return dict(u=u, dt=dt, ndof=len(idx), seen=seen, total_load=total_load, vert_reaction=vert_reaction)

def demands(P, mem, alive, s, scale, beam):
    u, seen = s['u'], s['seen']; D = np.zeros(len(mem))
    for e, m in enumerate(mem):
        a, b = m['a'], m['b']
        if not alive[e] or not (seen[a] and seen[b]): continue
        bh = COL if m['kind'] == 'col' else beam
        L = float(np.linalg.norm(P[b]-P[a])); T = rot(P[a], P[b])
        f = local_k(L, *sec(*bh)) @ (T @ np.r_[u[6*a:6*a+6], u[6*b:6*b+6]])
        if m['w']:   # add fixed-end actions (negative of equivalent nodal loads)
            q = m['w']*scale[e]; f[2] += q*L/2; f[8] += q*L/2; f[4] -= q*L*L/12; f[10] += q*L*L/12
        Nc, Mc, Vc = caps(*bh)
        N = max(abs(f[0]), abs(f[6])); M = max(abs(f[4]), abs(f[10]), abs(f[5]), abs(f[11])); V = max(abs(f[1]), abs(f[2]), abs(f[7]), abs(f[8]))
        D[e] = (N/Nc if m['kind'] == 'col' else 0.0) + M/Mc + V/Vc
    return D

def scenario(nx, ny, nz, remove, mode='nominal', beam=BEAM, offset=0.5, DIF=2.0, maxit=80):
    P, mem, ground, nid = build(nx, ny, nz)
    alive = np.ones(len(mem), bool); one = np.ones(len(mem))
    s0 = solve(P, mem, alive, ground, one, beam); D0 = demands(P, mem, alive, s0, one, beam)
    equilibrium_err = abs(s0['vert_reaction']-s0['total_load'])/s0['total_load']
    cap = np.ones(len(mem)) if mode == 'nominal' else D0 + offset
    intact_over = int((D0 > cap).sum())
    removed_plan = set()
    for (i, j) in remove:
        for e, m in enumerate(mem):
            if m['kind'] == 'col' and m['plan'] == (i, j) and m['lvl'] == 0: alive[e] = False; removed_plan.add((i, j))
    def dif_scale():
        sc = np.ones(len(mem))
        for e, m in enumerate(mem):   # beams framing into (bays adjacent to) any removed/failed column line
            if m['kind'] == 'beam' and any(abs(m['plan'][0]-i) <= 1 and abs(m['plan'][1]-j) <= 1 for (i, j) in removed_plan): sc[e] = DIF
        return sc
    times = [s0['dt']]; failed = 0; it = 0; s = None
    while it < maxit:
        it += 1; sc = dif_scale(); s = solve(P, mem, alive, ground, sc, beam); times.append(s['dt'])
        D = demands(P, mem, alive, s, sc, beam)
        over = np.where(alive & s['seen'][[m['a'] for m in mem]] & (D > cap))[0]
        if len(over) == 0: break
        alive[over] = False; failed += len(over)
        for e in over:
            if mem[e]['kind'] == 'col': removed_plan.add(mem[e]['plan'])
    fallen = int((~s['seen']).sum())
    return dict(size=f'{nx}x{ny}x{nz}', mode=mode, beam=list(beam), offset=offset if mode == 'baseline' else None,
                members=len(mem), intact_equilibrium_rel_err=float(f'{equilibrium_err:.2e}'), intact_overstressed=intact_over,
                removed_columns=len(remove), DIF=DIF, extra_failed_members=failed, fallen_nodes=fallen, total_nodes=len(P),
                iterations=it, free_dof_intact=s0['ndof'], mean_solve_s=round(float(np.mean(times)), 4), max_solve_s=round(float(max(times)), 4))

if __name__ == '__main__':
    import sys
    out = []
    # (a) causal differentiation: same building, different damage / structure / criterion
    for beam in [BEAM, (0.45, 0.90), (0.60, 1.20)]:
        for DIF in [2.0, 1.3]:
            out.append(scenario(4, 4, 5, [(2, 0)], 'nominal', beam=beam, DIF=DIF))
    for rem in [[(0, 0)], [(1, 0), (2, 0)], [(1, 0), (2, 0), (3, 0)], [(2, 2)]]:
        out.append(scenario(4, 4, 5, rem, 'nominal', beam=(0.60, 1.20), DIF=1.3))
    for off in [0.5, 0.15]:
        out.append(scenario(4, 4, 5, [(2, 0)], 'baseline', offset=off, DIF=1.3))
    # (b) cost scaling (a few iterations only)
    if '--scale' in sys.argv:
        for (nx, ny, nz) in [(8, 8, 10), (12, 12, 20), (16, 16, 30)]:
            out.append(scenario(nx, ny, nz, [(nx//2, 0)], 'nominal', beam=(0.45, 0.90), maxit=2))
    print(json.dumps(out, indent=1))
