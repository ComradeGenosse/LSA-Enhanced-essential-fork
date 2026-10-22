"""Pure acceptance-oracle regressions; never contacts the Windows host or GTA."""
import unittest
import smoke_x73 as s


def fixture(first=1, foreign=False, walk=True):
    pair = {first, first + 1}
    u = {0: -0.65, 1: 0.0, 2: 0.25, 3: 0.65}[first]
    rows = {
        'prepare': [dict(kind='x7_armed', originalBlocked=9, twinBlocked=0)],
        'shot': [
            dict(kind='x7_selection', label=s.SHOT_LABEL, first=first, second=first+1,
                 mask=3 << first, impactU=u, impactV=0.8, readyCount=1,
                 projectile=123, origin='projected_intersection'),
            dict(kind='x7_result', label=s.SHOT_LABEL, committed=True, projectileSeen=True,
                 late=False, fallbackUsed=False, framesCommitToExplosion=2,
                 nativeParts=2, originalBlocked=0),
            *[dict(kind='x7_secstate', label=s.SHOT_LABEL, pos=p, selected=p in pair,
                   exists=True, visible=True, attached=True, rootAlive=True, moved=0)
              for p in range(5)],
            dict(kind='x7_probe', label=s.SHOT_LABEL,
                 strips_blocked_debris_other=' '.join('000' if p in pair else '300' for p in range(5))),
            dict(kind='x7_frames', label=s.SHOT_LABEL, over50=0),
        ],
        'walk': [dict(kind='x7_player_result', isPlayer=True, crossed=walk, passed=walk,
                      outsideFootprint=False, reason=None if walk else 'no_clear_lane_0.9m')],
        'restore': [dict(kind='x7_restored', originalBlocked=9, originalExists=True,
                         restoredToOriginal=True)],
    }
    if foreign:
        rows['shot'].append(dict(kind='x7_other_hit', label=s.SHOT_LABEL,
                                 isLabHandle=False, isStray=False, model=12, u=-0.2))
    return rows


class AutoImpactOracleTests(unittest.TestCase):
    def test_center_tie_is_one_two_and_not_forced_to_two_three(self):
        result = s.analyze(fixture(1))
        self.assertEqual(result['selectedPair'], [1, 2])
        self.assertEqual(result['gameplayOutcome'], 'PASS')

    def test_positive_impact_selects_two_three_without_aim_override(self):
        result = s.analyze(fixture(2))
        self.assertEqual(result['selectedPair'], [2, 3])
        self.assertEqual(result['gameplayOutcome'], 'PASS')

    def test_left_and_right_pairs(self):
        for first in (0, 3):
            self.assertEqual(s.analyze(fixture(first))['gameplayOutcome'], 'PASS')

    def test_foreign_collision_separate_from_valid_fracture(self):
        result = s.analyze(fixture(1, foreign=True, walk=False))
        self.assertEqual(result['fractureOutcome'], 'PASS')
        self.assertEqual(result['traversalOutcome'], 'BLOCKED_OR_CONFOUNDED_BY_FOREIGN_COLLISION')
        self.assertEqual(result['gameplayOutcome'], 'FAIL_OR_PARTIAL')
        self.assertEqual(result['worldRestoration'], 'PASS_9_OF_9')

    def test_missing_foreign_cannot_be_called_environment(self):
        result = s.analyze(fixture(1, walk=False))
        self.assertEqual(result['traversalOutcome'], 'FAILED_OR_UNRESOLVED')

    def test_wrong_selected_sections_cannot_be_accepted(self):
        rows = fixture(1)
        rows['shot'][2]['selected'] = True  # position zero
        self.assertEqual(s.analyze(rows)['fractureOutcome'], 'FAIL_OR_MISSING')

    def test_wrong_selection_policy_rejected_even_if_walk_succeeds(self):
        rows = fixture(2)
        rows['shot'][0]['impactU'] = 0.0
        self.assertEqual(s.analyze(rows)['gameplayOutcome'], 'FAIL_OR_PARTIAL')

    def test_missing_selection_fails_closed(self):
        rows = fixture()
        rows['shot'].pop(0)
        self.assertEqual(s.analyze(rows)['fractureOutcome'], 'FAIL_OR_MISSING')

    def test_no_restore_not_claimed(self):
        rows = fixture()
        rows['restore'] = []
        self.assertEqual(s.analyze(rows)['worldRestoration'], 'FAIL_OR_MISSING')

    def test_original_collision_loss_without_commit_is_not_hidden_swap(self):
        rows = fixture()
        rows['shot'].pop(0)  # Failed live shot has no selection event.
        rows['shot'][0].update(committed=False, projectileSeen=False,
                               nativeParts=0, framesCommitToExplosion=None)
        rows['walk'] = []
        result = s.analyze(rows)
        self.assertFalse(result['checks']['original_hidden_after_swap'])
        self.assertEqual(result['fractureOutcome'], 'FAIL_OR_MISSING')
        self.assertEqual(result['traversalOutcome'], 'NOT_RUN')


if __name__ == '__main__':
    unittest.main()
