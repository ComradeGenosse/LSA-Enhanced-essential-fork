#!/usr/bin/env python3
"""Derive RPH members PROVEN resolvable on the user's real 1.132 runtime.

Principle: a .NET method is JIT-compiled before its first instruction runs, and the JIT
resolves every member token in the method's (reachable) IL at that time. So if a log line
proves a method executed, every RPH member referenced in that method's body was resolved
by the actual RPH 1.132 runtime in GTA.

Evidence: (a) plugin log messages matched to the unique method containing the ldstr literal
that produced them; (b) explicit facts supplied on the command line ("--executed TOKEN" for a
method shown to run by control flow, e.g. 5884d8b EntryPoint.Main, which logged host_failed).

Usage:
  python3 -I runtime_proven.py OUT.json LOGSCAN.json PLUGINNAME=METHODS.jsonl[,METHODS.jsonl...] ...
          [--executed PLUGINNAME:TOKEN ...]
"""
import json
import re
import sys

PLACEHOLDER = re.compile(r'\{\d+(?:[,:][^}]*)?\}')


def fragments(lit):
    parts = [p for p in PLACEHOLDER.split(lit) if len(p.strip()) >= 6]
    return parts if sum(len(p) for p in parts) >= 10 else []


def matches(frags, text):
    pos = 0
    for f in frags:
        i = text.find(f, pos)
        if i < 0:
            return False
        pos = i + len(f)
    return True


def main():
    out, logscan = sys.argv[1], sys.argv[2]
    specs, executed_explicit = [], []
    args = sys.argv[3:]
    i = 0
    while i < len(args):
        if args[i] == '--executed':
            executed_explicit.append(args[i + 1]); i += 2; continue
        specs.append(args[i]); i += 1
    logs = json.load(open(logscan, encoding='utf-8'))
    msgs = {}
    for r in logs:
        for m in r['messages']:
            msgs.setdefault(m['plugin'], set()).add(m['text'])
    result = {'principle': __doc__.split('\n\n')[1].strip(), 'plugins': {}}
    proven = {}
    for spec in specs:
        plugin, files = spec.split('=', 1)
        methods = []
        for f in files.split(','):
            methods += [json.loads(l) for l in open(f, encoding='utf-8')]
        by_token = {}
        lit_index = {}
        for m in methods:
            key = (m['type'], m['token'])
            by_token[key] = m
            for s in set(m['strings']):
                fr = fragments(s)
                if fr:
                    lit_index.setdefault(s, set()).add(key)
        executed = {}
        texts = msgs.get(plugin, set())
        for text in texts:
            best = None
            for lit, owners in lit_index.items():
                fr = fragments(lit)
                if matches(fr, text):
                    score = sum(len(x) for x in fr)
                    if best is None or score > best[0]:
                        best = (score, lit, owners)
            if best and len(best[2]) == 1:
                key = next(iter(best[2]))
                executed.setdefault(key, best[1])
        for spec_ex in executed_explicit:
            pl, tok = spec_ex.split(':', 1)
            if pl == plugin:
                for key, m in by_token.items():
                    if m['token'] == tok:
                        executed.setdefault(key, '<control-flow evidence>')
        members = {}
        for key, lit in executed.items():
            m = by_token[key]
            for r in m['rph']:
                mem = r['member']
                members.setdefault(mem, set()).add(m['full'])
        result['plugins'][plugin] = {
            'distinct_messages': len(texts),
            'executed_methods': [{'method': by_token[k]['full'], 'evidence_literal': v} for k, v in sorted(executed.items(), key=lambda kv: by_token[kv[0]]['full'])],
            'runtime_proven_members': sorted(members),
        }
        for mem, by in members.items():
            proven.setdefault(mem, set()).update(f'{plugin}: {x}' for x in by)
    result['all_runtime_proven_members'] = {k: sorted(v) for k, v in sorted(proven.items())}
    json.dump(result, open(out, 'w', encoding='utf-8'), indent=1)
    for p, d in result['plugins'].items():
        print(f"{p}: messages={d['distinct_messages']} executed_methods={len(d['executed_methods'])} proven_members={len(d['runtime_proven_members'])}")
    print(f"union of runtime-proven RPH members: {len(proven)}")


if __name__ == '__main__':
    main()
