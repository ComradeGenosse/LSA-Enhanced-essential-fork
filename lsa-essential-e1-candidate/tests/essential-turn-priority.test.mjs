import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectOriginalTurnPriority,OriginalEssentialTurnTimeline} from '../src/perception/essentialTurnPriority.mjs';
import {patchSource} from '../tools/buildCandidate.mjs';

const clear=()=>({
  micStatus:'idle',micActiveTurnId:'',micReleasedBeforeContextReady:false,
  liveTurns:0,activeTurnMappings:0,pendingSessionOpens:0,
  pendingOutputOwners:0,retiringOutputOwners:0,activeOutputOwners:0,
  pendingPlayerContext:0,pendingConversationContext:0,
  playerTurnRecoveries:0,micBufferedChunks:0,
});

test('original Essential backend quiet is a read-only negative observation, never a C-06 grant',()=>{
  const sample=projectOriginalTurnPriority(clear());
  assert.equal(sample.source,'original_essential_server_turn_stores');
  assert.equal(sample.quiet,true);
  assert.equal(sample.grantsNativeAdmission,false);
  assert.equal(Object.isFrozen(sample),true);
});

test('original backend mic start/release and hydration races do not appear quiet',()=>{
  for(const changed of [
    {micStatus:'capturing'},
    {micStatus:'waiting_context'},
    {micActiveTurnId:'mic-turn-1'},
    {micReleasedBeforeContextReady:true},
    {micBufferedChunks:2},
    {liveTurns:1},
  ]) {
    const snapshot=projectOriginalTurnPriority({...clear(),...changed});
    assert.equal(snapshot?.quiet,false,JSON.stringify(changed));
    assert.equal(snapshot?.grantsNativeAdmission,false);
  }
});

test('stock text, special, session-open and queued audio ownership are independently suppressive',()=>{
  for(const name of [
    'activeTurnMappings','pendingSessionOpens','pendingOutputOwners',
    'retiringOutputOwners','activeOutputOwners','pendingPlayerContext',
    'pendingConversationContext','playerTurnRecoveries',
  ]) {
    const snapshot=projectOriginalTurnPriority({...clear(),[name]:1});
    assert.equal(snapshot?.quiet,false,name);
  }
});

test('unknown, corrupt or incomplete original Essential turn stores fail closed',()=>{
  assert.equal(projectOriginalTurnPriority(null),null);
  assert.equal(projectOriginalTurnPriority({}),null);
  for(const [name,value] of [
    ['micStatus',null],['micActiveTurnId',undefined],
    ['micReleasedBeforeContextReady',undefined],
    ['liveTurns',-1],['activeTurnMappings',1.5],
    ['pendingSessionOpens',Infinity],['pendingOutputOwners',NaN],
    ['micBufferedChunks',2**53],
  ]) assert.equal(projectOriginalTurnPriority({...clear(),[name]:value}),null,name);
});

test('source-pinned backend bridge reads stock A state; no scheduler or synthetic idle authorization',async()=>{
  const source=await readFile(new URL('../upstream/server.bundle.mjs',import.meta.url),'utf8');
  const output=patchSource(source).output;
  assert.match(output,/directorTurnPrioritySnapshot\(\)/);
  assert.match(output,/A\.turnsById\.values\(\)/);
  assert.match(output,/A\.sessionOpenPromisesByPedId\.size/);
  assert.match(output,/A\.pendingOutputOwnerByPedId\.size/);
  assert.match(output,/inspectOriginalTurnPriority/);
  assert.doesNotMatch(output,/directorTurnPrioritySnapshot\(\)[^}]{0,300}SpecialGeminiTurnScheduler/);
});

test('original backend lifecycle revision rejects fast busy-idle-busy ABA even when final store counts match',()=>{
 const timeline=new OriginalEssentialTurnTimeline();
 const first=timeline.sample(clear());
 assert.equal(first.quiet,true);
 assert.equal(first.grantsNativeAdmission,false);
 timeline.transition('turn_intake');
 timeline.transition('turn_terminal');
 timeline.transition('turn_intake');
 const next=timeline.sample(clear());
 assert.equal(next.quiet,true);
 assert.equal(next.revision,first.revision+3);
 assert.notEqual(next.revision,first.revision);
});

test('async text/model terminal and session-retire boundaries advance a single source revision',()=>{
 const timeline=new OriginalEssentialTurnTimeline();
 let earlier=timeline.sample(clear()).revision;
 for(const event of ['turn_intake','turn_allocate','turn_terminal','turn_cancel','session_open',
    'session_retire','mic_reset','special_dispatch']) {
   assert.equal(timeline.transition(event),true);
   const sampled=timeline.sample(clear());
   assert.equal(sampled.revision,earlier+1,event);
   assert.equal(sampled.grantsNativeAdmission,false,event);
   earlier=sampled.revision;
 }
});

test('original backend source invalidation, wrap and malformed state are permanent',()=>{
 const t=new OriginalEssentialTurnTimeline({maxRevision:3});
 assert.ok(t.sample(clear()));
 t.transition('turn_intake');
 assert.ok(t.sample(clear()));
 t.transition('turn_terminal');
 assert.ok(t.sample(clear()));
 assert.equal(t.transition('turn_intake'),false);
 assert.equal(t.sample(clear()),null);
 assert.equal(t.revision,-1);
 const missing=new OriginalEssentialTurnTimeline();
 assert.equal(missing.sample({}),null);
 assert.equal(missing.sample(clear()),null);
 const unknown=new OriginalEssentialTurnTimeline();
 assert.equal(unknown.transition('fabricated_terminal'),false);
 assert.equal(unknown.sample(clear()),null);
});

test('pinned AST modifies original lifecycle entrypoints rather than polling alone',async()=>{
 const source=await readFile(new URL('../upstream/server.bundle.mjs',import.meta.url),'utf8');
 const patched=patchSource(source);
 for(const boundary of ['Xn','Xi','Zt','hK','WP','Ei','el','kb'])
   assert.ok(patched.edits.some(edit=>edit.label==='PS6 original lifecycle '+boundary));
 for(const event of ['turn_intake','turn_allocate','turn_terminal','turn_cancel','session_open',
  'session_retire','mic_reset','special_dispatch'])
   assert.ok(patched.output.includes('originalTurnTransition("'+event+'")'));
 assert.match(patched.output,/inspectOriginalTurnPriority/);
});


test('source-side original backend lease is exclusive, native ticket-specific, and cannot survive a mic/text ABA',()=>{
 let now=1000;
 const timeline=new OriginalEssentialTurnTimeline({now:()=>now});
 const a='71111111-1111-4111-8111-111111111111',b='81111111-1111-4111-8111-111111111111';
 const first=timeline.sample(clear());
 assert.ok(timeline.acquire(a,first));
 assert.equal(timeline.leaseCount,1);
 assert.equal(timeline.acquire(b,first),null,'a second candidate cannot borrow owner lease');
 assert.ok(timeline.check(a,timeline.sample(clear())));
 timeline.transition('turn_intake');
 timeline.transition('turn_terminal');
 assert.equal(timeline.leaseCount,0,'stock async takeover retires lease before another poll');
 assert.equal(timeline.check(a,timeline.sample(clear())),null);
 assert.equal(timeline.acquire(a,timeline.sample(clear())),null,'same ticket cannot rebase');
 assert.ok(timeline.acquire(b,timeline.sample(clear())),'new ticket can use later truly idle state');
 assert.equal(timeline.release(a),false,'foreign cancellation cannot free active lease');
 assert.equal(timeline.leaseCount,1);
 assert.equal(timeline.release(b),true);
 assert.equal(timeline.leaseCount,0);
 assert.equal(timeline.acquire(b,timeline.sample(clear())),null,'canceled ticket cannot be revived');
});

test('original backend ownership lease expires and revokes on hidden map mutation',()=>{
 let now=1000;
 const t=new OriginalEssentialTurnTimeline({now:()=>now});
 const ticket='91111111-1111-4111-8111-111111111111';
 const snapshot=t.sample(clear());
 assert.ok(t.acquire(ticket,snapshot,200));
 assert.ok(t.check(ticket,t.sample(clear())));
 const ownerChanged=t.sample({...clear(),pendingSessionOpens:1});
 assert.equal(ownerChanged.quiet,false);
 assert.equal(t.check(ticket,ownerChanged),null);
 assert.equal(t.acquire(ticket,t.sample(clear())),null);
 const next='a1111111-1111-4111-8111-111111111111';
 assert.ok(t.acquire(next,t.sample(clear()),200));
 now+=201;
 assert.equal(t.check(next,t.sample(clear())),null,'expiry cannot refresh the lease');
 assert.equal(t.acquire(next,t.sample(clear())),null,'expired lease is terminal');
});
