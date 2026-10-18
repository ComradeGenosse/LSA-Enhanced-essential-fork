#!/usr/bin/env python3
"""ASTRA-001 offline probe P2b -- sparse SPD solve cost for structural skeletons.

NOT a GTA test. Re-uses the P2 frame assembler; compares SciPy SuperLU (general LU)
with CHOLMOD supernodal Cholesky (scikit-sparse, SuiteSparse 7.6) on the intact
stiffness matrix, and measures numeric-only refactorisation after a member removal
(symbolic analysis reused, as an event-driven solver would do).
Sandbox: 2 vCPU Xeon @2.1 GHz -- an upper bound, not the user's i9-14900K.
"""
import numpy as np, scipy.sparse as sp, scipy.sparse.linalg as spla, time, json
from sksparse.cholmod import cho_factor
import p2_structural as S

def assemble(nx, ny, nz, beam=(0.45, 0.90), kill=None):
    P, mem, ground, nid = S.build(nx, ny, nz)
    n = len(P); rows, cols, vals = [], [], []; F = np.zeros(6*n); cache = {}
    for e, m in enumerate(mem):
        a, b = m['a'], m['b']; bh = S.COL if m['kind'] == 'col' else beam
        L = float(np.linalg.norm(P[b]-P[a])); key = (m['kind'], round(L, 3))
        if key not in cache: cache[key] = S.local_k(L, *S.sec(*bh))
        T = S.rot(P[a], P[b]); kg = T.T @ cache[key] @ T
        if kill is not None and e in kill: kg = kg*0.0          # keep pattern, zero stiffness
        dofs = np.r_[6*a:6*a+6, 6*b:6*b+6]; rr, cc = np.meshgrid(dofs, dofs, indexing='ij')
        rows.append(rr.ravel()); cols.append(cc.ravel()); vals.append(kg.ravel())
        if m['w']: F[6*a+2] -= m['w']*L/2; F[6*b+2] -= m['w']*L/2
    K = sp.csc_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(6*n, 6*n))
    free = np.ones(6*n, bool)
    for g in ground: free[6*g:6*g+6] = False
    idx = np.where(free)[0]
    return (K[idx][:, idx] + sp.identity(len(idx))*1e-3).tocsc(), F[idx], mem

def member_C(dims, beam, e_kill):
    """Low-rank factor C with C C^T = removed element stiffness (global, free DOFs)."""
    P, mem, ground, nid = S.build(*dims); n = len(P)
    free = np.ones(6*n, bool)
    for g in ground: free[6*g:6*g+6] = False
    pos = -np.ones(6*n, int); pos[free] = np.arange(free.sum())
    m = mem[e_kill]; a, b = m['a'], m['b']; bh = S.COL if m['kind'] == 'col' else beam
    L = float(np.linalg.norm(P[b]-P[a])); T = S.rot(P[a], P[b]); kg = T.T @ S.local_k(L, *S.sec(*bh)) @ T
    dofs = np.r_[6*a:6*a+6, 6*b:6*b+6]; keep = pos[dofs] >= 0
    w, V = np.linalg.eigh(kg[np.ix_(keep, keep)]); good = w > w.max()*1e-12
    Cd = V[:, good]*np.sqrt(w[good]); rows = pos[dofs][keep]
    Cs = sp.csc_matrix((Cd.ravel(order='F'), (np.tile(rows, good.sum()), np.repeat(np.arange(good.sum()), len(rows)))), shape=(int(free.sum()), int(good.sum())))
    return Cs

out = []
# 24x24x40 (~150k DOF) was attempted and killed by the 7 GB sandbox (OOM); not repeated.
for dims in [(8, 8, 10), (12, 12, 20), (16, 16, 30)]:
    beam = (0.45, 0.90)
    K, F, mem = assemble(*dims, beam=beam)
    r = dict(size='x'.join(map(str, dims)), free_dof=K.shape[0], nnz=int(K.nnz))
    if K.shape[0] <= 60000:
        t = time.perf_counter(); x1 = spla.splu(K, permc_spec='MMD_AT_PLUS_A').solve(F); r['superlu_factor_solve_s'] = round(time.perf_counter()-t, 3)
    t = time.perf_counter(); fac = cho_factor(K, order='metis'); r['cholmod_factor_s'] = round(time.perf_counter()-t, 3)
    t = time.perf_counter(); x2 = fac.solve(F); r['cholmod_solve_s'] = round(time.perf_counter()-t, 4)
    if 'superlu_factor_solve_s' in r: r['superlu_vs_cholmod_rel_diff'] = float(f'{np.linalg.norm(x1-x2)/np.linalg.norm(x2):.1e}')
    kill = [e for e, m in enumerate(mem) if m['kind'] == 'col' and m['lvl'] == 0 and m['plan'] == (dims[0]//2, 0)]
    K2, F2, _ = assemble(*dims, beam=beam, kill=set(kill))
    t = time.perf_counter(); fac.factorize(K2); x3 = fac.solve(F2); r['event_numeric_refactor_plus_solve_s'] = round(time.perf_counter()-t, 3)
    fac0 = cho_factor(K, order='metis'); C = member_C(dims, beam, kill[0])
    t = time.perf_counter(); fac0.downdate(C); x4 = fac0.solve(F2); r['event_rank_downdate_plus_solve_s'] = round(time.perf_counter()-t, 4)
    r['downdate_vs_refactor_rel_diff'] = float(f'{np.linalg.norm(x4-x3)/np.linalg.norm(x3):.1e}')
    r['max_vertical_disp_change_mm'] = round(float(np.abs(x3-x2)[2::6].max()*1000), 2)
    out.append(r); print(json.dumps(r), flush=True)
    json.dump(out, open('p2b_result.json', 'w'), indent=1)
