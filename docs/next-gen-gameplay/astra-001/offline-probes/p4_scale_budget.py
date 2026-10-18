#!/usr/bin/env python3
"""ASTRA-001 offline probe P4 -- representation cost per structure class (arithmetic only).

NOT a GTA measurement. Archetypal structures are ASSUMPTIONS standing in for real
Los Santos assets until Experiment E7 extracts real surface areas/volumes locally.
"""
import json
ARCH = {  # name: (structural volume m^3, structural surface m^2) -- assumed archetypes
  'house_2storey':   (125.0,     624.0),
  'midrise_8storey': (2900.0,  10560.0),
  'tower_50storey':  (26000.0, 108000.0),
  'bridge_600m':     (10000.0,  30000.0),
}
def costs(vol, area):
    return {
      'dense_voxels_10cm_MB': round(vol*1000*1/1e6, 1),           # 1 byte/voxel
      'dense_voxels_5cm_MB':  round(vol*8000*1/1e6, 1),
      'structural_chunks_1m3': int(vol),                          # bond graph nodes
      'structural_dof_6_per_chunk': int(6*vol),
      'prefractured_chunks_0.5m': int(vol/0.125),
      'prefractured_GB_at_15KB_per_chunk': round(vol/0.125*15e3/1e9, 2),
      'tile_state_bitmap_10cm_KB': round(area*100/8/1e3, 1),
      'event_log_MB_per_100k_impacts': 2.0,
    }
out = {k: costs(*v) for k, v in ARCH.items()}
# City-scale envelope as a formula with explicit ranges (not a measured count).
for n_bld, mean_vol, mean_area in [(5000, 1500, 5000), (20000, 2500, 8000), (50000, 4000, 12000)]:
    out[f'city_envelope_{n_bld}_buildings'] = {
      'assumed_mean_volume_m3': mean_vol, 'assumed_mean_surface_m2': mean_area,
      'dense_voxels_10cm_GB': round(n_bld*mean_vol*1000/1e9, 1),
      'prefractured_0.5m_TB': round(n_bld*mean_vol/0.125*15e3/1e12, 1),
      'tile_state_10cm_GB_if_everything_damaged': round(n_bld*mean_area*100/8/1e9, 2),
    }
print(json.dumps(out, indent=1))
