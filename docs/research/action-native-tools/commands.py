"""Map NpcActions public wrappers to the shared command executor and its vehicle policy.

NpcActions::m0x60002e4(Ped, string command, policy, Action<Ped,NpcState> body) is the shared
executor (see report). The policy value controls what happens when the ped is in a vehicle
(closure m0x60003e2): 1/2 defer the body until a forced exit completes; 0/3 run immediately.
"""
from registrations import walk, Sym, step  # noqa: F401  (walk drives the symbolic stack)
from cff import Deobfuscator

EXECUTOR = 0x60002e4


def executor_calls(mod, token):
    """Return [{command, policy, body}] for executor calls reachable on the first-call path of `token`."""
    import registrations
    found = []
    original = registrations.step

    def recording(mod_, d, off, stack, locs, found_, calls):
        ins = d.il[d.idx[off]]
        tk = ins.get('token')
        target = (mod_.specs[tk]['methodToken'] if tk in mod_.specs else tk) if tk is not None else None
        if ins['op'] == 'call' and target == EXECUTOR:
            args = [stack.pop() if stack else Sym('unk') for _ in range(4)][::-1]
            found.append({
                'command': args[1].value if args[1].kind == 'str' else None,
                'policy': args[2].value if args[2].kind == 'int' else None,
                'body': hex(args[3].value) if args[3].kind == 'delegate' and args[3].value else None,
            })
            return None
        return original(mod_, d, off, stack, locs, found_, calls)

    registrations.step = recording
    try:
        registrations.walk(mod, token, args=[Sym('unk', 'arg')] * 4)
    finally:
        registrations.step = original
    unique = []
    for f in found:
        if f not in unique:
            unique.append(f)
    return unique


def executor_delegate_fixup(mod):
    """Patch registrations.step to treat Action`2 delegate construction like NpcActionHandler."""
    import registrations
    original = registrations.step

    def patched(mod_, d, off, stack, locs, found, calls):
        ins = d.il[d.idx[off]]
        tk = ins.get('token')
        if ins['op'] == 'newobj' and tk is not None:
            name = mod_.method_name(mod_.specs[tk]['methodToken'] if tk in mod_.specs else tk)
            if ('System.Action`2<Rage.Ped,LosSantosAlive.NPC.NpcState>::.ctor' in name or 'System.Action::.ctor' in name
                    or 'System.Threading.ThreadStart::.ctor' in name):
                fn = stack.pop() if stack else None
                if stack:
                    stack.pop()
                stack.append(Sym('delegate', fn.value if isinstance(fn, Sym) and fn.kind == 'fn' else None))
                return None
        return original(mod_, d, off, stack, locs, found, calls)
    registrations.step = patched
    globals()['step'] = patched
