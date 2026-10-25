"""VH9 regression tests on synthetic, freely generated assets only."""
import csv
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from vh9_connected_mesh import (Probe, connected_grid, load_geometry,
                                render, safety, signed_areas, solve,
                                synthetic_probes)


class ConnectedWarpTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.sprite=self.root/'fakecar-shaded.png'
        self.geometry=self.root/'fakecar.json'
        self.geo={
            'schemaVersion':'vh6.vehicle-geometry.v1','model':'fakecar',
            'coordinateSystem':{'gtaFront':'+Y'},
            'dimensions':{'width':2.1,'length':4.7},
            'contour':{'vertices':[{'x':x,'y':y} for x,y in
                    [(-.30,.03),(.30,.03),(.43,.15),(.45,.75),(.32,.97),(-.32,.97),(-.45,.75),(-.43,.15)]]},
            'windowRegions':{'rings':[[{'x':x,'y':y} for x,y in
                     [(-.25,.32),(.25,.32),(.25,.69),(-.25,.69)]]]},
            'wheels':{name:{'hudNormalized':{'x':x,'y':y}} for name,x,y in
                       [('lf',-.46,.20),('rf',.46,.20),('lr',-.46,.79),('rr',.46,.79)]}
        }
        self.geometry.write_text(json.dumps(self.geo),encoding='utf-8')
        im=Image.new('RGBA',(256,552),(0,0,0,0))
        dr=ImageDraw.Draw(im)
        dr.polygon([(((v['x']+.55)/1.1)*255,((v['y']+.05)/1.1)*551) for v in self.geo['contour']['vertices']],
                   fill=(120,160,180,255))
        for y in range(40,540,20):
            dr.line([(40,y),(215,y)],fill=(240,240,230,255),width=2)
        im.save(self.sprite)

    def test_synthetic_regions_and_preserved_rear(self):
        for scenario in ('front-left','side','rear'):
            with self.subTest(scenario=scenario):
                probes,_=synthetic_probes(scenario)
                src,dst,report=solve(self.geo,probes,256,552)
                self.assertEqual('pass',report['safety'])
                self.assertGreater(report['max_pixel_shift'],.5)
                self.assertTrue((signed_areas(dst,connected_grid(256,552)[1])>0).all())
                shift=np.linalg.norm(dst-src,axis=1)
                if scenario=='front-left':
                    rear=src[:,1]>.80*551
                    self.assertLess(float(np.max(shift[rear])),.5)
                if scenario=='rear':
                    front=src[:,1]<.2*551
                    self.assertLess(float(np.max(shift[front])),.5)
                result=render(self.sprite,self.geometry,self.root/(scenario+'.png'),synthetic=scenario)
                self.assertEqual('synthetic_not_gta',result['kind'])
                self.assertTrue((self.root/(scenario+'.png')).exists())
                with Image.open(self.root/(scenario+'.png')) as preview:
                    self.assertEqual((256,552),preview.size)
                self.assertEqual('connected_shared_uv_triangles',result['renderer'])

    def test_no_motion_refuses_deformation(self):
        with self.assertRaisesRegex(ValueError,'No probe'):
            solve(self.geo,[],256,552)

    def test_inverted_triangles_rejected(self):
        src,tris=connected_grid(256,552)
        dst=src.copy()
        dst[tris[0][1]]=src[tris[0][0]]
        self.assertFalse(safety(src,dst,tris)[0])

    def test_wrong_schema_or_orientation_rejected(self):
        bad=dict(self.geo)
        bad['coordinateSystem']={'gtaFront':'-Y'}
        self.geometry.write_text(json.dumps(bad))
        with self.assertRaisesRegex(ValueError,'orientation'):
            load_geometry(self.geometry)

    def test_real_vh3_pair_and_insufficient_evidence(self):
        from vh9_connected_mesh import read_real_probes
        before,after=self.root/'baseline.csv',self.root/'damaged.csv'
        fields=['index','capture_id','model','handle','phase','region',
                'sample_x','sample_y','sample_z','min_x','min_y','min_z',
                'max_x','max_y','max_z','valid','dx','dy','dz','magnitude']
        def write(path,phase,impact):
            with path.open('w',newline='') as stream:
                out=csv.DictWriter(stream,fieldnames=fields);out.writeheader()
                for i in range(48):
                    sx=-.95+(i%8)*.27;sy=-2.1+(i//8)*.84
                    damage=(.12 if impact and i in (0,1,2,8) else 0)
                    out.writerow({'index':i,'capture_id':'case_1','model':'fakecar','handle':23,
                       'phase':phase,'region':'front' if i<16 else 'side','sample_x':sx,
                       'sample_y':sy,'sample_z':0,'min_x':-1.05,'max_x':1.05,
                       'min_y':-2.35,'max_y':2.35,'min_z':-.5,'max_z':1.1,
                       'valid':1,'dx':damage,'dy':damage,'dz':0,'magnitude':damage})
        write(before,'baseline',False);write(after,'damaged',True)
        probes,evidence=read_real_probes(before,after,self.geo)
        self.assertEqual(48,evidence['comparable'])
        self.assertEqual(4,evidence['changed'])
        self.assertEqual(4,len(probes))
        write(after,'damaged',False)
        with self.assertRaisesRegex(ValueError,'Insufficient'):
            read_real_probes(before,after,self.geo)

    def test_no_synthetic_output_as_gta_recording(self):
        r=render(self.sprite,self.geometry,self.root/'demo.png',synthetic='front-left')
        self.assertEqual(False,r['in_game_enabled'])
        self.assertEqual('synthetic_not_gta',r['kind'])
        self.assertTrue((self.root/'demo.vh9.json').exists())


if __name__ == '__main__':
    unittest.main()
