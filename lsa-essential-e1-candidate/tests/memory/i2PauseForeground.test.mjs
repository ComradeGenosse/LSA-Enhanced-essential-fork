import test from 'node:test';
import assert from 'node:assert/strict';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';
const capabilities={'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'on','memory.recall':'on','memory.commands':'off',
  'memory.interpretation':'off','memory.events':'off','memory.coverage':'off'};
const response=()=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Okay.',command:''})}]
}]}),{headers:{'content-type':'application/json'}});
async function say(x,text){const turn=await x.typed(text);assert.equal((await x.settled(turn)).status,'completed');return turn;}
function capture(x,{beforeSend=null}={}){
  const sent=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    dialogueAttempt:beforeSend?{request:beforeSend,outputText:()=>{}}:undefined,
    fetchImpl:async(url,req)=>{sent.push({body:JSON.parse(req.body),frame:options.knowledgeProjection});return response();}});
  return sent;
}
test('I2 pause in real original runner stops M2, H1/H2/M8 model contribution; ordinary fresh dialogue still completes',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:{memoryK:{capabilities}}});
    const sent=capture(x);await say(x,'The private I2 mint photograph is in the attic.');
    const before=await x.journal();assert.equal(before.players.length,1);
    x.h.runtime.pauseLearnedMemory();
    await say(x,'Tell me about the weather.');
    const after=await x.journal();assert.equal(after.players.length,before.players.length);assert.equal(after.npcs.length,before.npcs.length);
    assert.ok(!JSON.stringify(sent.at(-1).body).includes('mint photograph'));
    assert.equal(sent.at(-1).frame.modelAllocation.messages.length,1);
    const lanes=JSON.parse(sent.at(-1).frame.modelAllocation.scene).lanes;
    assert.equal(lanes.RECALLED.evidence,undefined);assert.equal(lanes.RECALLED.characterOpinions,undefined);
    assert.equal(lanes.SELF.memoryAction,undefined);
    assert.equal(x.h.runtime.memoryPause.paused,true);
  });
test('I2 pause after real original preparation but before HTTP cancels stale request and prevents retries',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:{memoryK:{capabilities}}});
    capture(x);await say(x,'The private I2 coral wallet is under the bridge.');
    const sent=capture(x,{beforeSend:()=>x.h.runtime.pauseLearnedMemory()});
    const turn=await x.typed('Where is the coral wallet?');
    assert.notEqual((await x.settled(turn)).status,'completed');assert.equal(sent.length,0);
    const before=(await x.journal()).players.length;
    capture(x);await say(x,'Start a fresh conversation.');assert.equal((await x.journal()).players.length,before);
  });

test('I2 pause aborts an in-flight provider request and never retries revoked memory',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:{memoryK:{capabilities}}});
    capture(x);await say(x,'The I2 private jade ticket is in my desk.');
    let calls=0,aborted=false;
    x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
      fetchImpl:async(url,request)=>new Promise((resolve,reject)=>{
        ++calls;
        request.signal.addEventListener('abort',()=>{aborted=true;reject(request.signal.reason);},{once:true});
        queueMicrotask(()=>x.h.runtime.pauseLearnedMemory());
      })});
    const turn=await x.typed('Where is my jade ticket?');
    assert.notEqual((await x.settled(turn)).status,'completed');
    assert.equal(aborted,true);assert.equal(calls,1);
  });
