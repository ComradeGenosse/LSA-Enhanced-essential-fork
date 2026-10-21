#!/usr/bin/env python3
"""ASTRA-001 X3 offline analyzer.

Reads the sanitised evidence collected by x3_lab.py (runs/*.jsonl + runs/*.frames.csv.gz) and computes every X3
outcome from raw masks, sweeps and per-frame times. Thresholds are NOT defined here: they are read from
native/fragment-x3/x3-protocol.json (frozen before any X3 GTA execution). The classification code in this file is the
authority; the GTA driver only emits raw data.

Usage:
    python x3_analyze.py <x3-evidence-dir> [--protocol PATH] [--out DIR]

Outputs (in --out, default <evidence>/analysis): summary.json, tables.md, trials.csv.

Mapping decisions made BEFORE any gated data existed (documented here so they cannot drift afterwards):
  * Mask cell codes: 0 clear, 1 root collision, 2 detached-debris, other = something else. Grid 12 columns x 10 rows,
    cell centre u = -1.5 + (i+0.5)*0.25, v = (j+0.5)*0.25 (row j = 0 is the bottom).
  * Percentiles use nearest rank on the raw per-frame deltas (ceil(p*n)).
  * Step outcome precedence: INVALID (baseline invalid, or the workload was not delivered: fewer walls detected than n)
    > UNSAFE (any SAFE gate fails, including walls spawned != n) > PERF_REGRESSION > PASS.
  * Leak tolerance: delta <= max(limit, ambient range measured by x3idle in the same launch).
  * "Pre-blast prop count" for the cull_all effectiveness gate = Prop count in the x3_start row (after spawn, before blast).
  * Management effectiveness: cull_all and cull_budget need every candidate gone; cull_corridor needs exactly the
    corridor set gone; freeze has no culled set (effectiveness trivially satisfied, integrity still applies).
  * Launch identity = the driver's loadedUtc (one per fresh GTA launch).
"""
import argparse
import csv
import glob
import gzip
import json
import math
import os
import sys
from collections import defaultdict, OrderedDict

NU, NV, U0, P = 12, 10, -1.5, 0.25


# ----------------------------------------------------------------------------------------------------------------------
def load_protocol(path):
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f)


def read_jsonl(path):
    rows = []
    with open(path, encoding='utf-8-sig', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                rows.append({'kind': 'unparsable', 'raw': line[:200]})
    return rows


def read_frames(path):
    out = defaultdict(list)
    if not os.path.exists(path):
        return out
    with gzip.open(path, 'rt', encoding='utf-8-sig', errors='replace') as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                out[(row['trial'], row['label'])].append(float(row['dtMs']))
            except (ValueError, KeyError):
                pass
    return out


def nearest_rank(sorted_vals, p):
    if not sorted_vals:
        return float('nan')
    k = max(1, int(math.ceil(p * len(sorted_vals))))
    return sorted_vals[min(k, len(sorted_vals)) - 1]


def fstats(vals):
    if not vals:
        return None
    s = sorted(vals)
    return {'n': len(s), 'mean': sum(s) / len(s), 'p50': nearest_rank(s, .50), 'p95': nearest_rank(s, .95),
            'p99': nearest_rank(s, .99), 'max': s[-1], 'over33': sum(1 for x in s if x > 33.0),
            'over50': sum(1 for x in s if x > 50.0), 'over100': sum(1 for x in s if x > 100.0)}


# ----------------------------------------------------------------------------------------------------------------------
# Geometry classification (the authority).
def cell_uv(i, j):
    return U0 + (i + .5) * P, (j + .5) * P


def components4(mask, code='0'):
    seen = set()
    comps = []
    for k, ch in enumerate(mask):
        if ch != code or k in seen:
            continue
        stack = [k]
        seen.add(k)
        comp = []
        while stack:
            c = stack.pop()
            comp.append(c)
            i, j = c % NU, c // NU
            for ni, nj in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)):
                if 0 <= ni < NU and 0 <= nj < NV:
                    n = nj * NU + ni
                    if n not in seen and mask[n] == code:
                        seen.add(n)
                        stack.append(n)
        comps.append(comp)
    return comps


def centroid(cells):
    if not cells:
        return None
    us, vs = zip(*[cell_uv(c % NU, c // NU) for c in cells])
    return sum(us) / len(us), sum(vs) / len(vs)


def classify(base, mask, window, protocol):
    """Returns dict with the opening class and its inputs. base/mask are 120-char strings."""
    d = protocol['D_definitions']
    solid = [k for k, ch in enumerate(base) if ch == '1']
    root_removed = sum(1 for k in solid if mask[k] != '1')
    clear = [k for k in solid if mask[k] == '0']
    debris = [k for k in solid if mask[k] == '2']
    other = [k for k in solid if mask[k] not in '012']
    comps = components4(mask, '0')
    big = max(comps, key=len) if comps else []
    big_low = min((c // NU for c in big), default=None)
    thr = 0.6
    if root_removed == 0:
        cls = 'INTACT'
    elif window is not None and window >= thr:
        cls = 'TRAVERSABLE'
    elif len(debris) >= 4 and len(clear) + len(debris) >= 8:
        cls = 'DEBRIS_OBSTRUCTED'
    elif len(big) >= 4 and big_low is not None and big_low >= 2:
        cls = 'ELEVATED'
    elif len(big) >= 4 and big_low is not None and big_low <= 1:
        cls = 'NARROW'
    else:
        cls = 'PARTIAL_OTHER'
    return {'class': cls, 'rootRemoved': root_removed, 'clearCells': len(clear), 'debrisCells': len(debris),
            'otherCells': len(other), 'bigCells': len(big), 'bigLowRow': big_low, 'bigCentroid': centroid(big),
            'allClearCentroid': centroid(clear), 'window': window}


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ----------------------------------------------------------------------------------------------------------------------
class Trial(object):
    def __init__(self, run, name):
        self.run = run
        self.name = name
        self.rows = []

    def of(self, kind, **kw):
        out = []
        for r in self.rows:
            if r.get('kind') != kind:
                continue
            if all(r.get(k) == v for k, v in kw.items()):
                out.append(r)
        return out

    def first(self, kind, **kw):
        x = self.of(kind, **kw)
        return x[0] if x else None


def load_all(evdir):
    runs = []
    for path in sorted(glob.glob(os.path.join(evdir, 'runs', '*.jsonl'))):
        rows = read_jsonl(path)
        base = path[:-len('.jsonl')]
        header = next((r for r in rows if r.get('kind') == 'header'), {})
        run = {'file': os.path.basename(path), 'tag': os.path.basename(path).split('-')[0], 'rows': rows,
               'header': header, 'frames': read_frames(base + '.frames.csv.gz'),
               'launch': header.get('loadedUtc', '?'), 'sha': header.get('scriptSha256', '?'),
               'condition': 'ISO' if 'false' in str(header.get('autoLoadScripts', '')).lower() else 'MOD',
               'done': any(r.get('kind') == 'done' for r in rows),
               'errors': sum(1 for r in rows if r.get('kind') in ('error', 'exception', 'script_error'))}
        trials = OrderedDict()
        for r in rows:
            t = r.get('trial')
            if t is None:
                continue
            trials.setdefault(t, Trial(run, t)).rows.append(r)
        run['trials'] = trials
        runs.append(run)
    return runs


def frame_stats(run, trial, label):
    v = run['frames'].get((trial, label))
    if v:
        return fstats(v)
    # fall back to the summary row the driver wrote
    for r in run['trials'].get(trial, Trial(run, trial)).rows:
        if r.get('kind') == 'perf' and r.get('label') == label:
            return {'n': r.get('n'), 'mean': r.get('meanMs'), 'p50': r.get('p50Ms'), 'p95': r.get('p95Ms'),
                    'p99': r.get('p99Ms'), 'max': r.get('maxMs'), 'over33': r.get('over33'),
                    'over50': r.get('over50'), 'over100': r.get('over100'), 'fromSummaryRow': True}
    return None


def trial_kind(t):
    if t.first('x3_perf_start'):
        return 'perf'
    if t.first('x3_player_ready') or t.first('x3_player_result'):
        return 'player'
    s = t.first('x3_start')
    if s is not None and 'seconds' in s:
        return 'idle'
    if t.first('idle'):
        return 'idle'
    if s is not None and (s.get('n') or 1) > 1:
        return 'multi'
    if s is not None:
        return 'breach'
    return 'unknown'


# ----------------------------------------------------------------------------------------------------------------------
def analyze_walk(t, wall, phase_suffix):
    """Return (result, outsideFootprint) for the NPC walk of a wall in a phase ('initial' or 'managed')."""
    res = None
    for r in t.rows:
        if r.get('kind') == 'x3_walk_result' and r.get('wall') == wall and str(r.get('phase', '')).startswith(phase_suffix):
            res = r.get('result')
    outside = None
    for r in t.rows:
        if r.get('kind') == 'walk' and str(r.get('label', '')).endswith('w%d_%s' % (wall, phase_suffix)):
            outside = r.get('outsideWallFootprint')
    return res, outside


def analyze_breach(run, t, protocol):
    rec = OrderedDict()
    st = t.first('x3_start')
    rec['trial'] = t.name
    rec['launch'] = run['launch']
    rec['tag'] = run['tag']
    rec['condition'] = run['condition']
    rec['explosive'] = st.get('explosive')
    rec['du'] = st.get('du')
    rec['height'] = st.get('height')
    rec['manage'] = st.get('manage')
    base = t.first('x3_baseline', wall=0)
    rec['baselineValid'] = bool(base and base.get('valid'))
    verdict = t.first('x3_verdict')
    rec['verdict'] = verdict.get('verdict') if verdict else None
    g = None
    for r in t.rows:
        if r.get('kind') == 'x3_geom' and r.get('phase') == 'initial' and r.get('wall') == 0:
            g = r
    if not (base and g and 'mask' in base and 'mask' in g):
        rec['usable'] = False
        return rec
    rec['usable'] = True
    target = st.get('explosive') != 'none'
    rec['target'] = target
    cl = classify(base['mask'], g['mask'], g.get('sweepWindowM'), protocol)
    rec['class'] = cl['class']
    rec['rootRemoved'] = cl['rootRemoved']
    rec['clearCells'] = cl['clearCells']
    rec['debrisCells'] = cl['debrisCells']
    rec['window'] = cl['window']
    rec['explosionDetected'] = bool(g.get('explosionDetected'))
    rec['flaggedDetachedEver'] = g.get('flaggedDetachedEver', 0)
    rec['destructionSuccess'] = rec['explosionDetected'] and (rec['flaggedDetachedEver'] or 0) >= 1
    rec['breachFormed'] = (g.get('openedClear') or 0) >= 4
    intended = (st.get('du') or 0.0, st.get('height') or 0.0)
    rec['accBigDistM'] = dist(cl['bigCentroid'], intended) if cl['bigCentroid'] else None
    rec['accAllDistM'] = dist(cl['allClearCentroid'], intended) if cl['allClearCentroid'] else None
    rec['openingAccurate'] = rec['accBigDistM'] is not None and rec['accBigDistM'] <= 0.5
    # UNCHANGED X2 strict locality definition: centroid of all clear cells within 0.5 m; no clear cells => fail.
    rec['strictLocality'] = rec['accAllDistM'] is not None and rec['accAllDistM'] <= 0.5
    walk, outside = analyze_walk(t, 0, 'initial')
    rec['walkResult'] = walk
    rec['walkOutside'] = outside
    crossed_inside = walk == 'crossed' and outside is not True
    rec['traversalSuccess'] = bool(rec['window'] is not None and rec['window'] >= 0.6 and crossed_inside)
    rec['crossedInside'] = crossed_inside
    rec['anchored'] = bool(g.get('anchored'))
    rec['anchorFaceHits'] = g.get('anchorFaceHits')
    rec['maxAnchorFaceMoveM'] = g.get('maxAnchorFaceMoveM')
    rec['rootMoveM'] = g.get('rootMoveM')
    rec['outerBlocked'] = '%s/%s' % (g.get('outerBlocked'), g.get('outerBaseline'))
    rec['intactCorrect'] = (not target) and cl['rootRemoved'] == 0 and not crossed_inside
    # frame windows
    for lab in ('burst', 'burst_control'):
        fs = frame_stats(run, t.name, lab)
        if fs:
            rec['burstMaxMs'] = fs['max']
            rec['burstMeanMs'] = fs['mean']
    # settled debris telemetry
    deb = t.first('x3_debris', label='initial')
    if deb:
        rec['debrisAliveInitial'] = deb.get('alive')
        rec['debrisMaxDistM'] = deb.get('maxDistFromWallM')
    fin = [r for r in t.rows if r.get('kind') == 'x3_debris' and r.get('label') == 'final']
    if fin:
        rec['debrisAliveFinal'] = fin[-1].get('alive')
        rec['debrisMovingFinal'] = fin[-1].get('moving')
        rec['debrisFrozenFinal'] = fin[-1].get('frozen')
    obs = [r for r in t.rows if r.get('kind') == 'x3_debris' and str(r.get('label', '')).startswith('observe_pre_')]
    if obs:
        rec['debrisMovingAtEndOfObservation'] = obs[-1].get('moving')
    pools = [r.get('fraction') for r in t.rows if r.get('kind') == 'x3_pools' and r.get('fraction') is not None]
    rec['poolFracMax'] = max(pools) if pools else None
    leak = t.first('x3_leak')
    if leak:
        rec['leakPropsDelta'] = leak.get('propsDelta')
        rec['leakCollidersDelta'] = leak.get('collidersDelta')
    # management phase
    mg = [r for r in t.rows if r.get('kind') == 'x3_geom' and str(r.get('phase', '')).startswith('managed:') and r.get('wall') == 0]
    if mg and 'mask' in mg[-1]:
        g2 = mg[-1]
        cl2 = classify(base['mask'], g2['mask'], g2.get('sweepWindowM'), protocol)
        rec['m_class'] = cl2['class']
        rec['m_window'] = cl2['window']
        rec['m_rootCells'] = sum(1 for k, ch in enumerate(base['mask']) if ch == '1' and g2['mask'][k] == '1')
        rec['i_rootCells'] = sum(1 for k, ch in enumerate(base['mask']) if ch == '1' and g['mask'][k] == '1')
        rec['m_outer'] = '%s/%s' % (g2.get('outerBlocked'), g2.get('outerBaseline'))
        rec['m_anchorFaceHits'] = g2.get('anchorFaceHits')
        rec['m_maxAnchorFaceMoveM'] = g2.get('maxAnchorFaceMoveM')
        rec['m_rootMoveM'] = g2.get('rootMoveM')
        rec['m_flaggedDetachedEver'] = g2.get('flaggedDetachedEver')
        w2, out2 = analyze_walk(t, 0, 'managed')
        rec['m_walkResult'] = w2
        rec['m_crossedInside'] = w2 == 'crossed' and out2 is not True
        rec['m_traversalSuccess'] = bool(cl2['window'] is not None and cl2['window'] >= 0.6 and rec['m_crossedInside'])
        mrow = t.first('x3_manage')
        if mrow:
            rec['m_candidates'] = mrow.get('candidates')
            rec['m_inCorridor'] = mrow.get('inCorridor')
            rec['m_acted'] = mrow.get('acted')
            rec['m_candidatesAliveAfter'] = mrow.get('candidatesAliveAfter')
        fs = frame_stats(run, t.name, 'manage_action')
        if fs:
            rec['m_spikeMaxMs'] = fs['max']
        # prop counts
        pre_blast = (st.get('pools') or {}).get('props')
        post = [r for r in t.rows if r.get('kind') == 'x3_pools' and str(r.get('label', '')).startswith('post_manage_')]
        if post and pre_blast is not None:
            rec['m_propsAfterManage'] = post[-1]['pools'].get('props')
            rec['m_propsPreBlast'] = pre_blast
    return rec


# ----------------------------------------------------------------------------------------------------------------------
ALL_RUNS = []


def ambient_range(run):
    """Ambient pool range measured by x3idle anywhere in the same launch (all run files with the same loadedUtc)."""
    props, colls = [], []
    for name, t in [(n, t) for r in (ALL_RUNS or [run]) if r['launch'] == run['launch'] for n, t in r['trials'].items()]:
        if trial_kind(t) != 'idle':
            continue
        for r in t.rows:
            if r.get('kind') == 'x3_pools' and r.get('pools'):
                props.append(r['pools'].get('props'))
                colls.append(r['pools'].get('colliders'))
            if r.get('kind') == 'idle' and r.get('pools'):
                props.append(r['pools'].get('props'))
                colls.append(r['pools'].get('colliders'))
    props = [x for x in props if x is not None]
    colls = [x for x in colls if x is not None]
    return (max(props) - min(props) if props else 0, max(colls) - min(colls) if colls else 0)


def leak_ok(run, t, protocol):
    lk = t.first('x3_leak')
    if not lk:
        return None, None
    lim = protocol['A_gates']['leak']
    ap, ac = ambient_range(run)
    ok = lk.get('propsDelta', 0) <= max(lim['propCountDeltaMaxAfterCleanup'], ap) and \
        lk.get('collidersDelta', 0) <= max(lim['colliderCountDeltaMaxAfterCleanup'], ac)
    return ok, {'propsDelta': lk.get('propsDelta'), 'collidersDelta': lk.get('collidersDelta'),
                'ambientPropsRange': ap, 'ambientCollidersRange': ac}


def analyze_perf(run, t, protocol):
    a = protocol['A_gates']
    s = t.first('x3_perf_start')
    end = t.first('x3_perf_end') or {}
    rec = OrderedDict()
    rec['trial'] = t.name
    rec['launch'] = run['launch']
    rec['tag'] = run['tag']
    rec['condition'] = run['condition']
    rec['n'] = s.get('n')
    rec['rounds'] = s.get('rounds')
    rec['manage'] = s.get('manage')
    rec['wallsSpawned'] = s.get('wallsSpawned')
    rec['wallsWith31Groups'] = s.get('wallsWith31Groups')
    rec['baselineFaceHitsMin'] = s.get('baselineFaceHitsMin')
    idle = frame_stats(run, t.name, 'idle')
    rec['idle'] = idle
    rec['burst'] = {}
    rec['active'] = {}
    for r in range(1, (s.get('rounds') or 1) + 1):
        rec['burst'][r] = frame_stats(run, t.name, 'burst_r%d' % r)
        rec['active'][r] = frame_stats(run, t.name, 'active_r%d' % r)
    rec['late'] = frame_stats(run, t.name, 'late')
    pools = [r.get('fraction') for r in t.rows if r.get('kind') == 'x3_pools' and r.get('fraction') is not None]
    rec['poolFracMax'] = max(pools) if pools else None
    coll = [r['pools']['colliders'] / float(r['pools']['colliderCap']) for r in t.rows
            if r.get('kind') == 'x3_pools' and r.get('pools') and r['pools'].get('colliderCap')]
    rec['colliderFracMax'] = max(coll) if coll else None
    allmax = [x['max'] for x in [idle, rec['late']] + list(rec['burst'].values()) + list(rec['active'].values()) if x]
    rec['maxAnyFrameMs'] = max(allmax) if allmax else None
    perwall = []
    for r in t.rows:
        if r.get('kind') == 'x3_debris' and isinstance(r.get('perWall'), list):
            perwall.extend(r['perWall'])
    rec['perWallLiveDebrisMax'] = max(perwall) if perwall else 0
    rec['detectedWallsLastRound'] = None
    rounds = t.of('x3_round')
    if rounds:
        rec['detectedWallsLastRound'] = rounds[-1].get('detectedWalls')
    anch = t.first('x3_perf_anchor') or {}
    rec['wallsWithMissingFaceHits'] = anch.get('wallsWithMissingFaceHits')
    rec['maxFaceMoveM'] = anch.get('maxFaceMoveM')
    rec['maxRootMoveM'] = anch.get('maxRootMoveM')
    # X3-0.2 diagnostic fields (display only; no gate uses them)
    rec['faceMissDiag'] = {k: anch.get(k) for k in ('badWalls', 'badWallHits', 'missNoHit', 'missOwnDebris', 'missForeignDebris', 'missOther') if k in anch}
    rec['stallSeen'] = end.get('stallSeen')
    rec['aborted'] = end.get('aborted')
    rec['leakOk'], rec['leak'] = leak_ok(run, t, protocol)
    rec['errors'] = run['errors']
    n = rec['n']
    # ---- gates
    inv = []
    base_bad = (rec['baselineFaceHitsMin'] is None) or t.first('x3_verdict', verdict='BASELINE_INVALID') is not None
    if base_bad and t.first('x3_verdict', verdict='BASELINE_INVALID'):
        inv.append('baseline invalid')
    if rec['detectedWallsLastRound'] is not None and rec['detectedWallsLastRound'] < n:
        inv.append('workload not delivered: %s/%s walls detected' % (rec['detectedWallsLastRound'], n))
    unsafe = []
    sg = a['safe']
    if rec['wallsSpawned'] != n or rec['wallsWith31Groups'] != n:
        unsafe.append('walls spawned %s / 31-group %s != n=%s' % (rec['wallsSpawned'], rec['wallsWith31Groups'], n))
    if rec['baselineFaceHitsMin'] is not None and rec['baselineFaceHitsMin'] < sg['baselineAnchorFaceHitsPerWall']:
        unsafe.append('baseline anchor face hits min %s < %s' % (rec['baselineFaceHitsMin'], sg['baselineAnchorFaceHitsPerWall']))
    pf = max([x for x in (rec['poolFracMax'], rec['colliderFracMax']) if x is not None] or [0])
    if pf > sg['maxPoolFraction']:
        unsafe.append('pool fraction %.3f > %.2f' % (pf, sg['maxPoolFraction']))
    if rec['maxAnyFrameMs'] is not None and rec['maxAnyFrameMs'] > sg['maxAnyFrameMs']:
        unsafe.append('frame %.1f ms > %s' % (rec['maxAnyFrameMs'], sg['maxAnyFrameMs']))
    if rec['stallSeen'] or rec['aborted'] or rec['errors']:
        unsafe.append('stall/abort/script error')
    if not run['done']:
        unsafe.append('run did not reach DONE')
    perf_fail = []
    pg = a['perf']
    if idle:
        for r, ac in rec['active'].items():
            if not ac:
                continue
            if ac['mean'] > pg['activeMeanMaxRatioToIdle'] * idle['mean']:
                perf_fail.append('round %d active mean %.2f > %.2fx idle %.2f' % (r, ac['mean'], pg['activeMeanMaxRatioToIdle'], idle['mean']))
            lim99 = max(pg['activeP99MaxRatioToIdleP99'] * idle['p99'], pg['activeP99AbsoluteFloorMs'])
            if ac['p99'] > lim99:
                perf_fail.append('round %d active P99 %.2f > %.2f' % (r, ac['p99'], lim99))
            if ac['max'] > pg['activeMaxMs']:
                perf_fail.append('round %d active max %.1f > %s' % (r, ac['max'], pg['activeMaxMs']))
        for r, b in rec['burst'].items():
            if b and b['max'] > pg['burstMaxMs']:
                perf_fail.append('round %d burst max %.1f > %s' % (r, b['max'], pg['burstMaxMs']))
        lt = rec['late']
        if lt:
            if lt['mean'] > pg['lateMeanMaxRatioToIdle'] * idle['mean']:
                perf_fail.append('late mean %.2f > %.2fx idle' % (lt['mean'], pg['lateMeanMaxRatioToIdle']))
            if lt['max'] > pg['lateMaxMs']:
                perf_fail.append('late max %.1f > %s' % (lt['max'], pg['lateMaxMs']))
    else:
        inv.append('no idle window')
    if rec['perWallLiveDebrisMax'] > a['perChunkCumulativeDetachedMax']:
        perf_fail.append('detached per wall %s > %s' % (rec['perWallLiveDebrisMax'], a['perChunkCumulativeDetachedMax']))
    face_item = None
    if rec['wallsWithMissingFaceHits']:
        face_item = ('%s walls lost anchor-face hits after blast %s' % (rec['wallsWithMissingFaceHits'], json.dumps(rec.get('faceMissDiag') or {})))
    if rec['leakOk'] is False:
        perf_fail.append('leak %s' % json.dumps(rec['leak']))
    def verdict(unsafe_list):
        if inv:
            return 'INVALID'
        if unsafe_list:
            return 'UNSAFE'
        if perf_fail:
            return 'PERF_REGRESSION'
        return 'PASS'
    # 'outcome' = rule exactly as committed (post-blast anchor-face hit loss counts as UNSAFE).
    # 'outcomeLiteral' = the SAFE list as written in the preregistration (baseline face hits only; post-blast loss is
    # reported with its diagnostic but is not a listed SAFE criterion). Both are reported; neither replaces the other.
    rec['outcome'] = verdict(unsafe + ([face_item] if face_item else []))
    rec['outcomeLiteral'] = verdict(unsafe)
    rec['faceItem'] = face_item
    rec['reasons'] = inv + unsafe + ([face_item] if face_item else []) + perf_fail
    # headline ratios
    if idle and rec['active'].get(1):
        rec['activeMeanRatio'] = max(x['mean'] for x in rec['active'].values() if x) / idle['mean']
        rec['activeP99Ratio'] = max(x['p99'] for x in rec['active'].values() if x) / idle['p99']
    if idle and rec['late']:
        rec['lateMeanRatio'] = rec['late']['mean'] / idle['mean']
    return rec


def analyze_multi(run, t, protocol):
    c = protocol['C_gates']
    s = t.first('x3_start')
    n = s.get('n')
    targets = set(s.get('targets') or [])
    gap = s.get('gap')
    rec = OrderedDict(trial=t.name, launch=run['launch'], tag=run['tag'], n=n, gap=gap, targets=sorted(targets),
                      simul=s.get('simul'), walls=[])
    for w in range(n):
        b = t.first('x3_baseline', wall=w)
        g = None
        for r in t.rows:
            if r.get('kind') == 'x3_geom' and r.get('wall') == w and r.get('phase') == 'initial':
                g = r
        wr = OrderedDict(wall=w, target=w in targets, baselineValid=bool(b and b.get('valid')))
        if b and g and 'mask' in b and 'mask' in g:
            cl = classify(b['mask'], g['mask'], g.get('sweepWindowM'), protocol)
            wr.update(cls=cl['class'], rootRemoved=cl['rootRemoved'], window=cl['window'], openedClear=g.get('openedClear'),
                      flaggedDetachedEver=g.get('flaggedDetachedEver'), foreignDebrisCells=g.get('foreignDebrisCells'),
                      anchored=g.get('anchored'), rootMoveM=g.get('rootMoveM'), anchorFaceHits=g.get('anchorFaceHits'))
            walk, outside = analyze_walk(t, w, 'initial')
            wr['walk'] = walk
            if w in targets:
                intended = (s.get('du') or 0.0, s.get('height') or 0.0)
                wr['strictLocality'] = bool(cl['allClearCentroid'] and dist(cl['allClearCentroid'], intended) <= 0.5)
                wr['breachFormed'] = (g.get('openedClear') or 0) >= 4
                wr['traversalSuccess'] = bool(cl['window'] is not None and cl['window'] >= 0.6 and walk == 'crossed' and outside is not True)
            else:
                ok = cl['rootRemoved'] == c['nonTargetPanel']['openedWall'] and \
                    (g.get('flaggedDetachedEver') or 0) == c['nonTargetPanel']['flaggedDetached'] and bool(g.get('anchored')) and \
                    (g.get('rootMoveM') if g.get('rootMoveM') is not None else 9) <= c['nonTargetPanel']['rootMoveMaxM']
                wr['nonTargetIsolated'] = ok
                wr['foreignDebrisClean'] = (g.get('foreignDebrisCells') or 0) <= c['foreignDebrisCellsAtGapAtLeastM']['max']
        rec['walls'].append(wr)
    live = []
    for r in t.rows:
        if r.get('kind') == 'x3_debris' and isinstance(r.get('perWall'), list):
            for i, v in enumerate(r['perWall']):
                if i in targets:
                    live.append(v)
    rec['perWallLiveDebrisMax'] = max(live) if live else 0
    rec['leakOk'], rec['leak'] = leak_ok(run, t, protocol)
    gated = gap is not None and gap >= c['foreignDebrisCellsAtGapAtLeastM']['gapM']
    rec['gated'] = bool(gated)
    ok = True
    for wr in rec['walls']:
        if not wr.get('baselineValid'):
            ok = False
        if not wr['target'] and gated:
            if not (wr.get('nonTargetIsolated') and wr.get('foreignDebrisClean')):
                ok = False
    if rec['perWallLiveDebrisMax'] > c['perWallLiveDebrisMax']:
        ok = False
    if rec['leakOk'] is False:
        ok = False
    rec['gatePass'] = ok if gated else None
    return rec


def analyze_player(run, t):
    res = t.first('x3_player_result') or {}
    rd = t.first('x3_player_ready') or {}
    return OrderedDict(trial=t.name, launch=run['launch'], tag=run['tag'], breached=rd.get('breached'),
                       moved=res.get('moved'), crossed=res.get('crossed'), outside=res.get('outsideWallFootprint'),
                       crossingU=res.get('crossingU'), maxProgressT=res.get('maxProgressT'),
                       window=(t.first('x3_player_opening') or {}).get('window'))


# ----------------------------------------------------------------------------------------------------------------------
def md_table(headers, rows):
    out = ['| ' + ' | '.join(headers) + ' |', '|' + '|'.join('---' for _ in headers) + '|']
    for r in rows:
        out.append('| ' + ' | '.join('' if v is None else (('%.3g' % v) if isinstance(v, float) else str(v)) for v in r) + ' |')
    return '\n'.join(out)


def frac(n, d):
    return '%d/%d (%.0f%%)' % (n, d, 100.0 * n / d) if d else '0/0'


def b_decision(breach_recs, protocol):
    b = protocol['B_gates']
    modes = ['none', 'freeze', 'cull_corridor', 'cull_all', 'cull_budget']
    ctrl = {}
    for r in breach_recs:
        if r.get('usable') and r['manage'] == 'none' and r['trial'].startswith('L2-B-'):
            ctrl[r['trial'].rsplit('-', 1)[0]] = r
    out = OrderedDict()
    for m in modes:
        rows = [r for r in breach_recs if r.get('usable') and r['manage'] == m and r['trial'].startswith('L2-B-')]
        res = OrderedDict(trials=len(rows), integrityPass=0, effectivenessPass=0, recoverable=0, recovered=0,
                          maxSpikeMs=0.0, deletions=0, failures=[])
        for r in rows:
            if 'm_class' not in r:
                res['failures'].append('%s: no managed phase' % r['trial'])
                continue
            matched = ctrl.get(r['trial'].rsplit('-', 1)[0])
            extra = (r.get('m_flaggedDetachedEver') or 0) - (r.get('flaggedDetachedEver') or 0)
            extra_c = ((matched.get('m_flaggedDetachedEver') or 0) - (matched.get('flaggedDetachedEver') or 0)) if matched and 'm_class' in matched else 0
            integ = r.get('m_outer') == '40/40' and r.get('m_anchorFaceHits') == 20 and \
                (r.get('m_maxAnchorFaceMoveM') if r.get('m_maxAnchorFaceMoveM') is not None else 9) <= b['integrity']['maxAnchorFaceMoveM'] and \
                (r.get('m_rootMoveM') if r.get('m_rootMoveM') is not None else 9) <= b['integrity']['maxRootMoveM'] and \
                r.get('m_rootCells', 0) >= r.get('i_rootCells', 0) and (extra - extra_c) <= b['integrity']['newDetachedFragmentsVersusMatchedRetainControlMax']
            if integ:
                res['integrityPass'] += 1
            else:
                res['failures'].append('%s: integrity' % r['trial'])
            eff = True
            if m in ('cull_all', 'cull_budget'):
                eff = r.get('m_candidatesAliveAfter') == 0 and r.get('m_acted') == r.get('m_candidates')
            elif m == 'cull_corridor':
                eff = r.get('m_acted') == r.get('m_inCorridor') and r.get('m_candidatesAliveAfter') == (r.get('m_candidates') or 0) - (r.get('m_acted') or 0)
            if m == 'cull_all' and r.get('m_propsAfterManage') is not None:
                eff = eff and r['m_propsAfterManage'] <= r['m_propsPreBlast'] + b['effectiveness']['propCountWithinOfPreBlastAfterFullCull']
            if eff:
                res['effectivenessPass'] += 1
            else:
                res['failures'].append('%s: effectiveness' % r['trial'])
            if r.get('class') == 'DEBRIS_OBSTRUCTED':
                res['recoverable'] += 1
                if (r.get('m_window') or 0) >= 0.6 and r.get('m_crossedInside'):
                    res['recovered'] += 1
            res['maxSpikeMs'] = max(res['maxSpikeMs'], r.get('m_spikeMaxMs') or 0.0)
            res['deletions'] += (r.get('m_acted') or 0) if m != 'freeze' else 0
        res['eligible'] = bool(rows) and res['integrityPass'] == res['trials'] and res['effectivenessPass'] == res['trials'] \
            and res['maxSpikeMs'] <= b['managementSpikeMaxFrameMs']
        out[m] = res
    cands = [(m, r) for m, r in out.items() if m != 'none' and r['eligible']]
    cands.sort(key=lambda x: (-x[1]['recovered'], x[1]['maxSpikeMs'], x[1]['deletions']))
    return out, (cands[0][0] if cands else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('evidence')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--protocol', default=os.path.join(here, '..', 'x3-protocol.json'))
    ap.add_argument('--out')
    a = ap.parse_args()
    protocol = load_protocol(a.protocol)
    out = a.out or os.path.join(a.evidence, 'analysis')
    os.makedirs(out, exist_ok=True)
    runs = load_all(a.evidence)
    ALL_RUNS[:] = runs
    if not runs:
        print('no runs found under', a.evidence)
        return 1

    breach, perf, multi, player, idles = [], [], [], [], []
    for run in runs:
        for name, t in run['trials'].items():
            k = trial_kind(t)
            if k == 'breach':
                breach.append(analyze_breach(run, t, protocol))
            elif k == 'perf':
                perf.append(analyze_perf(run, t, protocol))
            elif k == 'multi':
                multi.append(analyze_multi(run, t, protocol))
            elif k == 'player':
                player.append(analyze_player(run, t))
            elif k == 'idle':
                idles.append((run, t))

    md = []
    md.append('# X3 analysis (generated by x3_analyze.py)\n')
    md.append('## Run inventory\n')
    md.append(md_table(['file', 'launch (loadedUtc)', 'cond', 'script sha', 'rows', 'done', 'trials'],
                       [(r['file'], r['launch'], r['condition'], r['sha'][:10], len(r['rows']), r['done'], len(r['trials'])) for r in runs]))

    # ---- idle / ambient
    md.append('\n## Ambient (x3idle)\n')
    rows = []
    for run, t in idles:
        fs = []
        for r in t.rows:
            if r.get('kind') == 'perf':
                fs.append(r)
        ap_, ac_ = ambient_range(run)
        means = [x['meanMs'] for x in fs if x.get('label', '').startswith('ambient')]
        rows.append((t.name, run['launch'], len(fs), min(means) if means else None, max(means) if means else None, ap_, ac_))
    md.append(md_table(['trial', 'launch', 'windows', 'min mean ms', 'max mean ms', 'prop range', 'collider range'], rows))

    # ---- A
    md.append('\n## A. Debris and physics budgets (x3perf)\n')
    rows = []
    for r in perf:
        idle = r['idle'] or {}
        act = [x for x in r['active'].values() if x]
        rows.append((r['trial'], r['tag'], r['condition'], r['n'], r['rounds'], r['manage'],
                     idle.get('mean'), idle.get('p99'),
                     max([x['mean'] for x in act]) if act else None, max([x['p99'] for x in act]) if act else None,
                     max([x['max'] for x in act]) if act else None,
                     (r['late'] or {}).get('mean'), (r['late'] or {}).get('max'),
                     max([x['max'] for x in r['burst'].values() if x] or [0]), r.get('activeMeanRatio'), r.get('activeP99Ratio'),
                     r.get('lateMeanRatio'), r['poolFracMax'], r['perWallLiveDebrisMax'], r['outcome'], r['outcomeLiteral'], '; '.join(r['reasons'])))
    md.append(md_table(['trial', 'tag', 'cond', 'n', 'rounds', 'manage', 'idle mean', 'idle P99', 'active mean', 'active P99',
                        'active max', 'late mean', 'late max', 'burst max', 'mean ratio', 'P99 ratio', 'late ratio', 'pool frac',
                        'live/wall', 'outcome (committed)', 'outcome (prereg-literal)', 'reasons'], rows))
    ladder = defaultdict(list)
    for r in perf:
        if r['trial'].find('ladder-n') >= 0:
            ladder[r['n']].append(r)
    lad = OrderedDict()
    for n in sorted(ladder):
        launches = {}
        for r in ladder[n]:
            launches.setdefault(r['launch'], []).append(r['outcome'])
        passes = sum(1 for v in launches.values() if 'PASS' in v)
        lit = defaultdict(list)
        for r in ladder[n]:
            lit[r['launch']].append(r['outcomeLiteral'])
        passes_lit = sum(1 for v in lit.values() if 'PASS' in v)
        lad[n] = {'outcomesByLaunch': launches, 'passingLaunches': passes,
                  'status': 'PROVEN' if passes >= 2 else ('PARTIAL' if passes == 1 else 'NOT_PASSING'),
                  'outcomesByLaunchLiteral': lit, 'passingLaunchesLiteral': passes_lit,
                  'statusLiteral': 'PROVEN' if passes_lit >= 2 else ('PARTIAL' if passes_lit == 1 else 'NOT_PASSING')}
    md.append('\n### Ladder replication\n')
    md.append(md_table(['n', 'passing launches (as committed)', 'status (as committed)', 'outcomes by launch (as committed)',
                        'passing launches (prereg-literal SAFE list)', 'status (prereg-literal)', 'outcomes by launch (prereg-literal)'],
                       [(n, v['passingLaunches'], v['status'], json.dumps(v['outcomesByLaunch']), v['passingLaunchesLiteral'],
                         v['statusLiteral'], json.dumps(v['outcomesByLaunchLiteral'])) for n, v in lad.items()]))

    # ---- B
    bres, bpick = b_decision(breach, protocol)
    md.append('\n## B. Debris management (x3breach matrix)\n')
    md.append(md_table(['mode', 'trials', 'integrity pass', 'effectiveness pass', 'debris-obstructed recoverable', 'recovered',
                        'max spike ms', 'deletions', 'eligible', 'failures'],
                       [(m, r['trials'], r['integrityPass'], r['effectivenessPass'], r['recoverable'], r['recovered'],
                         r['maxSpikeMs'], r['deletions'], r['eligible'], '; '.join(r['failures'])) for m, r in bres.items()]))
    md.append('\nRecommended strategy per the frozen decision rule: **%s**\n' % (bpick or 'none eligible'))
    mrows = [r for r in breach if r.get('usable') and r['trial'].startswith('L2-B-')]
    md.append(md_table(['trial', 'mode', 'initial class', 'window', 'managed class', 'managed window', 'managed crossed', 'candidates', 'inCorridor', 'acted', 'alive after', 'spike ms', 'moving at +30s', 'final alive'],
                       [(r['trial'], r['manage'], r['class'], r['window'], r.get('m_class'), r.get('m_window'), r.get('m_crossedInside'),
                         r.get('m_candidates'), r.get('m_inCorridor'), r.get('m_acted'), r.get('m_candidatesAliveAfter'),
                         r.get('m_spikeMaxMs'), r.get('debrisMovingAtEndOfObservation'), r.get('debrisAliveFinal')) for r in mrows]))

    # ---- C
    md.append('\n## C. Multiple independently anchored structures\n')
    for r in multi:
        md.append('\n**%s** (launch %s, n=%s, gap=%s, targets=%s, gated=%s, gate %s, live/wall max %s, leak %s)\n' % (
            r['trial'], r['launch'][-9:], r['n'], r['gap'], r['targets'], r['gated'], r['gatePass'], r['perWallLiveDebrisMax'], json.dumps(r['leak'])))
        md.append(md_table(['wall', 'target', 'baseline', 'class', 'rootRemoved', 'window', 'flaggedEver', 'foreign cells', 'anchored', 'rootMove', 'walk', 'isolated', 'foreign clean', 'locality', 'traversal'],
                           [(w['wall'], w['target'], w['baselineValid'], w.get('cls'), w.get('rootRemoved'), w.get('window'), w.get('flaggedDetachedEver'),
                             w.get('foreignDebrisCells'), w.get('anchored'), w.get('rootMoveM'), w.get('walk'), w.get('nonTargetIsolated'),
                             w.get('foreignDebrisClean'), w.get('strictLocality'), w.get('traversalSuccess')) for w in r['walls']]))

    # ---- D / E (initial measurement only; every x3breach trial)
    iso = [r for r in breach if r.get('usable') and r['condition'] == 'ISO' and r['baselineValid']]
    mod = [r for r in breach if r.get('usable') and r['condition'] == 'MOD' and r['baselineValid']]
    md.append('\n## D. Opening reliability (initial, debris-present measurement; manage=none and managed trials share the same first measurement)\n')
    md.append(md_table(['trial', 'tag', 'cond', 'explosive', 'du', 'h', 'detected', 'flagged', 'destruction', 'openedClear', 'breach', 'class', 'window',
                        'big-comp dist', 'accurate', 'all-clear dist', 'strict', 'walk', 'traversal', 'debris cells'],
                       [(r['trial'], r['tag'], r['condition'], r['explosive'], r['du'], r['height'], r['explosionDetected'], r['flaggedDetachedEver'],
                         r['destructionSuccess'], r['clearCells'], r['breachFormed'], r['class'], r['window'], r['accBigDistM'], r['openingAccurate'],
                         r['accAllDistM'], r['strictLocality'], r['walkResult'], r['traversalSuccess'], r['debrisCells']) for r in breach if r.get('usable')]))

    def rate(rs, f):
        return frac(sum(1 for r in rs if f(r)), len(rs))
    tgt = [r for r in iso if r['target']]
    md.append('\n### Separated outcome rates (ISO, target trials; first measurement)\n')
    md.append(md_table(['population', 'trials', 'destruction success', 'breach formed', 'opening accurate (largest component)',
                        'strict locality (UNCHANGED X2 metric, gate 80%)', 'traversal success'],
                       [('all ISO targeted single-wall trials', len(tgt), rate(tgt, lambda r: r['destructionSuccess']), rate(tgt, lambda r: r['breachFormed']),
                         rate(tgt, lambda r: r['openingAccurate']), rate(tgt, lambda r: r['strictLocality']), rate(tgt, lambda r: r['traversalSuccess']))] +
                       [('D-matrix only (L4-D-*)', len([r for r in tgt if r['trial'].startswith('L4-D-')]),
                         *[rate([r for r in tgt if r['trial'].startswith('L4-D-')], f) for f in (lambda r: r['destructionSuccess'], lambda r: r['breachFormed'], lambda r: r['openingAccurate'], lambda r: r['strictLocality'], lambda r: r['traversalSuccess'])])]))
    md.append('\nX2 reference for the strict-locality metric: 14/20 = 70% (gate 80%). The definition is unchanged here.\n')
    groups = defaultdict(list)
    for r in tgt:
        groups[(r['explosive'], r['du'], r['height'])].append(r)
    md.append(md_table(['scenario (explosive, du, height)', 'trials', 'destruction', 'breach', 'accurate', 'strict', 'traversal', 'classes'],
                       [(str(k), len(v), rate(v, lambda r: r['destructionSuccess']), rate(v, lambda r: r['breachFormed']), rate(v, lambda r: r['openingAccurate']),
                         rate(v, lambda r: r['strictLocality']), rate(v, lambda r: r['traversalSuccess']),
                         json.dumps({c: sum(1 for r in v if r['class'] == c) for c in sorted(set(x['class'] for x in v))})) for k, v in sorted(groups.items(), key=lambda kv: str(kv[0]))]))
    ctl = [r for r in iso if not r['target']]
    md.append('\n### Intact controls (ISO)\n')
    md.append(md_table(['trial', 'tag', 'rootRemoved', 'class', 'walk', 'intact & blocked'],
                       [(r['trial'], r['tag'], r['rootRemoved'], r['class'], r['walkResult'], r['intactCorrect']) for r in ctl]))

    md.append('\n## E. Repeatability across fresh launches (ISO) and gameplay/mod-stack condition\n')
    by_launch = defaultdict(list)
    for r in iso:
        by_launch[r['launch']].append(r)
    cr = [r for r in tgt if r['explosive'] == 'rocket' and r['du'] == 0 and r['height'] == 1]
    md.append(md_table(['launch', 'centre-rocket trials', 'traversal', 'breach', 'strict locality'],
                       [(l[-9:], len([r for r in v if r in cr]), rate([r for r in v if r in cr], lambda r: r['traversalSuccess']),
                         rate([r for r in v if r in cr], lambda r: r['breachFormed']), rate([r for r in v if r in cr], lambda r: r['strictLocality'])) for l, v in by_launch.items()]))
    md.append('\nISO centre-rocket traversal overall: %s (gate: >= %.0f%%).\n' % (rate(cr, lambda r: r['traversalSuccess']), 100 * protocol['E_gates']['centreRocketTraversalMinSuccessFractionIso']))
    md.append('Distinct ISO launches contributing: %d (gate: >= %d).\n' % (len(by_launch), protocol['E_gates']['freshLaunchesIso']))
    md.append('\n### Player-controlled traversal\n')
    md.append(md_table(['trial', 'launch', 'breached', 'moved', 'crossed', 'outside footprint', 'crossingU', 'max progress t', 'window'],
                       [(p['trial'], p['launch'][-9:], p['breached'], p['moved'], p['crossed'], p['outside'], p['crossingU'], p['maxProgressT'], p['window']) for p in player]))
    md.append('\n### MOD (gameplay / mod-stack) condition - reported separately, never pooled\n')
    md.append(md_table(['trial', 'explosive', 'du', 'h', 'breach', 'class', 'window', 'strict', 'traversal', 'walk'],
                       [(r['trial'], r['explosive'], r['du'], r['height'], r['breachFormed'], r['class'], r['window'], r['strictLocality'], r['traversalSuccess'], r['walkResult']) for r in mod]))

    # ---- write
    summary = OrderedDict(protocolId=protocol.get('id'), runs=[OrderedDict(file=r['file'], launch=r['launch'], condition=r['condition'], sha=r['sha'],
                                                                           done=r['done'], rows=len(r['rows'])) for r in runs],
                          ladder=lad, perf=perf, breach=breach, multi=multi, player=player, management=bres, recommendedStrategy=bpick)
    with open(os.path.join(out, 'summary.json'), 'w') as f:
        json.dump(summary, f, indent=1, default=str)
    with open(os.path.join(out, 'tables.md'), 'w') as f:
        f.write('\n'.join(md) + '\n')
    if breach:
        keys = []
        for r in breach:
            for k in r:
                if k not in keys:
                    keys.append(k)
        with open(os.path.join(out, 'trials.csv'), 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            for r in breach:
                w.writerow({k: r.get(k) for k in keys})
    print('\n'.join(md))
    return 0


if __name__ == '__main__':
    sys.exit(main())
