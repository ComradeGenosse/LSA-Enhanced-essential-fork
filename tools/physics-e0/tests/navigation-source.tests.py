"""Regression contract for remote pre-shot navigation streaming and cleanup."""
from pathlib import Path
p=Path(__file__).resolve().parents[3]/'native/physics-e0/Probes.cs'
s=p.read_text()
body=s[s.index('bool PrepareAutoPosition()'):s.index('bool CheckDestinationReady')]
assert body.index('ADD_NAVMESH_REQUIRED_REGION') < body.index('GET_SAFE_COORD_FOR_PED')
assert 'if(!navRegionRequested)' in body
assert 'true,outPos,14' in body and 'autoSite.AcceptSafeCoord' in body
assert 'navQueries++' in body and 'navMisses++' in body and 'navRejected++' in body
assert 'lastNavigationStatus=positionStatus' in body
assert s.index('ReleaseNavigationRegion();') > s.index('void StopAuto(')
release=s[s.index('void ReleaseNavigationRegion()'):s.index('bool CheckDestinationReady')]
assert 'if(!navRegionRequested)return' in release
assert 'REMOVE_NAVMESH_REQUIRED_REGIONS' in release
assert 'navRegionRequested=false' in release
assert body.index('if(teleportedPlayer)') < body.index('if(autoSite.IsNearby')
print('PASS: remote navigation request precedes safe query; bounded gates and owned cleanup retained')
