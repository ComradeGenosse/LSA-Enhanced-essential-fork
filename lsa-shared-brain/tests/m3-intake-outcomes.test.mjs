// WS-5b: every intake decision is reported exactly once so the coverage ledger
// can never certify a moment whose observation was lost or is still undecided.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {M3BoundedIntake} from '../src/events/m3BoundedIntake.mjs';

const receipt=()=>({observation:{observationId:randomUUID(),revision:1,
  observer:{captureRef:randomUUID(),kind:'ped'},
  observedAt:{nativeRun:randomUUID(),gameTick:1000,receivedUtc:'2026-10-13T12:00:00.000Z'}}});
const binder=(result)=>({bindAcceptedReceipt:r=>typeof result==='function'?result(r):result});
const ok=r=>({accepted:true,observation:r.observation,candidate:{characterId:randomUUID()}});
function rig({bind=ok,capture,limit=8,scheduler}={}) {
  const outcomes=[];
  const intake=new M3BoundedIntake({binder:binder(bind),recorder:{capture,bufferBeforePromotion:()=>({accepted:true}),reset(){}},limit,
    ...(scheduler?{scheduler}:{}),onOutcome:o=>outcomes.push(o)});
  return {intake,outcomes};
}

test('committed, duplicate, superseded-revision and failed commits each produce exactly one terminal outcome',async()=>{
  const results=[{accepted:true,inserted:true},{accepted:true,duplicate:true},
    Promise.reject(new Error('journal_stale_event_revision')),
    Promise.reject(new Error('boom')),{accepted:false,reason:'x'}];
  let i=0;
  const {intake,outcomes}=rig({capture:async()=>results[i++]});
  for(let n=0;n<5;n++){intake.offer(receipt());await intake.idle();}
  const queued=outcomes.filter(o=>o.type==='queued'),done=outcomes.filter(o=>o.type!=='queued');
  assert.equal(queued.length,5);
  assert.equal(done.length,5);
  assert.deepEqual(done.map(o=>o.type==='settled'?o.result:o.reason),
    ['committed','duplicate','stale','commit_failed','recorder_rejected']);
  assert.deepEqual(done.map(o=>o.entryId),queued.map(o=>o.entryId),'terminal outcome carries the queued entry id');
  const s=intake.snapshot();
  assert.equal(s.committed,1);assert.equal(s.duplicate,1);assert.equal(s.stale,1);
  assert.equal(s.failed,1);assert.equal(s.rejected,1);
});

test('refusals, overflow and retirement are reported as losses, never silently dropped',async()=>{
  const held=[];
  const refused=receipt();
  const {intake,outcomes}=rig({limit:1,scheduler:fn=>held.push(fn),
    bind:r=>r.observation.observationId===refused.observation.observationId?{accepted:false,reason:'m3_native_owner_unverified'}:ok(r),
    capture:async()=>({accepted:true,inserted:true})});
  intake.offer(refused);
  const a=receipt(),b=receipt();
  intake.offer(a);intake.offer(b);                // second overflows the 1-slot queue
  intake.retire();                                // queued one is retired before commit
  held.splice(0).forEach(fn=>fn());
  await intake.idle();
  const reasons=outcomes.filter(o=>o.type==='refused'||o.type==='lost').map(o=>o.reason);
  assert.deepEqual(reasons.sort(),['intake_overflow','owner_unverified','retired_before_commit'].sort());
  assert.equal(intake.snapshot().unattributed,1);
});

test('an outcome callback that throws can never disturb capture',async()=>{
  const intake=new M3BoundedIntake({binder:binder(ok),recorder:{capture:async()=>({accepted:true,inserted:true}),bufferBeforePromotion:()=>({accepted:true})},
    onOutcome:()=>{throw new Error('listener bug');}});
  assert.equal(intake.offer(receipt()).accepted,true);
  await intake.idle();
  assert.equal(intake.snapshot().committed,1);
});
