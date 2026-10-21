#!/usr/bin/env python3
"""Phase-1 closeout checker for the X3-0.3 cleanup fix (PR #290 review, P0).

Reads a collected run jsonl and prints the x3_cleanup_test row, any x3_cleanup_skipped rows and the x3_leak counters.
It does not touch, reclassify or re-run the original X3 analysis (x3_analyze.py is unchanged).
Exit code 0 only if the cleanup test row exists and its 'pass' is true.
"""
import json, sys

def main():
    if len(sys.argv) != 2:
        sys.exit('usage: x3_cleanup_check.py <run.jsonl>')
    rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
    hdr = next((r for r in rows if r.get('kind') == 'header'), {})
    print('driver version:', hdr.get('version'), ' script sha256:', hdr.get('scriptSha256'))
    test = [r for r in rows if r.get('kind') == 'x3_cleanup_test']
    skipped = [r for r in rows if r.get('kind') == 'x3_cleanup_skipped']
    leaks = [r for r in rows if r.get('kind') == 'x3_leak']
    errs = [r for r in rows if r.get('kind') == 'error']
    for r in test:
        print(json.dumps(r, indent=1))
    print('x3_cleanup_skipped rows:', len(skipped))
    for r in skipped:
        print(' ', json.dumps(r))
    for r in leaks:
        print('x3_leak:', {k: r.get(k) for k in ('trial', 'cleanupDeletedOwned', 'cleanupSkippedAmbient', 'propsBefore', 'propsAfter')})
    print('error rows:', len(errs))
    ok = bool(test) and all(r.get('pass') is True for r in test) and not errs
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
