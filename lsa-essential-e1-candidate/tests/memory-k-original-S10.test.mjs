// W09 S10: executes original production runSequentialTurn + production
// P2 SQLite via the shared source-blocked probe. This negative probe cannot
// manufacture acceptance, native observation, or PS6 playback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOriginalRunnerProbe,expectedSourceBlocker}
  from './memory-k-original-runner-probe.mjs';

test('S10: authentic PS3/PS6 Director grant, cooldown and player interruption',async()=>{
  const probe=await executeOriginalRunnerProbe('S10');
  assert.equal(probe.actualRunnerInvoked,true);
  assert.equal(probe.p2StoreUsed,true);
  assert.equal(probe.oneHumanPlayer,true);
  assert.equal(probe.nativePlaybackVerified,false);assert.equal(probe.originalBackendAccepted,false);
  const missing=expectedSourceBlocker('S10');
  assert.equal(probe.blocker,missing);
  // This is a REQUIRED original source receipt gate, not an ignored TODO.
  // Actual runner+SQLite execution without original backend acceptance and
  // native verified ownership is never a passing original M0 scenario.
  assert.fail('SOURCE_BLOCKED_S10: '+missing);
});
