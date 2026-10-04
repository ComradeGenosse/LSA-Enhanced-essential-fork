"""Reproduce the static evidence N1-N21 of the LSA Activities / Goal Execution investigation.

Research only. Reads the JSON that ActionNativeAudit emits for the pinned Essential DLL and
walks it with the action audit's own decoders (ilcore.py, cff.py, registrations.py,
commands.py from research/essential-action-completion-audit-20261003). Nothing here loads,
reflects over or executes a game assembly.

Usage:
    python activity_probe.py <essential-il.json> [--tools <action-native-tools dir>] [--out evidence.json]
"""
import argparse
import json
import os
import re
import sys

parser = argparse.ArgumentParser()
parser.add_argument('il')
parser.add_argument('--tools', default=os.path.dirname(os.path.abspath(__file__)))
parser.add_argument('--out', default=None)
opts = parser.parse_args()
sys.path.insert(0, opts.tools)

from ilcore import Module  # noqa: E402

mod = Module(opts.il)
MASK = 0xffffffff
H = lambda v: '0x%x' % v  # noqa: E731


# ---------------------------------------------------------------- helpers
def type_of(suffix):
    found = mod.type_named(suffix)
    assert found, suffix
    return found[0]


def field_token(type_suffix, name):
    t = type_of(type_suffix)
    for f in t['fields']:
        if f['name'] == name:
            return f['token']
    raise KeyError(type_suffix + '.' + name)


def method_tokens(type_suffix, name, params=None):
    out = []
    for t in mod.type_named(type_suffix):
        for m in t['methods']:
            if m['name'] == name and (params is None or m['parameters'] == params):
                out.append(m['token'])
    return out


def users(ftok):
    rows = {}
    for (m, off, op) in mod.field_users(ftok):
        rows.setdefault((m, op), []).append(off)
    return [{'method': H(m), 'name': mod.method_name(m), 'op': op, 'offsets': [H(o) for o in sorted(offs)]}
            for (m, op), offs in sorted(rows.items())]


def callers(tok):
    return [{'method': H(m), 'name': mod.method_name(m), 'offset': H(off), 'op': op} for (m, off, op) in mod.callers(tok)]


def strings(tok):
    return [s for _, s in mod.strings_in(tok)]


def methods_with_string(text):
    hits = []
    for tok in mod.methods:
        try:
            if any(text == s for s in strings(tok)):
                hits.append({'method': H(tok), 'name': mod.method_name(tok)})
        except Exception:
            pass
    return hits


def attrs(tok):
    return mod.methods[tok].get('attributes', '')


def public_methods(type_suffix):
    t = type_of(type_suffix)
    return sorted({m['name'] for m in t['methods'] if 'Public' in m.get('attributes', '') and m['name'].isascii()})


def props(type_suffix):
    return [p['name'] for p in type_of(type_suffix).get('properties', [])]


def ascii_fields(type_suffix):
    return [f['name'] for f in type_of(type_suffix)['fields'] if f['name'].isascii() and f['name'] != 'value__']


evidence = {'pins': {'essentialDllSha256': mod.j['sha256']}, 'findings': {}}


def record(key, fn):
    try:
        evidence['findings'][key] = fn()
    except Exception as error:  # keep going; the failure itself is evidence that the pin drifted
        evidence['findings'][key] = {'error': repr(error)}


# ---------------------------------------------------------------- N1 activity queue item flags
def n1():
    started = field_token('NpcActivityQueueItem', 'Started')
    completed = field_token('NpcActivityQueueItem', 'Completed')
    return {'Started': {'field': H(started), 'users': users(started)},
            'Completed': {'field': H(completed), 'users': users(completed)}}


# ---------------------------------------------------------------- N2 NpcState activity fields
def n2():
    out = {}
    for name in ('ActivityQueue', 'CurrentActivity', 'ActivityInProgress', 'HasActivityQueue'):
        tok = field_token('NpcState', name)
        out[name] = {'field': H(tok), 'users': users(tok)}
    return out


# ---------------------------------------------------------------- N3 destination fields + resolver
def n3():
    out = {}
    for name in ('WalkToDestination', 'DriveToDestination', 'HasDestination', 'DestinationPosition', 'DriveDestination'):
        tok = field_token('NpcState', name)
        out[name] = {'field': H(tok), 'writers': [u for u in users(tok) if u['op'] in ('stfld', 'stsfld')],
                     'readers': [u for u in users(tok) if u['op'] in ('ldfld', 'ldsfld', 'ldflda')]}
    resolve = method_tokens('DestinationResolver', 'TryResolve')
    out['DestinationResolver.TryResolve'] = {'methods': [H(t) for t in resolve], 'callers': [c for t in resolve for c in callers(t)]}
    return out


# ---------------------------------------------------------------- N4 TASK inventory
def n4():
    out = {}
    for native in ('TASK_FOLLOW_NAV_MESH_TO_COORD', 'TASK_VEHICLE_DRIVE_TO_COORD_LONGRANGE', 'TASK_VEHICLE_DRIVE_TO_COORD',
                   'TASK_GO_STRAIGHT_TO_COORD', 'TASK_VEHICLE_DRIVE_WANDER'):
        out[native] = methods_with_string(native)
    out['StartDrivingImplementation0x6000989'] = [s for s in strings(0x6000989) if s.startswith('TASK_')]
    return out


# ---------------------------------------------------------------- N5 TryExecute -> NotifyNpcActionExecuted
def n5():
    tryexec = method_tokens('NpcActionRegistry', 'TryExecute')[0]
    notify = method_tokens('IntegrationManager', 'NotifyNpcActionExecuted')[0]
    il = mod.methods[tryexec]['il']
    sites = []
    for n, ins in enumerate(il):
        tk = ins.get('token')
        if ins['op'] in ('call', 'callvirt') and tk is not None and (mod.specs[tk]['methodToken'] if tk in mod.specs else tk) == notify:
            window = [(H(x['offset']), x['op'], mod.field_name(x['token']) if x['op'] in ('ldfld', 'ldsfld') and x.get('token') else None)
                      for x in il[max(0, n - 6):n]]
            sites.append({'callOffset': H(ins['offset']), 'precedingLoads': [w for w in window if w[2]]})
    return {'TryExecute': H(tryexec), 'NotifyNpcActionExecuted': H(notify), 'callSites': sites, 'notifyCallers': callers(notify)}


# ---------------------------------------------------------------- N6 bridge routing
def n6():
    return {'HandleBridgeTextMessage0x6001517': {'strings': [s for s in strings(0x6001517) if s.islower() or '_' in s][:40],
                                                  'callees': sorted({mod.method_name(t) for _, _, t in mod.callees(0x6001517)})},
            'predicate0x6001523': {'callers': callers(0x6001523), 'strings': strings(0x6001523)}}


# ---------------------------------------------------------------- N7 queue processing
def n7():
    process = method_tokens('NpcActionQueue', 'ProcessPendingActions')
    return {'ProcessPendingActions': [H(t) for t in process], 'processCallers': [c for t in process for c in callers(t)],
            'queueProcessor0x6000214': {'specialCaseStrings': [s for s in strings(0x6000214) if s in (
                'takecover', 'resumeactivity', 'continueactivity', 'returntoactivity')],
                'callees': sorted({mod.method_name(t) for _, _, t in mod.callees(0x6000214)})},
            'statefulDuplicateSet0x600021a': strings(0x600021a),
            'targetRelativeSet0x6000216': strings(0x6000216),
            'dispatch0x6000218': sorted({mod.method_name(t) for _, _, t in mod.callees(0x6000218)})}


# ---------------------------------------------------------------- N8 shared executor
def n8():
    return {'executor0x60002f7': {'attributes': attrs(0x60002f7), 'sectionStrings': sorted(s for s in strings(0x60002f7) if re.match(r'^\d\d\.', s)),
                                  'callees': [mod.method_name(t) for _, _, t in mod.callees(0x60002f7)]},
            'deferredExecutor0x60002e4': {'attributes': attrs(0x60002e4), 'callees': sorted({mod.method_name(t) for _, _, t in mod.callees(0x60002e4)})},
            'acquireExclusiveControl0x60002ea': sorted({mod.method_name(t) for _, _, t in mod.callees(0x60002ea)})}


# ---------------------------------------------------------------- N9 executor command map
def n9():
    import commands
    commands.executor_delegate_fixup(mod)
    out = []
    t = type_of('NpcActions')
    for m in t['methods']:
        if 'Public' not in m.get('attributes', '') or not m['name'].isascii() or not m['parameters'] or m['parameters'][0] != 'Rage.Ped':
            continue
        try:
            calls = commands.executor_calls(mod, m['token'])
        except Exception:
            calls = []
        direct = any(tk == 0x60002f7 for _, _, tk in mod.callees(m['token']))
        out.append({'wrapper': m['name'], 'params': m['parameters'], 'token': H(m['token']),
                    'deferred': [{'command': c['command'], 'policy': c['policy']} for c in calls], 'immediateDirect': direct})
    return {'wrappers': out, 'immediateExecutorCallers': callers(0x60002f7)}


# ---------------------------------------------------------------- N10 / N18 UseScenario
def n10_n18():
    pub = {name: method_tokens('NpcActions', name) for name in ('UseScenario', 'UseScenarioAtPosition')}
    return {'public': {k: [{'token': H(t), 'params': mod.methods[t]['parameters'], 'callees': [mod.method_name(c) for _, _, c in mod.callees(t)]} for t in v] for k, v in pub.items()},
            'impl0x6000254': {'strings': strings(0x6000254), 'callees': [mod.method_name(c) for _, _, c in mod.callees(0x6000254)],
                              'usesExecutor': any(c in (0x60002f7, 0x60002e4) for _, _, c in mod.callees(0x6000254))},
            'getPreparedState0x60002fa': [mod.method_name(c) for _, _, c in mod.callees(0x60002fa)],
            'initialTakeover0x60002fe': {'strings': strings(0x60002fe), 'callees': sorted({mod.method_name(c) for _, _, c in mod.callees(0x60002fe)})},
            'partialModeClear0x600031c': [mod.method_name(c) for _, _, c in mod.callees(0x600031c)],
            'stopAndFaceClear0x6000341.writes': sorted({mod.field_name(i['token']) for i in mod.methods[0x6000341]['il'] if i['op'] == 'stfld'}),
            'vehicleExitDeferral0x60002fc': {'strings': strings(0x60002fc), 'callees': sorted({mod.method_name(c) for _, _, c in mod.callees(0x60002fc)})},
            'clearHelpersWrites': {name: sorted({mod.field_name(i['token']).split('::')[-1] for i in mod.methods[method_tokens('NpcActions', name)[0]]['il'] if i['op'] == 'stfld'})
                                   for name in ('ClearComplianceFlags', 'ClearHostileFlags', 'ClearMovementActionFlags', 'ClearExplicitVehicleEnterFlags', 'ClearFollowFlags', 'ClearVehicleIntentFlagsOnly')},
            'impl0x6000255': {'strings': strings(0x6000255), 'callees': [mod.method_name(c) for _, _, c in mod.callees(0x6000255)],
                              'usesExecutor': any(c in (0x60002f7, 0x60002e4) for _, _, c in mod.callees(0x6000255))},
            'applyScenarioFriendlyBrain0x6000258': strings(0x6000258),
            'applyControlledBrainIfChanged0x6000309': {'strings': strings(0x6000309), 'callers': callers(0x6000309)}}


# ---------------------------------------------------------------- N11 ResumeActivityBehavior
def n11():
    t = type_of('ResumeActivityBehavior')
    import struct
    def literal(raw):
        b = bytes.fromhex(raw)
        return {'int32': struct.unpack('<i', b)[0], 'float32': round(struct.unpack('<f', b)[0], 4)} if len(b) == 4 else raw
    out = {'publicMethods': public_methods('ResumeActivityBehavior'), 'fields': [H(f['token']) for f in t['fields']],
           'literalConstants': [literal(f['constant']) for f in t['fields'] if f.get('constant')],
           'phaseEnum': [f['name'] for nested in mod.types if nested['name'].startswith(t['name'] + '+') and nested.get('baseType') == 'System.Enum'
                         for f in nested['fields'] if f['name'] != 'value__'],
           'strings': {}}
    keep = re.compile(r'^(TASK_|SET_|WORLD_|PROP_|GET_|IS_)|Remembered|activity|Activity|timeout|Timeout')
    for m in t['methods']:
        s = [x for x in strings(m['token']) if keep.search(x)]
        if s:
            out['strings'][H(m['token'])] = s[:30]
    return out


# ---------------------------------------------------------------- N12 approach completion
def n12():
    wanted = ('immediate arrival', 'no-progress arrival', 'task ended near target', 'no longer assigned', 'npcApproachCompleted', 'npcApproachFailed')
    hits = []
    for tok in mod.methods:
        try:
            for s in strings(tok):
                if any(w in s for w in wanted):
                    hits.append({'method': H(tok), 'name': mod.method_name(tok), 'string': s})
        except Exception:
            pass
    return {'strings': hits, 'BuildApproachResult0x60014fc': strings(0x60014fc)[:20]}


# ---------------------------------------------------------------- N13 far / dead release
def n13():
    il = mod.methods[0x6000311]['il'] if 0x6000311 in mod.methods else []
    consts = sorted({i['value'] for i in il if i['op'] == 'ldc.r4' and i.get('value') is not None})
    return {'farReleaseCheck0x6000311': {'floatConstants': consts, 'callers': callers(0x6000311)},
            'farRelease0x6000313': {'callees': sorted({mod.method_name(t) for _, _, t in mod.callees(0x6000313)})},
            'controlIntent0x60002dc': sorted({mod.field_name(i['token']) for i in mod.methods[0x60002dc]['il'] if i['op'] == 'ldfld' and i.get('token')}),
            'deadRelease0x60002c6': {'callers': callers(0x60002c6)}}


# ---------------------------------------------------------------- N14 continuity memory
def n14():
    return {'PedContinuityMemoryService.public': public_methods('PedContinuityMemoryService'),
            'PedContinuityMemory': ascii_fields('PedContinuityMemory'),
            'RecentVehicleMemory': ascii_fields('RecentVehicleMemory'),
            'InteractionActivityMemory': ascii_fields('InteractionActivityMemory'),
            'serviceIntegerConstants': {H(m['token']): sorted({i['value'] for i in m['il'] if i['op'] == 'ldc.i4' and i.get('value') is not None and 1000 <= abs(i['value']) <= 600000})
                                        for m in type_of('PedContinuityMemoryService')['methods']
                                        if any(i['op'] == 'ldc.i4' and i.get('value') is not None and 1000 <= abs(i['value']) <= 600000 for i in m['il'])}}


# ---------------------------------------------------------------- N15 location registry
def n15():
    out = {}
    for t in mod.types:
        if not t['name'].startswith('LosSantosAlive.Locations.Registries.'):
            continue
        text = []
        for m in t['methods']:
            try:
                text += strings(m['token'])
            except Exception:
                pass
        out[t['name'].split('.')[-1]] = {'decodedStrings': len(text), 'firstLocationName': next((s for s in text if re.match(r"^[A-Z][A-Za-z0-9'&.\- ]{2,60}$", s)), None),
                                         'mentionsLtdDavis': 'LTD Davis' in text}
    return out


# ---------------------------------------------------------------- N16 default items
def n16():
    reg = method_tokens('NpcItemStore', 'RegisterDefaults')
    names = ('CannedGoods', 'Donut', 'BreakfastSnack', 'Snack', 'Soda', 'Beer', 'Coffee', 'Liquor', 'EnergyDrink', 'Water', 'Cigarette')
    found = set()
    for t in reg:
        stack = [t]
        seen = set()
        while stack:  # registration helpers may be split across private methods
            cur = stack.pop()
            if cur in seen or cur not in mod.methods:
                continue
            seen.add(cur)
            for s in strings(cur):
                if s in names:
                    found.add(s)
            stack.extend(c for _, _, c in mod.callees(cur) if mod.method_type.get(c) is mod.method_type.get(t))
    return {'RegisterDefaults': [H(t) for t in reg], 'itemNames': sorted(found), 'cigarettePresent': 'Cigarette' in found}


# ---------------------------------------------------------------- N17 modifier dispatch
def n17():
    apply_tok = method_tokens('IntegrationManager', 'ApplyActionStateModifiers')[0]
    il = mod.methods[apply_tok]['il']
    isinst = [H(i['offset']) for i in il if i['op'] == 'isinst']
    lists = sorted({mod.field_name(i['token']) + ' ' + H(i['token']) for i in il if i['op'] == 'ldsfld'})
    phase = type_of('ActionStateModifierPhase')
    return {'ApplyActionStateModifiers': H(apply_tok), 'isinstOffsets': isinst, 'integrationList': lists,
            'callers': callers(apply_tok),
            'NotifyNpcActionExecuted.callers': callers(method_tokens('IntegrationManager', 'NotifyNpcActionExecuted')[0]),
            'IActionStateModifier.attributes': type_of('IActionStateModifier')['attributes'],
            'ActionStateModifierPhase': {f['name']: f.get('constant') for f in phase['fields'] if f['name'] != 'value__'}}


# ---------------------------------------------------------------- N19 control-change notifications
def n19():
    return {'NotifyPedControlChanged.callers': callers(method_tokens('IntegrationManager', 'NotifyPedControlChanged')[0])}


# ---------------------------------------------------------------- N20 locations
def n20():
    return {'LocationResolver.public': public_methods('LocationResolver'), 'LocationDefinition': props('LocationDefinition'),
            'ActivityPoint': props('ActivityPoint'), 'DestinationResolver.public': public_methods('DestinationResolver')}


# ---------------------------------------------------------------- N21 registry + handler contract
def n21():
    handler = type_of('NpcActionHandler')
    invoke = [m for m in handler['methods'] if m['name'] == 'Invoke'][0]
    return {'NpcActionRegistry.public': public_methods('NpcActionRegistry'),
            'NpcActionHandler.Invoke': {'params': invoke['parameters'], 'returns': invoke['returns']},
            'NpcActionContext': ascii_fields('NpcActionContext'),
            'NpcActions.publicHelpers': [n for n in public_methods('NpcActions') if n in (
                'PreparePed', 'SetControlledBrain', 'ClearFollowFlags', 'ClearMovementActionFlags', 'ClearVehicleIntentFlagsOnly',
                'ClearAllVehicleFlags', 'ClearComplianceFlags', 'HasExclusiveControl', 'GetExclusiveControlReason')],
            'executor0x60002f7.attributes': attrs(0x60002f7)}


for key, fn in [('N1', n1), ('N2', n2), ('N3', n3), ('N4', n4), ('N5', n5), ('N6', n6), ('N7', n7), ('N8', n8), ('N9', n9),
                ('N10_N18', n10_n18), ('N11', n11), ('N12', n12), ('N13', n13), ('N14', n14), ('N15', n15), ('N16', n16),
                ('N17', n17), ('N19', n19), ('N20', n20), ('N21', n21)]:
    record(key, fn)

text = json.dumps(evidence, indent=1, ensure_ascii=False)
if opts.out:
    with open(opts.out, 'w', encoding='utf-8') as handle:
        handle.write(text + '\n')
else:
    print(text)
