// Isolated request-fence regression tests; original H1 comparison file stays pinned.
// H1-B integration tests use the original bundled OpenAI turn runner,
// D01/D03/D02 accepted line and durable P2 SQLite. Only GTA/native and HTTP
// are scripted by the existing shared offline harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const modes=Object.freeze({
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'on','memory.recall':'off','memory.commands':'off',
  'memory.interpretation':'off','memory.events':'off','memory.coverage':'off'
});
const configured=(edits={})=>({memoryK:{capabilities:{...modes,...edits}}});
const response=()=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Got it.',command:''})}]
}]}),{headers:{'content-type':'application/json'}});
function realDecisions(x,fetchImpl){
  const submissions=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    fetchImpl:async(url,request)=>{
      submissions.push({body:JSON.parse(request.body),options});
      return fetchImpl?fetchImpl(url,request):response();
    }});
  return submissions;
}
async function say(x,line){
  const turn=await x.typed(line),result=await x.settled(turn);
  // The runner's public cause keeps only the error code (e.g. knowledge_request_stale),
  // so a failed turn also reports which H1 check last rejected the request.
  assert.equal(result.status,'completed',JSON.stringify({result,h1:result.status==='completed'?undefined:
    (({state,reason,lastPreparation,lastValidation})=>({state,reason,lastPreparation,lastValidation}))(
      x.h.runtime.services.memoryJournalDiagnostics())}));
}
const frame=record=>record.options.knowledgeProjection;
const lanes=record=>JSON.parse(frame(record).modelAllocation.scene).lanes;
const scope=x=>({characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
  timelineId:x.timelineId,protagonistKey:x.native.avatar});
async function forget(x,target){
  const latest=(await x.store.readDialogueLines({...scope(x),limit:20}))
    .find(row=>row.speaker==='player');
  return x.store.commitCommand({scope:scope(x),commandId:randomUUID(),
    requestedByLineId:latest.recordId,operation:'forget',content:latest.content,
    contentHash:sha(latest.content),evidenceRecordIds:[latest.recordId,target],
    targetRecordId:target,requestedAtUtc:latest.committedAtUtc});
}

test('H1 in-flight request survives unrelated P2 writes, retaining strict pre-send fence',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  await say(x,'The glass chessboard is behind the desk.');
  let checked=false;
  const sent=realDecisions(x,async()=>{
    const strict=x.store.memoryReadFence,request=x.store.memoryRequestFence;
    await x.store.withP2SqliteTransaction(scope(x),db=>
      db.prepare('UPDATE dialogue_journal SET content=content WHERE speaker=?').run('player'));
    assert.notEqual(x.store.memoryReadFence,strict,'the ordinary SQLite write is real');
    assert.equal(x.store.memoryRequestFence,request,'a normal write is not a privacy revocation');
    assert.equal(x.store.memoryRequestFenceFailure(request),null);
    checked=true;
    return response();
  });
  await say(x,'Where is my glass chessboard?');
  assert.equal(sent.length,1);
  assert.equal(checked,true);
});

test('H1 sent request still rejects an actual durable memory forget',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  await say(x,'The saffron compass belongs in the drawer.');
  const target=(await x.store.readDialogueLines({...scope(x),limit:20}))
    .find(row=>row.speaker==='player'&&row.content==='The saffron compass belongs in the drawer.');
  assert.ok(target);
  let committed=false;
  const sent=realDecisions(x,async()=>{
    const old=x.store.memoryRequestFence;
    const receipt=await forget(x,target.recordId);
    assert.equal(receipt.durableCommit,true);
    assert.notEqual(x.store.memoryRequestFence,old);
    assert.equal(x.store.memoryRequestFenceFailure(old),'privacy_changed');
    committed=true;
    return response();
  });
  const turn=await x.typed('Do you remember the saffron compass?');
  assert.notEqual((await x.settled(turn)).status,'completed',
    'forget committed during an HTTP request must cancel the stale answer');
  assert.equal(sent.length,1);
  assert.equal(committed,true);
});

