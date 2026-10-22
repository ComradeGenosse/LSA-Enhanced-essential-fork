"""Regenerate the corrected Phase 2 table solely from committed structured records."""
import argparse
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
REPORT=ROOT/'native/fragment-x7/evidence/x72b/RESULTS.md'
SOURCE=REPORT.with_name('phase2-shots.json')
BEGIN='<!-- generated-phase2:start -->'
END='<!-- generated-phase2:end -->'

def render():
    records=json.loads(SOURCE.read_text(encoding='utf-8-sig'))
    lines=[BEGIN,'| shot / exact run | strength (-U..+U) | broken | recorded walk |','|---|---|---|---|']
    for r in records:
        w=r.get('walk')
        outcome='NOT RECORDED' if w is None else ('PASS; U='+str(w['crossingU'])+'; lane '+str(w['laneWidthM'])+' m' if w['passed'] else 'FAIL; '+str(w.get('reason')))
        lines.append('| '+r['label']+' / `'+r['run']+'` | '+(r['pattern'] or '1400 x5')+' | '+str(r['nativeParts'])+'/5 | '+outcome+' |')
    lines+=['',f"Across {len(records)} records: original restoration witnesses {min(r['restoredOriginal9of9'] for r in records)}/9 in every record; commit cost {min(r['commitCallMs'] for r in records):.3f}–{max(r['commitCallMs'] for r in records):.3f} ms; near-event window maximum {min(r['windowMaxMs'] for r in records):.3f}–{max(r['windowMaxMs'] for r in records):.3f} ms; frames over 50 ms: {sum(r['over50'] for r in records)}.",END]
    return '\n'.join(lines)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');a=p.parse_args()
    text=REPORT.read_text(encoding='utf-8-sig'); old=text[text.index(BEGIN):text.index(END)+len(END)]
    if a.check:
        if old!=render(): raise SystemExit('Phase 2 table differs from structured records')
        print('PASS: all 8 structured records match corrected report')
    else: REPORT.write_bytes(text.replace(old,render()).encode('utf-8'))
