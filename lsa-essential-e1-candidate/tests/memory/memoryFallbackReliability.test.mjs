// Focused fallback regressions. Real original-runner/P1/D02/P2 components
// are exercised through d01Harness; provider and native playback are scripted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';
import {createKnowledgeDelivery} from '../../src/context/knowledgeDelivery.mjs';

const configured=()=>({memoryK:{capabilities:{
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'on','memory.recall':'off','memory.commands':'off',
  'memory.interpretation':'off','memory.events':'off','memory.coverage':'off'
}}});
const response=()=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'I hear you.',command:''})}]
}]}),{headers:{'content-type':'application/json'}});
function recordModel(x){
  const requests=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    fetchImpl:async (_url,request)=>{
      requests.push({...JSON.parse(request.body),__projection:options.knowledgeProjection});
      return response();
    }});
  return requests;
}
const scene=body=>JSON.parse(body.__projection.modelAllocation.scene);
const isClean=body=>{
  const lanes=scene(body).lanes;
  assert.deepEqual(lanes.RECALLED.memories,[]);
  assert.equal(lanes.RECALLED.evidence?.length??0,0);
  assert.equal(lanes.RECALLED.characterOpinions?.length??0,0);
  assert.equal(body.input.filter(x=>x.role==='user').length,1);
  assert.match(body.input[0].content,/Learned memory is unavailable for this turn/);
};

test('optional native M2 readiness timeout cannot block typed or microphone STT/Luna',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  // D02 native memory binding fails, but the independent P1 owner remains valid.
  x.h.runtime.memoryD02={bindActorAtTurnStart:()=>null};
  const requests=recordModel(x);
  x.h.runtime.services.transcribe=async()=> 'Nathan, can you hear me?';
  const typed=await x.typed('Nathan, are you there?');
  assert.equal((await x.settled(typed)).status,'completed');
  const mic=await x.mic({audio:[1,2,3,4]});
  assert.equal((await x.settled(mic)).status,'completed');
  assert.equal(requests.length,2);
  requests.forEach(isClean);
  assert.match(requests[1].input.at(-1).content,/Nathan, can you hear me/);
  assert.equal((await x.journal()).players.length,0,'unverified D02 never saves');
});

test('optional memory preparation failure still gets one clean Luna reply',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  x.h.runtime.services.prepareLiveTurnMemory=async()=>{throw new Error('test memory read unavailable');};
  const requests=recordModel(x);
  const typed=await x.typed('Hello, Nathan.');
  assert.equal((await x.settled(typed)).status,'completed');
  assert.equal(requests.length,1);
  isClean(requests[0]);
});

test('pre-send stale context rebuilds one safe body before the first HTTP submission',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  // An actual prepared lane may report source_changed after the model body
  // has been assembled. That must not suppress a clean pre-HTTP rebuild.
  const originalPrepare=x.h.runtime.services.prepareLiveTurnMemory;
  x.h.runtime.services.prepareLiveTurnMemory=async args=>{
    const prepared=await originalPrepare(args);
    return prepared?Object.freeze({...prepared,invalidationReason:()=> 'source_changed'}):prepared;
  };
  const requests=recordModel(x),original=x.h.runtime.services.decide;
  let attempts=0;
  x.h.runtime.services.decide=options=>{
    if(++attempts===1)throw Object.assign(new Error('knowledge_request_stale'),
      {code:'knowledge_request_stale',reason:'memory_stale'});
    return original(options);
  };
  const typed=await x.typed('Nathan, what is new?');
  assert.equal((await x.settled(typed)).status,'completed');
  assert.equal(attempts,2);
  assert.equal(requests.length,1,'never sends the stale body');
  isClean(requests[0]);
});

test('M8 opinions use the in-flight fence after admission, not an unrelated strict SQLite write',()=>{
  let changed=false,revoked=false,verifications=0;
  const frame={frameVersion:1,delivery:[],memoryStamp:{stamp:'A'},
    opinionReferences:[{entryId:'opinion'}],opinionStamp:{stamp:'A'},
    modelAllocation:{scene:'{}',messages:[{role:'user',content:'hello'}]}};
  const d=createKnowledgeDelivery({frame,isCurrent:()=>true,
    memoryCurrent:()=>!revoked,
    opinionCurrent:(_refs,_stamp,{requestSent}={})=>!revoked&&(requestSent||!changed),
    verifyPrepared:async()=>{verifications++;return true;}});
  const body={input:'identical request'};
  return d.prepareAsync().then(()=>{
    d.beforeRequest(body);
    changed=true;
    return d.prepareAsync();
  }).then(()=>{
    assert.equal(verifications,1,'no post-send strict re-verification on model retry');
    d.verifyBeforeRequest();
    d.beforeRequest(body);
    assert.doesNotThrow(()=>d.success({dialogue:'All good.',command:''}));
  });
});

test('genuine post-send privacy revocation still rejects stale M8 delivery',()=>{
  let revoked=false;
  const frame={frameVersion:1,delivery:[],memoryStamp:{stamp:'A'},
    opinionReferences:[{entryId:'opinion'}],opinionStamp:{stamp:'A'},
    modelAllocation:{scene:'{}',messages:[{role:'user',content:'hello'}]}};
  const d=createKnowledgeDelivery({frame,isCurrent:()=>true,
    memoryCurrent:()=>!revoked,
    opinionCurrent:()=>!revoked});
  d.beforeRequest({input:'old memory'});
  revoked=true;
  assert.throws(()=>d.success({dialogue:'This reply is unsafe.',command:''}),
    error=>error.code==='knowledge_request_stale');
});

test('an optional PS4 render failure without prepared memory safely retries with no learned memory',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  // An optional projection failure can occur without an M2/H1 prepared frame.
  x.h.runtime.services.prepareLiveTurnMemory=async()=>null;
  const original=x.h.runtime.services.finalizeKnowledgeFrame;
  let builds=0;
  x.h.runtime.services.finalizeKnowledgeFrame=(turn,args)=>{
    builds++;
    if(!args.forceNoMemory)throw new Error('test_optional_ps4_projection_unavailable');
    return original(turn,args);
  };
  const requests=recordModel(x);
  const typed=await x.typed('Nathan, can you respond?');
  assert.equal((await x.settled(typed)).status,'completed');
  assert.equal(builds,2,'only one clean rebuild is allowed');
  assert.equal(requests.length,1,'only the clean body reaches HTTP');
  isClean(requests[0]);
});

test('a privacy-revoked pre-send memory frame cannot trigger automatic clean replay',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  const originalPrepare=x.h.runtime.services.prepareLiveTurnMemory;
  x.h.runtime.services.prepareLiveTurnMemory=async args=>{
    const prepared=await originalPrepare(args);
    assert.equal(prepared?.status,'ready','test needs a real prepared memory lane');
    return Object.freeze({...prepared,invalidationReason:()=> 'privacy_changed'});
  };
  let attempts=0;
  x.h.runtime.services.decide=()=>{
    attempts++;
    throw Object.assign(new Error('knowledge_request_stale'),
      {code:'knowledge_request_stale',reason:'memory_stale'});
  };
  const typed=await x.typed('Nathan, what do you remember?');
  assert.notEqual((await x.settled(typed)).status,'completed');
  assert.equal(attempts,1,'privacy revocation must never launch a fallback model attempt');
});
