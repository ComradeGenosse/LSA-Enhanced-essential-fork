import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcceptedRecallQuery,preparePs4Recall,verifyPs4RecallCurrent} from '../../lsa-shared-brain/src/memory/ps4RecallContribution.mjs';
import {recallMemory} from '../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../src/context/knowledgeRenderer.mjs';
import {createKnowledgeDelivery} from '../src/context/knowledgeDelivery.mjs';
import {jsonBytes,KNOWLEDGE_LIMITS} from '../src/context/knowledgeSelector.mjs';
import {buildRequest} from '../src/context/essentialDecision.mjs';

const U=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const NOW='2026-10-11T21:00:00.000Z';
const SHA='b'.repeat(64);
const scope={characterId:U(1),worldProfileId:U(2),timelineId:U(3),protagonistKey:'franklin',
 hostRunId:U(4),worldEpoch:9,incarnationId:U(5),encounterId:U(6),turnId:U(7),turnIdentityHash:SHA};
const dialogue=(id,text,extra={})=>{
 const e={version:1,kind:'dialogue_line',characterId:scope.characterId,worldProfileId:scope.worldProfileId,
  timelineId:scope.timelineId,recordId:U(id),speaker:'player',source:'typed',content:text,
  delivery:'accepted',committedAtUtc:extra.at??NOW,turnIdentityHash:SHA,utteranceId:U(900),
  transcription:null,deliveryReceiptId:null};
 return {...scope,recordId:e.recordId,sourceKind:'dialogue_line',atUtc:e.committedAtUtc,
  evidenceState:'verified',envelope:{...e,...extra.envelope}};
};
const query=(question,intent='exact_quote',maxBytes=14336)=>({version:1,kind:'recall_query',
 characterId:scope.characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
 queryId:U(99),turnIdentityHash:SHA,intent,question,maxBytes});
const reader=(rows,coverageComplete=false)=>({async read(){return {rows,coverageComplete};}});
const read=(q,r,options={})=>preparePs4Recall({query:q,readAdapter:r,snapshot:scope,
 currentIdentity:()=>scope,protagonistKey:scope.protagonistKey,nowUtc:NOW,deadlineMs:200,
 maxContributionBytes:14336,...options});
const frameOf=(prepared)=>renderKnowledge({source:'player_text',input:'What did I say?',
 history:[],preparedRecall:prepared,recallAuthorization:()=>true,actor:{},listener:null});
const original=(frame)=>JSON.parse(frame.modelAllocation.scene).lanes;
const check=(prepared,identity=scope)=>verifyPs4RecallCurrent(prepared,{
 currentIdentity:()=>identity,validateEvidence:ids=>ids.every(id=>id===U(100))});

test('accepted typed and STT query classification uses exact source text, not synthetic intent',()=>{
 const text='What did I say about disco zephyr? 😀';
 const q=createAcceptedRecallQuery({acceptedTurn:{accepted:true,source:'player_mic',
  text,turnIdentityHash:SHA},snapshot:scope,queryId:U(99)});
 assert.equal(q.question,text);assert.equal(q.intent,'exact_quote');
 assert.equal(q.turnIdentityHash,SHA);
 assert.throws(()=>createAcceptedRecallQuery({acceptedTurn:{accepted:false,source:'player_mic',
  text,turnIdentityHash:SHA},snapshot:scope,queryId:U(99)}),/unverified/);
 assert.throws(()=>createAcceptedRecallQuery({acceptedTurn:{accepted:true,source:'npc_generated',
  text,turnIdentityHash:SHA},snapshot:scope,queryId:U(99)}),/unverified/);
});

test('sole PS4 allocation places archive in a separately named section, never history',async()=>{
 const text='  zephyr 🚗 é  line two\n  ';
 const prepared=await read(query('what did I say about zephyr'),reader([dialogue(100,text,
  {at:'2022-02-11T12:00:00.000Z'})]));
 assert.equal(prepared.status,'ready');
 const frame=frameOf(prepared),lanes=original(frame);
 assert.equal(lanes.RECALLED.earlierArchivedConversation[0].content,text);
 assert.equal(lanes.RECALLED.earlierArchivedConversation[0].mode,'exact_quote');
 assert.deepEqual(lanes.RECALLED.evidence,[]);
 assert.equal(frame.modelAllocation.messages.length,1);
 assert.ok(!frame.modelAllocation.messages.some(m=>m.content.includes('zephyr')));
 assert.equal(frame.recallReferences[0].recordId,U(100));
 const request=buildRequest({model:'offline',effort:'low',systemInstruction:'Trusted',knowledgeProjection:frame});
 assert.ok(jsonBytes(request)<=KNOWLEDGE_LIMITS.requestBytes);
 assert.equal(request.input.filter(x=>x.role==='user').length,1);
 assert.equal(Buffer.from(lanes.RECALLED.earlierArchivedConversation[0].content).equals(Buffer.from(text)),true);
});

test('no authorization, uncertified missing row, and source-forgotten rows never project facts',async()=>{
 const row=dialogue(100,'classified zephyr');
 const prepared=await read(query('what did I say about zephyr'),reader([row]));
 assert.equal(original(renderKnowledge({source:'player_text',input:'Hi',preparedRecall:prepared})).RECALLED.evidence,undefined);
 assert.equal((await read(query('zephyr'),reader([]))).status,'dropped');
 assert.equal((await read(query('zephyr'),reader([{...row,forgotten:true}],true))).status,'dropped');
 assert.equal(check(prepared),true);
 assert.equal(verifyPs4RecallCurrent(prepared,{currentIdentity:()=>scope}),false);
 assert.equal(verifyPs4RecallCurrent(prepared,{currentIdentity:()=>scope,
  validateEvidence:()=>false}),false);
});

test('different NPC and protagonists never inherit the same text via forged read results',async()=>{
 const row=dialogue(100,'the same exact zephyr');
 const wrongNpc={...row,characterId:U(67)};
 const wrongProtagonist={...row,protagonistKey:'trevor'};
 assert.equal((await read(query('zephyr'),reader([wrongNpc,wrongProtagonist]))).status,'dropped');
 assert.equal((await read(query('zephyr'),reader([row]))).status,'ready');
});

test('more than 200 turns: lexical archive candidate stays retrievable with no invented coverage',async()=>{
 const rows=Array.from({length:250},(_,i)=>dialogue(100+i,
  i===249?'the rare clementine zephyr':'ordinary other chatter',
  {at:new Date(Date.parse(NOW)-i*86400000).toISOString()}));
 const result=await recallMemory({query:query('what did I say about clementine zephyr'),
  readAdapter:reader(rows),protagonistKey:'franklin',nowUtc:NOW});
 assert.equal(result.bundle.items[0].recordId,U(349));
 assert.equal(result.bundle.items[0].freshness,'archive');
 assert.equal(result.bundle.totalBytes,Buffer.byteLength(JSON.stringify(result.bundle),'utf8'));
});

test('v1 exact 3072-code-point quote accepted and 3073 cannot be silently clipped',async()=>{
 const good='zephyr '+('🦊'.repeat(3072-7));
 const bad='zephyr '+('🦊'.repeat(3073-7));
 const yes=await read(query('what did I say about zephyr'),reader([dialogue(100,good)]));
 assert.equal(yes.status,'ready');assert.equal(yes.contribution.items[0].content,good);
 const no=await read(query('what did I say about zephyr'),reader([dialogue(100,bad)]));
 assert.equal(no.status,'dropped');assert.equal(no.reason,'no_verified_evidence');
});

test('awaiting SQLite cannot cross epoch, protagonist or NPC owner; time budget is nonblocking',async()=>{
 for(const change of [
  {worldEpoch:10},{protagonistKey:'trevor'},{characterId:U(89)},{hostRunId:U(90)}]){
  let finish;let identity={...scope};
  const p=preparePs4Recall({query:query('zephyr'),readAdapter:{read:()=>new Promise(r=>{finish=r;})},
   snapshot:scope,currentIdentity:()=>identity,protagonistKey:'franklin',nowUtc:NOW,deadlineMs:200});
  await Promise.resolve();identity={...identity,...change};
  finish({rows:[dialogue(100,'zephyr')],coverageComplete:false});
  assert.equal((await p).status,'dropped');
 }
 const slow=await read(query('zephyr'),{read:()=>new Promise(resolve=>
  setTimeout(()=>resolve({rows:[dialogue(100,'zephyr')],coverageComplete:false}),30))},
  {deadlineMs:5});
 assert.equal(slow.reason,'deadline');
});

test('pruning and retries cannot leak stale recall after deletion or protagonist switch',async()=>{
 const p=await read(query('zephyr'),reader([dialogue(100,'zephyr')]));
 const f=frameOf(p);
 let visible=true;
 const mk=()=>createKnowledgeDelivery({frame:f,isCurrent:()=>true,
  recallCurrent:()=>visible&&check(p),pruneRecall:frame=>pruneKnowledgeFrame(frame,
   ()=>true,()=>true,()=>true,()=>false)});
 const before=mk();
 visible=false;
 const pruned=before.prepare();
 assert.equal(pruned.recallReferences.length,0);
 assert.equal(original(pruned).RECALLED.evidence.length,0);
 const body={projection:pruned.modelAllocation};
 before.beforeRequest(body);
 assert.equal(before.finish().outcome,'rejected');
 visible=true;
 const sent=mk();const enriched=sent.prepare();
 sent.beforeRequest({projection:enriched.modelAllocation});
 visible=false;
 assert.throws(()=>sent.prepare(),{code:'knowledge_request_stale',reason:'recall_stale'});
 assert.throws(()=>sent.beforeRequest({projection:enriched.modelAllocation}),{code:'knowledge_request_stale'});
 assert.throws(()=>sent.success({dialogue:'Hi',command:''}),{code:'knowledge_request_stale'});
 const replaced=verifyPs4RecallCurrent(p,{currentIdentity:()=>({...scope,protagonistKey:'michael'}),
  validateEvidence:()=>true});
 assert.equal(replaced,false);
});

test('PS6 spontaneous memory never overrides player speech or unadmitted Director callback',async()=>{
 const q=query('zephyr','spontaneous'),r=reader([dialogue(100,'zephyr')]);
 assert.equal((await read(q,r,{source:'special_event',playerActive:true,directorAdmitted:true})).reason,'player_priority');
 assert.equal((await read(q,r,{source:'special_event',playerActive:false,directorAdmitted:false})).reason,'player_priority');
 assert.equal((await read(q,r,{source:'player_mic',playerActive:true})).reason,'player_priority');
 const accepted=await read(q,r,{source:'special_event',playerActive:false,directorAdmitted:true});
 assert.equal(accepted.status,'ready');
 assert.equal(verifyPs4RecallCurrent(accepted,{currentIdentity:()=>scope,
  source:'special_event',directorAdmitted:false,validateEvidence:()=>true}),false);
});
