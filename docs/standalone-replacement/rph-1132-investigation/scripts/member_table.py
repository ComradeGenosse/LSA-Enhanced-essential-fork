#!/usr/bin/env python3
"""Per-import evidence table for the HEAD host (report §D.2).

For every RPH member import and generic instantiation compiled into the HEAD host, mark:
  - whether it resolves against the official SDK (HEAD dual-audit status),
  - which control plugins import exactly the same canonical signature (their dual-audits, OK rows),
  - whether a method containing it demonstrably executed on the user's 1.132 (runtime-proven.json).

Usage:
  python3 -I member_table.py HEAD.dual-audit.tsv CONTROL_DIR runtime-proven.json [--format old|new] > table.md
"""
import json
import os
import re
import sys

PREFIX = '[RagePluginHook]'
SCOPE = re.compile(r'\[[A-Za-z0-9_.]+\]')


def display(imp):
    """Report form: drop assembly scopes and the class/valuetype markers (matching is done on the full form)."""
    return SCOPE.sub('', imp).replace('class ', '').replace('valuetype ', '')
GROUPS_NEW = [
    ('LSPDFR (ships with 1.132)', ['LSPD_First_Response']),
    ('Your Essential (ran)', ['LosSantosAlive']),
    ('Your Smart Vehicle Entry (ran)', ['SmartVehicleEntry']),
    ('Your other installed plugins (static only)',
     ['LSA.PromotedCharacters', 'LSA.PromotedCharacters.Runtime', 'LSA.SessionIdentity',
      'LosSantosAlive.PRBridge', 'LosSantosAlive.Interop', 'RAGENativeUI']),
]
GROUPS_OLD = [
    ('Used by LSPDFR', ['LSPD_First_Response']),
    ('Used by your Essential', ['LosSantosAlive']),
    ('Used by your other 1.132 plugins',
     ['SmartVehicleEntry', 'LSA.PromotedCharacters', 'LSA.PromotedCharacters.Runtime', 'LSA.SessionIdentity',
      'LosSantosAlive.PRBridge', 'LosSantosAlive.Interop', 'RAGENativeUI']),
]


def rows(path):
    for line in open(path, encoding='utf-8'):
        f = line.rstrip('\r\n').split('\t')
        if len(f) >= 3 and f[1] in ('MEMBER', 'SPEC'):
            yield f[0], f[1], f[2].rstrip()


def ok_set(path):
    return {imp for st, _, imp in rows(path) if st == 'OK'}


def main():
    head, cdir, proven_path = sys.argv[1:4]
    fmt = sys.argv[sys.argv.index('--format') + 1] if '--format' in sys.argv else 'new'
    groups = GROUPS_NEW if fmt == 'new' else GROUPS_OLD
    controls = {}
    for _, names in groups:
        for n in names:
            p = os.path.join(cdir, n + '.dual-audit.tsv')
            if not os.path.exists(p):
                sys.exit(f'missing control audit: {p}')
            controls[n] = ok_set(p)
    proven = set(json.load(open(proven_path, encoding='utf-8'))['all_runtime_proven_members'])
    imports = list(rows(head))
    imports = [r for r in imports if r[1] == 'MEMBER'] + [r for r in imports if r[1] == 'SPEC']
    hdr = ['#', 'HEAD import (exact compiled signature)', 'In official SDK'] + [g for g, _ in groups] + ['**Executed on your 1.132**']
    out = ['| ' + ' | '.join(hdr) + ' |', '|' + '---|' * len(hdr)]
    counts = [0] * len(groups)
    for i, (st, kind, imp) in enumerate(imports, 1):
        cells = [str(i), '`' + display(imp) + '`', '✓' if st == 'OK' else '✗']
        for gi, (_, names) in enumerate(groups):
            hit = any(imp in controls[n] for n in names)
            counts[gi] += hit
            cells.append('✓' if hit else '—')
        cells.append('**✓ proven**' if imp in proven else '—')
        out.append('| ' + ' | '.join(cells) + ' |')
    print('\n'.join(out))
    covered = sum(1 for st, k, imp in imports if any(imp in controls[n] for _, ns in groups for n in ns))
    print(f'<!-- imports={len(imports)} ' + ' '.join(f'{g.split(" (")[0]}={c}' for (g, _), c in zip(groups, counts))
          + f' covered_by_any_control={covered} runtime_proven={sum(1 for *_, imp in imports if imp in proven)} -->',
          file=sys.stderr)


if __name__ == '__main__':
    main()
