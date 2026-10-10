"""Read extracted IL, decode constants, and interpret only pure classifier IL.

No assembly loading, game calls, network, or reflection invocation. Unknown opcodes
and calls fail closed. Python uppercase is used only for the ASCII sample suite;
the native specification uses .NET String.ToUpperInvariant, proven by wrapper IL.
"""
import argparse
import hashlib
import itertools
import json
import lzma
from pathlib import Path
import struct

PIN = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653'
BRIDGE_PIN = '712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e'
MASK = 0xffffffff


class Audit:
    def __init__(self, file, bridge=False):
        self.j = json.loads(Path(file).read_text(encoding='utf-8-sig'))
        assert self.j['dllSha256'] == (BRIDGE_PIN if bridge else PIN), 'Wrong pinned DLL'
        self.methods = {m['token']: m for t in self.j['types'] for m in t['methods']}
        assert all('error' not in i and i.get('op') != 'UNKNOWN' for m in self.methods.values() for i in m['il']), 'IL extraction incomplete'
        self.specs = {s['token']: s for s in self.j['methodSpecs']}
        init = self.methods[0x6000003 if bridge else 0x600000c]['il']
        field = next(i['rawToken'] for i in init if i['op'] == 'ldtoken')
        count = init[0]['value']
        raw = bytes.fromhex(next(f['data'] for f in self.j['rvaFields'] if f['token'] == field))[:count*4]
        encrypted = struct.unpack('<' + 'I'*count, raw)
        seed = 3360315753 if bridge else 1907038128
        assert any(i.get('value') is not None and (i['value'] & MASK) == seed for i in init)
        key = []
        for _ in range(16):
            seed ^= seed >> 12
            seed ^= (seed << 25) & MASK
            seed ^= seed >> 27
            key.append(seed)
        compressed = bytearray()
        for base in range(0, count, 16):
            for i in range(16):
                v = encrypted[base+i] ^ key[i]
                compressed.extend(struct.pack('<I', v))
                key[i] ^= v
        size = struct.unpack_from('<Q', compressed, 5)[0]
        self.table = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(bytes(compressed), max_length=size)
        assert len(self.table) == size
        self.formulas = {}
        for token, m in self.methods.items():
            if m['declaringType'].endswith('<Module>') and m['returns'] == '!!0':
                self.formulas[token] = (m['il'][1]['value'] & MASK, m['il'][3]['value'] & MASK)
        self.coverage = {}

    def decode(self, token, argument):
        token = self.specs.get(token, {}).get('methodToken', token)
        mult, xor = self.formulas[token]
        v = ((argument * mult) & MASK) ^ xor
        off = (v & 0x3fffffff) * 4
        n = struct.unpack_from('<I', self.table, off)[0]
        assert off + 4 + n <= len(self.table)
        return self.table[off+4:off+4+n].decode('utf-8')

    def constants(self, m):
        found = []
        il = m['il']
        for n, i in enumerate(il):
            if i['op'] == 'ldstr':
                found.append({'offset': i['offset'], 'string': i['operand']})
            elif i['op'] == 'call' and i['rawToken'] in self.specs:
                spec = self.specs[i['rawToken']]
                if spec['signatureHex'] == '0A010E' and spec['methodToken'] in self.formulas:
                    assert il[n-1]['op'] == 'ldc.i4'
                    found.append({'offset': i['offset'], 'decoder': hex(spec['methodToken']), 'argument': il[n-1]['value'] & MASK, 'string': self.decode(i['rawToken'], il[n-1]['value'])})
        return found

    def run(self, token, args, trace=None):
        m = self.methods[token]
        assert token in {0x60012ba, 0x60012bb, 0x60012bc, 0x60012c8, 0x60012c7, 0x60012cd, 0x60012d2, 0x60012d3, 0x60012d4}, 'Non-pure method denied'
        il = m['il']; index = {i['offset']: n for n, i in enumerate(il)}
        stack = []; locals_ = {}; pc = 0
        self.coverage.setdefault(token, set())
        for _ in range(10000):
            i = il[pc]; self.coverage[token].add(i['offset']); pc += 1
            op = i['op']; val = i.get('value')
            if op.startswith('ldc.i4'):
                stack.append(val if val is not None else (-1 if op.endswith('m1') else int(op.split('.')[-1])))
            elif op.startswith('ldarg'):
                stack.append(args[val if val is not None else int(op.split('.')[-1])])
            elif op.startswith('ldloc'):
                stack.append(locals_.get(val if val is not None else int(op.split('.')[-1])))
            elif op.startswith('stloc'):
                locals_[val if val is not None else int(op.split('.')[-1])] = stack.pop()
            elif op == 'ldnull': stack.append(None)
            elif op == 'ldstr': stack.append(i['operand'])
            elif op == 'dup': stack.append(stack[-1])
            elif op == 'pop': stack.pop()
            elif op in ('xor', 'mul', 'add', 'sub', 'rem.un'):
                b = stack.pop(); a = stack.pop()
                v = {'xor': lambda: a ^ b, 'mul': lambda: a*b, 'add': lambda: a+b, 'sub': lambda: a-b, 'rem.un': lambda: (a & MASK) % (b & MASK)}[op]()
                stack.append(v & MASK)
            elif op in ('conv.i4', 'conv.u4'): stack[-1] &= MASK
            elif op == 'conv.i': pass
            elif op == 'ldlen': stack.append(len(stack.pop()))
            elif op == 'newarr': stack.append([None]*stack.pop())
            elif op.startswith('stelem'):
                v = stack.pop(); n = stack.pop(); stack.pop()[n] = v
            elif op == 'ldelem.ref':
                n = stack.pop(); stack.append(stack.pop()[n])
            elif op == 'switch':
                n = stack.pop() & MASK
                if n < len(i['targets']): pc = index[i['targets'][n]]
            elif op in ('br', 'br.s', 'leave', 'leave.s'): pc = index[i['targets'][0]]
            elif op.startswith(('brtrue', 'brfalse')):
                v = bool(stack.pop())
                if v == op.startswith('brtrue'): pc = index[i['targets'][0]]
            elif op.startswith(('bge', 'blt', 'ble', 'bgt', 'beq', 'bne')):
                b = stack.pop(); a = stack.pop()
                cond = {'bge': a >= b, 'blt': a < b, 'ble': a <= b, 'bgt': a > b, 'beq': a == b, 'bne': a != b}[op[:3]]
                if cond: pc = index[i['targets'][0]]
            elif op in ('call', 'callvirt'):
                called = i['rawToken']
                if called in self.specs:
                    stack.append(self.decode(called, stack.pop()))
                elif called in self.methods:
                    cm = self.methods[called]; nargs = len(cm['parameters']); aa = stack[-nargs:] if nargs else []
                    if nargs: del stack[-nargs:]
                    stack.append(self.run(called, aa, trace))
                else:
                    name = i['operand']
                    if name == 'System.String::IsNullOrEmpty': stack.append(stack.pop() in (None, ''))
                    elif name == 'System.String::IsNullOrWhiteSpace':
                        v = stack.pop(); stack.append(v is None or not v.strip())
                    elif name == 'System.String::ToUpperInvariant': stack.append(stack.pop().upper())
                    elif name == 'System.String::Trim': stack.append(stack.pop().strip())
                    elif name == 'System.String::op_Equality':
                        b = stack.pop(); a = stack.pop(); stack.append(a == b)
                        if trace is not None: trace.append({'method': hex(token), 'offset': i['offset'], 'left': a, 'right': b, 'equal': a == b})
                    elif name == 'System.String::Split':
                        sep = stack.pop(); a = stack.pop(); assert sep == [95]; stack.append(a.split('_'))
                    else: raise RuntimeError('Call denied: '+name)
            elif op == 'ret': return stack.pop()
            elif op == 'nop': pass
            else: raise RuntimeError('Opcode denied: '+op)
        raise RuntimeError('Instruction budget exceeded')


def expected(model):
    if model in (None, ''): return ('unknown', 'unknown', 'unknown')
    s = model.upper(); p = s.split('_')
    gender = 'male' if s in ('PLAYER_ZERO', 'PLAYER_ONE', 'PLAYER_TWO', 'MP_M_SHOPKEEP_01') else ('male' if len(p)>=2 and p[1]=='M' else 'female' if len(p)>=2 and p[1]=='F' else 'unknown')
    age = {'PLAYER_ZERO': 'middle-aged', 'PLAYER_ONE': 'young', 'PLAYER_TWO': 'middle-aged', 'MP_M_SHOPKEEP_01': 'middle-aged'}.get(s)
    if age is None: age = {'Y':'young', 'M':'middle-aged', 'O':'old'}.get(p[2], 'unknown') if len(p)>=3 else 'unknown'
    archetype = {'PLAYER_ZERO': 'MICHAEL', 'PLAYER_ONE': 'FRANKLIN', 'PLAYER_TWO': 'TREVOR', 'MP_M_SHOPKEEP_01': 'SHOPKEEP'}.get(s)
    if archetype is None: archetype = (p[3].strip() or 'unknown') if len(p)>=4 and s.strip() else 'unknown'
    return gender, age, archetype


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('il'); parser.add_argument('output'); parser.add_argument('--bridge', action='store_true'); args=parser.parse_args()
    a=Audit(args.il, args.bridge); out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    selected = {'ActorContextProvider': None, 'ActorContext': None,
                'ActorHydrationCoordinator': None, 'ConversationHydrationCoordinator': None,
                'GeminiContextBuilder': {0x600118c, 0x600118d, 0x600118e, 0x600118f, 0x6001190, 0x6001192, 0x6001196, 0x60011a5},
                'ContextJsonSerializer': None, 'IntegrationManager': None,
                'NpcStateStore': None, 'NpcState': set(),
                'PedContinuityMemoryService': None, 'PedContinuityMemory': None,
                'InteropContextStore': None, 'WeaponContextProvider': {0x6001342},
                'DirectedInteractionManager': {0x60001ba},
                'PolicingRedefinedBridgeIntegration': {0x6000c21, 0x6000c24, 0x6000c30, 0x6000c37, 0x6000c38, 0x6000c4b, 0x6000c4d, 0x6000c51, 0x6000c52, 0x6000c53, 0x6000c61, 0x6000c62, 0x6000c63, 0x6000c65, 0x6000c66, 0x6000c78},
                'PolicingRedefinedPipeClient': {0x6000cc1, 0x6000cc6, 0x6000cc7, 0x6000cca, 0x6000ccb, 0x6000ccc, 0x6000ccd, 0x6000cce, 0x6000ccf, 0x6000cd0, 0x6000cd1},
                'PrDataExtractor': {0x60000ce, 0x60000d0, 0x60000d1, 0x60000d3, 0x60000f2, 0x6000105, 0x6000109, 0x600010c},
                'PrCalloutPedHydrator': {0x60000ae, 0x60000af, 0x60000b6, 0x60000be, 0x60000bf},
                'PrStateTracker': None, 'LspdfrCalloutBridgeStore': None,
                'LspdfrDynamicDisturbanceCallout': {0x6000053, 0x6000055, 0x6000057}}
    lines=['SHA256 '+a.j['dllSha256'], 'Scope: selected complete method bodies, field signatures and short call wrappers. Tokens are assembly-local.']
    for t in a.j['types']:
        short=t['name'].split('.')[-1]
        if short not in selected: continue
        lines.append('\nTYPE '+t['name'])
        for f in t['fields']:
            name=f['name'] if f['name'].isascii() else 'hidden'
            lines.append(f"FIELD {hex(f['token'])} {name} {json.dumps(f['type'],ensure_ascii=True)} constantHex={f['constant']}")
        for m in t['methods']:
            if selected[short] is not None and m['token'] not in selected[short] and len(m['il'])>12: continue
            name=m['name'] if m['name'].isascii() else 'hidden'
            signature=', '.join(m['parameters']).encode('unicode_escape').decode('ascii')
            returns=m['returns'].encode('unicode_escape').decode('ascii')
            lines.append(f"METHOD {hex(m['token'])} {name}({signature}) -> {returns}")
            for e in m.get('exceptionRegions', []):
                lines.append('  EXCEPTION '+json.dumps(e, sort_keys=True))
            constants={c['offset']:c for c in a.constants(m)}
            for i in m['il']:
                operand=i['operand']
                if any(ord(c)>127 for c in operand): operand=operand.split('::')[0]+'::hidden'
                if i['rawToken']: operand=hex(i['rawToken'])+' '+operand
                if i['value'] is not None: operand=str(i['value'])
                if i['targets']: operand=' -> '+','.join(f"IL_{x:04x}" for x in i['targets'])
                if i['offset'] in constants: operand+=' decoded='+json.dumps(constants[i['offset']]['string'],ensure_ascii=True)
                lines.append(f"  IL_{i['offset']:04x}: {i['op']} {operand}")
    rendered='\n'.join(line.rstrip() for line in lines).encode('ascii',errors='backslashreplace').decode('ascii')+'\n'
    (out/('prbridge-il.txt' if args.bridge else 'native-il.txt')).write_text(rendered,encoding='utf-8',newline='\n')
    if args.bridge:
        (out/'prbridge-provenance.json').write_text(json.dumps({'dllSha256':a.j['dllSha256'],'tableSha256':hashlib.sha256(a.table).hexdigest(),'assemblyRefs':a.j['assemblyRefs']},indent=2)+'\n',encoding='utf-8',newline='\n')
        return
    samples=[None,'',' ','PLAYER_ZERO','PLAYER_ONE','PLAYER_TWO','MP_M_SHOPKEEP_01','A_M_Y_BUSINESS_01','A_F_O_GENSTREET_01','MP_M_FREEMODE_01','MP_F_FREEMODE_01','IG_MICHAEL','U_M_Y_ZOMBIE_01','custom','custom_M_Y','custom_F_O_person','_F_M_','CUSTOM_FEMALE_Y_01','A__Y_TEST',' A_M_Y_TEST ','A_M_Y_','A_M_Y','A_M','A_F','_','__','___']
    samples += ['_'.join(p) for n in range(1,5) for p in itertools.product(['A','M','F','Y','O','','CUSTOM'], repeat=n)]
    result=[]
    for s in samples:
        trace=[]; g=a.run(0x60012ba,[s],trace); age=a.run(0x60012bb,[s],trace)
        archetype=a.run(0x60012bc,[s],[])
        assert (g,age,archetype)==expected(s),(s,g,age,archetype,expected(s))
        result.append({'model':s,'gender':g,'ageRange':age,'archetype':archetype})
    metadata={'dllSha256':a.j['dllSha256'],'tableSha256':hashlib.sha256(a.table).hexdigest(),'cases':len(result),'sampleRows':result[:27],'coverage':{hex(t):sorted(v) for t,v in a.coverage.items()},'scope':'Offline IL interpretation, ASCII input adapter; no game or native assembly execution.'}
    (out/'classifier-results.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'cases':len(result),'status':'passed','sha256':a.j['dllSha256']}))


if __name__=='__main__': main()
