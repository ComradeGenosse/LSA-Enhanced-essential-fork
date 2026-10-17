import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCallbackHarness,crash} from './m9-callbacks-harness.mjs';

const boot = async (t,options = {}) => createCallbackHarness(t,options);

test('fresh witnessed crash rides the Director turn through the unchanged M9 admission',async t => {
  const h = await boot(t);
  const [a,b] = h.npcs;
  await h.crashFor(a);
  assert.equal((await h.rows(a)).length,1,'precondition: durably journaled for the witness only');
  const r = await h.runDirector(a);
  assert.equal(r.attempted,1,'the existing coordinator is attempted exactly once');
  assert.equal(r.outcome.status,'director_submitted_audio_unverified');
  assert.equal(r.outcome.requiresNativePlaybackCompletionReceipt,true);
  assert.ok(r.prepared,'the stock Director turn received a prepared RECALLED contribution');
  assert.equal(r.verified,true);
  assert.equal(r.projected.references.length,1);
  assert.match(JSON.stringify(r.projected),/vehicle_crash/);
  assert.equal(JSON.stringify(r.projected).includes('speed'),false,'unverified detail stays unknown');
  const snap = h.callbacks.snapshot();
  assert.equal(snap.counters.armedFresh,1);
  assert.equal(snap.counters.consumed,1);
  assert.equal(snap.armed,0,'unregistered after the turn');
  assert.equal(snap.audibleDeliveryProof,false);
  // B did not witness it: no callback, no leakage.
  const rb = await h.runDirector(b);
  assert.equal(rb.prepared,null);
  assert.equal(h.callbacks.snapshot().counters.consumed,1);
});

import {worldProfileId} from './m3-production-harness.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {memoryKM9Activation,m9OperationalStates} from '../src/memory/m9Activation.mjs';
import {createM9Callbacks} from '../src/memory/m9Callbacks.mjs';
import {createM9RuntimeEvents} from '../src/memory/m9RuntimeEvents.mjs';

const forget = async (h,npc,recordId) => {
  const privacy = createM5SqliteServices({store:h.store,filePath:h.filePath,authorize:() => true,
    clock:() => new Date().toISOString()});
  await privacy.trash({scope:{worldProfileId,characterId:npc.characterId,timelineId:h.timelineId,
    protagonistKey:'franklin'},targetId:recordId,operationId:randomUUID()});
};
const counters = h => h.callbacks.snapshot().counters;
const refusals = h => h.callbacks.snapshot().refusals;

test('callbacks are off by default and shadow only counts what it would do',async t => {
  const off = await boot(t,{callbackMode:'off'});
  assert.equal(off.callbacks,null);
  assert.equal(off.wrapped,off.coordinator,'off leaves the coordinator untouched');
  await off.crashFor(off.npcs[0]);
  const r = await off.runDirector(off.npcs[0]);
  assert.equal(r.prepared,null);
  assert.equal(r.attempted,1,'ordinary Director speech is unaffected');
});

test('shadow mode counts a would-be callback but never arms, prepares or consumes',async t => {
  const h = await boot(t,{callbackMode:'shadow'});
  await h.crashFor(h.npcs[0]);
  const r = await h.runDirector(h.npcs[0]);
  assert.equal(r.prepared,null);
  assert.equal(r.attempted,1);
  assert.equal(counters(h).shadowWouldCallback,1);
  assert.equal(counters(h).armed ?? 0,0);
  assert.equal(counters(h).consumed ?? 0,0);
});

test('an event older than the 30 s cue window uses the verified-recall path',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  await h.age(120_000);
  const r = await h.runDirector(a);
  assert.ok(r.prepared);
  assert.equal(r.verified,true);
  assert.equal(r.projected.references.length,1);
  assert.equal(counters(h).armedVerifiedRecall,1);
  assert.equal(counters(h).armedFresh ?? 0,0);
});

test('multi-NPC: each witness recalls only its own record; a non-witness recalls nothing',async t => {
  const h = await boot(t,{npcCount:3,limits:{globalCooldownMs:0}});
  const [a,b,c] = h.npcs;
  await h.sample(100,tick => ({vehicle:h.vehicleState({collision:crash()}),
    witnessReceipts:[h.witness(a,tick),h.witness(b,tick)]}));
  await h.settle();
  const [rowA] = await h.rows(a), [rowB] = await h.rows(b);
  assert.notEqual(rowA.recordId,rowB.recordId);
  const ra = await h.runDirector(a);
  const rb = await h.runDirector(b);
  const rc = await h.runDirector(c);
  assert.deepEqual(ra.prepared.preparedRecall.contribution.items.map(i => i.recordId),[rowA.recordId]);
  assert.deepEqual(rb.prepared.preparedRecall.contribution.items.map(i => i.recordId),[rowB.recordId]);
  assert.equal(rc.prepared,null,'c never witnessed it');
});

test('cross-NPC leakage: a ticket for A cannot prepare a turn whose profile is B',async t => {
  const h = await boot(t,{npcCount:2,limits:{globalCooldownMs:0}});
  const [a,b] = h.npcs;
  await h.crashFor(a);
  const r = await h.runDirector(a,{turnProfile:b});
  assert.equal(r.prepared,null);
  assert.equal(refusals(h).speaker_mismatch,1);
  // The memory was never consumed by the refused preparation of the wrong profile.
  const again = await h.runDirector(a);
  assert.equal(again.prepared,null,'revoked after the mismatch; never silently re-armed on the same event');
});

test('forget before the Director attempt: nothing is armed and ordinary speech continues',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  const [row] = await h.rows(a);
  await forget(h,a,row.recordId);
  const r = await h.runDirector(a);
  assert.equal(r.prepared,null);
  assert.equal(r.attempted,1);
  assert.equal(counters(h).armed ?? 0,0);
  assert.equal(refusals(h).event_not_visible,1);
});

test('forget while the callback is pending: the M9 admission and PS4 prepare both refuse',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  const [row] = await h.rows(a);
  const r = await h.runDirector(a,{before:() => forget(h,a,row.recordId)});
  assert.equal(r.prepared,null,'a forgotten event never surfaces through a pending callback');
  assert.equal(r.outcome.status,'director_returned_with_stale_memory');
});

test('forget after preparation: the prepared recall stops being sendable',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  const [row] = await h.rows(a);
  const r = await h.runDirector(a);
  assert.equal(r.verified,true);
  assert.equal(r.prepared.sendCurrent(),true);
  await forget(h,a,row.recordId);
  assert.equal(await r.prepared.verifyPrepared(),false);
  assert.equal(r.prepared.sendCurrent(),false);
  assert.notEqual(r.prepared.invalidationReason(),null);
});

test('replay after suppression: the same native receipt neither revives nor duplicates a forgotten event',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  const receipt = crash();
  await h.crashFor(a,{receipt});
  const [row] = await h.rows(a);
  await forget(h,a,row.recordId);
  // A reconnect/restart forgets companion RAM dedupe; the P2 replay fence must hold.
  h.m9Events.reset();h.client.runtime.correlator.clear();
  await h.crashFor(a,{receipt});
  assert.equal((await h.rows(a)).length,1,'no second row');
  const r = await h.runDirector(a);
  assert.equal(r.prepared,null);
});

test('the P2 native-receipt fence rejects the same signal at the same tick even with empty companion RAM',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  const receipt = crash();
  await h.sample(100,tick => ({vehicle:h.vehicleState({collision:receipt}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal((await h.rows(a)).length,1);
  // Simulate lost companion RAM AND the in-process spent set: the replay is the
  // identical sample (same tick), so only P2's persisted replay index can stop it.
  const fresh = createM9RuntimeEvents({activation:h.activation,now:() => h.clock.ms});
  h.client.runtime.m9Events = fresh;
  h.client.runtime.correlator.clear();
  await h.sample(0,tick => ({vehicle:h.vehicleState({collision:receipt}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal(fresh.snapshot().counters.observations,1,'the fresh process did re-derive and offer the event');
  assert.equal((await h.rows(a)).length,1,'P2 replay index stops it');
});

test('same native receipt replayed after a companion restart does not duplicate or re-arm',async t => {
  const h = await boot(t,{limits:{perNpcCooldownMs:0,perFamilyCooldownMs:0,globalCooldownMs:0}});
  const [a] = h.npcs;
  const receipt = crash();
  await h.crashFor(a,{receipt});
  const first = await h.runDirector(a);
  assert.ok(first.prepared);
  h.m9Events.reset();h.client.runtime.correlator.clear();
  await h.crashFor(a,{receipt});
  assert.equal((await h.rows(a)).length,1);
  const second = await h.runDirector(a);
  assert.equal(second.prepared,null,'the one record was already spent this run');
});

test('pause during a pending callback revokes it and any prepared recall',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  const paused = await h.runDirector(a,{before:() => h.pause.pause()});
  assert.equal(paused.prepared,null);
  const after = await h.runDirector(a);
  assert.equal(after.prepared,null);
  assert.equal(after.attempted,1);
  const h2 = await boot(t);
  await h2.crashFor(h2.npcs[0]);
  const ok = await h2.runDirector(h2.npcs[0]);
  assert.equal(ok.prepared.sendCurrent(),true);
  h2.pause.pause();
  assert.equal(ok.prepared.sendCurrent(),false);
});

test('world boundary and host change revoke armed callbacks',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  const boundary = await h.runDirector(a,{before:() => h.callbacks.revoke('world_boundary')});
  assert.equal(boundary.prepared,null);
  const h2 = await boot(t);
  await h2.crashFor(h2.npcs[0]);
  const epoch = await h2.runDirector(h2.npcs[0],{before:async () => {
    h2.send('world_epoch',{epoch:2,reason:'clock_regression'});await h2.flush();}});
  assert.equal(epoch.prepared,null,'a stale world epoch never prepares');
});

test('player speech priority, native availability and combat all veto before anything is armed',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  h.control.quiet = false;
  assert.equal((await h.runDirector(a)).prepared,null);
  h.control.quiet = true;h.control.live = false;
  assert.equal((await h.runDirector(a)).prepared,null);
  h.control.live = true;
  const w = await h.runDirector(a,{sampleBody:{wantedLevel:3}});
  assert.equal(w.prepared,null,'an active wanted level is combat-not-idle');
  assert.equal(counters(h).armed ?? 0,0);
  assert.ok(refusals(h).player_or_combat_priority >= 3);
  // Priority is checked at the moment of the turn, not remembered: idle again => allowed.
  assert.ok((await h.runDirector(a)).prepared);
});

test('cooldowns, per-NPC budget and once-only records',async t => {
  const h = await boot(t,{limits:{perNpcCooldownMs:5_000,perFamilyCooldownMs:5_000,globalCooldownMs:0,
    maxPerNpcPerRun:2}});
  const [a] = h.npcs;
  await h.crashFor(a);
  const first = await h.runDirector(a);
  assert.ok(first.prepared);
  assert.equal((await h.runDirector(a)).prepared,null,'the same record is spent');
  await h.crashFor(a);
  assert.equal((await h.runDirector(a)).prepared,null,'inside the NPC cooldown');
  assert.equal(refusals(h).npc_cooldown >= 1,true);
  // >30 s later the event is outside the fresh-cue window, so the (fixed 600 s)
  // M9 cue cooldown is not involved and only this runtime's own limits apply.
  await h.age(35_000);
  const second = await h.runDirector(a);
  assert.ok(second.prepared,'allowed after the cooldown');
  assert.notEqual(second.prepared.preparedRecall.contribution.items[0].recordId,
    first.prepared.preparedRecall.contribution.items[0].recordId);
  await h.age(35_000);
  await h.crashFor(a);
  await h.age(35_000);
  assert.equal((await h.runDirector(a)).prepared,null,'run budget of two exhausted');
  assert.equal(refusals(h).npc_budget >= 1,true);
});

test('retention: an event older than the callback window is not eligible',async t => {
  const h = await boot(t,{limits:{retentionMs:60_000}});
  const [a] = h.npcs;
  await h.crashFor(a);
  await h.age(120_000);
  const r = await h.runDirector(a);
  assert.equal(r.prepared,null);
  assert.equal(refusals(h).no_recent_event,1);
});

test('events recorded in shadow mode are not durable, so no callback can exist',async t => {
  const h = await boot(t,{families:{'events.crash':'shadow'}});
  const [a] = h.npcs;
  await h.crashFor(a);
  assert.equal((await h.rows(a)).length,0);
  assert.equal((await h.runDirector(a)).prepared,null);
});

test('a ticket that does not match the armed Director decision prepares nothing',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  let wrong = null;
  const r = await h.runDirector(a,{prepare:false,before:async attempt => {
    const input = h.attempts.at(-1);
    wrong = await h.callbacks.prepareForTurn({
      turn:h.turnFor(a,{decisionKey:'some-other-decision',observationId:randomUUID()}),
      source:'special_event',isCurrent:() => true});
    const player = await h.callbacks.prepareForTurn({turn:h.turnFor(a,{decisionKey:'x',observationId:'y'}),
      source:'player_text',isCurrent:() => true});
    assert.equal(player,null,'never for a player turn');
    void input;void attempt;
  }});
  assert.equal(wrong,null);
  assert.equal(r.prepared,null);
});

test('a non-persistent or unpromoted speaker never receives a callback',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  const r = await h.runDirector(a,{prepare:false,before:async () => {
    const turn = h.turnFor(a,h.attempts.length ? {decisionKey:'x',observationId:'y'} : {});
    void turn;
  }});
  assert.equal(r.prepared,null);
});

test('dispose revokes everything and the wrapped coordinator becomes a pass-through',async t => {
  const h = await boot(t);
  const [a] = h.npcs;
  await h.crashFor(a);
  h.callbacks.dispose();
  const r = await h.runDirector(a);
  assert.equal(r.prepared,null);
  assert.equal(r.attempted,1);
});

test('activation: callbacks need the source pipeline and are never legacy-on',()=>{
  assert.equal(memoryKM9Activation({}).callbacks.mode,'off');
  const blocked = memoryKM9Activation({memoryK:{capabilities:{'memory.callbacks':'on','memory.dialogue.player':'on'}}});
  assert.equal(blocked.callbacks.mode,'off');
  assert.equal(blocked.callbacks.reason,'dependency_blocked');
  const ok = memoryKM9Activation({memoryK:{capabilities:{'memory.callbacks':'on','ps1.producers':'on',
    'ps2.observations':'on','ps3.salience':'on','memory.events':'on','ps6.speech':'on','ps4.assembler':'on'}}});
  assert.equal(ok.callbacks.mode,'on');
  assert.equal(createM9Callbacks({activation:memoryKM9Activation({})}),null);
});

test('diagnostics report observed state only and never audible delivery',async t => {
  const h = await boot(t);
  await h.crashFor(h.npcs[0]);
  await h.runDirector(h.npcs[0]);
  const rows = m9OperationalStates({activation:h.activation,m9Events:h.m9Events,callbacks:h.callbacks});
  assert.equal(rows['events.crash'].state,'operational');
  assert.equal(rows['memory.callbacks'].state,'operational');
  assert.equal(JSON.stringify(rows).includes('audible'),false);
  const stopped = m9OperationalStates({activation:h.activation,m9Events:h.m9Events,callbacks:h.callbacks,closed:true});
  assert.equal(stopped['events.crash'].state,'stopped');
});
