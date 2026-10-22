"""Local, single-worker CLI handoffs. Python 3.10+, standard library only."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import uuid

SCHEMA = {"type": "object", "properties": {
    "result": {"type": "string"},
    "handoff": {"type": ["object", "null"], "properties": {
        "target": {"type": "string", "enum": ["claude", "codex"]},
        "prompt": {"type": "string"}}, "required": ["target", "prompt"], "additionalProperties": False}},
    "required": ["result", "handoff"], "additionalProperties": False}

class UnknownExecution(RuntimeError):
    """Termination could not be established; never allow another queued effect."""

def dump(path, obj):
    path = Path(path)
    tmp = path.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(obj, f, indent=2); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)

class Queue:
    def __init__(self, root):
        self.root = Path(root).resolve(); self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / 'queue.sqlite', timeout=30, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL'); self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY, root_id TEXT, parent TEXT, depth INTEGER, target TEXT,
            workspace TEXT, prompt TEXT, timeout INTEGER, session TEXT, state TEXT,
            created REAL, updated REAL, pid INTEGER, cancel INTEGER DEFAULT 0,
            result TEXT, error TEXT);
            CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, task TEXT, at REAL, event TEXT, detail TEXT);
            CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY, value TEXT);''')

    @contextlib.contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK'); raise

    def event(self, task, event, detail=None):
        self.db.execute('INSERT INTO events(task,at,event,detail) VALUES(?,?,?,?)',
                        (task, time.time(), event, json.dumps(detail)))

    def config(self):
        return json.loads((self.root / 'config.json').read_text(encoding='utf-8-sig'))

    def submit(self, target, workspace, prompt, timeout=180, parent=None, session=None):
        cfg = self.config(); workspace = str(Path(workspace).resolve())
        if workspace not in cfg['workspaces'].get(target, []):
            raise ValueError('Workspace must be explicitly registered for this agent')
        if not prompt.strip() or len(prompt) > 100000 or not 5 <= timeout <= 3600:
            raise ValueError('Invalid prompt or timeout (5..3600 seconds)')
        depth = parent['depth'] + 1 if parent else 0
        if depth > cfg.get('max_hops', 2):
            raise ValueError('Handoff hop budget exhausted')
        if parent and parent['target'] == target:
            raise ValueError('Self-delegation refused')
        tid = uuid.uuid4().hex
        self.db.execute('''INSERT INTO tasks(id,root_id,parent,depth,target,workspace,prompt,timeout,session,state,created,updated)
                          VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',?,?)''',
            (tid, parent['root_id'] if parent else tid, parent['id'] if parent else None,
             depth, target, workspace, prompt, timeout, session, time.time(), time.time()))
        self.event(tid, 'QUEUED', {'target': target, 'parent': parent['id'] if parent else None})
        return tid

    def state(self, tid, state, **fields):
        fields.update(state=state, updated=time.time())
        self.db.execute('UPDATE tasks SET '+','.join(k+'=?' for k in fields)+' WHERE id=?',
                        (*fields.values(), tid))
        self.event(tid, state, fields)

    def get(self, tid):
        row = self.db.execute('SELECT * FROM tasks WHERE id=?', (tid,)).fetchone()
        if not row: raise ValueError('Unknown task ID')
        return dict(row)

@contextlib.contextmanager
def worker_lock(root):
    f = (root / 'worker.lock').open('a+b')
    if not (root / 'worker.lock').stat().st_size: f.write(b'0'); f.flush()
    f.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close(); raise RuntimeError('Another worker owns this queue')
    try: yield
    finally: f.close()

def kill_tree(p):
    try:
        if os.name == 'nt':
            r = subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True, timeout=15)
            if r.returncode and p.poll() is None: raise RuntimeError('Could not terminate task tree')
        else:
            import signal
            os.killpg(p.pid, signal.SIGKILL)
        p.wait(timeout=15)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as e:
        raise UnknownExecution('Task-tree termination unconfirmed; inspect recorded PID before resolving') from e

def execute(q, task):
    cfg = q.config(); tid = task['id']; agent = task['target']
    run = q.root / 'runs' / tid; run.mkdir(parents=True, exist_ok=True)
    dump(run / 'task.json', task); dump(run / 'schema.json', SCHEMA)
    exe = cfg['executables'][agent]
    # Executables only: .cmd wrappers create avoidable shell quoting risks on Windows.
    if not Path(exe).is_file() or (os.name == 'nt' and Path(exe).suffix.lower() != '.exe'):
        raise ValueError('Configure an absolute existing .exe path')
    prompt = ('You are a bounded local collaborator. Do not spawn agents or run the coordinator. '
              'Return the required JSON. Request a peer only through handoff, never through shell tools. '
              f'Remaining handoff budget: {cfg.get("max_hops", 2)-task["depth"]}. '
              'Use null handoff when done. Role: '+ ('experiment design/coding proposal/independent review.' if agent == 'claude'
              else 'Windows execution/builds/GitHub/GTA operator; live actions require an explicit runbook authorization.')
              +'\nTask:\n'+task['prompt'])
    if agent == 'codex':
        args = [exe, 'exec', '--sandbox', cfg.get('codex_sandbox', 'read-only')]
        if task['session']: args += ['resume', task['session']]
        args += ['--json',
                 '--output-schema', str(run / 'schema.json'), '-o', str(run / 'answer.json'), '-']
    else:
        permitted = ','.join(cfg.get('claude_tools', []))
        args = [exe, '-p', '--output-format', 'json', '--json-schema', json.dumps(SCHEMA),
                '--permission-mode', 'dontAsk', '--strict-mcp-config', '--tools', permitted]
        if permitted: args += ['--allowedTools', permitted]
        if task['session']: args += ['--resume', task['session']]
    dump(run / 'argv.json', args)
    # STARTING cancellation must not launch another process.
    if q.get(tid)['cancel'] or q.db.execute("SELECT 1 FROM control WHERE key='stop'").fetchone():
        q.state(tid, 'CANCELLED'); return
    with (run / 'stdout.jsonl').open('wb') as out, (run / 'stderr.log').open('wb') as err:
        p = subprocess.Popen(args, cwd=task['workspace'], stdin=subprocess.PIPE, stdout=out, stderr=err,
                             start_new_session=os.name != 'nt', creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        q.state(tid, 'RUNNING', pid=p.pid)
        write_errors = []
        def feed():
            try:
                p.stdin.write(prompt.encode('utf-8')); p.stdin.close()
            except (OSError, ValueError) as e: write_errors.append(str(e))
        writer = threading.Thread(target=feed, daemon=True)
        until = time.monotonic() + task['timeout']
        writer.start()
        try:
            while p.poll() is None:
                stopped = q.db.execute("SELECT value FROM control WHERE key='stop'").fetchone()
                if q.get(tid)['cancel'] or stopped or time.monotonic() > until:
                    reason = 'CANCELLED' if q.get(tid)['cancel'] or stopped else 'TIMED_OUT'
                    kill_tree(p)
                    q.state(tid, reason, error='Process tree terminated; side effects, if any, require review')
                    return
                time.sleep(.25)
        except BaseException:
            if p.poll() is None: kill_tree(p)
            raise
        writer.join(timeout=1)
        if writer.is_alive() or write_errors:
            raise UnknownExecution('Prompt delivery unconfirmed; inspect CLI logs and effects')
    raw = (run / 'stdout.jsonl').read_text(encoding='utf-8-sig')
    session = task['session']
    if agent == 'codex':
        events = [json.loads(line) for line in raw.splitlines() if line.strip()]
        session = next((e['thread_id'] for e in events if e.get('type') == 'thread.started'), session)
        answer = json.loads((run / 'answer.json').read_text(encoding='utf-8-sig')) if (run/'answer.json').exists() else None
    else:
        response = json.loads(raw); dump(run / 'response.json', response)
        session = response.get('session_id', session)
        if response.get('is_error'): raise RuntimeError(str(response.get('result', response)))
        answer = response.get('structured_output')
    if p.returncode != 0 or not isinstance(answer, dict):
        raise RuntimeError(f'CLI failed or missing structured answer: exit={p.returncode}; inspect {run}')
    if set(answer) != {'result', 'handoff'} or not isinstance(answer['result'], str):
        raise ValueError('Invalid answer schema')
    handoff = answer['handoff']
    if handoff is not None and (not isinstance(handoff, dict) or set(handoff) != {'target','prompt'} or
                               handoff['target'] not in ('claude','codex') or not isinstance(handoff['prompt'], str)):
        raise ValueError('Invalid handoff schema')
    dump(run / 'answer.json', answer)
    with q.transaction():
        if q.get(tid)['cancel'] or q.db.execute("SELECT 1 FROM control WHERE key='stop'").fetchone():
            q.state(tid, 'CANCELLED', result=json.dumps({'answer':answer,'child':None}), session=session,
                    error='CLI completed while cancellation arrived; handoff suppressed')
            return
        child = None
        rejected = None
        if handoff:
            # Agent output may request text work only; it cannot select arbitrary paths or commands.
            try:
                peer_workspace = cfg['workspaces'][handoff['target']][0]
                child = q.submit(handoff['target'], peer_workspace, handoff['prompt'], task['timeout'], task)
            except (ValueError, KeyError, IndexError) as e:
                rejected = str(e); q.event(tid, 'HANDOFF_REJECTED', rejected)
        q.state(tid, 'HANDOFF_REJECTED' if rejected else 'SUCCEEDED',
                result=json.dumps({'answer': answer, 'child': child}), session=session, error=rejected)

def worker(q, once=False):
    with worker_lock(q.root):
        # No replay of possibly applied effects after worker/host death.
        with q.transaction():
            for row in q.db.execute("SELECT id FROM tasks WHERE state IN ('STARTING','RUNNING')").fetchall():
                q.state(row['id'], 'UNKNOWN', error='Interrupted worker; inspect PID, logs and side effects; no automatic replay')
        while not q.db.execute("SELECT 1 FROM control WHERE key='stop'").fetchone():
            if q.db.execute("SELECT 1 FROM tasks WHERE state='UNKNOWN'").fetchone():
                raise RuntimeError('Queue paused: resolve UNKNOWN work after inspecting recorded PID and logs')
            with q.transaction():
                task = q.db.execute("SELECT * FROM tasks WHERE state='QUEUED' ORDER BY created LIMIT 1").fetchone()
                if task: q.state(task['id'], 'STARTING')
            if task:
                task = dict(task)
                try: execute(q, task)
                except UnknownExecution as e: q.state(task['id'], 'UNKNOWN', error=str(e))
                except Exception as e:
                    state = 'UNKNOWN' if q.get(task['id'])['state'] == 'RUNNING' else 'FAILED'
                    q.state(task['id'], state, error=str(e))
            elif once: break
            else: time.sleep(1)  # Local SQLite check only; no idle model calls.

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--queue', required=True, type=Path)
    sub = p.add_subparsers(dest='cmd', required=True)
    i = sub.add_parser('init'); i.add_argument('--codex', required=True); i.add_argument('--claude', required=True)
    i.add_argument('--codex-workspace', required=True); i.add_argument('--claude-workspace', required=True)
    s = sub.add_parser('submit'); s.add_argument('target', choices=['claude','codex']); s.add_argument('--workspace', required=True)
    s.add_argument('--prompt-file', required=True, type=Path); s.add_argument('--timeout', type=int, default=180); s.add_argument('--session')
    h = sub.add_parser('handoff'); h.add_argument('parent'); h.add_argument('target', choices=['claude','codex'])
    h.add_argument('--prompt-file', required=True, type=Path)
    for name in ['status', 'cancel', 'resolve']:
        z = sub.add_parser(name); z.add_argument('id', nargs='?' if name == 'status' else None)
        if name == 'resolve': z.add_argument('--note', required=True)
    w = sub.add_parser('work'); w.add_argument('--once', action='store_true')
    sub.add_parser('stop'); sub.add_parser('start')
    a = p.parse_args(); q = Queue(a.queue)
    if a.cmd == 'init':
        if (q.root/'config.json').exists(): raise ValueError('Existing config; edit explicitly')
        dump(q.root/'config.json', {'executables': {'codex':str(Path(a.codex).resolve()), 'claude':str(Path(a.claude).resolve())},
             'workspaces': {'codex':[str(Path(a.codex_workspace).resolve())], 'claude':[str(Path(a.claude_workspace).resolve())]},
             'max_hops':2, 'codex_sandbox':'read-only'})
    elif a.cmd == 'submit':
        with q.transaction(): print(q.submit(a.target, a.workspace, a.prompt_file.read_text(encoding='utf-8-sig'), a.timeout, session=a.session))
    elif a.cmd == 'handoff':
        with q.transaction():
            parent = q.get(a.parent)
            if parent['state'] != 'SUCCEEDED': raise ValueError('Parent must have succeeded')
            if q.db.execute('SELECT 1 FROM tasks WHERE parent=?',(a.parent,)).fetchone(): raise ValueError('Parent already handed off')
            print(q.submit(a.target,q.config()['workspaces'][a.target][0],a.prompt_file.read_text(encoding='utf-8-sig'),parent['timeout'],parent))
    elif a.cmd == 'status':
        print(json.dumps(q.get(a.id) if a.id else [dict(r) for r in q.db.execute('SELECT * FROM tasks ORDER BY created')],indent=2))
    elif a.cmd == 'cancel':
        with q.transaction():
            task = q.get(a.id)
            if task['state'] == 'QUEUED': q.state(a.id,'CANCELLED')
            elif task['state'] in ('STARTING','RUNNING'):
                q.db.execute('UPDATE tasks SET cancel=1 WHERE id=?',(a.id,)); q.event(a.id,'CANCEL_REQUESTED')
            else: raise ValueError('Task is already terminal')
    elif a.cmd == 'resolve':
        with q.transaction():
            if q.get(a.id)['state'] != 'UNKNOWN': raise ValueError('Only UNKNOWN tasks can be resolved')
            q.state(a.id,'REVIEWED',error=a.note)
    elif a.cmd == 'stop':
        q.db.execute("INSERT OR REPLACE INTO control VALUES('stop','1')")
    elif a.cmd == 'start':
        with worker_lock(q.root): q.db.execute("DELETE FROM control WHERE key='stop'")
        with (q.root/'worker.log').open('ab') as log:
            proc = subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--queue',str(q.root),'work'],
                stdin=subprocess.DEVNULL,stdout=log,stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, start_new_session=os.name != 'nt')
        print(json.dumps({'workerPid':proc.pid,'log':str(q.root/'worker.log')}))
    else: worker(q,a.once)

if __name__ == '__main__':
    try: main()
    except (ValueError, RuntimeError, OSError) as e:
        print(json.dumps({'error':str(e)}),file=sys.stderr); sys.exit(2)
