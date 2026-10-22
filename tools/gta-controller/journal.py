"""Small write-ahead rename journal for adoption by a stopped-game installer.
No game paths or automatic recovery. Each operation is reversible and hash fenced.
"""
import hashlib
from pathlib import Path
from controller import atomic, read, exclusive, ProtocolError


def sha(path):
    p = Path(path)
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None


def rename(journal, source, target):
    journal, source, target = Path(journal), Path(source).resolve(strict=True), Path(target).resolve()
    with exclusive(str(journal)+'.lock'):
        if not source.is_file() or source.is_symlink() or journal.exists() or target.exists() or source == target:
            raise ProtocolError('existing journal or target; reconcile first')
        record = dict(source=str(source), target=str(target), sha256=sha(source), state='INTENT')
        atomic(journal, record)  # durable before first mutation
        source.rename(target)
        record['state'] = 'APPLIED'; atomic(journal, record)


def recover(journal, undo=False):
    journal = Path(journal)
    with exclusive(str(journal)+'.lock'):
        r = read(journal); a, b = Path(r['source']), Path(r['target'])
        before = sha(a) == r['sha256'] and not b.exists()
        after = not a.exists() and sha(b) == r['sha256']
        if not before and not after:
            raise ProtocolError('ambiguous rename state or hash mismatch; manual review')
        if undo and after:
            r['state'] = 'UNDO_INTENT'; atomic(journal, r)
            b.rename(a)
            before = True
        r['state'] = 'ORIGINAL' if before else 'APPLIED'; atomic(journal, r)
        return r
