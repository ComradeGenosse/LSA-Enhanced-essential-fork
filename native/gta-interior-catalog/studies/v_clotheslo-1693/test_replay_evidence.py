"""Regression checks on published derived receipts; not a private replay."""
import json
from pathlib import Path
import unittest


class ReplayEvidenceTests(unittest.TestCase):
    def read(self, name):
        return json.loads(Path(__file__).with_name(name).read_text())

    def test_real_replay_preserves_vegetation_and_display(self):
        result = self.read('replay-results.json')
        self.assertTrue(result['partitionVerified'])
        self.assertEqual(result['deployment'], 'BLOCKED')
        self.assertTrue(all(result['mutationChecks'].values()))
        protected = [g for g in result['groups'] if g['name'].startswith('prop_')
                     or g['name'].startswith('v_51_clothing')
                     or (g['name']=='v_clotheslo' and g['child']=='root/0')]
        self.assertTrue(protected)
        self.assertTrue(all(g['cutRecords']==0 and g['openingMeasure']==0 for g in protected))
        self.assertTrue(any(g['protectedIntersection']>0 for g in protected))

    def test_clearance_retains_profile_blockers(self):
        result = self.read('alternative-evidence.json')
        for label in ('landing','turnToShop'):
            region = result['regions'][label]
            for field in ('surfaceIntersections','centerInsideBoxes','unsupportedBroadphase',
                          'entitySetIntersections','entitySetContainingBoxes',
                          'entitySetUnsupportedBroadphase'):
                self.assertEqual(region[field], [])
        self.assertTrue(all(row['meshGroups']>0 for row in result['entitySetCoverage']))
        self.assertTrue(any(row['name']=='v_51_posters' for row in
                            result['regions']['opening']['entitySetIntersections']))
        fresh = self.read('fresh-comparison.json')
        self.assertTrue(fresh['nonRunRecordsIdentical'])
        self.assertTrue(fresh['assetHashesIdentical'])
        self.assertFalse(fresh['errors'])


if __name__ == '__main__':
    unittest.main()
