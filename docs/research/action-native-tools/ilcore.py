"""Core helpers for the action-completion audit.

Reads the JSON emitted by ActionNativeAudit (PE/CLR metadata + IL as data). Decodes the
obfuscator's module string table with the same seed / XOR-feedback / LZMA procedure proven
by the earlier native-context audit (docs/research/native-context-tools/audit.py on branch
research/remaining-native-context-audit). Nothing here loads or executes a game assembly.
"""
import json
import lzma
import struct
from pathlib import Path

PINS = {
    'essential': ('9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653', 0x600000c, 1907038128),
    'prbridge': ('712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e', 0x6000003, 3360315753),
}
MASK = 0xffffffff


def is_readable(name):
    return bool(name) and name.isascii() and all(c.isalnum() or c in '_<>.`+-|=,![]&*' for c in name)


def nice(name):
    """Replace obfuscated (non-ASCII) identifier segments with a stable ~crc32 alias."""
    import re
    import zlib
    if name is None:
        return None
    return re.sub(r'[^\x20-\x7e]+', lambda m: '~%08x' % zlib.crc32(m.group(0).encode('utf-8')), name)


class Module:
    def __init__(self, path, kind='essential'):
        self.kind = kind
        self.j = json.loads(Path(path).read_text(encoding='utf-8-sig'))
        pin, init_token, seed = PINS[kind]
        assert self.j['sha256'] == pin, 'wrong pinned input'
        self.types = self.j['types']
        self.methods = {}
        self.method_type = {}
        self.fields = {}
        self.field_type = {}
        for t in self.types:
            for m in t['methods']:
                self.methods[m['token']] = m
                self.method_type[m['token']] = t
            for f in t['fields']:
                self.fields[f['token']] = f
                self.field_type[f['token']] = t
        for m in self.methods.values():
            for i in m['il']:
                assert i['op'] != 'UNKNOWN'
        self.specs = {s['token']: s for s in self.j['methodSpecs']}
        self.memberrefs = {r['token']: r for r in self.j['memberRefs']}
        self._init_strings(init_token, seed)
        self._xrefs = None

    # ---- obfuscated string table -------------------------------------------------
    def _init_strings(self, init_token, seed):
        init = self.methods[init_token]['il']
        field = next(i['token'] for i in init if i['op'] == 'ldtoken')
        count = init[0]['value']
        raw = bytes.fromhex(next(f['data'] for f in self.j['rvaFields'] if f['token'] == field))[:count * 4]
        encrypted = struct.unpack('<' + 'I' * count, raw)
        assert any(i.get('value') is not None and (i['value'] & MASK) == seed for i in init), 'seed not found'
        key = []
        s = seed
        for _ in range(16):
            s ^= s >> 12
            s ^= (s << 25) & MASK
            s ^= s >> 27
            key.append(s)
        out = bytearray()
        for base in range(0, count, 16):
            for k in range(16):
                v = encrypted[base + k] ^ key[k]
                out.extend(struct.pack('<I', v))
                key[k] ^= v
        size = struct.unpack_from('<Q', out, 5)[0]
        self.table = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(bytes(out), max_length=size)
        assert len(self.table) == size
        self.formulas = {}
        for token, m in self.methods.items():
            t = self.method_type[token]
            if t['name'].endswith('<Module>') and m['returns'] == '!!0' and len(m['il']) > 4:
                self.formulas[token] = (m['il'][1]['value'] & MASK, m['il'][3]['value'] & MASK)

    def decode_string(self, call_token, argument):
        token = self.specs.get(call_token, {}).get('methodToken', call_token)
        mult, xor = self.formulas[token]
        v = ((argument * mult) & MASK) ^ xor
        off = (v & 0x3fffffff) * 4
        n = struct.unpack_from('<I', self.table, off)[0]
        assert off + 4 + n <= len(self.table)
        return self.table[off + 4:off + 4 + n].decode('utf-8')

    def is_string_decoder_call(self, ins):
        if ins['op'] not in ('call', 'callvirt') or ins.get('token') not in self.specs:
            return False
        spec = self.specs[ins['token']]
        return spec['signatureHex'] == '0A010E' and spec['methodToken'] in self.formulas

    def strings_in(self, token):
        il = self.methods[token]['il']
        found = []
        for n, ins in enumerate(il):
            if ins['op'] == 'ldstr':
                found.append((ins['offset'], ins['operand']))
            elif self.is_string_decoder_call(ins) and n and il[n - 1]['op'].startswith('ldc.i4'):
                found.append((ins['offset'], self.decode_string(ins['token'], il[n - 1]['value'] & MASK)))
        return found

    # ---- trivial forwarding wrappers ---------------------------------------------
    def wrapper_target(self, token):
        """Return 'NOP' for empty bodies, or the single forwarded call for ldarg*/call/ret stubs."""
        m = self.methods.get(token)
        if not m or not m['il']:
            return None
        ops = [i['op'] for i in m['il']]
        if ops == ['ret']:
            return 'NOP'
        calls = [i for i in m['il'] if i['op'] in ('call', 'callvirt', 'newobj')]
        rest = [i for i in m['il'] if i['op'] not in ('call', 'callvirt', 'newobj', 'ret', 'constrained.') and not i['op'].startswith('ldarg')]
        if len(calls) == 1 and not rest and ops[-1] == 'ret':
            tk = calls[0]['token']
            return self.method_name(tk)
        return None

    # ---- naming ------------------------------------------------------------------
    def method_name(self, token):
        if token in self.methods:
            t = self.method_type[token]
            n = self.methods[token]['name']
            return f"{nice(t['name'])}::{n if is_readable(n) else 'm' + hex(token)}"
        if token in self.memberrefs:
            return nice(self.memberrefs[token]['name'])
        if token in self.specs:
            return self.method_name(self.specs[token]['methodToken']) + '<spec>'
        return hex(token)

    def field_name(self, token):
        if token in self.fields:
            t = self.field_type[token]
            n = self.fields[token]['name']
            return f"{nice(t['name'])}::{n if is_readable(n) else 'f' + hex(token)}"
        if token in self.memberrefs:
            return nice(self.memberrefs[token]['name'])
        return hex(token)

    def type_named(self, suffix):
        return [t for t in self.types if t['name'] == suffix or t['name'].endswith('.' + suffix) or t['name'].endswith('+' + suffix)]

    def find_methods(self, type_suffix, name=None):
        out = []
        for t in self.type_named(type_suffix):
            for m in t['methods']:
                if name is None or m['name'] == name:
                    out.append(m)
        return out

    # ---- cross references ----------------------------------------------------------
    def xrefs(self):
        if self._xrefs is None:
            calls, fields = {}, {}
            for token, m in self.methods.items():
                for ins in m['il']:
                    tk = ins.get('token')
                    if tk is None:
                        continue
                    if ins['op'] in ('call', 'callvirt', 'newobj', 'ldftn', 'ldvirtftn'):
                        target = self.specs[tk]['methodToken'] if tk in self.specs else tk
                        calls.setdefault(target, []).append((token, ins['offset'], ins['op']))
                    elif ins['op'] in ('ldfld', 'stfld', 'ldsfld', 'stsfld', 'ldflda', 'ldsflda'):
                        fields.setdefault(tk, []).append((token, ins['offset'], ins['op']))
            self._xrefs = (calls, fields)
        return self._xrefs

    def callers(self, token):
        return self.xrefs()[0].get(token, [])

    def field_users(self, token):
        return self.xrefs()[1].get(token, [])

    def callees(self, token):
        out = []
        for ins in self.methods[token]['il']:
            if ins['op'] in ('call', 'callvirt', 'newobj', 'ldftn') and ins.get('token') is not None:
                if self.is_string_decoder_call(ins):
                    continue
                tk = ins['token']
                out.append((ins['offset'], ins['op'], self.specs[tk]['methodToken'] if tk in self.specs else tk))
        return out

    # ---- rendering -------------------------------------------------------------------
    def render(self, token, limit=None):
        m = self.methods[token]
        t = self.method_type[token]
        lines = [f"METHOD {hex(token)} {self.method_name(token)}({nice(', '.join(m['parameters']))}) -> {nice(m['returns'])} "
                 f"static={m['isStatic']} rva={hex(m['rva'])} ilSha256={m['ilSha256']}"]
        for e in m.get('exceptionRegions', []):
            lines.append('  EXCEPTION ' + json.dumps(e, sort_keys=True))
        il = m['il']
        for n, ins in enumerate(il):
            if limit and n >= limit:
                lines.append('  ...')
                break
            op = ins['op']
            text = ''
            tk = ins.get('token')
            if self.is_string_decoder_call(ins) and n and il[n - 1]['op'].startswith('ldc.i4'):
                text = 'STRING ' + json.dumps(self.decode_string(tk, il[n - 1]['value'] & MASK))
            elif op in ('call', 'callvirt', 'newobj', 'ldftn', 'ldvirtftn') and tk is not None:
                text = f"{hex(tk)} {self.method_name(tk)}"
            elif op in ('ldfld', 'stfld', 'ldsfld', 'stsfld', 'ldflda', 'ldsflda') and tk is not None:
                text = f"{hex(tk)} {self.field_name(tk)}"
            elif tk is not None:
                text = f"{hex(tk)} {nice(ins.get('operand'))}"
            elif ins.get('targets'):
                text = '-> ' + ','.join(f"IL_{x:04x}" for x in ins['targets'])
            elif ins.get('value') is not None:
                text = str(ins['value'])
            elif ins.get('operand') is not None and op == 'ldstr':
                text = json.dumps(ins['operand'])
            lines.append(f"  IL_{ins['offset']:04x}: {op} {text}".rstrip())
        return '\n'.join(lines)
