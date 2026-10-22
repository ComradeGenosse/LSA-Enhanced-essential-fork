import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from controller import Controller, ProtocolError, atomic, read, exclusive, collect
import journal
import jobs

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name)
        self.expected = dict(pid=123, loadedUtc='2026-10-22T15:00:00.0000000Z', scriptSha256='a'*64)
        self.c = Controller(self.lab, 'codex', 'offline', self.expected, poll=.01)
        self.beat_stop = threading.Event()
        def heartbeat():
            frame = 0
            while not self.beat_stop.is_set():
                frame += 1
                atomic(self.lab/'status.json', dict(self.expected, protocol=2, frame=frame, state='IDLE', nowUtc=datetime.now(timezone.utc).isoformat()))
                time.sleep(.002)
        self.beat = threading.Thread(target=heartbeat); self.beat.start()
        def stop(): self.beat_stop.set(); self.beat.join()
        self.addCleanup(stop)
        time.sleep(.02)

    def reply(self, state='DONE', wrong=None):
        def runtime():
            slot=self.lab/'request.txt'
            end=time.monotonic()+2
            while not slot.exists():
                if time.monotonic()>end: return
                time.sleep(.002)
            wire=slot.read_text().splitlines(); rid=wire[1]
            r=read(self.lab/'requests'/(rid+'.json'))
            result=dict(self.expected, protocol=2, **{k:r[k] for k in ('requestId','fence','sessionId','experimentId','trialId','command')}, state=state, error=None if state=='DONE' else 'exception', runId='offline-run')
            if wrong: result[wrong]='wrong'
            (self.lab/'responses').mkdir(exist_ok=True)
            atomic(self.lab/'responses'/(rid+'.json'),result)
            slot.unlink()
        t=threading.Thread(target=runtime); t.start(); self.addCleanup(lambda:t.join(timeout=2))

    def send(self, timeout=.5): return self.c.submit('x7restore','x7','trial1',timeout)

    def test_success_and_exact_collection(self):
        self.reply(); r=self.send()
        (self.lab/'offline-run').mkdir(); (self.lab/'offline-run'/'trials.jsonl').write_text(json.dumps({k:r[k] for k in ('requestId','sessionId','experimentId','trialId')})+'\n')
        (self.lab/'unrelated-run').mkdir(); (self.lab/'unrelated-run'/'secret').write_text('no')
        collect(self.lab,[r['requestId']],self.lab/'bundle')
        self.assertFalse((self.lab/'bundle'/'unrelated-run').exists())
        self.assertEqual(len(read(self.lab/'bundle'/'manifest.json')['files']),3)

    def test_runtime_exception_nonzero(self):
        self.reply('ERROR')
        with self.assertRaisesRegex(ProtocolError,'runtime failure'): self.send()

    def test_wrong_request_and_correlation_remain_pending(self):
        for key in ('requestId','fence','sessionId','experimentId','trialId','command','loadedUtc'):
            with self.subTest(key=key):
                # independent subdirectories, same heartbeat identity
                if (self.lab/'controller.json').exists(): (self.lab/'controller.json').unlink()
                self.reply(wrong=key)
                with self.assertRaises(ProtocolError): self.send()
                self.assertIsNotNone(read(self.lab/'controller.json')['pending'])
                time.sleep(.01)

    def test_stale_wrong_sha_and_reload_same_pid(self):
        self.beat_stop.set(); self.beat.join()
        base=read(self.lab/'status.json')
        for change in (dict(nowUtc='2000-01-01T00:00:00Z'),dict(scriptSha256='b'*64),dict(loadedUtc='2026-10-22T16:00:00Z')):
            atomic(self.lab/'status.json',dict(base,**change))
            with self.assertRaises(ProtocolError): self.send()
        self.assertFalse((self.lab/'request.txt').exists())

    def test_nonadvancing_frames(self):
        self.beat_stop.set(); self.beat.join()
        with self.assertRaisesRegex(ProtocolError,'stalled'): self.send()

    def test_concurrent_process_rejected(self):
        script='from controller import exclusive; import sys\nwith exclusive(sys.argv[1]): pass'
        with exclusive(self.lab/'controller.lock'):
            r=subprocess.run([sys.executable,'-c',script,str(self.lab/'controller.lock')],capture_output=True,cwd=Path(__file__).parent)
        self.assertNotEqual(r.returncode,0)
        self.assertIn(b'controller already locked',r.stderr)

    def test_interrupted_lock_holder_releases_kernel_lock(self):
        ready=self.lab/'ready'
        script='from controller import exclusive; from pathlib import Path; import sys,time\nwith exclusive(sys.argv[1]):\n Path(sys.argv[2]).write_text("ready"); time.sleep(30)'
        child=subprocess.Popen([sys.executable,'-c',script,str(self.lab/'controller.lock'),str(ready)],cwd=Path(__file__).parent)
        try:
            end=time.monotonic()+3
            while not ready.exists() and time.monotonic()<end: time.sleep(.01)
            self.assertTrue(ready.exists())
            with self.assertRaises(ProtocolError):
                with exclusive(self.lab/'controller.lock'): pass
        finally:
            child.terminate(); child.wait(timeout=3)
        with exclusive(self.lab/'controller.lock'): pass

    def test_session_cannot_takeover(self):
        with self.c.owned(): pass
        other=Controller(self.lab,'claude','other',self.expected)
        with self.assertRaisesRegex(ProtocolError,'handoff'):
            with other.owned(): pass

    def test_timeout_and_restart_never_republish(self):
        with self.assertRaisesRegex(ProtocolError,'TIMEOUT_UNKNOWN'): self.send(.03)
        original=(self.lab/'request.txt').read_bytes()
        restarted=Controller(self.lab,'codex','offline',self.expected,poll=.01)
        with self.assertRaisesRegex(ProtocolError,'unresolved'): restarted.submit('x7shot','x7','trial2')
        with self.assertRaises(ProtocolError): restarted.release()
        with self.assertRaises(ProtocolError): restarted.reconcile(.01)
        self.assertEqual(original,(self.lab/'request.txt').read_bytes())
        self.reply(); self.assertEqual(restarted.reconcile(.3)['state'],'DONE')

    def test_interrupted_publish_retains_intent(self):
        import controller
        real=controller.atomic
        def fail(path,value):
            if Path(path).name=='request.txt': raise OSError('interrupted before publication')
            return real(path,value)
        with patch('controller.atomic',side_effect=fail):
            with self.assertRaises(OSError): self.send()
        self.assertIsNotNone(read(self.lab/'controller.json')['pending'])
        with self.assertRaises(ProtocolError): self.send()

    def test_partial_json_fails_closed(self):
        with self.assertRaises(ProtocolError): self.send(.02)
        r=read(self.lab/'controller.json')['pending']; (self.lab/'responses').mkdir()
        (self.lab/'responses'/(r['requestId']+'.json')).write_text('{')
        with self.assertRaises(ValueError): self.c.reconcile(.02)
        self.assertIsNotNone(read(self.lab/'controller.json')['pending'])

    def test_interrupted_rename_and_undo(self):
        a,b,j=self.lab/'addon',self.lab/'addon.off',self.lab/'journal.json'; a.write_bytes(b'original')
        real=journal.atomic
        def crash(path,r):
            if r['state']=='APPLIED': raise OSError('power loss after rename')
            real(path,r)
        with patch('journal.atomic',side_effect=crash):
            with self.assertRaises(OSError): journal.rename(j,a,b)
        self.assertEqual(read(j)['state'],'INTENT')
        self.assertEqual(journal.recover(j)['state'],'APPLIED')
        self.assertEqual(journal.recover(j,undo=True)['state'],'ORIGINAL')
        self.assertEqual(a.read_bytes(),b'original')
        self.assertEqual(journal.recover(j,undo=True)['state'],'ORIGINAL')

    def test_rename_intent_before_mutation_and_ambiguous_rejection(self):
        a,b,j=self.lab/'a',self.lab/'b',self.lab/'j'; a.write_text('a')
        with patch.object(Path,'rename',side_effect=OSError('crash before rename')):
            with self.assertRaises(OSError): journal.rename(j,a,b)
        self.assertEqual(journal.recover(j)['state'],'ORIGINAL')
        b.write_text('unexpected')
        with self.assertRaises(ProtocolError): journal.recover(j,undo=True)
        b.unlink(); a.write_text('changed')
        with self.assertRaises(ProtocolError): journal.recover(j)

    def test_abandon_requires_changed_runtime_and_no_slot(self):
        with self.assertRaises(ProtocolError): self.send(.02)
        with self.assertRaises(ProtocolError): self.c.abandon_ended_runtime()
        old=self.c.expected.copy()
        self.c.expected=dict(old,loadedUtc='2026-10-22T16:00:00.0000000Z')
        with self.assertRaisesRegex(ProtocolError,'quarantine'): self.c.abandon_ended_runtime()
        (self.lab/'request.txt').unlink()  # simulates operator quarantine while old game stopped
        self.expected.update(self.c.expected)
        time.sleep(.03)
        self.c.abandon_ended_runtime()
        state=read(self.lab/'controller.json')
        self.assertIsNone(state['pending'])
        self.assertEqual(state['abandoned'][0]['outcome'],'UNKNOWN_OLD_RUNTIME_ENDED')

    def test_cli_failure_returns_nonzero(self):
        self.reply('ERROR')
        with self.assertRaises(ProtocolError): self.send()
        # Reintroduce pending to exercise CLI response handling in a fresh process.
        state=read(self.lab/'controller.json')
        state['pending']=read(next((self.lab/'requests').glob('*.json')))
        atomic(self.lab/'controller.json',state); atomic(self.lab/'expected.json',self.expected)
        r=subprocess.run([sys.executable,str(Path(__file__).with_name('controller.py')),
            '--lab',str(self.lab),'--owner','codex','--session','offline','--expected',str(self.lab/'expected.json'),'reconcile'],capture_output=True)
        self.assertEqual(r.returncode,2)
        self.assertIn(b'runtime failure',r.stderr)

    def test_durable_job_failure_and_unknown(self):
        job=Path(jobs.start(self.lab/'jobs',[sys.executable,'-c','print("evidence"); raise SystemExit(7)'],self.lab))
        end=time.monotonic()+10
        while jobs.status(job)['state']=='UNKNOWN_OR_RUNNING' and time.monotonic()<end: time.sleep(.05)
        self.assertEqual(jobs.status(job)['exitCode'],7)
        self.assertIn('evidence',(job/'output.log').read_text())
        self.assertEqual(jobs.status(self.lab/'missing')['state'],'UNKNOWN_OR_RUNNING')

if __name__=='__main__': unittest.main(verbosity=2)
