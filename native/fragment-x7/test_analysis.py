"""Synthetic unit fixtures only; these must never become game evidence."""
import unittest, json, tempfile
from pathlib import Path
from unittest.mock import patch
from analyze_x7 import classify,iou,choose,largest_component,load,decode
class ClassificationContract(unittest.TestCase):
 def test_frozen_order(self):
  self.assertEqual(classify(25,0,1,0),"WHOLE")
  self.assertEqual(classify(8,1.2,.7,.3),"LOCAL")
  self.assertEqual(classify(2,.15,.9,.9),"SMALL")
  self.assertEqual(classify(0,.1,.9,99),"NONE")
  self.assertEqual(classify(17,3,.4,.1),"PARTIAL")
 def test_iou(self):
  a={"nu":2,"nv":2,"pitch":.1,"u0":0,"v0":0,"mask":"0011"}
  b={**a,"mask":"0101"}
  self.assertAlmostEqual(iou(a,b),1/3,places=3)
  self.assertEqual(largest_component("0111",2,2),1)
 def test_walk5_mask_not_misclassified_as_original_session_a(self):
  row={"nu":25,"nv":20,"mask":"0"*100+"1"*400,"pitch":.1,"u0":-1.208,"v0":.16}
  res={"label":"synthetic_only","model":"lsa_x7c_walk5_j1000",
       "aimU":0,"aimV":.8,"nativeParts":2,"committed":True}
  shot=decode(res,row)
  self.assertEqual(shot["layout"],"walk5")
  self.assertEqual(len(shot["pieceStates"]),5)
  self.assertEqual(shot["class"],"WALK5_EXPERIMENT")
  self.assertEqual(choose([shot])["state"],"STOP_CONTROL")
 def test_no_evidence_means_no_tstar(self):
  self.assertEqual(choose([])["state"],"STOP_CONTROL")
 def test_split_commands_keep_pre_result_timing_and_later_restore(self):
  # Synthetic parser fixture only, never written into the evidence directory.
  with tempfile.TemporaryDirectory() as temp:
   a=Path(temp)/'01.jsonl'; b=Path(temp)/'02.jsonl'
   a.write_text('\n'.join(json.dumps(x) for x in [
    {"kind":"x7_shot_begin","label":"fixture"},
    {"kind":"x7_frames","windowMaxMs":17},
    {"kind":"x7_result","label":"fixture","model":"fixture"},
    {"kind":"x7_mask","label":"fixture"}]))
   b.write_text(json.dumps({"kind":"x7_restored","originalBlocked":9,"restoredToOriginal":True}))
   with patch('analyze_x7.decode',return_value={"label":"fixture"}):
    shot=load([b,a])[0]
   self.assertEqual(shot['windowMaxMs'],17)
   self.assertEqual(shot['restore']['originalBlocked'],9)
 def test_missing_mask_keeps_failed_swap_and_restore(self):
  with tempfile.TemporaryDirectory() as temp:
   a=Path(temp)/'01.jsonl'
   a.write_text('\n'.join(json.dumps(x) for x in [
    {"kind":"x7_shot_begin","label":"fixture"},
    {"kind":"x7_frames","windowMaxMs":17},
    {"kind":"x7_result","label":"fixture","committed":False,"nativeParts":0},
    {"kind":"x7_restored","originalBlocked":6,"restoredToOriginal":False}]))
   shot=load([a])[0]
   self.assertFalse(shot['committed'])
   self.assertEqual(shot['restore']['originalBlocked'],6)
   self.assertIsNone(iou(shot,shot))
 def test_multiple_walks_preserve_outside_footprint_failure(self):
  with tempfile.TemporaryDirectory() as temp:
   a=Path(temp)/'01.jsonl'
   a.write_text('\n'.join(json.dumps(x) for x in [
    {"kind":"x7_shot_begin","label":"fixture"},
    {"kind":"x7_result","label":"fixture","committed":False},
    {"kind":"x7_player_result","crossed":False,"reason":"no_clear_lane_0.9m"},
    {"kind":"x7_player_result","crossed":True,"outsideFootprint":True,"maxRise":0}]))
   shot=load([a])[0]
   self.assertEqual(len(shot['walkAttempts']),2)
   self.assertTrue(shot['walk']['outsideFootprint'])
if __name__=="__main__":unittest.main()
