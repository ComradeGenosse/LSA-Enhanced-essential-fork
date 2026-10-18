#!/usr/bin/env python3
"""Render REPORT.md from REPORT.template.md by inserting the two generated evidence tables.

Usage: python3 -I render_report.py TEMPLATE INVENTORY_TABLE.md MEMBER_TABLE.md OUT.md
"""
import re
import sys


def main():
    template, inventory, members, out = sys.argv[1:5]
    text = open(template, encoding='utf-8').read()
    for key, path in (('INVENTORY_TABLE', inventory), ('MEMBER_TABLE', members)):
        token = '{{' + key + '}}'
        if text.count(token) != 1:
            sys.exit(f'{token} must occur exactly once in the template')
        table = open(path, encoding='utf-8').read().strip('\n')
        if not table.startswith('|'):
            sys.exit(f'{path} does not look like a markdown table')
        text = text.replace(token, table)
    left = re.findall(r'\{\{[A-Z_]+\}\}', text)
    if left:
        sys.exit(f'unfilled placeholders: {left}')
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print(f'{out}: {text.count(chr(10))} lines')


if __name__ == '__main__':
    main()
