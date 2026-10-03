"""Classify registry handler bodies: what they call and what their boolean return proves."""
from cff import Deobfuscator, COND, ldc


def classify_handler(mod, token):
    d = Deobfuscator(mod, token)
    il, idx = d.il, d.idx
    order = d.real_order()
    calls, rets = [], []
    reads = []
    for off in order:
        ins = il[idx[off]]
        op, tk = ins['op'], ins.get('token')
        if op in ('call', 'callvirt', 'newobj') and tk is not None and not mod.is_string_decoder_call(ins):
            target = mod.specs[tk]['methodToken'] if tk in mod.specs else tk
            w = mod.wrapper_target(target)
            calls.append(w if w and w != 'NOP' else mod.method_name(target))
        if op == 'ldfld' and tk is not None and 'NpcActionContext::' in mod.field_name(tk):
            reads.append(mod.field_name(tk).split('::')[-1])
    for src, succ in d.edges.items():
        for label, dst in succ:
            if dst == 'EXIT:ret' and isinstance(src, int):
                prev_n = idx[src] - 1
                prev = il[prev_n] if prev_n >= 0 else None
                c = ldc(prev) if prev is not None else None
                rets.append('true' if c == 1 else 'false' if c == 0 else 'computed')
    kinds = sorted(set(rets))
    has_cond = any(il[idx[o]]['op'] in COND for o in order)
    return {
        'handler': hex(token),
        'calls': calls,
        'contextFields': sorted(set(reads)),
        'returns': kinds,
        'branches': has_cond,
        'unconditionalTrue': kinds == ['true'] and not has_cond,
    }
