#!/usr/bin/env python3
"""Compare files on the user's PC with the copies analysed here (read-only on both sides).

The PC side is summarised by one digest computed on the PC:
    for f in <FILES in order>; do sha256sum "$f" | cut -c1-64; done | sha256sum
Files that changed on the PC after staging are passed as --drift entries (their PC hash, size and
mtime as printed on the PC). The script rebuilds the PC hash list = analysed-copy hash for unchanged
files, drift hash for changed ones, and checks it reproduces the PC digest exactly, so the written
evidence cannot silently contain a transcription error.

Usage: python3 -I pc_hash_check.py OUT STAGED_ROOT PC_DIGEST PC_TIME [--drift RELPATH|SHA|SIZE|MTIME ...]
       python3 -I pc_hash_check.py --list      (prints FILES, one per line, for the PC-side command)
"""
import hashlib
import os
import sys

O = 'Codex/2026-10-18/implemented-in-pr-50-x20-build'
G = 'Grand Theft Auto V Enhanced'
FILES = [
    f'{G}/RAGEPluginHook.exe', f'{G}/RAGENativeUI.dll', f'{G}/plugins/LosSantosAlive.dll',
    f'{G}/plugins/LSA.PromotedCharacters.dll',
    f'{G}/plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll',
    f'{G}/plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll',
    f'{G}/plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll', f'{G}/plugins/SmartVehicleEntry.dll',
    f'{G}/plugins/LSPDFR/LosSantosAlive.PRBridge.dll', f'{G}/plugins/LSPDFR/LosSantosAlive.Interop.dll',
    f'{O}/outputs/pr50-testing/payload/LSA.Standalone.RageHost.dll', f'{O}/outputs/pr50-testing/payload/LSA.Standalone.Core.dll',
    f'{O}/outputs/pr50-switcher-testing/payload/LSA.Standalone.RageHost.dll',
    f'{O}/outputs/pr50-switcher-testing/payload/LSA.Standalone.Core.dll',
    f'{O}/outputs/pr50-5884d8b-testing/payload/LSA.Standalone.RageHost.dll',
    f'{O}/outputs/pr50-5884d8b-testing/payload/LSA.Standalone.Core.dll',
    f'{O}/outputs/lsa-standalone-gta-smoke.zip', f'{O}/work/pr50-5884d8b-artifact/lsa-standalone-gta-smoke.zip',
    'Downloads/ragepluginhook.1.124.0.nupkg', 'Downloads/RAGEPluginHook_1_131_1424_17745.zip',
    'Downloads/lspdfr_049_9695_Manual_Install_Enhanced_1158_16.zip', f'{O}/outputs/lspdfr_049_9695_Manual_Install_Enhanced_1158_16.zip',
]


# PC files that were not staged themselves; their analysed twin (same PC hash) is used instead.
ALIAS = {
    f'{O}/outputs/pr50-switcher-testing/payload/LSA.Standalone.RageHost.dll': f'{O}/outputs/pr50-testing/payload/LSA.Standalone.RageHost.dll',
    f'{O}/outputs/pr50-switcher-testing/payload/LSA.Standalone.Core.dll': f'{O}/outputs/pr50-testing/payload/LSA.Standalone.Core.dll',
    'Downloads/lspdfr_049_9695_Manual_Install_Enhanced_1158_16.zip': f'{O}/outputs/lspdfr_049_9695_Manual_Install_Enhanced_1158_16.zip',
}


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    if sys.argv[1:2] == ['--list']:
        print('\n'.join(FILES)); return
    out, root, pc_digest, pc_time = sys.argv[1:5]
    drift = {}
    a = sys.argv[5:]
    for i, x in enumerate(a):
        if x == '--drift':
            rel, h, size, mtime = a[i + 1].split('|')
            drift[rel] = (h.lower(), int(size), mtime)
    unknown = set(drift) - set(FILES)
    if unknown:
        sys.exit(f'drift entries not in FILES: {sorted(unknown)}')
    rows, pc_hashes = [], []
    for rel in FILES:
        src = ALIAS.get(rel, rel)
        p = os.path.join(root, src)
        s_hash, s_size = sha(p), os.path.getsize(p)
        note = f'  (not staged; compared with analysed twin {src})' if src != rel else ''
        if rel in drift:
            h, size, mtime = drift[rel]
            rows.append(f'DRIFT  pc={h}  pc_bytes={size}  pc_mtime={mtime}  analysed={s_hash}  analysed_bytes={s_size}  {rel}')
            pc_hashes.append(h)
        else:
            rows.append(f'MATCH  {s_hash}  {s_size:>9}  {rel}{note}')
            pc_hashes.append(s_hash)
    digest = hashlib.sha256(''.join(h + '\n' for h in pc_hashes).encode()).hexdigest()
    ok = digest == pc_digest.lower()
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write('# PC-side SHA-256 (read-only, device shell) vs. the copies analysed in this investigation\n')
        fh.write(f'# PC check time (device clock): {pc_time}; analysed copies staged 2026-10-18 ~13:33 UTC\n')
        fh.write(f'# PC digest over the {len(FILES)} hashes in this order: {pc_digest.lower()}\n')
        fh.write(f'# digest rebuilt from this file: {digest} -> {"VERIFIED (exact)" if ok else "MISMATCH"}\n')
        fh.write(f'# match={sum(r.startswith("MATCH") for r in rows)} drift={len(drift)}\n')
        fh.write('\n'.join(rows) + '\n')
    print(f'match={len(FILES) - len(drift)} drift={len(drift)} digest_verified={ok}')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
