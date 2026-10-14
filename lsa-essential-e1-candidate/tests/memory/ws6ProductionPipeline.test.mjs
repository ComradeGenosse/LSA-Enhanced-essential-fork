// Original bundled runner, D01/D02/D03, P2, PS4 and real request/retry code.
// Only native socket/playback and provider HTTP responses are offline fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './d01-harness.mjs';
import {decide,decideStreaming} from '../../src/openai/decide.mjs';
import {createM3ProductionMemory} from '../../src/memory/m3ProductionMemory.mjs';
import {CAPABILITIES} from '../../src/perception/contracts.mjs';
import {sleep,waitFor} from './d01-harness.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const scope=x=>({characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
 timelineId:x.timelineId,protagonistKey:x.native.avatar});
const lanes=options=>JSON.parse(options.knowledgeProjection.modelAllocation.scene).lanes;
async function forget(x,targetRecordId){
 const requested=(await x.store.readDialogueLines({...scope(x),limit:20})).find(e=>e.speaker==='player');
 const result=await x.store.commitCommand({scope:scope(x),commandId:randomUUID(),
  requestedByLineId:requested.recordId,operation:'forget',content:requested.content,
  contentHash:sha(requested.content),evidenceRecordIds:[requested.recordId,targetRecordId],
  targetRecordId,requestedAtUtc:requested.committedAtUtc});
 assert.equal(result.status,'committed');
}
function response(stream=false){
 const text=JSON.stringify(stream?{mode:'dialogue_only',segments:[{text:'Got it.'}],command:''}:
  {dialogue:'Got it.',command:''});
 if(!stream)return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}),
  {headers:{'content-type':'application/json'}});
 const item={id:'msg_ws6',type:'message',role:'assistant',content:[]};
 const events=[{type:'response.created',response:{id:'resp_ws6',status:'in_progress'}},
  {type:'response.output_item.added',output_index:0,item},
  {type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:text},
  {type:'response.completed',response:{id:'resp_ws6',status:'completed',output:[{
   ...item,status:'completed',content:[{type:'output_text',text,annotations:[]}]}]}}];
 return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),
  {headers:{'content-type':'text/event-stream'}});
}
async function say(x,text){
 const turn=await x.typed(text),result=await x.settled(turn);
 assert.equal(result.status,'completed',JSON.stringify(result));
 return turn;
}

test('WS6 production: D03-issued M8, G4 provenance and G3 exhaustive counts reach one PS4 frame across avatars',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);
 await say(x,'Thanks for helping me, my friend.');
 x.native.avatar='michael';await x.native.sample();
 await say(x,'Inside joke: the flying purple car!');
 x.native.avatar='trevor';await x.native.sample();
 await say(x,'Running joke: the flying purple car!');
 let m=lanes(x.replies.at(-1));
 assert.ok(m.RECALLED.characterOpinions?.length>0);
 assert.equal(m.RECALLED.runningJokes?.length,1);
 assert.equal(m.RECALLED.relationshipInterpretation.verifiedWorldFact,false);
 assert.ok(m.RECALLED.evidence.some(e=>e.category==='exact_quote'&&e.sourceAvatar==='michael'));
 await say(x,'How many times did I say "flying purple car"?');
 m=lanes(x.replies.at(-1));
 assert.equal(m.RECALLED.answerEvidence.dialogueCount.status,'complete');
 assert.equal(m.RECALLED.answerEvidence.dialogueCount.exactCount,2,'current question must be excluded');
 assert.equal(m.RECALLED.answerEvidence.dialogueCount.first.sourceAvatar,'michael');
 assert.equal(m.RECALLED.answerEvidence.dialogueCount.last.sourceAvatar,'trevor');
 await say(x,'When was the first time I said "flying purple car"?');
 assert.equal(lanes(x.replies.at(-1)).RECALLED.answerEvidence.dialogueCount.exactCount,3,
  'earlier literal count question is itself accepted dialogue containing the phrase');
 await say(x,'How many crimes have I committed?');
 assert.equal(lanes(x.replies.at(-1)).RECALLED.answerEvidence.dialogueCount.exactCount,null);
 await say(x,'Did you witness a robbery?');
 assert.equal(lanes(x.replies.at(-1)).RECALLED.answerEvidence.witness.status,'unknown');
 assert.equal(lanes(x.replies.at(-1)).RECALLED.answerEvidence.negativeWitnessing,'unavailable');
});

for(const boundary of ['native_owner','timeline','host'])test('WS6 original runner: '+boundary+' revocation during preparation clears memory and RAM fallback',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Inside joke: the private marmalade secret.');
 const read=x.store.readIntegratedRecall.bind(x.store);let changed=false;
 x.store.readIntegratedRecall=async args=>{
  const result=await read(args);
  if(!changed){changed=true;
   if(boundary==='native_owner'){x.native.stop();x.native.includeOwner=false;await x.native.sample();}
   if(boundary==='timeline')x.store.onBoundary({reason:'timeline_change'});
   if(boundary==='host')x.store.setVerifiedHostContext(null);
  }
  return result;
 };
 await say(x,'What was the private secret?');
 const frame=x.replies.at(-1).knowledgeProjection;
 assert.ok(changed);
 assert.equal(frame.memoryStamp,null);
 assert.ok(!JSON.stringify(frame.modelAllocation).includes('private marmalade secret'));
});

test('WS6 pre-send privacy: forget after asynchronous verification drops journal, recall and M8 without RAM resurrection',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Inside joke: the private marmalade secret.');
 const target=(await x.journal()).players[0].record_id;
 let body=null;
 x.h.runtime.services.decide=async options=>{
  assert.ok(lanes(options).RECALLED.characterOpinions?.length);
  await forget(x,target);
  return decide({...options,config:x.h.runtime.config,fetchImpl:async(_url,req)=>{
   body=JSON.parse(req.body);return response();
  }});
 };
 await say(x,'What was that secret?');
 assert.ok(body);
 assert.ok(!JSON.stringify(body).includes('private marmalade secret'));
});

for(const stream of [false,true])test('WS6 '+(stream?'streaming':'JSON')+' request boundary awaits SQLite verification after body composition',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Inside joke: the private marmalade secret.');
 const target=(await x.journal()).players[0].record_id;let sent=0,queued=null;
 x.h.runtime.services.decide=options=>(stream?decideStreaming:decide)({...options,
  config:x.h.runtime.config,
  dialogueAttempt:{request:()=>{queued??=forget(x,target);},outputText:()=>{}},
  fetchImpl:async()=>{sent++;return response(stream);}});
 const turn=await x.typed('What was that secret?');
 assert.notEqual((await x.settled(turn)).status,'completed');
 await queued;
 assert.equal(sent,0,'a composed stale request must never reach fetch');
});

for(const revoke of [false,true])test('WS6 real provider retry '+(revoke?'rejects forgotten sources':'preserves exact frozen bytes'),
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Inside joke: the private marmalade secret.');
 const target=(await x.journal()).players[0].record_id,bodies=[];
 x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
  fetchImpl:async(_url,req)=>{
   bodies.push(req.body);
   if(bodies.length===1){
    if(revoke)await forget(x,target);
    return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
   }
   return response();
  }});
 const turn=await x.typed('What was that secret?'),result=await x.settled(turn);
 if(revoke){assert.notEqual(result.status,'completed');assert.equal(bodies.length,1);}
 else{assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);}
});

for(const boundary of ['native_disconnect','timeline','host'])test('WS6 '+boundary+' revoked after request composition never reaches provider fetch',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Inside joke: the private marmalade secret.');
 let sent=0;
 x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
  dialogueAttempt:{request:()=>{
   if(boundary==='native_disconnect'){x.native.stop();x.client.stop();}
   if(boundary==='timeline')x.store.onBoundary({reason:'timeline_change'});
   if(boundary==='host')x.store.setVerifiedHostContext(null);
  },outputText:()=>{}},fetchImpl:async()=>{sent++;return response();}});
 const turn=await x.typed('What was that secret?');
 assert.notEqual((await x.settled(turn)).status,'completed');
 assert.equal(sent,0);
});

test('WS6 synchronous fence detects a write committed after the final awaited read',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Thanks for helping me, my friend.');
 let checked=false;
 x.h.runtime.services.decide=async options=>{
  await options.knowledgeDelivery.verifyBeforeRequest();
  const fence=x.store.memoryReadFence;
  await x.store.withP2SqliteTransaction(scope(x),db=>db.prepare('UPDATE dialogue_journal SET content=content WHERE speaker=?').run('player'));
  assert.notEqual(x.store.memoryReadFence,fence);
  assert.throws(()=>options.knowledgeDelivery.beforeRequest({test:'never sent'}),{code:'knowledge_request_stale'});
  checked=true;
  throw Object.assign(new Error('knowledge_request_stale'),{code:'knowledge_request_stale'});
 };
 const turn=await x.typed('What do you remember?');
 assert.notEqual((await x.settled(turn)).status,'completed');assert.ok(checked);
});

test('WS6 original mic transcript correction is withdrawn from CONVERSE and read as a reported correction',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);
 x.h.runtime.services.transcribe=async()=> 'Inside joke: the erroneous marmalade banana.';
 const mic=await x.mic();assert.equal((await x.settled(mic)).status,'completed');
 const target=(await x.journal()).players[0].record_id;
 await say(x,'I actually said the truthful marmalade avocado.');
 const requested=(await x.store.readDialogueLines({...scope(x),limit:20})).find(e=>e.speaker==='player');
 const content='Inside joke: the truthful marmalade avocado.';
 assert.equal((await x.store.commitCommand({scope:scope(x),commandId:randomUUID(),
  requestedByLineId:requested.recordId,operation:'correct',correctionMode:'transcript',
  content,contentHash:sha(content),evidenceRecordIds:[requested.recordId,target],
  targetRecordId:target,requestedAtUtc:requested.committedAtUtc})).status,'committed');
 await say(x,'What was the marmalade joke?');
 const frame=x.replies.at(-1).knowledgeProjection,m=lanes(x.replies.at(-1));
 assert.ok(!JSON.stringify(frame.modelAllocation).includes('erroneous marmalade banana'));
 assert.ok(m.RECALLED.evidence.some(e=>e.content==='Player correction (reported): '+content&&e.category==='reported_claim'));
});

test('WS6 original runner receives witnessed G5 evidence from authenticated PS2/M3 into the same P2 writer',
 {timeout:45000},async t=>{
 const x=await d01Harness(t,{roster:{capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,['shooting','witness'].includes(k)]))}});
 const m3=createM3ProductionMemory({intelligence:x.client,memoryStore:x.store});
 t.after(()=>m3.close());x.client.runtime.acceptedObservationTap=receipt=>m3.tap(receipt);
 await x.native.send('memory_authority',{memoryProofVersion:1,hostRunId:x.native.hostRunId,
  worldEpoch:1,sampledGameTick:x.native.tick,owners:x.native.owners().map(({nativeActorPedId,...owner})=>owner),
  protagonist:{key:'franklin',source:'native_player_model',playerCaptureRef:x.native.playerRef,
   sampledGameTick:x.native.tick},acceptedTurns:[]});
 const tick=x.native.tick;
 await x.native.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,
  kind:'firing',source:x.native.playerRef,target:null,gameTick:tick,ageMs:0,facts:{},
  witnessReceipts:[{observer:{captureRef:x.native.npcRef,kind:'ped'},status:'witnessed',
   sampledGameTick:tick,reason:'visual_clear',knowsSource:true,knowsTarget:false,
   evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:tick}}]});
 await sleep(1000);await m3.adapter.idle();
 const events=await x.store.readJournalEvents({...scope(x),limit:10});
 assert.equal(events.length,1,JSON.stringify(m3.snapshot()));
 await waitFor(()=>x.d02.port.status()?.settled===true,'current native source after M3');
 await say(x,'Did you witness firing?');
 const recalled=lanes(x.replies.at(-1)).RECALLED;
 assert.equal(recalled.answerEvidence.witness.status,'witnessed');
 assert.deepEqual(recalled.answerEvidence.witness.evidenceIds,[events[0].recordId]);
 assert.ok(recalled.evidence.some(e=>e.category==='directly_observed_fact'));
 assert.equal(recalled.answerEvidence.negativeWitnessing,'unavailable');
});

test('WS6 rechecks selected source avatar metadata before provider composition',
 {timeout:45000},async t=>{
 const x=await d01Harness(t);await say(x,'Inside joke: the private marmalade secret.');
 const target=(await x.journal()).players[0].record_id;let body=null;
 x.h.runtime.services.decide=async options=>{
  await x.store.withP2SqliteTransaction(scope(x),db=>db.prepare('UPDATE dialogue_journal SET protagonist=? WHERE record_id=?').run('michael',target));
  return decide({...options,config:x.h.runtime.config,fetchImpl:async(_url,req)=>{
   body=JSON.parse(req.body);return response();
  }});
 };
 await say(x,'What was that secret?');
 assert.ok(body);assert.ok(!JSON.stringify(body).includes('private marmalade secret'));
});

test('WS6 P2 persistent history: losing D03 cannot resurrect a forgotten line from RAM', {timeout:45000},async t=>{
 const x=await d01Harness(t);
 const secret='never reveal violet sapphire private code';
 await say(x,secret);
 const target=(await x.journal()).players.find(row=>row.content===secret)?.record_id;
 assert.ok(target,'the source-backed line must first exist in P2');
 await say(x,'That concludes our earlier topic.');
 await forget(x,target);
 // Deliberately remove the REAL private D02 corroboration from subsequent
 // original turns. The backend may still hold the older bytes in its RAM
 // conversation; a source-less P2 turn must not make them model-visible.
 x.h.runtime.memoryD02=null;
 const turn=await x.typed('Can you repeat the old code?');
 assert.equal((await x.settled(turn)).status,'completed');
 const projected=JSON.stringify(x.replies.at(-1).knowledgeProjection.modelAllocation);
 assert.ok(!projected.includes(secret),
   'RAM fallback must not resurrect forgotten P2 history when D03 is unavailable');
 const recent=JSON.parse(x.replies.at(-1).knowledgeProjection.modelAllocation.scene).lanes.CONVERSE;
 assert.equal(recent?.earlier?.length??0,0);
});
