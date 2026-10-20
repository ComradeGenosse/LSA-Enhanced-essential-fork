#!/usr/bin/env python3
"""Offline E0.4 passive-shot correlation. Reads WPS-LAB E0.4 JSONL (player mode) and reports how reported impact coordinates relate to the
gameplay camera ray, which weapon fired, and how many DISTINCT impact reports exist. An impact coordinate is not a trajectory: this report never
claims a round count or a complete bullet path.

  e04_correlate.py run-E0_4.jsonl [--json]
  e04_correlate.py --self-test
"""
import argparse, collections, json, math, sys

def rows(path):
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if line.startswith('[WPS-LAB] '): line = line[10:]
            try: r = json.loads(line)
            except ValueError: continue
            if isinstance(r, dict) and 'kind' in r: yield r

def direction(pitch, heading):
    p, h = math.radians(pitch), math.radians(heading)
    return (-math.sin(h) * math.cos(p), math.cos(h) * math.cos(p), math.sin(p))

def off_axis(cam, d, imp):
    v = [imp[i] - cam[i] for i in range(3)]
    vl = math.sqrt(sum(x * x for x in v)); dl = math.sqrt(sum(x * x for x in d))
    if vl < 1e-9 or dl < 1e-9: return float('nan')
    c = sum(v[i] * d[i] for i in range(3)) / (vl * dl)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))

def classify(a):
    return 'UNDEFINED' if a != a else 'ON_CAMERA_RAY' if a <= 3 else 'NEAR_CAMERA_RAY' if a <= 10 else 'OFF_CAMERA_RAY'

def summarize(paths):
    # Group by file and recorded run identifier so latches, firing transitions and
    # cumulative ammo counters never leak across independent capture sessions.
    grouped = collections.OrderedDict()
    for p in paths:
        for r in rows(p):
            if r['kind'] != 'shot_sample': continue
            grouped.setdefault((p, str(r.get('run', '__unknown__'))), []).append(r['details'])
    sample_count = fire_frames = fire_rises = impact_frames = distinct = ammo = cam_ok = uncorrelated = 0
    cls = collections.Counter(); weapons = collections.Counter()
    for samples in grouped.values():
        prev_fire = False; last = None; run_ammo = 0
        for d in samples:
            sample_count += 1
            active = bool(d.get('fire'))
            if active:
                fire_frames += 1
                if not prev_fire: fire_rises += 1
            prev_fire = active
            run_ammo = max(run_ammo, d.get('ammoSpent') or 0)
            if not (d.get('impactValid') and d.get('impact')): continue
            impact_frames += 1
            pt = (d['impact']['x'], d['impact']['y'], d['impact']['z'])
            new = last is None or any(abs(pt[i] - last[i]) > 1e-3 for i in range(3))
            last = pt
            if not new: continue
            distinct += 1
            weapons[str(d.get('weaponHash'))] += 1
            cam = d.get('cam') or {}
            if cam.get('ok'):
                cam_ok += 1
                a = off_axis((cam['pos']['x'], cam['pos']['y'], cam['pos']['z']),
                             direction(cam['rot']['x'], cam['rot']['z']), pt)
                cls[classify(a)] += 1
            else:
                uncorrelated += 1
        ammo += run_ammo
    return {'runs': len(grouped), 'shotSamples': sample_count,
        'fireActiveFrames': fire_frames, 'fireEdgeSamples': fire_rises,
        'impactReportFrames': impact_frames, 'distinctImpactRunsLowerBound': distinct,
        'ammoSpentReported': ammo, 'camerasOk': cam_ok,
        'distinctImpactsWithoutCamera': uncorrelated, 'cameraRayClassOfDistinctImpacts': dict(cls),
        'weaponHashesAtImpact': dict(weapons),
        'caveat': 'Fire edges are observed rising transitions, not round counts; sampled frames can omit edges. Distinct impacts are a lower bound; latches, pellets, spread and penetration are invisible. Not a trajectory.'}

def self_test():
    import os, tempfile
    def s(i, fire, impact, cam=True, ammo=1, weapon=111):
        d = {'sampleIndex': i, 'fire': fire, 'impactValid': impact is not None, 'impact': impact, 'ammoSpent': ammo, 'weaponHash': weapon}
        d['cam'] = {'ok': True, 'pos': {'x': 0, 'y': 0, 'z': 0}, 'rot': {'x': 0, 'y': 0, 'z': 0}} if cam else None
        return {'kind': 'shot_sample', 't_real_ms': i, 'details': d}
    data = [s(1, True, {'x': 0, 'y': 20, 'z': 0}), s(2, False, {'x': 0, 'y': 20, 'z': 0}), s(3, True, {'x': 0, 'y': 20, 'z': 0}),
            s(4, True, {'x': 20, 'y': 20, 'z': 0}, ammo=4), s(5, False, None), s(6, True, {'x': 5, 'y': 5, 'z': 5}, cam=False, ammo=6)]
    second = s(7, True, {'x': 0, 'y': 20, 'z': 0}, ammo=2)
    second['run'] = 'independent-capture'
    data.append(second)
    with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False, encoding='utf-8-sig') as f:
        for r in data: f.write('[WPS-LAB] ' + json.dumps(r) + '\n')
        f.write('noise\n'); path = f.name
    try: o = summarize([path])
    finally: os.unlink(path)
    assert o['runs'] == 2 and o['shotSamples'] == 7 and o['fireActiveFrames'] == 5
    assert o['fireEdgeSamples'] == 4 and o['impactReportFrames'] == 6
    assert o['distinctImpactRunsLowerBound'] == 4 and o['ammoSpentReported'] == 8
    assert o['cameraRayClassOfDistinctImpacts'] == {'ON_CAMERA_RAY': 2, 'OFF_CAMERA_RAY': 1}
    assert o['distinctImpactsWithoutCamera'] == 1
    assert off_axis((0, 0, 0), direction(0, 90), (-10, 0, 0)) < 1e-6
    assert summarize([])['distinctImpactRunsLowerBound'] == 0
    print('e04_correlate self-test PASS')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('files', nargs='*'); ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test: return self_test()
    print(json.dumps(summarize(a.files), indent=2, sort_keys=True))

if __name__ == '__main__': main()
