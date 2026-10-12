// W09 S06: executes original production runSequentialTurn + production
// P2 SQLite via the shared source-blocked probe. This negative probe cannot
// manufacture acceptance, native observation, or PS6 playback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOriginalRunnerProbe,expectedSourceBlocker}
  from './memory-k-original-runner-probe.mjs';

test('S06: same verified facts must pass one PS4 frame for different personality interpretations',async()=>{
  const probe=await executeOriginalRunnerProbe('S06');
  assert.equal(probe.actualRunnerInvoked,true);
  assert.equal(probe.p2StoreUsed,true);
  assert.equal(probe.oneHumanPlayer,true);
  assert.equal(probe.npcIds.length,2);assert.equal(probe.durableAcceptedRows,0);
  const missing=expectedSourceBlocker('S06');
  assert.equal(probe.blocker,missing);
  // This is a REQUIRED original source receipt gate, not an ignored TODO.
  // Actual runner+SQLite execution without original backend acceptance and
  // native verified ownership is never a passing original M0 scenario.
  assert.fail('SOURCE_BLOCKED_S06: '+missing);
});
