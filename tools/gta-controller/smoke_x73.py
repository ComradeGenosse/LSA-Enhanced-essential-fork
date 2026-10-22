"""Bounded X7.3 live impact-selected fracture smoke trial over the P2 controller (Windows host operator only).

One trial: prepare -> camera -> real RPG shot -> player walk -> restore, each a separate strict P2 request.
The walk step uses the driver's bounded native player task. Exit 0 requires command, native-fracture, traversal and world verdicts to all pass; environmental obstacles are reported separately.
Filesystem restoration is NOT assessed here: run verify_hashes.py after GTA is stopped.
"""
import argparse
import json
import sys
from pathlib import Path

import controller as c

EXPERIMENT = 'X7.3-p2-auto-impact'
SHOT_LABEL = 'p2smoke_auto_center'
# One center shot at the validated site, but no section is selected at preparation.
STEPS = [
    ('prepare', 'x7prepare model=lsa_x7d_secp_j1400 verified=1 hash=1185366416 tx=1065.758 ty=-1773.716 tz=34.851 px=1072 py=-1772.5 pz=36.5 pu=0 back=4'),
    ('camera', 'x7cam t=-5.5 u=1.5 z=1.5 lu=0 lz=1.1'),
    # The 40 ms default missed the last pre-impact sample by 0.053 ms in the failed smoke.
    # 60 ms provides a small margin for the RPG's collision nose ahead of the target plane.
    ('shot', 'x7shot label=' + SHOT_LABEL + ' aimu=0 aimv=0.80 back=4 probe=1 horizon=60'),
    ('walk', 'x7walk hold=3'),
    ('restore', 'x7restore'),
]
PROTECTED_MOVE_LIMIT = 0.05


def rows_of(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def first(rows, kind, **match):
    for r in rows:
        if r.get('kind') == kind and all(r.get(k) == v for k, v in match.items()):
            return r
    return None


def analyze(rows_by_step, label=SHOT_LABEL):
    """Judge the predicted selection, fracture, foreign collision and restoration independently."""
    checks = {}
    armed = first(rows_by_step.get('prepare', []), 'x7_armed')
    checks['armed_original_9_of_9_twin_0'] = bool(armed and armed.get('originalBlocked') == 9 and armed.get('twinBlocked') == 0)
    shot = rows_by_step.get('shot', [])
    res = first(shot, 'x7_result', label=label)
    sel = first(shot, 'x7_selection', label=label)
    pair = set()
    valid_selection = False
    if sel:
        a, b, mask = sel.get('first'), sel.get('second'), sel.get('mask')
        u, v = sel.get('impactU'), sel.get('impactV')
        if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (a,b,mask,u,v)):
            valid_selection = (0 <= a <= 3 and b == a+1 and mask == 3 << a
                               and -1.268 <= u <= 1.268 and 0 <= v <= 2.131
                               and sel.get('origin') == 'projected_intersection'
                               and sel.get('readyCount') == 1 and sel.get('projectile') == (res or {}).get('projHandle',sel.get('projectile')))
            if valid_selection:
                # Reproduce the same deterministic geometry rule, not a walk-friendly override.
                expected_a = 0 if u <= -0.5072 else 1 if u <= 0 else 2 if u <= 0.5072 else 3
                valid_selection = a == expected_a
                pair = {a, b}
    checks['valid_projected_two_section_selection'] = valid_selection
    checks['real_projectile_committed_before_explosion'] = bool(
        res and res.get('committed') and res.get('projectileSeen') and not res.get('late') and not res.get('fallbackUsed')
        and (res.get('framesCommitToExplosion') or 0) >= 1)
    checks['native_fracture_exactly_two_parts'] = bool(res and res.get('nativeParts') == 2)
    checks['original_hidden_after_swap'] = bool(res and res.get('originalBlocked') == 0)
    states = {r['pos']: r for r in shot if r.get('kind') == 'x7_secstate' and r.get('label') == label}
    five = sorted(states) == [0, 1, 2, 3, 4]
    checks['five_section_states_logged'] = five
    checks['sections_match_projected_pair'] = valid_selection and five and {p for p,r in states.items() if r.get('selected')} == pair
    checks['protected_sections_intact'] = valid_selection and five and all(
        r.get('exists') and r.get('visible') and r.get('attached') and r.get('rootAlive')
        and 0 <= r.get('moved', -1) < PROTECTED_MOVE_LIMIT for p,r in states.items() if p not in pair)
    probes = [r for r in shot if r.get('kind') == 'x7_probe' and r.get('label') == label]
    final = probes[-1].get('strips_blocked_debris_other', '').split() if probes else []
    checks['probe_open_only_at_selected'] = valid_selection and len(final) == 5 and all(
        len(x) == 3 and (x[0] == '0') == (i in pair) and (x[0] == '3') == (i not in pair)
        for i,x in enumerate(final))
    frames = first(shot, 'x7_frames', label=label)
    checks['no_frame_over_50ms'] = bool(frames and frames.get('over50') == 0)
    fracture = all(v for k,v in checks.items() if k != 'armed_original_9_of_9_twin_0')
    walk = first(rows_by_step.get('walk', []), 'x7_player_result')
    checks['player_traversed_opening'] = bool(walk and walk.get('isPlayer') and walk.get('crossed') and walk.get('passed') and not walk.get('outsideFootprint'))
    foreign = [r for r in shot if r.get('kind') == 'x7_other_hit' and r.get('label') == label
               and r.get('isLabHandle') is False]
    if walk is None:
        traversal = 'NOT_RUN'
    elif checks['player_traversed_opening']:
        traversal = 'PASS'
    elif foreign:
        traversal = 'BLOCKED_OR_CONFOUNDED_BY_FOREIGN_COLLISION'
    else:
        traversal = 'FAILED_OR_UNRESOLVED'
    restored = first(rows_by_step.get('restore', []), 'x7_restored')
    world = bool(restored and restored.get('restoredToOriginal') and restored.get('originalExists')
                 and restored.get('originalBlocked') == 9)
    gameplay = all(checks.values())
    return dict(checks=checks, selection=sel, selectedPair=sorted(pair),
                fractureOutcome='PASS' if fracture else 'FAIL_OR_MISSING',
                traversalOutcome=traversal, foreignCollisionHits=len(foreign),
                gameplayOutcome='PASS' if gameplay else 'FAIL_OR_PARTIAL',
                worldRestoration='PASS_9_OF_9' if world else 'FAIL_OR_MISSING')

def run(ctl, out):
    """Return (verdict dict, exit code). Never resubmits; a timeout stops everything for reconcile."""
    out = Path(out)
    if out.exists():
        raise ValueError('Evidence directory must be new')
    done, request_ids, error, unknown = [], [], None, False
    restore_attempted = False
    for name, command in STEPS:
        try:
            if name == 'restore':
                restore_attempted = True
            result = ctl.submit(command, EXPERIMENT, 'smoke-' + name, timeout=120 if name == 'walk' else 80)
            request_ids.append(result['requestId']); done.append(name)
            if name in ('prepare', 'shot'):
                rows = rows_of(ctl.lab / result['runId'] / 'trials.jsonl')
                if name == 'prepare':
                    armed = first(rows, 'x7_armed')
                    accepted = bool(armed and armed.get('originalBlocked') == 9 and armed.get('twinBlocked') == 0)
                else:
                    checks = analyze({'shot': rows})['checks']
                    accepted = all(v for k, v in checks.items() if k not in ('armed_original_9_of_9_twin_0', 'player_traversed_opening'))
                if not accepted:
                    error = {'step': name, 'message': 'Gameplay acceptance failed; no further trial steps'}
                    break
        except (OSError, ValueError, KeyError) as e:
            error = {'step': name, 'message': 'Evidence acceptance failed: ' + str(e)}
            unknown = bool(getattr(ctl, 'state', {}).get('pending'))
            break
        except c.ProtocolError as e:
            error = {'step': name, 'message': str(e)}
            unknown = 'TIMEOUT_UNKNOWN' in str(e) or bool(getattr(ctl, 'state', {}).get('pending'))
            last = getattr(ctl, 'state', {}).get('last')
            if last and last.get('command') == command:
                request_ids.append(last['requestId'])  # definite runtime failure: keep its evidence
            break
    restore_after_failure = None
    if error and not unknown and 'prepare' in done and not restore_attempted:
        # Definite failure (never a timeout): one restore through the SAME controller/session.
        try:
            r = ctl.submit('x7restore', EXPERIMENT, 'smoke-restore-after-failure', timeout=80)
            request_ids.append(r['requestId']); restore_after_failure = 'DONE'
        except c.ProtocolError as e:
            restore_after_failure = 'FAILED: ' + str(e)
            unknown = 'TIMEOUT_UNKNOWN' in str(e) or bool(getattr(ctl, 'state', {}).get('pending'))
            last = getattr(ctl, 'state', {}).get('last')
            if not unknown and last and last.get('command') == 'x7restore':
                request_ids.append(last['requestId'])
    verdict = dict(experiment=EXPERIMENT, stepsCompleted=done, requestIds=request_ids, error=error,
                   restoreAfterFailure=restore_after_failure,
                   commandOutcome='ALL_DONE' if len(done) == len(STEPS) and not error else ('UNKNOWN_RECONCILE_REQUIRED' if unknown else 'FAILED'),
                   filesystemRestoration='NOT_ASSESSED_RUN_verify_hashes_AFTER_GTA_STOPPED')
    code = 2
    out.mkdir(parents=True, exist_ok=True)
    # Preserve command outcomes even if exact evidence collection cannot finish.
    (out / 'verdict.json').write_text(json.dumps(verdict, indent=2), encoding='utf-8')
    if not unknown and request_ids:
        (out / 'request-ids.json').write_text(json.dumps({'requestIds': request_ids}), encoding='utf-8')
        c.collect(ctl.lab, request_ids, out / 'evidence')
        by_step = {}
        for rid in request_ids:
            resp = c.read(ctl.lab / 'responses' / (rid + '.json'))
            step = resp['trialId'].replace('smoke-', '').replace('restore-after-failure', 'restore')
            by_step.setdefault(step, []).extend(rows_of(ctl.lab / resp['runId'] / 'trials.jsonl'))
        verdict.update(analyze(by_step))
        if verdict['commandOutcome'] == 'ALL_DONE' and verdict['gameplayOutcome'] == 'PASS' and verdict['worldRestoration'] == 'PASS_9_OF_9':
            code = 0
    (out / 'verdict.json').write_text(json.dumps(verdict, indent=2), encoding='utf-8')
    return verdict, code


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--lab', required=True, type=Path); p.add_argument('--owner', required=True)
    p.add_argument('--session', required=True); p.add_argument('--expected', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path, help='new evidence directory')
    a = p.parse_args()
    ctl = c.Controller(a.lab, a.owner, a.session, c.read(a.expected))
    print('One auto-selected trial; inspect independent fracture/traversal verdicts. No retest.', file=sys.stderr)
    try:
        verdict, code = run(ctl, a.out)
    except (c.ProtocolError, OSError, ValueError, KeyError) as e:
        print(str(e), file=sys.stderr); raise SystemExit(2)
    print(json.dumps(verdict, indent=2)); raise SystemExit(code)


if __name__ == '__main__':
    main()
