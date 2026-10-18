#!/usr/bin/env python3
"""Which method fails JIT first on the real execution path from EntryPoint.Main?

A method's IL is JIT-compiled on first call; every RPH token in its body is resolved
then, so a method whose body holds an unresolvable token throws before running.
Inputs: methods JSONL (RphMeta methods) + audit TSV (RphMeta audit). Read-only.
Usage: python3 -I jit_order.py METHODS.jsonl AUDIT.tsv
"""
import json, sys
methods = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8')]
bad = set()
for line in open(sys.argv[2], encoding='utf-8'):
    f = line.rstrip('\n').split('\t')
    if f[0] == 'FAIL' and f[1] in ('MISSING_MEMBER', 'MISSING_DECLARING_TYPE'):
        bad.add(f[2])
    if f[0] == 'FAIL' and f[1] == 'MISSING_TYPE':
        bad.add('type ' + f[2])
by_tok = {m['token']: m for m in methods}
def bad_refs(m):
    out = []
    for r in m['rph']:
        mem = r['member']
        base = mem.split('<')[0] if mem.endswith('>') and '`' in mem.split('(')[0] else mem
        if mem in bad or base in bad or any(mem.startswith(b + '<') for b in bad):
            out.append((r['il'], mem))
    return out
main = next(m for m in methods if m['type'].endswith('EntryPoint') and m['name'] == 'Main')
print('EntryPoint.Main bad refs in its OWN body:', bad_refs(main) or 'none')
print('Direct callees of Main in IL order (first 30) -> own-body bad refs:')
seen = set()
for c in main['calls'][:60]:
    if c['token'] in seen: continue
    seen.add(c['token'])
    callee = by_tok.get(c['token'])
    br = bad_refs(callee) if callee else []
    print(f"  IL_{c['il']:04X} {c['op']:8} {c['name'][:95]}" + (f"   <== {len(br)} bad: {br[0][1][:80]}" if br else ''))
print('All methods with bad refs:')
for m in methods:
    br = bad_refs(m)
    if br: print(f"  {m['full'][:100]}  ({len(br)})")
