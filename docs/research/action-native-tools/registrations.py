"""Recover NpcActionRegistry.Register(canonical, aliases, handler) calls from registrar IL.

Walks the deobfuscated real control flow (cff.Deobfuscator) with a tiny symbolic stack that
understands decoded strings, string arrays / List<string> initializers, cached lambda fields and
ldftn delegate construction. Delegate caches (`<>9__N_M`) are treated as initially null, which is
exactly the first-registration path. Unknown values stay unknown rather than guessed.
"""
from cff import Deobfuscator, COND, ldc, local_index
from ilcore import MASK, nice

REGISTER = 'LosSantosAlive.NPC.Actions.NpcActionRegistry::Register'


class Sym:
    def __init__(self, kind, value=None):
        self.kind = kind
        self.value = value

    def __repr__(self):
        return f'{self.kind}:{self.value!r}'


def walk(mod, token, max_steps=20000, args=None, inline=None, found=None, calls=None):
    """Follow real edges from ENTRY; resolved branches take one edge, opaque ones fork.

    `inline` is a set of method tokens whose calls are followed with the symbolic arguments.
    """
    d = Deobfuscator(mod, token)
    d.sym_args = args or []
    d.inline = inline or set()
    found = [] if found is None else found
    calls = [] if calls is None else calls
    entry = [e[1] for e in d.edges.get('ENTRY', ()) if isinstance(e[1], int)]
    work = [(off, [], {}) for off in entry]
    seen = set()
    steps = 0
    while work and steps < max_steps:
        off, stack, locs = work.pop()
        while isinstance(off, int) and steps < max_steps:
            steps += 1
            key = (off, len(stack), tuple(s.kind for s in stack[-3:]))
            if key in seen:
                break
            seen.add(key)
            branch = step(mod, d, off, stack, locs, found, calls)
            succ = sorted(d.edges.get(off, ()), key=lambda e: (str(e[0]), str(e[1])))
            if branch is not None:
                succ = [e for e in succ if e[0] and e[0].endswith(':T' if branch else ':F')]
            if not succ:
                break
            for lab, dst in succ[1:]:
                work.append((dst, list(stack), dict(locs)))
            off = succ[0][1]
    return found, calls


def step(mod, d, off, stack, locs, found, calls):
    """Execute one real instruction symbolically. Returns True/False for a resolved conditional."""
    il, idx = d.il, d.idx
    n = idx[off]
    ins = il[n]
    op, tk = ins['op'], ins.get('token')
    pops, pushes = ins['pops'], ins['pushes']

    def pop(k=1):
        out = []
        for _ in range(k):
            out.append(stack.pop() if stack else Sym('unk', 'underflow'))
        return list(reversed(out))

    c = ldc(ins)
    if c is not None:
        stack.append(Sym('int', c))
        return None
    if op == 'ldstr':
        stack.append(Sym('str', ins['operand']))
        return None
    if mod.is_string_decoder_call(ins):
        arg = pop()[0]
        stack.append(Sym('str', mod.decode_string(tk, arg.value & MASK)) if arg.kind == 'int' else Sym('unk', 'string'))
        return None
    if op == 'ldnull':
        stack.append(Sym('null'))
        return None
    if op == 'newarr':
        size = pop()[0]
        stack.append(Sym('arr', [None] * (size.value if size.kind == 'int' else 0)))
        return None
    if op == 'dup':
        v = pop()[0]
        stack.extend([v, v])
        return None
    if op == 'pop':
        pop()
        return None
    if op.startswith('stelem'):
        arr, i, val = pop(3)
        if arr.kind == 'arr' and i.kind == 'int' and i.value < len(arr.value):
            arr.value[i.value] = val.value if val.kind == 'str' else repr(val)
        return None
    if op == 'ldsfld':
        name = mod.field_name(tk)
        stack.append(Sym('null') if '<>9__' in name else Sym('unk', 'static:' + name))
        return None
    if op == 'stsfld':
        pop()
        return None
    if op == 'ldftn':
        stack.append(Sym('fn', tk))
        return None
    if op.startswith('ldloc'):
        stack.append(locs.get(local_index(ins), Sym('unk', 'local')))
        return None
    if op.startswith('ldarg') and not op.startswith('ldarga'):
        i = ins['value'] if ins.get('value') is not None and not op[-1].isdigit() else int(op.split('.')[-1])
        args = getattr(d, 'sym_args', [])
        stack.append(args[i] if i < len(args) else Sym('unk', op))
        return None
    if op.startswith('stloc'):
        locs[local_index(ins)] = pop()[0]
        return None
    if op in ('brtrue', 'brtrue.s', 'brfalse', 'brfalse.s'):
        v = pop()[0]
        if v.kind == 'null':
            truth = False
        elif v.kind in ('delegate', 'fn', 'arr', 'str'):
            truth = True
        else:
            return None
        return truth if op.startswith('brtrue') else not truth
    if op in ('newobj', 'call', 'callvirt'):
        target = mod.specs[tk]['methodToken'] if tk in mod.specs else tk
        name = mod.method_name(target)
        args = pop(pops)
        if op == 'newobj' and name.endswith('NpcActionHandler::.ctor'):
            fn = args[1] if len(args) > 1 else Sym('unk')
            stack.append(Sym('delegate', fn.value if fn.kind == 'fn' else None))
            return None
        if op == 'newobj' and 'List`1<String>::.ctor' in name:
            stack.append(Sym('arr', []))
            return None
        if 'List`1<String>::Add' in name and args and args[0].kind == 'arr':
            args[0].value.append(args[1].value if args[1].kind == 'str' else repr(args[1]))
            return None
        if target in getattr(d, 'inline', ()):
            walk(mod, target, args=list(args), inline=d.inline, found=found, calls=calls)
            for _ in range(pushes):
                stack.append(Sym('unk', 'ret:' + name))
            return None
        if name == REGISTER:
            canon, aliases, handler = args
            found.append({
                'site': f'{hex(d.token)}@IL_{off:04x}',
                'canonical': canon.value if canon.kind == 'str' else repr(canon),
                'aliases': list(aliases.value) if aliases.kind == 'arr' else ([] if aliases.kind == 'null' else repr(aliases)),
                'handler': handler.value if handler.kind == 'delegate' else None,
            })
            return None
        calls.append((off, name))
        for _ in range(pushes):
            stack.append(Sym('unk', 'ret:' + name))
        return None
    # generic
    pop(pops)
    for _ in range(pushes):
        stack.append(Sym('unk', op))
    return None


def registrar_methods(mod, type_suffix):
    """RegisterActions plus same-type helpers it calls (recursively), in first-call order."""
    types = mod.type_named(type_suffix)
    assert types, type_suffix
    t = types[0]
    own = {m['token'] for m in t['methods']}
    start = next(m['token'] for m in t['methods'] if m['name'] == 'RegisterActions')
    order, todo = [], [start]
    while todo:
        tk = todo.pop(0)
        if tk in order:
            continue
        order.append(tk)
        d = Deobfuscator(mod, tk)
        for off in d.real_order():
            ins = d.il[d.idx[off]]
            if ins['op'] in ('call', 'callvirt') and ins.get('token') in own and ins['token'] not in order:
                todo.append(ins['token'])
    return order


def extract(mod, type_suffix):
    """Walk RegisterActions once, inlining every same-type helper with its symbolic arguments."""
    t = mod.type_named(type_suffix)[0]
    own = {m['token'] for m in t['methods']}
    start = next(m['token'] for m in t['methods'] if m['name'] == 'RegisterActions')
    found, _ = walk(mod, start, args=[Sym('unk', 'this')], inline=own - {start})
    return found
