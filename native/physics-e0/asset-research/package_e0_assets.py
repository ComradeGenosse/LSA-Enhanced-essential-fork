"""Verify portable resources, record every staged file hash, and ZIP locally."""
import argparse
import hashlib
import json
import struct
import zipfile
import zlib
from pathlib import Path


def sha(data): return hashlib.sha256(data).hexdigest()


def main():
    p=argparse.ArgumentParser();p.add_argument('staging',type=Path);p.add_argument('zip',type=Path);a=p.parse_args()
    m=json.loads((a.staging/'manifest.json').read_text(encoding='utf-8-sig'))
    for asset in m['assets']:
        b=(a.staging/asset['file']).read_bytes()
        assert sha(b)==asset['sha256'], asset['file']
        if asset.get('resourceFlags'):
            magic,version,system,graphics=struct.unpack('<4I',b[:16])
            assert magic==0x37435352
            f=asset['resourceFlags'];assert (version,system,graphics)==(f['version'],f['system'],f['graphics'])
            assert sha(zlib.decompress(b[16:],-15))==asset['decodedPayloadSha256'], asset['file']
    inventory=[dict(file=str(f.relative_to(a.staging)).replace('\\','/'),bytes=f.stat().st_size,sha256=sha(f.read_bytes()))
               for f in sorted(a.staging.rglob('*')) if f.is_file() and f.name!='package-inventory.json']
    (a.staging/'package-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n',encoding='utf-8')
    with zipfile.ZipFile(a.zip,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for f in sorted(a.staging.rglob('*')):
            if f.is_file(): z.write(f,f.relative_to(a.staging))
    with zipfile.ZipFile(a.zip) as z:
        assert z.testzip() is None
        for row in inventory: assert sha(z.read(row['file']))==row['sha256']
    receipt=dict(file=a.zip.name,bytes=a.zip.stat().st_size,sha256=sha(a.zip.read_bytes()),files=len(inventory)+1,
                 assets=len(m['assets']),resourcePayloadsVerified=sum(bool(x.get('resourceFlags')) for x in m['assets']))
    a.zip.with_suffix('.receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt))


if __name__=='__main__': main()
