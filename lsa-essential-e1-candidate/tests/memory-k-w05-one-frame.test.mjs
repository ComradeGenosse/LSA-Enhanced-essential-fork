import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {prepareOriginalPs4Recall,verifyPs4RecallCurrent} from '../../lsa-shared-brain/src/memory/ps4RecallContribution.mjs';
import {SQLiteRecallReadAdapter} from '../../lsa-shared-brain/src/memory/sqliteRecallReadAdapter.mjs';
import {toPs4RecallContribution} from '../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {sealRecallBundle} from '../../lsa-shared-brain/src/memory/recallSchemaV1.mjs';
import {evaluateM8,createM8ReadAdapter,preparePs4M8,verifyPs4M8Current} from '../../lsa-shared-brain/src/memory/m8Interpretation.mjs';
import {projectPreparedRecall,projectPreparedM8,KNOWLEDGE_LIMITS,jsonBytes} from '../src/context/knowledgeSelector.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../src/context/knowledgeRenderer.mjs';
import {createKnowledgeDelivery} from '../src/context/knowledgeDelivery.mjs';
const U=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const NOW='2026-10-11T21:00:00.000Z',SHA='a'.repeat(64);
const stamp={characterId:U(1),worldProfileId:U(2),timelineId:U(3),
 protagonistKey:'franklin',hostRunId:U(4),worldEpoch:7,incarnationId:U(5),
 encounterId:U(6),observerCaptureRef:U(7),turnId:U(8),turnIdentityHash:SHA};
const scope=()=>Object.fromEntries(['characterId','worldProfileId','timelineId','protagonistKey'].map(k=>[k,stamp[k]]));
const live={...stamp,nativeVerified:true,timelineWritable:true};
const receipt=(text='What did I say about zephyr? 🚗')=>({...stamp,recordId:U(9),
 originalAccepted:true,nativeVerified:true,p2Committed:true,accepted:true,source:'player_mic',text});
function realSqlite(text='I said zephyr 🦊 with two  spaces!'){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE m4_recall_records_v1(document_id INTEGER PRIMARY KEY,character_id TEXT,world_profile_id TEXT,timeline_id TEXT,protagonist_key TEXT,record_id TEXT,source_kind TEXT,speaker TEXT,timestamp_utc TEXT,evidence_state TEXT,envelope_json TEXT,surface_text TEXT)');
 db.exec('CREATE VIRTUAL TABLE m4_recall_fts_v1 USING fts5(surface_text)');
 db.exec('CREATE TABLE m4_recall_coverage_v1(character_id TEXT,world_profile_id TEXT,timeline_id TEXT,protagonist_key TEXT,source_kind TEXT,from_utc TEXT,to_utc TEXT,all_complete INTEGER,complete INTEGER)');
 const envelope={version:1,kind:'dialogue_line',characterId:stamp.characterId,
  worldProfileId:stamp.worldProfileId,timelineId:stamp.timelineId,recordId:U(10),
  speaker:'player',source:'stt',content:text,delivery:'accepted',committedAtUtc:NOW,
  turnIdentityHash:SHA,utteranceId:U(11),transcription:null,deliveryReceiptId:null};
 db.prepare('INSERT INTO m4_recall_records_v1(character_id,world_profile_id,timeline_id,protagonist_key,record_id,source_kind,speaker,timestamp_utc,evidence_state,envelope_json,surface_text) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(stamp.characterId,stamp.worldProfileId,stamp.timelineId,stamp.protagonistKey,U(10),'dialogue_line','player',NOW,'verified',JSON.stringify(envelope),text);
 db.prepare('INSERT INTO m4_recall_fts_v1(rowid,surface_text) VALUES(1,?)').run(text);
 const accepted={...envelope,recordId:U(9),content:receipt().text};
 db.prepare('INSERT INTO m4_recall_records_v1(character_id,world_profile_id,timeline_id,protagonist_key,record_id,source_kind,speaker,timestamp_utc,evidence_state,envelope_json,surface_text) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(stamp.characterId,stamp.worldProfileId,stamp.timelineId,stamp.protagonistKey,U(9),'dialogue_line','player',NOW,'verified',JSON.stringify(accepted),accepted.content);
 db.prepare('INSERT INTO m4_recall_fts_v1(rowid,surface_text) VALUES(2,?)').run(accepted.content);
 return {db,reader:new SQLiteRecallReadAdapter({db})};
}
const render=(m4=null,m8=null)=>renderKnowledge({
 source:'player_mic',input:receipt().text,history:[],actor:{},listener:null,
 preparedRecall:m4,recallAuthorization:()=>m4?.status==='ready',
 preparedM8:m8,m8Authorization:()=>m8?.status==='ready'});
const lanes=f=>JSON.parse(f.modelAllocation.scene).lanes;
const event=(characterId,recordId)=>({version:1,kind:'journal_event',
 characterId,worldProfileId:stamp.worldProfileId,timelineId:stamp.timelineId,
 recordId,observationId:U(43),revision:1,receivedAtUtc:NOW,sourceHash:SHA,
 ownerProof:{ownerAlias:'promoted.'+characterId,hostRunId:stamp.hostRunId,
  worldEpoch:7,incarnationId:stamp.incarnationId,encounterId:stamp.encounterId,
  observerCaptureRef:stamp.observerCaptureRef},
 receiptStatus:'witnessed',eventType:'crash',claims:[{
 kind:'crash',modality:'visual',certainty:'direct',durableSubject:'vehicle',
 sourceEvidenceId:U(44)}]});
const committed=record=>({record,committed:true,sourceVerified:true,sidecarVerified:true});

test('production M4 refuses unproven accepted transcript; real SQLite quote is byte-exact',async()=>{
 const f=realSqlite();try{
  const args={snapshot:stamp,queryId:U(12),readAdapter:f.reader,
   currentIdentity:()=>live,nowUtc:NOW,deadlineMs:200};
  assert.equal((await prepareOriginalPs4Recall({...args,readVerifiedAccepted:async()=>({...receipt(),originalAccepted:false})})).status,'dropped');
  assert.equal((await prepareOriginalPs4Recall({...args,readVerifiedAccepted:async()=>({...receipt(),p2Committed:false})})).status,'dropped');
  const p=await prepareOriginalPs4Recall({...args,readVerifiedAccepted:async()=>receipt()});
  assert.equal(p.status,'ready');assert.equal(p.originalAccepted,true);
  assert.equal(p.acceptedEvidenceRecordId,U(9));
  assert.equal(p.contribution.items[0].content,'I said zephyr 🦊 with two  spaces!');
  assert.deepEqual(Buffer.from(p.contribution.items[0].content),Buffer.from('I said zephyr 🦊 with two  spaces!'));
  assert.equal(verifyPs4RecallCurrent(p,{currentIdentity:()=>live,
   validateEvidence:ids=>ids.includes(U(9))&&ids.includes(U(10))}),true);
  const f1=render(p),scene=lanes(f1);
  assert.equal(scene.RECALLED.evidence[0].mode,'exact_quote');
  assert.ok(f1.diagnostics.bytes<=KNOWLEDGE_LIMITS.frameBytes);
  assert.equal(f1.modelAllocation.messages.length,1);
 }finally{f.db.close();}
});

test('strict v1 self-accounted bytes, malformed UTF8 and 4096-byte optional cap',()=>{
 const bare={version:1,kind:'recall_bundle',characterId:stamp.characterId,
  worldProfileId:stamp.worldProfileId,timelineId:stamp.timelineId,queryId:U(12),
  status:'matched',coverage:{status:'matched',returnedCount:1,matchedCount:1},
  items:[{sourceKind:'dialogue_line',recordId:U(10),mode:'exact_quote',
   content:'🦊'.repeat(900),freshness:'recent'}],totalBytes:0};
 sealRecallBundle(bare);
 assert.equal(bare.totalBytes,jsonBytes(bare));
 assert.throws(()=>toPs4RecallContribution({...bare,totalBytes:bare.totalBytes-1}),/byte_accounting/);
 const p={status:'ready',contribution:toPs4RecallContribution(bare)};
 const projected=projectPreparedRecall(p,{maxBytes:4096});
 assert.ok(jsonBytes({evidence:projected.evidence,earlierArchivedConversation:projected.earlierArchivedConversation})<=4096);
 assert.ok(projected.evidence.length===0||projected.evidence[0].content===bare.items[0].content);
});

test('two NPCs preserve identical event facts while applying different personality opinions',()=>{
 const s={...scope(),protagonistKey:'unknown'};
 const results=[{humor:{style:'goofy'},caution:.1},{humor:{style:'dry'},caution:.9}]
  .map((personality,i)=>evaluateM8({scope:{...s,characterId:U(50+i)},
   personality,nowUtc:new Date(Date.parse(NOW)+20000).toISOString(),
   sources:[committed(event(U(50+i),U(60+i)))],maxBytes:4096}));
 assert.deepEqual(results[0].facts.map(x=>({mode:x.mode,content:x.content})),
   results[1].facts.map(x=>({mode:x.mode,content:x.content})));
 assert.notEqual(results[0].interpretations[0].opinion,results[1].interpretations[0].opinion);
 assert.ok(results.every(x=>x.interpretations[0].verifiedWorldFact===false));
});

test('original single frame carries M8 opinion only, not cloned facts, and prunes deleted source',()=>{
 const source=U(61),id=U(62);
 const projection={version:1,kind:'m8_typed_projection',...scope(),facts:[],
  interpretations:[{id,epistemicStatus:'character_opinion',verifiedWorldFact:false,
    tone:'concern',opinion:'That moment made me uneasy.',confidence:.8,
    freshness:'recent',sourceEvidenceIds:[source]}],jokes:[],
  relationship:{epistemicStatus:'character_opinion',verifiedWorldFact:false,
   canonRelationshipUnchanged:true,dimensions:{trust:0,affection:0,familiarity:0},
   sourceEvidenceIds:[]},totalBytes:0};
 while(projection.totalBytes!==jsonBytes(projection))projection.totalBytes=jsonBytes(projection);
 const prepared={status:'ready',projection,stamp};
 const projected=projectPreparedM8(prepared);
 assert.equal(projected.characterOpinions.length,1);
 assert.equal(projected.references[0].sourceEvidenceIds[0],source);
 const frame=render(null,prepared),l=lanes(frame);
 assert.equal(l.RECALLED.characterOpinions[0].verifiedWorldFact,false);
 assert.equal(l.RECALLED.evidence,undefined);
 assert.equal(frame.opinionReferences.length,1);
 const cleaned=pruneKnowledgeFrame(frame,()=>true,()=>true,()=>true,()=>true,()=>false);
 assert.equal(lanes(cleaned).RECALLED.characterOpinions.length,0);
 assert.equal(cleaned.opinionReferences.length,0);
 assert.ok(cleaned.diagnostics.bytes<=KNOWLEDGE_LIMITS.frameBytes);
 assert.equal(projectPreparedM8({...prepared,projection:{...projection,totalBytes:1}}).references.length,0);
});

test('original PS4 delivery prunes unsent opinion, aborts sent deletion and stale retry',()=>{
 const source=U(61),id=U(62);
 const p={version:1,kind:'m8_typed_projection',...scope(),facts:[],
  interpretations:[{id,epistemicStatus:'character_opinion',verifiedWorldFact:false,
   tone:'uneasy',opinion:'I was worried.',confidence:.7,freshness:'recent',
   sourceEvidenceIds:[source]}],jokes:[],relationship:null,totalBytes:0};
 while(p.totalBytes!==jsonBytes(p))p.totalBytes=jsonBytes(p);
 const f=render(null,{status:'ready',projection:p,stamp});
 let visible=true;
 const build=()=>createKnowledgeDelivery({frame:f,isCurrent:()=>true,
  opinionCurrent:refs=>visible&&refs.length===1,
  pruneOpinion:frame=>pruneKnowledgeFrame(frame,()=>true,()=>true,()=>true,()=>true,()=>false)});
 const initial=build();visible=false;
 const stripped=initial.prepare();
 assert.equal(stripped.opinionReferences.length,0);
 assert.equal(lanes(stripped).RECALLED.characterOpinions.length,0);
 initial.beforeRequest({projection:stripped.modelAllocation});
 visible=true;const sent=build(),enriched=sent.prepare();
 sent.beforeRequest({projection:enriched.modelAllocation});
 visible=false;
 assert.throws(()=>sent.beforeRequest({projection:enriched.modelAllocation}),
  {code:'knowledge_request_stale',reason:'opinion_stale'});
 assert.throws(()=>sent.prepare(),{code:'knowledge_request_stale'});
});

test('protagonist uncertainty and epoch/owner races fail closed before PS4',async()=>{
 const authority={...stamp,nativeVerified:true};
 let active={...stamp};
 const adapter={project:async()=>null};
 assert.equal((await preparePs4M8({scope:{...scope(),protagonistKey:'unknown'},
  authority:{...authority,protagonistKey:'unknown'},readAdapter:adapter,
  currentIdentity:()=>active})).status,'dropped');
 assert.equal((await preparePs4M8({scope:scope(),authority,readAdapter:adapter,
  currentIdentity:()=>({...active,worldEpoch:8})})).status,'dropped');
 const fake={status:'ready',stamp,projection:{interpretations:[{sourceEvidenceIds:[U(61)]}],
  jokes:[],relationship:null}};
 assert.equal(verifyPs4M8Current(fake,{currentIdentity:()=>live,
  validateEvidence:()=>false}),false);
 assert.equal(verifyPs4M8Current(fake,{currentIdentity:()=>({...stamp,incarnationId:U(90)}),
  validateEvidence:()=>true}),false);
 assert.equal(verifyPs4M8Current(fake,{currentIdentity:()=>live,
  validateEvidence:()=>Promise.resolve(true)}),false);
});


test('P2 M8 reader honors source scope and positive single PS4 admission; tombstone blocks next send',async()=>{
 const row={version:1,kind:'dialogue_line',...scope(),recordId:U(71),
   speaker:'player',source:'typed',delivery:'accepted',
   content:'That crash was hilarious',committedAtUtc:NOW,
   attribution:{protagonist:'franklin',worldEpoch:7,hostRunId:stamp.hostRunId}};
 let active={...stamp,nativeVerified:true,timelineWritable:true};
 let suppressed=[];
 const adapter=createM8ReadAdapter({
  readCommittedSources:async()=>[committed(row)],
  readCommittedMemories:async()=>[],readSuppressedIds:async()=>suppressed,
  readCorrectedIds:async()=>[],readCurationAppraisals:async()=>[],
  currentScope:()=>active
 });
 const prepared=await preparePs4M8({scope:scope(),authority:{...stamp,nativeVerified:true},
  personality:{humor:{style:'sarcastic'}},readAdapter:adapter,
  currentIdentity:()=>active,nowUtc:new Date(Date.parse(NOW)+20000).toISOString()});
 assert.equal(prepared.status,'ready');
 assert.equal(prepared.projection.interpretations[0].epistemicStatus,'character_opinion');
 const frame=render(null,prepared);
 assert.equal(lanes(frame).RECALLED.characterOpinions[0].verifiedWorldFact,false);
 assert.equal(verifyPs4M8Current(prepared,{currentIdentity:()=>active,
  validateEvidence:ids=>ids.every(id=>!suppressed.includes(id))}),true);
 suppressed=[row.recordId];
 assert.equal(verifyPs4M8Current(prepared,{currentIdentity:()=>active,
  validateEvidence:ids=>ids.every(id=>!suppressed.includes(id))}),false);
 const delivery=createKnowledgeDelivery({frame,isCurrent:()=>true,
  opinionCurrent:refs=>refs.every(x=>x.sourceEvidenceIds.every(id=>!suppressed.includes(id))),
  pruneOpinion:f=>pruneKnowledgeFrame(f,()=>true,()=>true,()=>true,()=>true,()=>false)});
 assert.equal(delivery.prepare().opinionReferences.length,0);
 active={...active,worldEpoch:8};
 assert.equal((await preparePs4M8({scope:scope(),authority:{...stamp,nativeVerified:true},
  readAdapter:adapter,currentIdentity:()=>active,nowUtc:NOW})).status,'dropped');
});
