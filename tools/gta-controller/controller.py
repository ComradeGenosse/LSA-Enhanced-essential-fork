"""Offline-testable SHVDN command client. No default game path; no deploy/launch code."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import uuid

class ProtocolError(RuntimeError):
    pass


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def atomic(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with tmp.open('x', encoding='utf-8', newline='\n') as f:
        f.write(value if isinstance(value, str) else json.dumps(value, indent=2))
        f.flush()
        os.fsync(f.fileno())
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            break
        except PermissionError:
            if attempt == 19: raise
            time.sleep(.005)


@contextlib.contextmanager
def exclusive(path):
    # Kernel releases lock on process death. Never delete the lock inode/file.
    f = Path(path).open('a+b')
    try:
        f.seek(0)
        if os.name == 'nt':
            import msvcrt
            try:
                if Path(path).stat().st_size == 0:
                    f.write(b'0'); f.flush()
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as e:
                raise ProtocolError('controller already locked') from e
        else:
            import fcntl
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as e:
                raise ProtocolError('controller already locked') from e
        yield
    finally:
        f.close()


def identity(s):
    return {k: s[k] for k in ('pid', 'loadedUtc', 'scriptSha256')}


def validate(s, expected, max_age=4):
    from datetime import datetime, timezone
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(s['nowUtc'].replace('Z', '+00:00'))).total_seconds()
    if s.get('protocol') != 2 or identity(s) != expected or not -1 <= age <= max_age:
        raise ProtocolError('wrong protocol, stale heartbeat or loaded runtime mismatch')


class Controller:
    def __init__(self, lab, owner, session, expected, poll=.2):
        self.lab = Path(lab).resolve(strict=True)
        self.owner, self.session, self.expected, self.poll = owner, session, expected, poll
        self.state_path = self.lab / 'controller.json'

    @contextlib.contextmanager
    def owned(self):
        with exclusive(self.lab / 'controller.lock'):
            if self.state_path.exists():
                self.state = read(self.state_path)
                if (self.state['owner'], self.state['session']) != (self.owner, self.session):
                    raise ProtocolError('ownership handoff required; no automatic lease takeover')
            else:
                self.state = dict(owner=self.owner, session=self.session, fence=uuid.uuid4().hex,
                                  controllerPid=os.getpid(), acquiredUnix=time.time(), pending=None)
                self.save()
            atomic(self.lab / 'controller.fence', self.state['fence'])
            yield

    def save(self):
        atomic(self.state_path, self.state)

    def preflight(self):
        a = read(self.lab / 'status.json'); validate(a, self.expected)
        end = time.monotonic() + 3
        while time.monotonic() < end:
            time.sleep(self.poll)
            b = read(self.lab / 'status.json'); validate(b, self.expected)
            if b['state'] == 'RUNNING':
                raise ProtocolError('runtime already running')
            if b['frame'] > a['frame']:
                return b
        raise ProtocolError('runtime stalled; frame did not advance')

    def submit(self, command, experiment, trial, timeout=80):
        with self.owned():
            if self.state['pending']:
                raise ProtocolError('unresolved request; reconcile before any new command')
            if not command.strip() or any(c in command for c in '\r\n'):
                raise ProtocolError('exactly one command required')
            for x in (experiment, trial, self.session):
                if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', x):
                    raise ProtocolError('invalid correlation ID')
            if not 0 < timeout <= 3600:
                raise ProtocolError('timeout must be 0..3600 seconds')
            self.preflight()
            slot = self.lab / 'request.txt'
            if slot.exists() or (self.lab / 'command.txt').exists():
                raise ProtocolError('occupied or legacy command slot; operator reconciliation required')
            rid = uuid.uuid4().hex
            request = dict(requestId=rid, fence=self.state['fence'], sessionId=self.session,
                           experimentId=experiment, trialId=trial, command=command,
                           expected=self.expected, expiresUnix=time.time()+timeout)
            # Write intent BEFORE publishing; an interruption never authorizes resubmission.
            self.state['pending'] = request; self.save()
            request_dir = self.lab / 'requests'; request_dir.mkdir(exist_ok=True)
            atomic(request_dir / (rid + '.json'), request)
            text = '\n'.join(['X7P2', rid, request['fence'], self.session, experiment, trial,
                              str(self.expected['pid']), self.expected['loadedUtc'],
                              self.expected['scriptSha256'], str(int(request['expiresUnix'])), command])
            if len(text.encode('utf-8')) > 4096:
                raise ProtocolError('request too large; reconcile intent')
            atomic(slot, text)
            return self.wait(timeout)

    def wait(self, timeout):
        r = self.state['pending']
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            path = self.lab / 'responses' / (r['requestId'] + '.json')
            if path.exists():
                result = read(path)  # partial/malformed responses fail closed, retain pending
                for key in ('requestId', 'fence', 'sessionId', 'experimentId', 'trialId', 'command'):
                    if result.get(key) != r[key]:
                        raise ProtocolError('unmatched response: ' + key)
                if identity(result) != r['expected'] or result.get('protocol') != 2:
                    raise ProtocolError('response runtime mismatch')
                if result.get('state') not in ('DONE', 'ERROR', 'REJECTED'):
                    raise ProtocolError('nonterminal response')
                self.state['last'] = result
                self.state['pending'] = None; self.save()
                if result['state'] != 'DONE' or result.get('error'):
                    raise ProtocolError('runtime failure: ' + str(result))
                return result
            time.sleep(self.poll)
        raise ProtocolError('TIMEOUT_UNKNOWN: request may still execute; reconcile, never retry')

    def reconcile(self, timeout):
        with self.owned():
            if not self.state['pending']:
                raise ProtocolError('no pending request')
            return self.wait(timeout)  # never republishes, including after client crash

    def abandon_ended_runtime(self):
        """Operator-only recovery; never claims an interrupted physical effect succeeded."""
        with self.owned():
            r = self.state['pending']
            if not r or r['expected'] == self.expected:
                raise ProtocolError('a different verified runtime is required')
            if (self.lab / 'request.txt').exists() or (self.lab / 'command.txt').exists():
                raise ProtocolError('operator must quarantine queued slots while GTA is stopped')
            self.preflight()
            self.state.setdefault('abandoned', []).append(dict(request=r, outcome='UNKNOWN_OLD_RUNTIME_ENDED'))
            self.state['pending'] = None; self.save()

    def release(self):
        with self.owned():
            if self.state['pending']:
                raise ProtocolError('pending request blocks release')
            archive = self.lab / 'ownership-history'; archive.mkdir(exist_ok=True)
            atomic(archive / (self.state['fence'] + '.json'), self.state)
            self.state_path.unlink()


def collect(lab, request_ids, destination):
    """Only exact manifest-listed responses/runs; preserve bytes plus SHA256 inventory."""
    lab, destination = Path(lab).resolve(), Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    inventory = []
    for rid in request_ids:
        if not re.fullmatch('[0-9a-f]{32}', rid):
            raise ProtocolError('invalid request id')
        request = read(lab / 'requests' / (rid + '.json'))
        response = read(lab / 'responses' / (rid + '.json'))
        if response['requestId'] != rid or request['requestId'] != rid:
            raise ProtocolError('evidence request mismatch')
        for k in ('fence', 'sessionId', 'experimentId', 'trialId', 'command'):
            if request[k] != response[k]:
                raise ProtocolError('evidence correlation mismatch')
        if identity(response) != request['expected']:
            raise ProtocolError('evidence runtime mismatch')
        run = response.get('runId')
        if not run or not re.fullmatch(r'[A-Za-z0-9-]+', run):
            raise ProtocolError('missing/unsafe run id')
        trials = lab / run / 'trials.jsonl'
        if not trials.is_file():
            raise ProtocolError('missing trials')
        records = [json.loads(line) for line in trials.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
        if not records:
            raise ProtocolError('empty trials')
        for row in records:
            for key in ('requestId', 'sessionId', 'experimentId', 'trialId'):
                if row.get(key) != request[key]:
                    raise ProtocolError('trial row correlation mismatch')
        sources = [lab / 'requests' / (rid+'.json'), lab / 'responses' / (rid+'.json')]
        sources += sorted((lab / run).rglob('*'))
        if not (lab / run / 'trials.jsonl').is_file():
            raise ProtocolError('missing trials')
        for src in sources:
            if src.is_symlink() or not src.resolve().is_relative_to(lab):
                raise ProtocolError('unsafe evidence path')
            if src.is_file():
                rel = src.relative_to(lab); dst = destination / rel
                dst.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(src, dst)
                inventory.append(dict(path=rel.as_posix(), sha256=hashlib.sha256(dst.read_bytes()).hexdigest()))
    atomic(destination / 'manifest.json', dict(requestIds=request_ids, files=inventory,
           commandOutcome='SEE_RESPONSES', gameplayOutcome='NOT_ASSESSED'))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--lab', required=True, type=Path)
    p.add_argument('--owner', required=True); p.add_argument('--session', required=True)
    p.add_argument('--expected', required=True, type=Path, help='JSON: pid, loadedUtc, scriptSha256')
    sub = p.add_subparsers(dest='op', required=True)
    s = sub.add_parser('send'); s.add_argument('command'); s.add_argument('--experiment', required=True); s.add_argument('--trial', required=True)
    s.add_argument('--timeout', type=float, default=80)
    s = sub.add_parser('reconcile'); s.add_argument('--timeout', type=float, default=5)
    sub.add_parser('release')
    s = sub.add_parser('abandon-ended-runtime'); s.add_argument('--confirm-old-runtime-ended', action='store_true', required=True)
    s = sub.add_parser('collect'); s.add_argument('--requests', required=True, type=Path); s.add_argument('--out', required=True, type=Path)
    a = p.parse_args(); c = Controller(a.lab, a.owner, a.session, read(a.expected))
    try:
        if a.op == 'send': result = c.submit(a.command, a.experiment, a.trial, a.timeout)
        elif a.op == 'reconcile': result = c.reconcile(a.timeout)
        elif a.op == 'release': result = c.release()
        elif a.op == 'abandon-ended-runtime': result = c.abandon_ended_runtime()
        else: result = collect(a.lab, read(a.requests)['requestIds'], a.out)
        print(json.dumps(result))
    except (ProtocolError, OSError, ValueError, KeyError) as e:
        p.exit(2, str(e)+'\n')

if __name__ == '__main__':
    main()
