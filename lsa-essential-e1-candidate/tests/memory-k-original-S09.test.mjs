// W09 S09: executes original production runSequentialTurn + production
// P2 SQLite via the shared source-blocked probe. This negative probe cannot
// manufacture acceptance, native observation, or PS6 playback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOriginalRunnerProbe,expectedSourceBlocker}
  from './memory-k-original-runner-probe.mjs';

test('S09: source-linked final STT correction replaces misheard bytes',async()=>{
  const probe=await executeOriginalRunnerProbe('S09');
  assert.equal(probe.actualRunnerInvoked,true);
  assert.equal(probe.p2StoreUsed,true);
  assert.equal(probe.oneHumanPlayer,true);
  assert.ok(probe.providerMockCalls.includes('stt_mock'));assert.equal(probe.durableAcceptedRows,0);
  const missing=expectedSourceBlocker('S09');
  assert.equal(probe.blocker,missing);
  // This is a REQUIRED original source receipt gate, not an ignored TODO.
  // Actual runner+SQLite execution without original backend acceptance and
  // native verified ownership is never a passing original M0 scenario.
  assert.fail('SOURCE_BLOCKED_S09: '+missing);
});
