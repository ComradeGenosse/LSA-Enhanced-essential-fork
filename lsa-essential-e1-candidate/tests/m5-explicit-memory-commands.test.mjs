import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {detectExplicitMemoryCommand,handleExplicitMemoryCommand,memoryActionAcknowledgement} from '../../lsa-shared-brain/src/memory/explicitCommands.mjs';
import {FixtureMemoryCommandStore} from '../../lsa-shared-brain/src/memory/fixtureMemoryCommandStore.mjs';

const scope={
  characterId:'11111111-1111-4111-8111-111111111111',
  worldProfileId:'22222222-2222-4222-8222-222222222222',
  timelineId:'33333333-3333-4333-8333-333333333333',
  protagonistKey:'franklin'
};
const baseTime='2026-10-11T21:00:00.000Z';
const sec=(n=0)=>new Date(Date.parse(baseTime)+n*1000).toISOString();
const line=(content,n=0,more={})=>({
  version:1,kind:'dialogue_line',recordId:randomUUID(),
  ...scope,speaker:'player',source:'typed',delivery:'accepted',
  content,committedAtUtc:sec(n),...more
});
const candidate=(content,n=-10,more={})=>({
  recordId:randomUUID(),kind:'journal_event',...scope,
  content,occurredAtUtc:sec(n),receiptStatus:'witnessed',
  eventType:'crash',...more
});
async function setup(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lsa-m5-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let writable=true;
  const filePath=path.join(dir,'fixtures.json');
  const makeStore=()=>new FixtureMemoryCommandStore({
    filePath,scope,assertTimelineWrite:(s)=>{
      if (!writable || s.timelineId!==scope.timelineId)throw Error('timeline_write_suspended');
      return true;
    }
  });
  const store=makeStore();
  return {store,makeStore,filePath,setWritable:v=>{writable=v;}};
}
const act=(store,input,extras={})=>handleExplicitMemoryCommand({
  line:input,scope,commandId:randomUUID(),store,...extras
});
const isAction=action=>{
  assert.equal(action.kind,'memory_action');
  assert.equal(action.version,1);
  assert.deepEqual(Object.keys(action).sort(),
    ['version','characterId','worldProfileId','timelineId','kind','commandId',
     'requestedByLineId','operation','outcome','durableCommit','evidenceRecordIds','memoryId'].sort());
};
test('M5 deterministic detector distinguishes commands from questions and idioms',()=>{
  assert.equal(detectExplicitMemoryCommand('Do you remember Lamar?').intent,'inspect');
  assert.equal(detectExplicitMemoryCommand('I forgot my keys'),null);
  assert.equal(detectExplicitMemoryCommand('We should remember to drive'),null);
  assert.equal(detectExplicitMemoryCommand('Never forget that I hate olives').pin,true);
  assert.equal(detectExplicitMemoryCommand('Nathan, remember what I just told you').selector,'dialogue');
  assert.equal(detectExplicitMemoryCommand('No, I said Grove Street').correctionMode,'transcript');
  assert.equal(detectExplicitMemoryCommand("That's not what happened, it was a bus").correctionMode,'counter_claim');
  assert.equal(detectExplicitMemoryCommand('forget what I said about Lamar').selector,'dialogue_topic');
  assert.equal(detectExplicitMemoryCommand('export my memories').intent,'export');
});
test('M5 claim commits to durable fixture, restarts, and never asserts it is a witnessed event',async t=>{
  const {store,makeStore}=await setup(t);
  const input=line('Remember that I hate olives');
  const response=await act(store,input);
  isAction(response);
  assert.equal(response.outcome,'saved');
  assert.equal(response.durableCommit,true);
  assert.deepEqual(response.evidenceRecordIds,[input.recordId]);
  assert.equal(memoryActionAcknowledgement(response),'I saved that memory.');
  const data=await makeStore().inspect({scope});
  assert.equal(data.memoryCount,1);
  assert.equal(data.memories[0].content,'I hate olives');
  assert.equal(data.memories[0].subjectCertainty,'reported');
  assert.equal(data.memories[0].origin,'explicit_player');
});
test('M5 unresolved deixis clarifies rather than invents song identity',async t=>{
  const {store}=await setup(t);
  const input=line('Remember that I hate this song');
  const response=await act(store,input);
  assert.equal(response.outcome,'clarify');
  assert.equal(response.durableCommit,false);
  assert.equal((await store.inspect({scope})).memoryCount,0);
});
test('M5 verified situation allows stated claim while keeping its reported provenance',async t=>{
  const {store}=await setup(t);
  const input=line('Remember that I hate this song');
  const response=await act(store,input,{verifiedContext:{referents:[{
    phrase:'this song',value:'A qualified radio track',verified:true,
    worldProfileId:scope.worldProfileId,timelineId:scope.timelineId
  }]}});
  assert.equal(response.outcome,'saved');
  assert.equal((await store.inspect({scope})).memories[0].subjectCertainty,'reported');
});
test('M5 binds uniquely grounded witnessed crash, not an unrelated event',async t=>{
  const {store}=await setup(t);
  const match=candidate('A crash on the freeway',-5);
  await store.seedCandidate(match);
  await store.seedCandidate(candidate('Gunfire at the docks',-8,{eventType:'gunfire'}));
  const response=await act(store,line('Remember this crash'));
  assert.equal(response.outcome,'saved');
  assert.deepEqual(response.evidenceRecordIds[0],match.recordId);
  const data=await store.inspect({scope});
  assert.equal(data.memories[0].recordType,'journal_event');
  assert.equal(data.memories[0].importance,85);
});
test('M5 ambiguous this asks rather than selecting a moment at random',async t=>{
  const {store}=await setup(t);
  await store.seedCandidate(candidate('A crash',-5));
  await store.seedCandidate(candidate('Another crash',-6));
  const response=await act(store,line('Remember this'));
  assert.equal(response.outcome,'clarify');
  assert.equal(response.durableCommit,false);
  assert.equal((await store.inspect({scope})).memoryCount,0);
});
test('M5 reported or cross-world evidence is ineligible',async t=>{
  const {store}=await setup(t);
  await store.seedCandidate(candidate('An unverified crash',-5,{receiptStatus:'reported'}));
  await store.seedCandidate(candidate('A crash by Michael',-6,{protagonistKey:'michael'}));
  const response=await act(store,line('Remember this crash'));
  assert.equal(response.outcome,'clarify');
});
test('M5 last player line is captured byte-exact without rewriting source',async t=>{
  const {store}=await setup(t);
  const source=candidate("My exact original words 😂  \t",-3,{
    kind:'dialogue_line',speaker:'player',source:'stt',delivery:'accepted',segmentId:'S1'
  });
  await store.seedCandidate(source);
  const response=await act(store,line('Remember what I just told you',0,{segmentId:'S1'}));
  assert.equal(response.outcome,'saved');
  assert.equal((await store.inspect({scope})).memories[0].content,source.content);
});
test('M5 transcript correction retains original and stores linked overlay',async t=>{
  const {store}=await setup(t);
  const original=candidate('I went to Growth Street',-4,{
    kind:'dialogue_line',speaker:'player',source:'stt',delivery:'accepted'
  });
  await store.seedCandidate(original);
  const response=await act(store,line('No, I said Grove Street'));
  assert.equal(response.outcome,'corrected');
  isAction(response);
  const data=await store.inspect({scope});
  assert.equal(data.corrections.length,1);
  assert.equal(data.corrections[0].targetRecordId,original.recordId);
  assert.equal(data.corrections[0].content,'Grove Street');
  assert.equal(data.corrections[0].originalUnchanged,true);
  assert.equal((await store.findCandidates({scope}))[0].content,original.content);
});
test('M5 forget creates suppression tombstone and hides target from subsequent recall',async t=>{
  const {store}=await setup(t);
  const source=candidate('I trust Lamar',-4,{
    kind:'dialogue_line',speaker:'player',source:'typed',delivery:'accepted'
  });
  await store.seedCandidate(source);
  const response=await act(store,line('Forget what I said about Lamar'));
  assert.equal(response.outcome,'forgotten');
  isAction(response);
  const data=await store.inspect({scope});
  assert.equal(data.tombstones[0].targetRecordId,source.recordId);
  assert.equal(data.tombstones[0].contentHash,createHash('sha256').update(source.content).digest('hex'));
  assert.equal((await store.findCandidates({scope})).length,0);
});
test('M5 replay of same command id is idempotent and verified across process restart',async t=>{
  const {store,makeStore}=await setup(t);
  const input=line('Remember that I will call Franklin');
  const commandId=randomUUID();
  const args={line:input,scope,commandId};
  const first=await handleExplicitMemoryCommand({...args,store});
  const second=await handleExplicitMemoryCommand({...args,store:makeStore()});
  assert.deepEqual(second,first);
  assert.equal((await store.inspect({scope})).memoryCount,1);
});
test('M5 repeating a remember command for same referent inside 60 seconds is deduplicated',async t=>{
  const {store}=await setup(t);
  const source=candidate('Crash at the freeway',-4);
  await store.seedCandidate(source);
  const a=await act(store,line('Remember this crash',0));
  const b=await act(store,line('Remember this crash',10));
  assert.equal(a.outcome,'saved');
  assert.equal(a.memoryId,b.memoryId);
  assert.equal((await store.inspect({scope})).memoryCount,1);
});
test('M5 writer fence suspends commit and cannot be bypassed by verified context',async t=>{
  const {store,setWritable}=await setup(t);
  setWritable(false);
  const response=await act(store,line('Remember that I hate olives'));
  assert.equal(response.outcome,'failed');
  assert.equal(response.durableCommit,false);
  assert.equal((await store.inspect({scope})).memoryCount,0);
});
test('M5 rollback before rename does not commit and cannot truthfully acknowledge',async t=>{
  const {store}=await setup(t);
  store.injectFailure('before_rename');
  const response=await act(store,line('Remember that I like the docks'));
  assert.equal(response.outcome,'failed');
  assert.equal((await store.inspect({scope})).memoryCount,0);
});
test('M5 lost receipt after rename returns failure until same-id replay verifies it',async t=>{
  const {store}=await setup(t);
  const input=line('Remember that I hate traffic');
  const commandId=randomUUID(),request={line:input,scope,commandId,store};
  store.injectFailure('after_rename');
  assert.equal((await handleExplicitMemoryCommand(request)).outcome,'failed');
  const replay=await handleExplicitMemoryCommand(request);
  assert.equal(replay.outcome,'saved');
  assert.equal((await store.inspect({scope})).memoryCount,1);
});
test('M5 a lying mock can never produce a verified success',async ()=>{
  const fake={
    findCandidates:async()=>[],
    commitCommand:async op=>({commandId:op.commandId,status:'committed',durableCommit:true}),
    verifyCommand:async()=>null
  };
  const response=await act(fake,line('Remember that I love pizza'));
  assert.equal(response.outcome,'failed');
  assert.equal(response.durableCommit,false);
});
test('M5 invalid addressee/scope and unaccepted speech fail closed',async t=>{
  const {store}=await setup(t);
  await assert.rejects(()=>act(store,line('Remember that I love pizza',0,{characterId:randomUUID()})),/invalid_memory_command_input/);
  await assert.rejects(()=>act(store,line('Remember that I love pizza',0,{delivery:'failed'})),/invalid_memory_command_input/);
  await assert.rejects(()=>act(store,line('Remember that I love pizza',0,{speaker:'npc'})),/invalid_memory_command_input/);
});
test('M5 inspector and export are read-only and restartable',async t=>{
  const {store}=await setup(t);
  await act(store,line('Remember that I love pizza'));
  const inspected=await act(store,line('Inspect memories',2));
  assert.equal(inspected.kind,'memory_read');
  assert.equal(inspected.status,'ok');
  assert.equal(inspected.data.memoryCount,1);
  const exp=await act(store,line('Export my memories',3));
  assert.equal(exp.status,'ok');
  const raw=await fs.readFile(exp.data.path,'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'),exp.data.sha256);
  assert.equal((await store.inspect({scope})).memoryCount,1);
});
