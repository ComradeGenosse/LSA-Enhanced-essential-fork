#!/usr/bin/env python3
"""Offline report for the E0.2/E0.3 shape-test options comparison (option 7 baseline vs option 0).

Reads WPS-LAB JSONL runs and prints a side-by-side summary. Raw per-probe rows stay in the JSONL.
Default output contains counts and classification labels only (no coordinates, material names or entity ids);
use --private for per-probe rows (keep that output in the private research repository, never the public one).

  options_report.py run-E0_2.jsonl run-E0_3.jsonl [--private] [--json]
  options_report.py --self-test
"""
import argparse, json, sys, collections

def rows(path):
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if line.startswith('[WPS-LAB] '):
                line = line[10:]
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if isinstance(r, dict) and 'kind' in r:
                yield r

def summarize(paths):
    mats, walls = {}, {}
    mat_conf, wall_conf = {}, {}
    for p in paths:
        for r in rows(p):
            k, d = r['kind'], r.get('details', {})
            i = d.get('sampleIndex')
            if k == 'material': mats.setdefault(i, {})['base'] = d
            elif k == 'material_options': mats.setdefault(i, {})['opt'] = d
            elif k == 'material_confirmation': mat_conf[i] = d
            elif k == 'exit_faces': walls.setdefault(i, {})['base'] = d
            elif k == 'wall_options': walls.setdefault(i, {})['opt'] = d
            elif k == 'wall_confirmation': wall_conf[i] = d
    out = {'materials': {}, 'walls': {}}
    # Materials ---------------------------------------------------------------------------
    n = len(mats); base_ok = sum(1 for v in mats.values() if v.get('base', {}).get('indexMatches'))
    cls = collections.Counter(v['opt']['classification'] for v in mats.values() if 'opt' in v)
    base_bad = [i for i, v in mats.items() if not v.get('base', {}).get('indexMatches')]
    resolved = [i for i in base_bad if mats[i].get('opt', {}).get('classification', '').startswith('RECOVERED_BY_OPT0')]
    out['materials'] = {'samples': n, 'baselineMatches': base_ok, 'optionsRowsPresent': sum(1 for v in mats.values() if 'opt' in v),
        'classification': dict(cls), 'baselineMismatches': len(base_bad), 'recoveredByOption0': len(resolved),
        'unresolved': sorted(set(base_bad) - set(resolved)),
        'delayedConfirmationsAgree': all(not mat_conf[i].get('indexedHashMatches') for i in mat_conf)}
    # Walls -------------------------------------------------------------------------------
    n = len(walls); base_ok = sum(1 for v in walls.values() if v.get('base', {}).get('diagnostic') == 'match')
    cls = collections.Counter(v['opt']['classification'] for v in walls.values() if 'opt' in v)
    base_bad = [i for i, v in walls.items() if v.get('base', {}).get('diagnostic') != 'match']
    resolved = [i for i in base_bad if walls[i].get('opt', {}).get('classification') == 'RECOVERED_BY_OPT0']
    layers = {i: (walls[i]['opt'].get('layersForward', {}).get('summary'), walls[i]['opt'].get('layersReverse', {}).get('summary'))
              for i in base_bad if 'opt' in walls[i]}
    out['walls'] = {'samples': n, 'baselineMatches': base_ok, 'optionsRowsPresent': sum(1 for v in walls.values() if 'opt' in v),
        'classification': dict(cls), 'baselineMismatches': len(base_bad), 'recoveredByOption0': len(resolved),
        'unresolved': sorted(set(base_bad) - set(resolved)),
        'unresolvedBaselineDiagnostics': {str(i): walls[i].get('base', {}).get('diagnostic') for i in base_bad},
        'unresolvedLayerSummaries': {str(i): v for i, v in layers.items() if i not in resolved}}
    corr = collections.Counter(); psum = collections.Counter(); matched = []; corroborated = []
    for i, v in walls.items():
        ps = v.get('opt', {}).get('pairSearch') or {}
        if not ps: continue
        corr[ps.get('corroboration')] += 1; psum[ps.get('summary')] += 1
        if ps.get('uniqueMatchesGroundTruth'): matched.append(i)
        if ps.get('corroboration') == 'CORROBORATED_THICKNESS': corroborated.append(i)
    base_bad_set = set(i for i, v in walls.items() if v.get('base', {}).get('diagnostic') != 'match')
    out['walls']['pairSearchSummary'] = dict(psum)
    out['walls']['corroborationClassification'] = dict(corr)
    out['walls']['uniquePairMatchesGroundTruth'] = sorted(matched)
    out['walls']['corroboratedThickness'] = sorted(corroborated)
    out['walls']['baselineMismatchesRecoveredByCorroboratedPair'] = sorted(base_bad_set & set(corroborated) & set(matched))
    out['walls']['baselineMismatchesNotRecovered'] = sorted(base_bad_set - (set(corroborated) & set(matched)))
    mlay = collections.Counter((v.get('opt', {}).get('layersOpt0') or {}).get('summary') for v in mats.values() if 'opt' in v)
    out['materials']['layerSummaryOpt0'] = dict(mlay)
    out['verdict'] = {
        'materialDiscrepancyResolvedByOptions': bool(mats) and out['materials']['optionsRowsPresent'] > 0 and not out['materials']['unresolved'],
        'wallDiscrepancyResolvedByOptions': bool(walls) and out['walls']['optionsRowsPresent'] > 0 and not out['walls']['unresolved'],
        'wallDiscrepancyResolvedByCorroboratedLayerPairs': bool(walls) and out['walls']['optionsRowsPresent'] > 0 and not out['walls']['baselineMismatchesNotRecovered'],
        'note': 'Resolved means every baseline mismatch was independently recovered by option 0; '
                'it is a shape-test statement, not a projectile-penetration claim.'}
    if True:
        out['_private'] = {'materials': mats, 'walls': walls}
    return out

def render(out, private):
    pub = {k: v for k, v in out.items() if not k.startswith('_')}
    if private:
        pub['perProbe'] = {'materials': {str(i): v.get('opt', {}).get('classification') for i, v in out['_private']['materials'].items()},
                           'walls': {str(i): v.get('opt', {}).get('classification') for i, v in out['_private']['walls'].items()}}
    return pub

def self_test():
    import tempfile, os
    def mat(i, ok): return {'kind': 'material', 'details': {'sampleIndex': i, 'indexMatches': ok}}
    def mato(i, c): return {'kind': 'material_options', 'details': {'sampleIndex': i, 'classification': c}}
    def wall(i, d): return {'kind': 'exit_faces', 'details': {'sampleIndex': i, 'diagnostic': d}}
    def wallo(i, c, f='SINGLE_SURFACE', r='SINGLE_SURFACE'):
        return {'kind': 'wall_options', 'details': {'sampleIndex': i, 'classification': c, 'layersForward': {'summary': f}, 'layersReverse': {'summary': r}}}
    def wallobl(i, c, corroboration, summary='UNIQUE_PAIR', gt=True):
        r = wallo(i, c)
        r['details']['pairSearch'] = {'summary': summary, 'corroboration': corroboration, 'uniqueMatchesGroundTruth': gt}
        return r
    data = [mat(1, True), mato(1, 'MATCH_BOTH'), mat(2, False), mato(2, 'RECOVERED_BY_OPT0_SEE_THROUGH_CLASS'),
            wall(1, 'match'), wallobl(1, 'MATCH_BOTH', 'CORROBORATED_THICKNESS'), wall(2, 'different_entities'), wallobl(2, 'UNCHANGED_BY_OPTIONS:ENTITY_SPLIT', 'NO_THICKNESS_CLAIM:ANGLE_INCONSISTENT')]
    data[-1]['details']['layersForward'] = {'summary': 'MULTIPLE_ENTITIES'}
    with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False, encoding='utf-8-sig') as f:
        for r in data: f.write('[WPS-LAB] ' + json.dumps(r) + '\n')
        f.write('garbage line\n')
        path = f.name
    try:
        o = summarize([path])
    finally:
        os.unlink(path)
    assert o['materials']['samples'] == 2 and o['materials']['baselineMatches'] == 1
    assert o['materials']['recoveredByOption0'] == 1 and o['materials']['unresolved'] == []
    assert o['verdict']['materialDiscrepancyResolvedByOptions'] is True
    assert o['walls']['baselineMismatches'] == 1 and o['walls']['unresolved'] == [2]
    assert o['verdict']['wallDiscrepancyResolvedByOptions'] is False
    assert o['walls']['unresolvedLayerSummaries']['2'][0] == 'MULTIPLE_ENTITIES'
    assert o['walls']['corroboratedThickness'] == [1] and o['walls']['baselineMismatchesNotRecovered'] == [2]
    assert o['verdict']['wallDiscrepancyResolvedByCorroboratedLayerPairs'] is False
    o3 = {'x': 1}
    pub = render(o, False)
    assert '_private' not in pub and 'perProbe' not in pub
    # a run without options rows can never be reported as resolved
    o2 = summarize([])
    assert o2['verdict']['materialDiscrepancyResolvedByOptions'] is False
    print('options_report self-test PASS')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('files', nargs='*'); ap.add_argument('--private', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test: return self_test()
    print(json.dumps(render(summarize(a.files), a.private), indent=2, sort_keys=True))

if __name__ == '__main__':
    main()
