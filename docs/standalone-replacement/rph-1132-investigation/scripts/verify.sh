#!/usr/bin/env bash
# Regenerate every PROVEN number in REPORT.md from the raw inputs (read-only).
# Requires: .NET SDK on PATH, the RphMeta tool and repo auditor already built, inputs staged.
set -uo pipefail
export PATH=/home/claude/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
R=/home/claude/rph55; cd "$R"
T="timeout 180 dotnet tools/bin/RphMeta.dll"; A="timeout 180 dotnet builds/audit-bin/RphSignatureAudit.dll"
SDK=extracted/sdk124/lib/net472/RagePluginHook.dll
U=/mnt/user-data/uploads; G="$U/Grand Theft Auto V Enhanced"
H=builds/head/native/standalone-host/bin/Release/net481
pass=0; fail=0
# Known starting state: HEAD output = official-SDK build (CI order, fake SDK present).
(cd builds/head && dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -t:Rebuild "-p:RphReferencePath=$R/$SDK" > /tmp/claude-0/head-build.log 2>&1) || { echo "HEAD rebuild failed"; exit 99; }
chk(){ if [ "$2" = "$3" ]; then printf 'PASS  %-58s %s\n' "$1" "$2"; pass=$((pass+1)); else printf 'FAIL  %-58s got[%s] want[%s]\n' "$1" "$2" "$3"; fail=$((fail+1)); fi; }
sum(){ $T audit "$1" RagePluginHook $SDK /tmp/claude-0/v.tsv < /dev/null | tr '\t' '\n' | grep "^$2=" | cut -d= -f2; }

# A — inventory / provenance
chk "SDK 1.124 == SDK 1.131 (sha256)" "$(sha256sum $SDK | cut -c1-64)" "$(sha256sum extracted/rph131/SDK/RagePluginHookSDK.dll | cut -c1-64)"
chk "installed launcher == 1.132 installer launcher" "$(sha256sum "$G/RAGEPluginHook.exe" | cut -c1-64)" "$(sha256sum extracted/lspdfr132/RAGEPluginHook.exe | cut -c1-64)"
chk "b5cd53f deployed host == CI artifact host" "$(sha256sum $U/Codex/2026-10-18/implemented-in-pr-50-x20-build/outputs/pr50-testing/payload/LSA.Standalone.RageHost.dll | cut -c1-64)" "$(sha256sum extracted/ci_b5cd/payload/LSA.Standalone.RageHost.dll | cut -c1-64)"
chk "5884d8b deployed host == CI artifact host" "$(sha256sum $U/Codex/2026-10-18/implemented-in-pr-50-x20-build/outputs/pr50-5884d8b-testing/payload/LSA.Standalone.RageHost.dll | cut -c1-64)" "$(sha256sum extracted/ci5884/payload/LSA.Standalone.RageHost.dll | cut -c1-64)"
chk "CI artifact BUILD_SHA 5884d8b" "$(tr -d '\r\n' < extracted/ci5884/BUILD_SHA.txt)" "5884d8b37773d6922200ddb22a613029c3968c89"
# B — architecture
chk "1.132 launcher Rage.* typedefs" "$($T info extracted/lspdfr132/RAGEPluginHook.exe < /dev/null | grep -o 'rage_namespace_typedefs=[0-9]*' | cut -d= -f2)" "0"
chk "1.132 launcher assembly identity" "$($T info extracted/lspdfr132/RAGEPluginHook.exe < /dev/null | grep -o 'assembly=RagePluginHookLauncher, Version=1.0.0.0' )" "assembly=RagePluginHookLauncher, Version=1.0.0.0"
chk "1.132 launcher packed blob bytes" "$($T info extracted/lspdfr132/RAGEPluginHook.exe < /dev/null | grep -o 'rva_field_bytes=10[0-9]*' | cut -d= -f2)" "10847744"
chk "LSA host AssemblyRef to RPH" "$($T info $H/LSA.Standalone.RageHost.dll < /dev/null | grep -c 'assemblyref=RagePluginHook, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null')" "1"
chk "LSA Core references RPH" "$($T info $H/LSA.Standalone.Core.dll < /dev/null | grep -c 'assemblyref=RagePluginHook')" "0"
# D/E — audits
chk "b5cd53f unresolvable imports" "$(sum extracted/ci_b5cd/payload/LSA.Standalone.RageHost.dll failures)" "11"
chk "5884d8b unresolvable imports" "$(sum extracted/ci5884/payload/LSA.Standalone.RageHost.dll failures)" "10"
chk "HEAD unresolvable imports" "$(sum $H/LSA.Standalone.RageHost.dll failures)" "0"
chk "HEAD member imports ok" "$(sum $H/LSA.Standalone.RageHost.dll members_ok)" "33"
chk "HEAD type imports ok" "$(sum $H/LSA.Standalone.RageHost.dll types_ok)" "14"
chk "HEAD generic instantiations ok" "$(sum $H/LSA.Standalone.RageHost.dll specs_ok)" "4"
chk "HEAD attribute named args ok" "$(sum $H/LSA.Standalone.RageHost.dll named_args_ok)" "18"
chk "HEAD matcher disagreements" "$(sum $H/LSA.Standalone.RageHost.dll matcher_disagreements)" "0"
chk "repo auditor on HEAD" "$($A $SDK $H/LSA.Standalone.RageHost.dll $H/LSA.Standalone.Core.dll < /dev/null 2>&1 | tail -1 | grep -oE 'types=14 members=33 coreTypes=18 coreMembers=67 resolved=100 errors=0')" "types=14 members=33 coreTypes=18 coreMembers=67 resolved=100 errors=0"
chk "repo auditor on 5884d8b errors" "$($A $SDK extracted/ci5884/payload/LSA.Standalone.RageHost.dll extracted/ci5884/payload/LSA.Standalone.Core.dll < /dev/null 2>&1 | tail -1 | grep -oE 'errors=[0-9]+')" "errors=10"
chk "LSPDFR RPH members ok / failures" "$(sum "extracted/lspdfr132/plugins/LSPD First Response.dll" members_ok)/$(sum "extracted/lspdfr132/plugins/LSPD First Response.dll" failures)" "692/0"
chk "Essential RPH members ok / failures" "$(sum "$G/plugins/LosSantosAlive.dll" members_ok)/$(sum "$G/plugins/LosSantosAlive.dll" failures)" "98/0"
# E — JIT order facts
chk "b5cd53f Main own-body bad tokens" "$(python3 -I scripts/jit_order.py evidence/methods/b5cd53f.jsonl evidence/audit/b5cd53f.dual-audit.tsv | head -1 | grep -o 'get_GameTime():System.Int32' | sort -u)" "get_GameTime():System.Int32"
chk "5884d8b Main own-body bad tokens" "$(python3 -I scripts/jit_order.py evidence/methods/5884d8b.jsonl evidence/audit/5884d8b.dual-audit.tsv | head -1 | grep -o 'none')" "none"
chk "5884d8b first callee with bad tokens" "$(python3 -I scripts/jit_order.py evidence/methods/5884d8b.jsonl evidence/audit/5884d8b.dual-audit.tsv | grep -m1 '<==' | grep -o 'RageActorResolver::.ctor')" "RageActorResolver::.ctor"
chk "08:00 log: [LSA-*] lines from host" "$(grep -c '\[LSA-' "$G/Logs/RagePluginHook_18102026_115921.log")" "0"
chk "08:17 log: host_failed + stopped" "$(grep -cE '\[LSA-S2\] (host_failed kind=MissingMethodException|stopped)' "$G/Logs/RagePluginHook_18102026_121606.log")" "2"
chk "EntryPoint.cs identical 5884d8b..HEAD" "$(git -C /home/claude/wt-rph-opus55 diff --quiet 5884d8b HEAD -- native/standalone-host/EntryPoint.cs && echo identical)" "identical"
# runtime-proven / logs
chk "logs: all RPH 1.132.1428.17748" "$(python3 -I -c "import json;d=json.load(open('evidence/log-summary.json'));print(list(d['rph_versions'].items()))")" "[('1.132.1428.17748', 162)]"
chk "logs with LSPDFR loaded" "$(python3 -I -c "import json;print(json.load(open('evidence/log-summary.json'))['logs_with_LSPDFR_loaded'])")" "0"
chk "runtime-proven members (union)" "$(python3 -I -c "import json;print(len(json.load(open('evidence/runtime-proven.json'))['all_runtime_proven_members']))")" "6"
chk "UInt32 get_GameTime runtime-proven" "$(python3 -I -c "import json;print(any('get_GameTime():System.UInt32' in k for k in json.load(open('evidence/runtime-proven.json'))['all_runtime_proven_members']))")" "True"
chk "Essential-version sessions (after file date) loaded" "$(python3 -I -c "
import json,re,datetime as dt
w=lambda f:(lambda m: dt.datetime(int(m[3]),int(m[2]),int(m[1]),int(m[4]),int(m[5]),int(m[6])) if m else None)(re.search(r'_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{2})',f))
d=json.load(open('evidence/log-scan.json'))
print(len({r['file'] for r in d if w(r['file']) and w(r['file'])>dt.datetime(2026,10,12,21,18) and any(p['name']=='LosSantosAlive' for p in r['plugins'])}))")" "37"
chk "SVE 'Loaded.' sessions after its file date" "$(python3 -I -c "
import json,re,datetime as dt
w=lambda f:(lambda m: dt.datetime(int(m[3]),int(m[2]),int(m[1]),int(m[4]),int(m[5]),int(m[6])) if m else None)(re.search(r'_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{2})',f))
d=json.load(open('evidence/log-scan.json'))
print(len({r['file'] for r in d if w(r['file']) and w(r['file'])>dt.datetime(2026,10,3,22,27,42) and any(m['plugin']=='Smart Vehicle Entry' and m['text'].startswith('[SmartVehicleEntry] Loaded.') for m in r['messages'])}))")" "94"
chk "BaseDirectory=GTA root sessions / distinct values" "$(python3 -I -c "
import json
d=json.load(open('evidence/log-scan.json')); s={};
[s.setdefault(r['file'],set()).add(m['text']) for r in d for m in r['messages'] if m['plugin']=='LosSantosAlive' and 'AppDomain.BaseDirectory=' in m['text']]
v={t for x in s.values() for t in x}; print(len(s), len(v), all(t.endswith('Grand Theft Auto V Enhanced') for t in v))")" "128 1 True"
chk "Essential ldstr sites / distinct non-empty literals" "$(python3 -I -c "
import json
L=[json.loads(l) for l in open('evidence/methods/LosSantosAlive.jsonl')]
print(sum(len(m['strings']) for m in L), len({s for m in L for s in m['strings'] if s}))")" "965 0"
chk "1.132 installer ZIP: SDK folder entries / readme cites SDK dll" "$(python3 -I -c "
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); n=z.namelist()
print(sum(1 for x in n if x.lower().startswith('sdk/')), b'SDK\\\\RagePluginHookSDK.dll' in z.read('RPH_Readme.txt'))" "$U/Codex/2026-10-18/implemented-in-pr-50-x20-build/outputs/lspdfr_049_9695_Manual_Install_Enhanced_1158_16.zip")" "0 True"
chk "HEAD gate line: requested == resolved" "$(python3 -I -c "
import re
m=re.search(r'RPH compile reference requested=(\S+) resolved=(\S+)', open('/tmp/claude-0/head-build.log').read())
print(bool(m) and m.group(1)==m.group(2) and m.group(1).endswith('lib/net472/RagePluginHook.dll'))")" "True"
# D.2 table: regenerated from the audits, and the coverage claim (34 LSPDFR + 2 Essential + 1 executed)
chk "D.2 member table regenerates identically" "$(python3 -I scripts/member_table.py evidence/audit/HEAD-9933290b.dual-audit.tsv evidence/control evidence/runtime-proven.json 2>/dev/null | cmp -s - evidence/head-member-evidence.md && echo identical)" "identical"
chk "D.2 coverage: LSPDFR / +Essential / +executed only" "$(python3 -I -c "
rows=[[c.strip() for c in l.strip().strip('|').split('|')] for l in open('evidence/head-member-evidence.md') if l.startswith('| ') and l.split('|')[1].strip().isdigit()]
lsp=[r for r in rows if r[3]=='✓']; ess=[r for r in rows if r[3]!='✓' and r[4]=='✓']; exe=[r for r in rows if r[3]!='✓' and r[4]!='✓' and 'proven' in r[7]]
print(len(rows), len(lsp), len(ess), len(exe), [r[1] for r in exe])")" "37 34 2 1 ['\`Rage.GameFiber::get_CanSleepNow():System.Boolean static\`']"
# PC-side drift checks: rebuild each evidence file from its own recorded PC digest/drift and compare
for pcf in evidence/pc-hash-check.txt evidence/pc-hash-check-20261018T1445Z.txt; do
chk "PC hash evidence reproduces: ${pcf#evidence/}" "$(PCF="$pcf" python3 -I - <<'PY'
import os, re, subprocess, sys
t = open(os.environ['PCF'], encoding='utf-8').read()
dig = re.search(r'PC digest over the 22 hashes in this order: ([0-9a-f]{64})', t).group(1)
when = re.search(r'PC check time \(device clock\): (\S+);', t).group(1)
args = []
for m in re.finditer(r'^DRIFT  pc=([0-9a-f]{64})  pc_bytes=(\d+)  pc_mtime=(\S+)  analysed=\S+  analysed_bytes=\d+  (.+)$', t, re.M):
    args += ['--drift', f'{m.group(4)}|{m.group(1)}|{m.group(2)}|{m.group(3)}']
r = subprocess.run([sys.executable, '-I', 'scripts/pc_hash_check.py', '/tmp/claude-0/pc-hash-check.txt', '/mnt/user-data/uploads', dig, when] + args, capture_output=True, text=True)
same = open('/tmp/claude-0/pc-hash-check.txt', encoding='utf-8').read() == t
print(r.stdout.strip(), 'identical' if same else 'DIFFERENT')
PY
)" "match=18 drift=4 digest_verified=True identical"
done
# G — defects
chk "ExitPoint Shutdown() parameter count" "$(grep -cE 'public static void Shutdown\(\)' /home/claude/wt-rph-opus55/native/standalone-host/EntryPoint.cs)" "1"
chk "SDK CallByName<T> constraint" "$($T genparams $SDK CallByName < /dev/null | grep -o 'NotNullableValueTypeConstraint' | head -1)" "NotNullableValueTypeConstraint"
# Gate test in a throwaway copy so its (expected) failed Rebuild cannot clean HEAD's output.
rm -rf builds/head-gate && cp -r builds/head builds/head-gate
rm -f /tmp/claude-0/gate.log; (cd builds/head-gate && dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -t:Rebuild "-p:RphReferencePath=$R/extracted/rph131/SDK/RagePluginHookSDK.dll" > /tmp/claude-0/gate.log 2>&1); rc=$?
chk "csproj gate rejects SDK/RagePluginHookSDK.dll" "$([ $rc -ne 0 ] && grep -q 'does not equal the requested real SDK' /tmp/claude-0/gate.log && echo rejected)" "rejected"
chk "HEAD rebuilt vs official SDK still clean" "$(sum $H/LSA.Standalone.RageHost.dll failures)" "0"
echo "-----"; echo "VERIFY: $pass passed, $fail failed"; exit $fail
