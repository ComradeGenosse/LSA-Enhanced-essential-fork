import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectOriginalTurnPriority} from '../src/perception/essentialTurnPriority.mjs';
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
  assert.match(output,/projectOriginalTurnPriority/);
  assert.doesNotMatch(output,/directorTurnPrioritySnapshot\(\)[^}]{0,300}SpecialGeminiTurnScheduler/);
});
