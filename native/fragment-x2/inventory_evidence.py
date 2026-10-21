"""Validate preserved JSONL and immutable source hashes, then inventory all evidence."""
from pathlib import Path
import hashlib,json,argparse
ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);args=ap.parse_args();e=args.directory
for p in e.glob('source-*.cs.txt'):
    assert hashlib.sha256(p.read_bytes()).hexdigest().startswith(p.name[7:15]),p
index=[]
for p in sorted(e.glob('*.jsonl')):
    rows=[json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s.strip()]
    header=next((r for r in rows if r.get('kind')=='header'),{})
    index.append({'file':p.name,'rows':len(rows),'scriptSha256':header.get('scriptSha256'),'loadedUtc':header.get('loadedUtc'),'completed':any(r.get('kind')=='done' for r in rows),'errors':[r for r in rows if r.get('kind')=='error'],'verdicts':[r for r in rows if r.get('kind')=='x2_verdict']})
(e/'run-index.json').write_text(json.dumps(index,indent=2)+'\n')
(e/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(e.iterdir()) if p.is_file() and p.name!='SHA256SUMS.txt'))
print('Validated',len(index),'run logs and all source snapshots; evidence hashes refreshed.')
