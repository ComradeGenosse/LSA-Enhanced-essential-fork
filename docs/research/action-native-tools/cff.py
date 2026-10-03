"""Resolve the obfuscator's control-flow flattening into a real control-flow listing.

The pinned DLL replaces structured branches with a state machine:

    ldc.i4 A ; [head:] ldc.i4 B ; xor ; dup ; stloc S ; ldc.i4 K ; rem.un ; switch T[...]

Each block ends by pushing a constant (or `ldloc S * M ^ X`) and jumping back to `head`.
State values are concrete, so a small abstract interpreter (known ints vs opaque values,
exact per-instruction stack effects from the extractor) can follow them deterministically.
Real conditions (opaque values) fork both ways. Pass 1 marks every instruction whose values
only feed a dispatcher as junk; pass 2 records edges between the remaining real instructions.
This is a reading aid with explicit limits: unusual opaque predicates are reported, not guessed.
"""
from ilcore import MASK, nice

COND = {'brtrue', 'brtrue.s', 'brfalse', 'brfalse.s', 'beq', 'beq.s', 'bne.un', 'bne.un.s', 'blt', 'blt.s', 'blt.un',
        'blt.un.s', 'ble', 'ble.s', 'ble.un', 'ble.un.s', 'bgt', 'bgt.s', 'bgt.un', 'bgt.un.s', 'bge', 'bge.s', 'bge.un', 'bge.un.s'}
UNCOND = {'br', 'br.s'}
LEAVE = {'leave', 'leave.s'}
TERM = {'ret', 'throw', 'rethrow', 'endfinally', 'endfilter'}


def ldc(ins):
    op = ins['op']
    if not op.startswith('ldc.i4'):
        return None
    if op == 'ldc.i4.m1':
        return MASK
    if op in ('ldc.i4', 'ldc.i4.s'):
        return ins['value'] & MASK
    return int(op.split('.')[-1])


def local_index(ins):
    op = ins['op']
    if ins.get('value') is not None and (op.startswith('ldloc') or op.startswith('stloc')) and not op[-1].isdigit():
        return ins['value']
    return int(op.split('.')[-1])


class Val:
    __slots__ = ('const', 'producers')

    def __init__(self, const=None, producers=()):
        self.const = const
        self.producers = frozenset(producers)


def find_dispatchers(il):
    out = {}
    for n, ins in enumerate(il):
        if ins['op'] != 'switch' or n < 6:
            continue
        a = il[n - 6:n]
        if (ldc(a[0]) is not None and a[1]['op'] == 'xor' and a[2]['op'] == 'dup' and a[3]['op'].startswith('stloc')
                and ldc(a[4]) is not None and a[5]['op'] == 'rem.un'):
            seq = [x['offset'] for x in a] + [ins['offset']]
            nxt = il[n + 1] if n + 1 < len(il) else None
            if nxt is not None and nxt['op'] in UNCOND:
                seq.append(nxt['offset'])
            out[a[0]['offset']] = dict(B=ldc(a[0]), S=local_index(a[3]), K=ldc(a[4]), targets=ins['targets'], seq=seq,
                                       xor=a[1]['offset'])
    return out


class Deobfuscator:
    def __init__(self, mod, token, max_steps=200000):
        self.mod = mod
        self.token = token
        self.m = mod.methods[token]
        self.il = self.m['il']
        self.idx = {ins['offset']: n for n, ins in enumerate(self.il)}
        self.disp = find_dispatchers(self.il)
        self.max_steps = max_steps
        self.warnings = []
        self.junk = set()
        for d in self.disp.values():
            self.junk.update(d['seq'])
        self._pass(record=False)
        self.edges = {}
        self.entry_targets = set()
        self._pass(record=True)

    def _starts(self):
        starts = [(0, ())]
        for r in self.m.get('exceptionRegions', []):
            stack = (Val(None, ()),) if r['kind'] in ('Catch', 'Filter') else ()
            starts.append((r['handlerOffset'], stack))
        return starts

    def _mark_junk_value(self, v):
        todo = list(v.producers)
        while todo:
            p = todo.pop()
            if p in self.junk:
                continue
            self.junk.add(p)
            todo.extend(self.inputs.get(p, ()))

    def _pass(self, record):
        il, idx = self.il, self.idx
        if not record:
            self.inputs = {}
            self.dup_outputs = {}
        visited = set()
        work = []
        for off, stack in self._starts():
            work.append((off, stack, {}, 'ENTRY' if off == 0 else f'HANDLER@{off:04x}', None))
        steps = 0
        while work:
            off, stack, locs, last, label = work.pop()
            while True:
                steps += 1
                if steps > self.max_steps:
                    self.warnings.append('step budget exceeded')
                    return
                key = (off, tuple(v.const for v in stack), tuple(sorted((k, v.const) for k, v in locs.items() if v.const is not None)))
                if not (record and off in self.junk):
                    if key in visited:
                        if record:
                            self.edges.setdefault(last, set()).add((label, off))
                        break
                    visited.add(key)
                n = idx[off]
                ins = il[n]
                op = ins['op']
                real = record and off not in self.junk
                if real:
                    self.edges.setdefault(last, set()).add((label, off))
                    last, label = off, None
                # dispatcher head reached with a known incoming value
                if off in self.disp:
                    d = self.disp[off]
                    incoming = stack[-1] if stack else None
                    if incoming is None or incoming.const is None:
                        self.warnings.append(f'unknown state at head IL_{off:04x}')
                        break
                    if not record:
                        self._mark_junk_value(incoming)
                    state = (incoming.const ^ d['B']) & MASK
                    stack = stack[:-1]
                    locs = dict(locs)
                    locs[d['S']] = Val(state, (d['xor'],))
                    target = d['targets'][state % d['K']]
                    off = target
                    continue
                pops, pushes = ins['pops'], ins['pushes']
                if len(stack) < pops:
                    self.warnings.append(f'stack underflow at IL_{off:04x}')
                    break
                args = stack[len(stack) - pops:] if pops else ()
                stack = stack[:len(stack) - pops] if pops else stack
                if not record:
                    self.inputs.setdefault(off, set()).update(p for a in args for p in a.producers)
                out = []
                c = ldc(ins)
                if c is not None:
                    out = [Val(c, (off,))]
                elif op.startswith('ldloc'):
                    li = local_index(ins)
                    v = locs.get(li)
                    out = [Val(v.const if v else None, (off,))]
                elif op.startswith('stloc'):
                    li = local_index(ins)
                    locs = dict(locs)
                    locs[li] = Val(args[0].const, (off,))
                    if not record and args[0].const is not None and any(li == d['S'] for d in self.disp.values()):
                        self._mark_junk_value(args[0])
                        self.junk.add(off)
                elif op == 'dup':
                    out = [Val(args[0].const, (off,)), Val(args[0].const, (off,))]
                elif op == 'pop':
                    if not record and args[0].const is not None:
                        self._mark_junk_value(args[0])
                        self.junk.add(off)
                elif op in ('xor', 'mul', 'add', 'sub', 'and', 'or', 'rem.un', 'shl', 'shr.un'):
                    a, b = args
                    if a.const is not None and b.const is not None:
                        r = {'xor': a.const ^ b.const, 'mul': a.const * b.const, 'add': a.const + b.const,
                             'sub': a.const - b.const, 'and': a.const & b.const, 'or': a.const | b.const,
                             'rem.un': (a.const % b.const) if b.const else 0, 'shl': a.const << (b.const & 31),
                             'shr.un': a.const >> (b.const & 31)}[op] & MASK
                        out = [Val(r, (off,))]
                    else:
                        out = [Val(None, (off,))]
                else:
                    out = [Val(None, (off,)) for _ in range(pushes)]
                if len(out) != pushes:
                    out = (out + [Val(None, (off,))] * pushes)[:pushes]
                stack = stack + tuple(out)
                if op in UNCOND:
                    if not record:
                        self.junk.add(off)
                    off = ins['targets'][0]
                    continue
                if op in LEAVE:
                    if not record:
                        self.junk.add(off)
                    stack = ()
                    off = ins['targets'][0]
                    continue
                if op == 'nop':
                    if not record:
                        self.junk.add(off)
                    off = il[n + 1]['offset']
                    continue
                if op in COND:
                    known = all(a.const is not None for a in args)
                    tgt = ins['targets'][0]
                    fall = il[n + 1]['offset']
                    if known:
                        if not record:
                            self.junk.add(off)
                            for a in args:
                                self._mark_junk_value(a)
                        taken = self._eval(op, [a.const for a in args])
                        off = tgt if taken else fall
                        continue
                    work.append((tgt, stack, locs, last, f'{off:04x}:T' if real else label))
                    off, label = fall, (f'{off:04x}:F' if real else label)
                    continue
                if op == 'switch':
                    for t in ins['targets']:
                        work.append((t, stack, locs, last, f'{off:04x}:case' if real else label))
                    off = il[n + 1]['offset']
                    label = f'{off:04x}:default' if real else label
                    continue
                if op in TERM:
                    if record:
                        self.edges.setdefault(off if real else last, set()).add((label if not real else None, 'EXIT:' + op))
                    break
                off = il[n + 1]['offset']

    @staticmethod
    def _eval(op, vals):
        base = op.split('.')[0]
        if base in ('brtrue',):
            return vals[0] != 0
        if base in ('brfalse',):
            return vals[0] == 0
        a, b = vals
        sa = a - (1 << 32) if a & 0x80000000 else a
        sb = b - (1 << 32) if b & 0x80000000 else b
        un = '.un' in op
        x, y = (a, b) if un else (sa, sb)
        return {'beq': a == b, 'bne': a != b, 'blt': x < y, 'ble': x <= y, 'bgt': x > y, 'bge': x >= y}[base]

    def real_order(self):
        order, seen = [], set()
        stack = ['ENTRY'] + [k for k in self.edges if isinstance(k, str) and k.startswith('HANDLER')]
        while stack:
            k = stack.pop(0)
            for _, dst in sorted(self.edges.get(k, ()), key=lambda e: (str(e[0]), str(e[1]))):
                if isinstance(dst, int) and dst not in seen:
                    seen.add(dst)
                    order.append(dst)
                    stack.insert(0, dst)
        return order

    def render(self):
        mod, il, idx = self.mod, self.il, self.idx
        lines = [f"DEOBFUSCATED {hex(self.token)} {mod.method_name(self.token)}({nice(', '.join(self.m['parameters']))}) -> "
                 f"{nice(self.m['returns'])}  dispatchers={len(self.disp)} junk={len(self.junk)}/{len(il)}"]
        for r in self.m.get('exceptionRegions', []):
            lines.append(f"  REGION {r['kind']} try IL_{r['tryOffset']:04x}+{r['tryLength']} handler IL_{r['handlerOffset']:04x}+{r['handlerLength']} {r.get('catchType') or ''}")
        for w in sorted(set(self.warnings)):
            lines.append('  WARNING ' + w)
        order = self.real_order()
        for k in ['ENTRY'] + [k for k in self.edges if isinstance(k, str) and k.startswith('HANDLER')]:
            succ = sorted(self.edges.get(k, ()), key=lambda e: (str(e[0]), str(e[1])))
            lines.append(f"  {k} -> " + ', '.join(self._fmt_edge(e) for e in succ))
        for pos, off in enumerate(order):
            ins = il[idx[off]]
            text = self._operand(idx[off])
            succ = sorted(self.edges.get(off, ()), key=lambda e: (str(e[0]), str(e[1])))
            nxt = order[pos + 1] if pos + 1 < len(order) else None
            simple = len(succ) == 1 and succ[0][0] is None and succ[0][1] == nxt
            line = f"  IL_{off:04x}: {ins['op']} {text}".rstrip()
            if not simple:
                line += '    => ' + ', '.join(self._fmt_edge(e) for e in succ)
            lines.append(line)
        return '\n'.join(lines)

    @staticmethod
    def _fmt_edge(e):
        label, dst = e
        d = dst if isinstance(dst, str) else f'IL_{dst:04x}'
        return f'[{label}] {d}' if label else d

    def _operand(self, n):
        mod, il = self.mod, self.il
        ins = il[n]
        op, tk = ins['op'], ins.get('token')
        if mod.is_string_decoder_call(ins):
            return 'STRING ' + repr(mod.decode_string(tk, il[n - 1]['value'] & MASK))
        if op in ('call', 'callvirt', 'newobj', 'ldftn', 'ldvirtftn') and tk is not None:
            target = mod.specs[tk]['methodToken'] if tk in mod.specs else tk
            w = mod.wrapper_target(target)
            return f'{mod.method_name(tk)}' + (f'  [=> {w}]' if w else '')
        if op in ('ldfld', 'stfld', 'ldsfld', 'stsfld', 'ldflda', 'ldsflda') and tk is not None:
            return f'{mod.field_name(tk)}'
        if tk is not None:
            return nice(str(ins.get('operand')))
        if op == 'ldstr':
            return repr(ins.get('operand'))
        if ins.get('value') is not None and not op.startswith(('ldloc', 'stloc', 'ldarg', 'starg')):
            return str(ins['value'])
        if ins.get('value') is not None:
            return str(ins['value'])
        return ''


def deobfuscate(mod, token):
    return Deobfuscator(mod, token).render()
