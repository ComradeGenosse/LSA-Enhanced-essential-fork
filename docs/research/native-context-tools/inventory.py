"""Read-only cross references for audit scope; no DLL loading or game execution."""
import argparse
import json
from pathlib import Path
import re
from audit import Audit


def main():
    p = argparse.ArgumentParser()
    p.add_argument('native_il'); p.add_argument('output'); p.add_argument('--cdf-il'); p.add_argument('--bridge-il')
    args = p.parse_args(); a = Audit(args.native_il)
    fields = {f['token']: dict(f, declaringType=t['name']) for t in a.j['types'] for f in t['fields']}
    methods = a.methods
    def method(token):
        m = methods[token]
        return {'token': hex(token), 'type': m['declaringType'], 'name': m['name'] if m['name'].isascii() else 'hidden'}
    def refs(predicate):
        return [dict(method(t), offset=hex(i['offset']), op=i['op'], targetToken=hex(i['rawToken']), target=i['operand'])
                for t,m in methods.items() for i in m['il'] if i.get('rawToken') and predicate(i)]
    core = {t:f for t,f in fields.items() if f['declaringType']=='LosSantosAlive.Context.ActorContext' and f['name'] in ['PedId','PedModel','Gender','AgeRange','Archetype','ArchetypeDescription','ArchetypePerceivedDescription','RoleName','RoleContext']}
    guid = refs(lambda i: i['operand'].startswith('System.Guid::'))
    guid_wrappers = {int(r['token'],16) for r in guid}
    data = {
        'dllSha256': a.j['dllSha256'],
        'scope': 'All method bodies and field signatures in pinned Essential. Reflection/external providers remain outside this static negative-search scope.',
        'methodCount': len(methods), 'typeCount': len(a.j['types']),
        'coreFields': [{**f,'token':hex(t)} for t,f in core.items()],
        'coreWrites': refs(lambda i: i['op']=='stfld' and i['rawToken'] in core),
        'guidFields': [{**f,'token':hex(t)} for t,f in fields.items() if f['type']=='System.Guid'],
        'guidOperations': guid,
        'guidWrapperCallers': refs(lambda i:i['op'] in ('call','callvirt') and i['rawToken'] in guid_wrappers),
        'namedIdentityFields': [{**f,'token':hex(t)} for t,f in fields.items() if f['type']=='String' and f['name'].isascii() and re.search(r'(id|identity|key|guid|nonce)$',f['name'],re.I)],
        'archetypeReloadCallers': refs(lambda i:i['rawToken'] in [0x60012b5,0x600118c]),
        'contextUpdateConsumers': refs(lambda i:i['rawToken']==0x6001196),
    }
    if args.bridge_il:
        b = Audit(args.bridge_il, True)
        data['bridgeScope'] = {
            'dllSha256': b.j['dllSha256'],
            'types': [t['name'] for t in b.j['types']],
            'guidOperations': [{'token':hex(m['token']), 'type':m['declaringType'], 'offset':hex(i['offset']), 'target':i['operand']}
                               for m in b.methods.values() for i in m['il'] if i['operand'].startswith('System.Guid::')],
            'dictionaryFields': [{**f,'token':hex(f['token']), 'declaringType':t['name']}
                                 for t in b.j['types'] for f in t['fields'] if 'Dictionary' in f['type']],
        }
    Path(args.output).write_text(json.dumps(data,indent=2,ensure_ascii=True)+'\n',encoding='utf-8',newline='\n')
    if args.cdf_il:
        j = json.loads(Path(args.cdf_il).read_text(encoding='utf-8-sig'))
        assert j['dllSha256']=='d0a81554ff66ea344a6e778f8c7faa6292201a45854ea89b83ced5b6814c24fc', 'Unexpected CDF package binary'
        # No decoder needed: CDF is unobfuscated. Keep relevant public getters,
        # constructors, cache/prune code and unload logic, excluding record values.
        selected = {'CommonDataFramework.Modules.PedDatabase.PedData': {'.ctor','get_Birthday','set_Birthday','get_Gender','set_Gender','get_ModelAge'},
                    'CommonDataFramework.Modules.PedDatabase.PedDataController': None,
                    'CommonDataFramework.EntryPoint': {'UnloadSystems','.cctor'}}
        lines = ['CDF SHA256 '+j['dllSha256']]
        for t in j['types']:
            if t['name'] not in selected: continue
            lines.append('TYPE '+t['name'])
            for f in t['fields']: lines.append('FIELD '+hex(f['token'])+' '+f['name']+' '+f['type']+' constant='+str(f['constant']))
            for m in t['methods']:
                if selected[t['name']] is not None and m['name'] not in selected[t['name']]: continue
                lines.append('METHOD '+hex(m['token'])+' '+m['name']+' '+str(m['parameters']))
                lines.extend('EXCEPTION '+json.dumps(e) for e in m.get('exceptionRegions', []))
                for i in m['il']:
                    v = i['operand']
                    if i.get('rawToken'): v=hex(i['rawToken'])+' '+v
                    if i.get('value') is not None: v=str(i['value'])
                    if i.get('targets'): v=' -> '+','.join('IL_'+format(x,'04x') for x in i['targets'])
                    lines.append('  IL_'+format(i['offset'],'04x')+': '+i['op']+' '+v)
        Path(args.output).with_name('cdf-il.txt').write_text('\n'.join(line.rstrip() for line in lines)+'\n',encoding='utf-8',newline='\n')


if __name__=='__main__': main()
