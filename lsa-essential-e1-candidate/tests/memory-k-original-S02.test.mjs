// W09 S02: executes original production runSequentialTurn + production
// P2 SQLite via the shared source-blocked probe. This negative probe cannot
// manufacture acceptance, native observation, or PS6 playback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOriginalRunnerProbe,expectedSourceBlocker}
  from './memory-k-original-runner-probe.mjs';

test('S02: mundane firing after 180 seconds requires genuine source-time witness and recall',async()=>{
  const probe=await executeOriginalRunnerProbe('S02');
  assert.equal(probe.actualRunnerInvoked,true);
  assert.equal(probe.p2StoreUsed,true);
  assert.equal(probe.oneHumanPlayer,true);
  assert.equal(probe.nativeOwnerVerified,false);assert.equal(probe.durableAcceptedRows,0);
  const missing=expectedSourceBlocker('S02');
  assert.equal(probe.blocker,missing);
  // This is a REQUIRED original source receipt gate, not an ignored TODO.
  // Actual runner+SQLite execution without original backend acceptance and
  // native verified ownership is never a passing original M0 scenario.
  assert.fail('SOURCE_BLOCKED_S02: '+missing);
});
