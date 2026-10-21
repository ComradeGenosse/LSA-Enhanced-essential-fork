"""Describe the frozen final pass without changing any strict acceptance verdict."""
from pathlib import Path
import argparse
import hashlib
import json

ap = argparse.ArgumentParser()
ap.add_argument('directory', type=Path)
ap.add_argument('run')
args = ap.parse_args()
rows = json.loads((args.directory / 'trial-summary.json').read_text())
config_path = Path(__file__).with_name('final-validation-config.json')
config = json.loads(config_path.read_text())
selected = [t for t in rows if t['run'] == args.run]
assert len(selected) == 11, 'Expected nine impacts and two intact controls'
assert all(t.get('completed') and 'x2_verdict' in t and 'error' not in t for t in selected)
assert all(t['scriptSha256'] == config['scriptSha256'] and
           t['start']['assetSha256'] == config['packSha256'] for t in selected)
expected = {(p['du'], p['height'], e, c['scale'], c['dx'])
            for p in config['positions'].values() for e, c in config['charges'].items()}
actual = set()
out = []
for t in selected:
    options = dict(x.split('=', 1) for x in t['command'].split() if '=' in x)
    explosive = options['explosive']
    if explosive != 'none':
        actual.add(tuple(float(options[k]) for k in ('du', 'height')) +
                   (explosive,) + tuple(float(options[k]) for k in ('scale', 'dx')))
    b = t.get('x2_baseline', {})
    g = t.get('x2_geometry', {})
    v = t['x2_verdict']
    valid = (b.get('blocked') == 120 and b.get('sweepClearColumns') == 0 and
             b.get('anchorFaceHits') == 20 and b.get('failedRayRequests') == 0)
    verdict = v['verdict']
    interpretation = 'intact_control' if explosive == 'none' else 'not_confirmed'
    if verdict == 'LOCAL_ANCHORED_BREACH_CONFIRMED':
        interpretation = 'measured_native_anchored_traversable_breach'
    elif not valid:
        interpretation = 'invalid_measurement_baseline_not_a_valid_non_breach'
    elif explosive == 'grenade' and t['clearAreaM2'] == 0 and g.get('explosionDetected') and g.get('anchored'):
        interpretation = 'weak_concrete_charge_non_breach_strict_result_unchanged'
    elif explosive != 'none' and t['clearAreaM2'] > 0 and g.get('sweepWindowM', 0) < .6:
        interpretation = 'localized_or_partial_opening_without_traversable_clearance'
    out.append({'command': t['command'], 'baselineValid': valid, 'strictVerdict': verdict,
                'interpretation': interpretation, 'clearAreaM2': t['clearAreaM2'],
                'centroidErrorM': t.get('centroidErrorM'), 'geometry': g,
                'finalAnchor': t.get('x2_final_anchor'), 'walk': v,
                'anchoringUnverified': explosive != 'none' and not v.get('anchored', False)})
assert actual == expected, 'Final matrix differs from frozen configuration'
report = {'run': args.run, 'config': config,
          'configSha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
          'matrixComplete': True, 'blasts': 9, 'controls': 2,
          'explosionDetectedTrials': sum(t['geometry'].get('explosionDetected', False)
                                         for t in out if 'explosive=none' not in t['command']),
          'closedControls': sum(t['strictVerdict'] == 'CONTROL_CLOSED' for t in out),
          'completedWithoutErrors': True,
          'coreTechnicalFeasibility': 'PROVEN', 'formalX2Acceptance': 'PARTIALLY_PASSED',
          'policy': 'Interpretation never overwrites strict verdicts or removes failed trials. Research closed after this pass; recommend X3 with documented limitations.',
          'trials': out}
(args.directory / 'final-validation.json').write_text(json.dumps(report, indent=2) + '\n')

# Preserve the original three-launch, twenty-blast cohort separately from later pilots.
initial_runs = {'20261021-112312-5588e1', '20261021-112658-91c08f',
                '20261021-113317-10c8bb', '20261021-114027-98d666'}
initial = [t for t in rows if t['run'] in initial_runs and t['start']['explosive'] != 'none']
assert len(initial) == 20
local = [t for t in initial if t.get('centroidErrorM', 999) <= .5]
confirmed = [t for t in initial if t['x2_verdict']['verdict'] == 'LOCAL_ANCHORED_BREACH_CONFIRMED']
snapshot = {'runs': sorted(initial_runs), 'blasts': len(initial),
            'confirmedTraversals': len(confirmed),
            'freshConfirmedLaunches': len({t['loadedUtc'] for t in confirmed}),
            'centroidPasses': len(local), 'centroidTrials': len(initial),
            'centroidGatePassed': len(local) / len(initial) >= .8,
            'originalStrictStatus': 'INCOMPLETE',
            'note': 'Original threshold preserved: no-opening trials fail the centroid gate; legitimate weak-charge interpretation does not remove them.'}
(args.directory / 'strict-initial-20.json').write_text(json.dumps(snapshot, indent=2) + '\n')
print(json.dumps({'finalRun': args.run, 'strictOriginalCohort': snapshot,
                  'finalVerdicts': [t['strictVerdict'] for t in out]}, indent=2))
