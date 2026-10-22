"""Replay the real failed smoke: do not walk into an uncommitted wall or lose restore evidence."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import controller as c
import smoke_x72c as smoke

EVIDENCE = Path(__file__).resolve().parents[2] / 'docs/agent-operations/2026-10-22/p2smoke/evidence'


class Replay:
    def __init__(self, unknown_shot=False, unknown_restore=False):
        self.lab = EVIDENCE
        self.state = {}
        self.commands = []
        self.unknown_shot, self.unknown_restore = unknown_shot, unknown_restore
        self.responses = {}
        for path in (EVIDENCE / 'responses').glob('*.json'):
            row = c.read(path)
            self.responses[row['trialId']] = row

    def submit(self, command, experiment, trial, timeout):
        self.commands.append(command.split()[0])
        if (trial == 'smoke-shot' and self.unknown_shot) or ('restore' in trial and self.unknown_restore):
            raise c.ProtocolError('TIMEOUT_UNKNOWN')
        row = self.responses[trial]
        if 'restore' in trial:
            self.state['last'] = dict(command=command, requestId=row['requestId'])
            raise c.ProtocolError('runtime failure original_restore_requires_9_of_9')
        return row


class SmokeTests(unittest.TestCase):
    def replay(self, ctl):
        with tempfile.TemporaryDirectory() as temp, patch.object(c, 'collect'):
            verdict, code = smoke.run(ctl, Path(temp) / 'new')
        return verdict, code

    def test_failed_shot_stops_before_walk_and_retains_failed_restore(self):
        ctl = Replay()
        verdict, code = self.replay(ctl)
        self.assertEqual(ctl.commands, ['x7prepare', 'x7cam', 'x7shot', 'x7restore'])
        self.assertEqual(code, 2)
        self.assertEqual(verdict['error']['step'], 'shot')
        self.assertEqual(len(verdict['requestIds']), 4)
        self.assertEqual(verdict['worldRestoration'], 'FAIL_OR_MISSING')
        self.assertFalse(verdict['checks']['real_projectile_committed_before_explosion'])

    def test_unknown_shot_does_not_send_restore(self):
        ctl = Replay(unknown_shot=True)
        verdict, code = self.replay(ctl)
        self.assertEqual(ctl.commands, ['x7prepare', 'x7cam', 'x7shot'])
        self.assertEqual(verdict['commandOutcome'], 'UNKNOWN_RECONCILE_REQUIRED')
        self.assertEqual(code, 2)

    def test_unknown_restore_requires_reconciliation(self):
        verdict, code = self.replay(Replay(unknown_restore=True))
        self.assertEqual(verdict['commandOutcome'], 'UNKNOWN_RECONCILE_REQUIRED')
        self.assertEqual(code, 2)

    def test_existing_evidence_refused_before_command(self):
        ctl = Replay()
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'must be new'):
                smoke.run(ctl, temp)
        self.assertEqual(ctl.commands, [])

    def test_unreadable_shot_evidence_still_restores_once(self):
        ctl = Replay()
        original = smoke.rows_of
        def read_rows(path):
            if '170801' in str(path):
                raise ValueError('incomplete evidence')
            return original(path)
        with tempfile.TemporaryDirectory() as temp, patch.object(c, 'collect', side_effect=c.ProtocolError('collection incomplete')), patch.object(smoke, 'rows_of', side_effect=read_rows):
            out = Path(temp) / 'new'
            with self.assertRaises(c.ProtocolError):
                smoke.run(ctl, out)
            self.assertTrue((out / 'verdict.json').is_file())
        self.assertEqual(ctl.commands, ['x7prepare', 'x7cam', 'x7shot', 'x7restore'])


if __name__ == '__main__':
    unittest.main()
