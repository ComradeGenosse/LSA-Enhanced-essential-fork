#!/usr/bin/env python3
"""Parse RAGE Plugin Hook logs (read-only).

Per log: RPH version, game product version, plugins loaded (name + file), every
plugin-prefixed message ("<PluginName>: <message>"), and structured exceptions
(type, message, origin, stack frames) as printed by RPH's unhandled-exception block.

Usage: python3 -I scan_rph_logs.py OUT.json LOG [LOG ...]
"""
import json
import os
import re
import sys

STAMP = re.compile(r'^\[(?P<ts>[^\]]+)\]\s?(?P<body>.*)$')
VER = re.compile(r'RAGE Plugin Hook v(?P<v>[0-9.]+)')
PROD = re.compile(r'^Product version:\s*(?P<v>[0-9.]+)')
LOADED = re.compile(r'^Loaded plugin "(?P<name>[^"]+)" \((?P<file>[^)]+)\)')
EXC_FIELDS = ('Origin:', 'Exception type:', 'Exception message:')


def scan(path):
    rec = {'file': os.path.basename(path), 'rph_version': None, 'game_version': None,
           'plugins': [], 'messages': [], 'exceptions': []}
    names = set()
    cur = None
    in_stack = False
    for raw in open(path, encoding='utf-8', errors='replace'):
        raw = raw.rstrip('\r\n')
        m = STAMP.match(raw)
        body = m.group('body') if m else raw
        v = VER.search(body)
        if v and not rec['rph_version']:
            rec['rph_version'] = v.group('v')
        p = PROD.match(body)
        if p and not rec['game_version']:
            rec['game_version'] = p.group('v')
        l = LOADED.match(body)
        if l:
            rec['plugins'].append({'name': l.group('name'), 'file': l.group('file')})
            names.add(l.group('name'))
        # Plugin-prefixed message: "<Name>: text"
        pref = next((n for n in names if body.startswith(n + ': ')), None)
        if pref is None:
            if in_stack and body.startswith('at '):
                cur['stack'].append(body)
            continue
        text = body[len(pref) + 2:]
        if text.startswith('UNHANDLED EXCEPTION'):
            cur = {'plugin': pref, 'banner': text, 'origin': None, 'type': None, 'message': None, 'stack': []}
            rec['exceptions'].append(cur)
            in_stack = False
            continue
        if cur is not None and cur['plugin'] == pref:
            if text.startswith('Origin:'):
                cur['origin'] = text[7:].strip(); continue
            if text.startswith('Exception type:'):
                cur['type'] = text[15:].strip(); continue
            if text.startswith('Exception message:'):
                cur['message'] = text[18:].strip(); continue
            if text.startswith('Stack trace:'):
                in_stack = True; continue
            if in_stack and text.startswith('at '):
                cur['stack'].append(text); continue
            if text.startswith('=====') and in_stack:
                in_stack = False; cur = None; continue
            if text.startswith('-----') or text.startswith('Inner exceptions') or text == '':
                continue
        rec['messages'].append({'plugin': pref, 'text': text})
    return rec


def main():
    out, logs = sys.argv[1], sys.argv[2:]
    res = [scan(p) for p in logs]
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(res, fh, indent=1)
    print(f'scanned {len(res)} logs -> {out}')


if __name__ == '__main__':
    main()
