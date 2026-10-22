import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
import coordinator as c

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.q = c.Queue(Path(self.tmp.name)/'queue'); self.addCleanup(self.q.db.close)
        self.ws = str(Path(self.tmp.name).resolve())
        c.dump(self.q.root/'config.json',{'workspaces':{'claude':[self.ws],'codex':[self.ws]},'max_hops':2})

    def submit(self,target='claude',parent=None):
        return self.q.submit(target,self.ws,'harmless task',5,parent)

    def test_chain_and_hop_limit(self):
        a=self.submit(); b=self.submit('codex',self.q.get(a)); d=self.submit('claude',self.q.get(b))
        self.assertEqual(self.q.get(d)['root_id'],a)
        with self.assertRaises(ValueError): self.submit('codex',self.q.get(d))
        with self.assertRaises(ValueError): self.submit('claude',self.q.get(a))

    def test_workspace_and_timeout_gates(self):
        with self.assertRaises(ValueError): self.q.submit('claude',str(Path(self.ws).parent),'x')
        with self.assertRaises(ValueError): self.q.submit('claude',self.ws,'x',3601)

    def test_transaction_rolls_back_child(self):
        a=self.submit()
        with self.assertRaises(RuntimeError):
            with self.q.transaction():
                self.submit('codex',self.q.get(a)); raise RuntimeError('simulated interruption')
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM tasks').fetchone()[0],1)

    def test_crash_is_unknown_never_replayed(self):
        a=self.submit(); self.q.state(a,'RUNNING',pid=123)
        b=self.submit('codex')
        with patch.object(c,'execute') as execute:
            with self.assertRaises(RuntimeError): c.worker(self.q,True)
            execute.assert_not_called()
        self.assertEqual(self.q.get(a)['state'],'UNKNOWN')
        self.assertEqual(self.q.get(b)['state'],'QUEUED')

    def test_cancelled_is_never_executed(self):
        a=self.submit(); self.q.state(a,'CANCELLED')
        with patch.object(c,'execute') as execute:
            c.worker(self.q,True); execute.assert_not_called()

    def test_worker_exclusion(self):
        with c.worker_lock(self.q.root):
            with self.assertRaises((RuntimeError,OSError)):
                with c.worker_lock(self.q.root): pass

    def test_reopen_preserves_results_and_event_journal(self):
        a=self.submit(); self.q.state(a,'SUCCEEDED',result=json.dumps({'answer':'42'}))
        other=c.Queue(self.q.root)
        try:
            self.assertEqual(other.get(a)['state'],'SUCCEEDED')
            self.assertEqual(other.db.execute('SELECT count(*) FROM events').fetchone()[0],2)
        finally: other.db.close()

    def test_actual_timeout_terminates_process(self):
        cfg=self.q.config(); cfg['executables']={'codex':sys.executable}; c.dump(self.q.root/'config.json',cfg)
        # Exceeds the pipe buffer; child never drains stdin. Timeout must still fire.
        task=self.q.submit('codex',self.ws,'x'*90000,5); original=subprocess.Popen; children=[]
        def launch(_args, **kw):
            if len(_args) < 2 or _args[1] != 'exec': return original(_args, **kw)
            child=original([sys.executable,'-c','import time; time.sleep(60)'],**kw)
            children.append(child); return child
        with patch.object(c.subprocess,'Popen',side_effect=launch): c.worker(self.q,True)
        self.assertEqual(self.q.get(task)['state'],'TIMED_OUT')
        self.assertIsNotNone(children[0].poll())

    def test_unconfirmed_termination_pauses_queue(self):
        a=self.submit(); b=self.submit('codex')
        with patch.object(c,'execute',side_effect=c.UnknownExecution('termination unknown')):
            with self.assertRaises(RuntimeError): c.worker(self.q,True)
        self.assertEqual(self.q.get(a)['state'],'UNKNOWN')
        self.assertEqual(self.q.get(b)['state'],'QUEUED')

if __name__=='__main__': unittest.main()
