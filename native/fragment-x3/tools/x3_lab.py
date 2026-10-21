#!/usr/bin/env python3
"""X3 lab bridge: file-bridge control for the SHVDN WpsBreachLab driver plus hash-verified temporary changes.

Why Python: the X2 helpers are PowerShell. They keep their behaviour; this tool performs the same file-level steps
(loader isolate/restore with SHA-256 backups, deploy/restore of the lab script, command submission, status polling,
sanitised evidence collection) from a shell that cannot run Windows processes. GTA launch/stop and key presses are done
separately with Claude's computer-control tools (or the X2 PowerShell helpers when a Windows shell is available).

Usage (all paths default to the mounted GTA root; override with X3_GTA_ROOT / X3_BACKUP / X3_EVIDENCE):
  x3_lab.py inventory OUT.json          hash the tracked ASI/DLL/script/loader/pack files
  x3_lab.py deploy                      back up the deployed X2 lab script (once) and install the X3 driver
  x3_lab.py restore-script              put the backed-up X2 lab script back and verify its hash
  x3_lab.py isolate | restore-ini       temporary AutoLoadScripts=false (exact-byte backup) / restore
  x3_lab.py status                      show heartbeat freshness, loaded script SHA, state
  x3_lab.py submit BATCH [--prefix P] [--hold SECONDS --hold-labels REGEX]   write command.txt atomically
  x3_lab.py wait [--max 90]             poll until DONE (prints progress); exit 0 DONE, 2 still running, 3 stale heartbeat
  x3_lab.py collect RUNID TAG           sanitise run -> evidence dir, gzip frames.csv, write manifest line
  x3_lab.py tail RUNID [N]              last N rows of a run
  x3_lab.py shvdnlog [N]                last lines of ScriptHookVDotNet.log (compile errors, started scripts)
"""
import argparse, datetime, gzip, hashlib, json, os, re, shutil, sys, time
from pathlib import Path

HOME = Path(os.path.expanduser('~'))
GTA = Path(os.environ.get('X3_GTA_ROOT', HOME / 'mnt' / 'Grand Theft Auto V Enhanced'))
WORK = Path(os.environ.get('X3_WORK', HOME / 'mnt' / 'Codex' / '2026-10-21' / 'x3'))
REPO = WORK / 'repo'
BACKUP = Path(os.environ.get('X3_BACKUP', WORK / 'backup'))
EVID = Path(os.environ.get('X3_EVIDENCE', REPO / 'docs' / 'next-gen-gameplay' / 'astra-001' / 'x3-evidence'))
LAB = GTA / 'WpsBreachLab'
SCRIPT_DST = GTA / 'scripts' / 'WpsBreachLab.3.cs'
SCRIPT_X3 = REPO / 'native' / 'fragment-x3' / 'WpsBreachLab.3.cs'
INI = GTA / 'ScriptHookVDotNet.ini'
X2_SCRIPT_SHA = '5be72312804d55e7c0ea9b68c2182fbad7fdf4aead86852623bd1c4ffb78adae'
X2_PACK_SHA = '180618adbe9e56bdaa9a6220e82a87effc6d624ea2b78926cc348263e60af347'
ORIG_INI_SHA = 'c9ecd8e277f8c7012793e8a2368700c71be626d3d270f0b68e6dba0aca53bb72'
TRACKED = ['AdaptiveHeadlights.asi', 'DirectStorageFix.asi', 'ImmersiveSantos.asi', 'onigiri.asi', 'Reshade64.asi', 'ScriptHookVDotNet.asi',
           'ScriptHookV.dll', 'ScriptHookVDotNet2.dll', 'ScriptHookVDotNet3.dll', 'scripts/BetterChasesPlus.Enhanced.dll', 'scripts/CustomWeaponDamage.dll',
           'scripts/EnableAllinteriors.dll', 'scripts/Fumes.dll', 'scripts/iFruitAddon2.dll', 'scripts/LemonUI.SHVDN3.dll', 'scripts/LocationalDamage.dll',
           'scripts/PoliceRide.dll', 'scripts/VehicleRollover.dll', 'onigiri/dlcpacks/lsa_destruct/dlc.rpf', 'onigiri/common/data/dlclist.xml',
           'ScriptHookVDotNet.ini', 'scripts/WpsBreachLab.3.cs']


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def read_status():
    p = LAB / 'status.json'
    try:
        s = json.loads(p.read_text(encoding='utf-8-sig'))
    except Exception as e:
        return None, 'unreadable: %s' % e
    return s, None


def parse_utc(s):
    s = s.rstrip('Z')
    if '.' in s:
        a, b = s.split('.')
        s = a + '.' + b[:6]
    return datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc)


def cmd_inventory(a):
    out = {'utc': now().isoformat(), 'files': {}}
    for rel in TRACKED:
        p = GTA / rel
        out['files'][rel] = sha(p) if p.exists() else None
    Path(a.out).write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps(out['files'], indent=1))


def cmd_deploy(a):
    BACKUP.mkdir(parents=True, exist_ok=True)
    bk = BACKUP / 'WpsBreachLab.3.cs.x2-deployed'
    cur = sha(SCRIPT_DST)
    if not bk.exists():
        if cur != X2_SCRIPT_SHA:
            sys.exit('deployed script is not the frozen X2 driver (%s); refusing to back up an unknown file' % cur)
        shutil.copyfile(SCRIPT_DST, bk)
    assert sha(bk) == X2_SCRIPT_SHA, 'backup hash mismatch'
    assert sha(GTA / 'onigiri/dlcpacks/lsa_destruct/dlc.rpf') == X2_PACK_SHA, 'pack hash differs from the frozen X2 asset'
    shutil.copyfile(SCRIPT_X3, SCRIPT_DST)
    state = {'x2BackupSha256': sha(bk), 'x3ScriptSha256': sha(SCRIPT_DST), 'packSha256': sha(GTA / 'onigiri/dlcpacks/lsa_destruct/dlc.rpf'), 'utc': now().isoformat()}
    (BACKUP / 'x3-deploy-state.json').write_text(json.dumps(state, indent=2))
    print(json.dumps(state, indent=2))


def cmd_restore_script(a):
    bk = BACKUP / 'WpsBreachLab.3.cs.x2-deployed'
    assert bk.exists() and sha(bk) == X2_SCRIPT_SHA, 'X2 backup missing or altered'
    shutil.copyfile(bk, SCRIPT_DST)
    assert sha(SCRIPT_DST) == X2_SCRIPT_SHA
    print('restored X2 lab script; sha256', sha(SCRIPT_DST))


def cmd_isolate(a):
    BACKUP.mkdir(parents=True, exist_ok=True)
    orig = BACKUP / 'ScriptHookVDotNet.ini.original'
    state = BACKUP / 'shvdn-isolation.json'
    if not orig.exists():
        if sha(INI) != ORIG_INI_SHA:
            sys.exit('current loader INI is not the known original (%s); refusing to back up an unknown state' % sha(INI))
        shutil.copyfile(INI, orig)
    assert sha(orig) == ORIG_INI_SHA
    data = INI.read_bytes()
    if data.count(b'AutoLoadScripts=true') != 1:
        sys.exit('expected exactly one AutoLoadScripts=true')
    INI.write_bytes(data.replace(b'AutoLoadScripts=true', b'AutoLoadScripts=false'))
    st = {'originalSha256': sha(orig), 'isolatedSha256': sha(INI), 'onlyChange': 'AutoLoadScripts=false', 'utc': now().isoformat()}
    state.write_text(json.dumps(st, indent=2)); print(json.dumps(st, indent=2))


def cmd_restore_ini(a):
    orig = BACKUP / 'ScriptHookVDotNet.ini.original'
    st = json.loads((BACKUP / 'shvdn-isolation.json').read_text())
    cur = sha(INI)
    if cur not in (st['originalSha256'], st['isolatedSha256']):
        sys.exit('loader changed externally; refusing to overwrite')
    assert sha(orig) == st['originalSha256']
    shutil.copyfile(orig, INI)
    assert sha(INI) == ORIG_INI_SHA
    print('loader restored byte-for-byte; sha256', sha(INI), 'AutoLoadScripts=true' in INI.read_text())


def cmd_status(a):
    s, err = read_status()
    if err:
        print('STATUS', err); sys.exit(3)
    age = (now() - parse_utc(s['nowUtc'])).total_seconds()
    installed = sha(SCRIPT_DST)
    print(json.dumps({'state': s['state'], 'step': s['step'], 'cmd': s.get('cmd'), 'runId': s.get('runId'), 'version': s['version'], 'loadedUtc': s['loadedUtc'],
                      'heartbeatAgeSeconds': round(age, 1), 'scriptShaLoaded': s['scriptSha256'], 'scriptShaInstalled': installed, 'shaMatch': s['scriptSha256'] == installed,
                      'pendingCommand': (LAB / 'command.txt').exists()}, indent=1))


def cmd_submit(a):
    s, err = read_status()
    if err or s['state'] not in ('IDLE', 'DONE'):
        sys.exit('lab not ready: %s' % (err or s['state']))
    age = (now() - parse_utc(s['nowUtc'])).total_seconds()
    if age > 30:
        sys.exit('heartbeat stale (%.0f s)' % age)
    if s['scriptSha256'] != sha(SCRIPT_DST):
        sys.exit('loaded script SHA != installed script SHA (reload needed)')
    if (LAB / 'command.txt').exists():
        sys.exit('a command file is already pending')
    lines = []
    for ln in Path(a.batch).read_text(encoding='utf-8').splitlines():
        t = ln.strip()
        if not t or t.startswith('#'):
            continue
        if a.prefix:
            t = re.sub(r'label=(\S+)', lambda m: 'label=%s-%s' % (a.prefix, m.group(1)), t)
        if a.hold and a.hold_labels and re.search(a.hold_labels, t) and ' hold=' not in t:
            t += ' hold=%d' % a.hold
        lines.append(t)
    tmp = LAB / 'command.tmp'
    tmp.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (EVID / 'submitted').mkdir(parents=True, exist_ok=True)
    stamp = now().strftime('%Y%m%d-%H%M%S')
    (EVID / 'submitted' / ('%s-%s' % (stamp, Path(a.batch).name))).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    os.replace(tmp, LAB / 'command.txt')
    print('submitted', len(lines), 'commands at', stamp)


def cmd_wait(a):
    t0 = time.time(); last = None
    while time.time() - t0 < a.max:
        s, err = read_status()
        if err:
            time.sleep(1); continue
        age = (now() - parse_utc(s['nowUtc'])).total_seconds()
        if age > 60:
            print('STALE heartbeat %.0f s (state %s, step %s)' % (age, s['state'], s['step'])); sys.exit(3)
        key = (s['state'], s['step'])
        if key != last:
            print(datetime.datetime.now().strftime('%H:%M:%S'), s['state'], '|', s['step'], '|', s.get('cmd', '')[:90]); last = key
        if s['state'] == 'DONE' and not (LAB / 'command.txt').exists():
            print('DONE runId', s['runId']); sys.exit(0)
        if s['state'] == 'AWAIT_PLAYER':
            print('AWAIT_PLAYER', s['step']); sys.exit(4)
        time.sleep(2)
    print('still running:', last); sys.exit(2)


SKIP_KINDS = {'site_candidate', 'site'}
DROP_FIELDS = ('pid', 'stack', 'pos')


def cmd_collect(a):
    run = LAB / a.runid
    src = run / 'trials.jsonl'
    out_dir = EVID / 'runs'; out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for ln in src.read_text(encoding='utf-8-sig').splitlines():
        if not ln.strip():
            continue
        r = json.loads(ln)
        if r.get('kind') in SKIP_KINDS:
            continue
        for k in DROP_FIELDS:
            r.pop(k, None)
        rows.append(r)
    name = '%s-%s' % (a.tag, a.runid)
    (out_dir / (name + '.jsonl')).write_text('\n'.join(json.dumps(r, separators=(',', ':')) for r in rows) + '\n', encoding='utf-8')
    if (run / 'frames.csv').exists():
        with open(run / 'frames.csv', 'rb') as f, gzip.open(out_dir / (name + '.frames.csv.gz'), 'wb', compresslevel=9) as g:
            shutil.copyfileobj(f, g)
    for extra in ('summary.jsonl',):
        if (run / extra).exists():
            shutil.copyfile(run / extra, out_dir / (name + '.' + extra))
    done = any(r.get('kind') == 'done' for r in rows)
    hdr = next((r for r in rows if r.get('kind') == 'header'), {})
    print(json.dumps({'file': name + '.jsonl', 'rows': len(rows), 'done': done, 'version': hdr.get('version'), 'scriptSha256': hdr.get('scriptSha256'),
                      'loadedUtc': hdr.get('loadedUtc'), 'errors': sum(1 for r in rows if r.get('kind') == 'error')}))


def cmd_tail(a):
    rows = (LAB / a.runid / 'trials.jsonl').read_text(encoding='utf-8-sig').splitlines()
    for ln in rows[-a.n:]:
        r = json.loads(ln)
        for k in ('mask',):
            if k in r:
                r[k] = r[k][:12] + '...'
        print(json.dumps(r)[:700])


def cmd_shvdnlog(a):
    lines = (GTA / 'ScriptHookVDotNet.log').read_text(encoding='utf-8-sig', errors='replace').splitlines()
    print('\n'.join(lines[-a.n:]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('inventory'); p.add_argument('out'); p.set_defaults(f=cmd_inventory)
    for n, f in (('deploy', cmd_deploy), ('restore-script', cmd_restore_script), ('isolate', cmd_isolate), ('restore-ini', cmd_restore_ini), ('status', cmd_status)):
        sp.add_parser(n).set_defaults(f=f)
    p = sp.add_parser('submit'); p.add_argument('batch'); p.add_argument('--prefix', default=''); p.add_argument('--hold', type=int, default=0); p.add_argument('--hold-labels', default=''); p.set_defaults(f=cmd_submit)
    p = sp.add_parser('wait'); p.add_argument('--max', type=int, default=90); p.set_defaults(f=cmd_wait)
    p = sp.add_parser('collect'); p.add_argument('runid'); p.add_argument('tag'); p.set_defaults(f=cmd_collect)
    p = sp.add_parser('tail'); p.add_argument('runid'); p.add_argument('n', type=int, nargs='?', default=12); p.set_defaults(f=cmd_tail)
    p = sp.add_parser('shvdnlog'); p.add_argument('n', type=int, nargs='?', default=25); p.set_defaults(f=cmd_shvdnlog)
    a = ap.parse_args(); a.f(a)


if __name__ == '__main__':
    main()
