"""Durable offline jobs: explicit argv, persistent output and terminal exit receipt.
Call start/status/collect; a missing receipt is UNKNOWN, never success or retry.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import threading
import uuid
from controller import atomic, read, ProtocolError


def start(root, argv, cwd):
    job = Path(root).resolve() / uuid.uuid4().hex
    job.mkdir(parents=True)
    atomic(job / 'intent.json', dict(argv=argv, cwd=str(Path(cwd).resolve()), createdUnix=time.time()))
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_worker', str(job)],
                         creationflags=flags, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=os.name != 'nt')
    threading.Thread(target=p.wait, daemon=True).start()
    atomic(job / 'worker.json', dict(pid=p.pid))
    return str(job)


def worker(job):
    job = Path(job); intent = read(job / 'intent.json')
    try:
        with (job / 'output.log').open('xb') as out:
            p = subprocess.Popen(intent['argv'], cwd=intent['cwd'], stdout=out, stderr=subprocess.STDOUT,
                                 stdin=subprocess.DEVNULL)
            atomic(job / 'running.json', dict(pid=p.pid, startedUnix=time.time()))
            code = p.wait()
            out.flush(); os.fsync(out.fileno())
        atomic(job / 'result.json', dict(exitCode=code, completedUnix=time.time(), state='SUCCEEDED' if code == 0 else 'FAILED'))
    except Exception as e:
        atomic(job / 'result.json', dict(exitCode=None, state='FAILED', error=str(e)))


def status(job):
    job = Path(job)
    return read(job / 'result.json') if (job / 'result.json').exists() else dict(state='UNKNOWN_OR_RUNNING')

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('op', choices=['start', 'status', 'collect', '_worker'])
    p.add_argument('path'); p.add_argument('--cwd', default=os.getcwd()); p.add_argument('argv', nargs=argparse.REMAINDER)
    a = p.parse_args()
    if a.op == 'start': print(start(a.path, a.argv[1:] if a.argv[:1] == ['--'] else a.argv, a.cwd))
    elif a.op == '_worker': worker(a.path)
    else:
        r = status(a.path); print(json.dumps(r))
        if a.op == 'collect':
            if r['state'] == 'UNKNOWN_OR_RUNNING': sys.exit(2)
            print((Path(a.path)/'output.log').read_text(errors='replace'))
            sys.exit(0 if r.get('exitCode') == 0 else 2)
