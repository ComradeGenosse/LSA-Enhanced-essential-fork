import json,hashlib
from pathlib import Path
root=Path.cwd();g=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced')
m=json.loads((root/'work/backup-story/manifest.json').read_text());H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest().upper() if p.is_file() else None
for x in m['rows']:assert H(g/x['relative'])==x['before']
for x in m['renames']:assert H(g/x['source'])==x['sha256'] and not(g/x['target']).exists()
assert not(g/'onigiri/dlcpacks/lsa_destruction_lab/dlc.rpf').exists()
st=json.loads((g/'WpsBreachLab/controller.json').read_text());assert st['pending'] is None
for n in ['request.txt','command.txt']:assert not(g/'WpsBreachLab'/n).exists()
h={'state':'GTA_STOPPED_FILESYSTEM_RESTORED_READY_TO_RELEASE','operator':'codex-lab','publisher':'codex','session':'lab-story-sp-20261023','acknowledgedBy':'codex-lab','sourceHead':'6e676446','shots':0,'preparations':0,'mapLoading':'FAIL_NATIVE_SOURCES_ABSENT','bothGenuineMapObjects':'FAIL_A_AND_B_MISSING','fractureA':'NOT_RUN','fractureB':'NOT_RUN','selectedSections':'NOT_RUN','traversal':'NOT_RUN','independentRestorationCleanup':'NOT_RUN_NO_PREPARATIONS','filesystem':'PASS_ORIGINAL_HASHES_AND_ABSENCES','iplRequestRemoved':True,'pending':None,'nextAction':'Review exact negative SP candidate and explicit IPL discriminator; no grounded fix established. No new gameplay authorized by this handoff.'}
(root/'outputs/handoff.json').write_text(json.dumps(h,indent=2));(root/'outputs/map-filesystem-restoration.json').write_text(json.dumps({'passed':True,'labPackAbsent':True,'driverRestorationReceipt':'filesystem-restoration.json','mapJournal':json.loads((root/'work/backup-map/manifest.json').read_text())},indent=2))
print('All final hashes, absences, empty command slots and no pending intent verified')
