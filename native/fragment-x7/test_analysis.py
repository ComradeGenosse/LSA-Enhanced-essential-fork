"""Synthetic unit fixtures only; these must never become game evidence."""
import unittest
from analyze_x7 import classify,iou,choose,largest_component
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
 def test_no_evidence_means_no_tstar(self):
  self.assertEqual(choose([])["state"],"STOP_CONTROL")
if __name__=="__main__":unittest.main()
