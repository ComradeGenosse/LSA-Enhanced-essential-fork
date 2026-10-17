// K-07 / K-12 production regressions on the REAL file-backed P2 SQLite store.
// Only native receipts are offline fixtures; nothing here weakens the W04
// acceptance tests (which keep running unchanged in their own file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {createM5RuntimeCoordinator,stableM5CommandId} from '../src/memory/m5RuntimeCoordinator.mjs';
import {compoundCommandId} from '../src/memory/explicitCommands.mjs';
import {createM3WitnessRecorder} from '../src/memory/integrationPorts.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID(),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const at=ms=>new Date(ms).toISOString();

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'k07-k12-'));
 const filePath=path.join(root,'p2.sqlite');
 const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 const proof={hostRunId:host.hostRunId,worldEpoch:1,turn:'verified_fixture'};
 let store,service,commands,runtime,now=Date.now(),sequence=0;
 const x={root,filePath,host,proof};
 const open=async()=>{
  store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();store.setVerifiedHostContext(host);
 };
 await open();
 const npc=await store.create(profile());
 const timelineId=await store.createTimeline({label:'K07 K12'});
 await store.confirmTimeline(timelineId,{confirmation:timelineId});
 const scopeFor=(avatar='franklin')=>({worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:avatar});
 const scope=scopeFor();
 const wire=async()=>{
  service=createM5SqliteServices({store,filePath,clock:()=>at(now),
   authorize:({scope:s})=>s.worldProfileId===worldProfileId&&s.characterId===npc.characterId&&s.timelineId===timelineId});
  await service.ready(scope);
  commands=service.bindCommands();
  runtime=createM5RuntimeCoordinator({commandStore:commands,authority:{
   assertCurrent:({line,scope:s,sourceProof})=>store.verifiedHostContext?.hostRunId===host.hostRunId&&
    sourceProof===proof&&s.characterId===npc.characterId&&s.timelineId===timelineId&&
    line.attribution?.hostRunId===host.hostRunId&&line.attribution?.worldEpoch===1}});
 };
 await wire();
 t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
 Object.defineProperties(x,Object.getOwnPropertyDescriptors({scope,scopeFor,npc,timelineId,
  get store(){return store;},get service(){return service;},get commands(){return commands;},
  get runtime(){return runtime;},
  advance:ms=>{now+=ms;},
  restart:async()=>{await store.close();await open();await store.confirmTimeline(timelineId,{confirmation:timelineId});await wire();},
  async accept(text,{avatar='franklin',source='typed'}={}){
   const r=await createConversationJournalRecorder(store).recordPlayerAccepted({characterId:npc.characterId,
    identity:{pedId:101,turnId:'k07-'+(++sequence),generationId:'g1',sessionNonce:'k07-session'},
    source,text,attribution:{protagonist:avatar}});
   return (await store.readDialogueLines({characterId:npc.characterId,timelineId})).find(l=>l.recordId===r.recordId);
  },
  dispatch:(line,{avatar='franklin',clarificationId=null}={})=>runtime.acceptAcceptedPlayerLine({
   line,scope:scopeFor(avatar),sourceProof:proof,clarificationId}),
  sql:fn=>store.withP2SqliteRead(scope,fn),
  write:fn=>store.withTimelineSqliteWrite(scope,fn),
  counts:()=>store.withP2SqliteRead(scope,db=>({
   commands:db.prepare('SELECT count(*) AS n FROM memory_commands').get().n,
   memories:db.prepare('SELECT count(*) AS n FROM memory_records').get().n,
   tombstones:db.prepare('SELECT count(*) AS n FROM memory_tombstones').get().n,
   suppressions:db.prepare('SELECT count(*) AS n FROM memory_suppressions').get().n,
   trash:db.prepare('SELECT count(*) AS n FROM m5_trash').get().n,
   corrections:db.prepare('SELECT count(*) AS n FROM memory_corrections').get().n,
   openClarifications:db.prepare('SELECT count(*) AS n FROM m5_clarifications WHERE completed_at_utc IS NULL').get().n
  })),
  recall:()=>store.readIntegratedRecall({scope,limit:384}),
  async witnessEvent(){
   const adapterEpoch=id(),ownerProof={ownerAlias:store.get(npc.characterId).promotion.ownerAlias,
    incarnationId:id(),encounterId:id(),hostRunId:host.hostRunId,worldEpoch:1,observerCaptureRef:id()};
   const identity={promoted:true,current:true,...scope,adapterEpoch,ownerProof};
   const observation={version:1,observationId:id(),episodeId:id(),revision:1,
    observer:{captureRef:ownerProof.observerCaptureRef,kind:'ped'},
    observedAt:{nativeRun:adapterEpoch,gameTick:100,receivedUtc:new Date().toISOString()},eventType:'firing_burst',
    claims:[{claimId:id(),kind:'firing',certainty:'supported',evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100}}]};
   const out=await createM3WitnessRecorder({store,authorize:()=>identity}).capture({candidate:identity,observation});
   assert.equal(out.inserted,true);
   const events=await store.readJournalEvents({characterId:npc.characterId,timelineId});
   assert.equal(events.length,1);
   return events[0];
  }}));
 return x;
}
const noSaved=r=>assert.equal((r.acknowledgements??[]).some(a=>a.durableCommit===true),false,
  'no durable success may be acknowledged');
const same=(a,b)=>assert.deepEqual(a,b);

// ---------------------------------------------------------------- K-07 atomic

test('K07 production port: bindCommands exposes the atomic batch and durable clarification lookup',async t=>{
 const x=await fixture(t);
 for(const name of ['commitCommandBatch','findPendingClarification'])
  assert.equal(typeof x.commands[name],'function',name+' must be bound in production');
});

test('K07 remember+forget compound commits both effects atomically, replay is idempotent',async t=>{
 const x=await fixture(t);
 const sedan=await x.accept('I parked the sedan outside the bar');
 const line=await x.accept('Remember that I like tea; forget the sedan');
 const result=await x.dispatch(line);
 assert.deepEqual(result.acknowledgements.map(a=>a.outcome),['saved','forgotten']);
 assert.ok(result.acknowledgements.every(a=>a.durableCommit===true));
 const counts=await x.counts();
 assert.equal(counts.memories,1);assert.ok(counts.tombstones>=1);assert.ok(counts.suppressions>=1);
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(sedan.recordId));
 const before=await x.counts();
 const again=await x.dispatch(line);
 assert.deepEqual(again.acknowledgements.map(a=>a.outcome),['saved','forgotten']);
 same(await x.counts(),before);
});

test('K07 a failing LATER member rolls back an EARLIER forget: no tombstone, suppression or trash',async t=>{
 const x=await fixture(t);
 await x.accept('I parked the sedan outside the bar');
 await x.write(db=>db.exec("CREATE TRIGGER k07_block BEFORE INSERT ON memory_records WHEN NEW.content LIKE '%coffee%' BEGIN SELECT RAISE(ABORT,'forced_second_member_failure'); END"));
 const baseline=await x.counts();
 const line=await x.accept('Forget the sedan; remember that I like coffee');
 const result=await x.dispatch(line);
 noSaved(result);
 assert.ok(!result.acknowledgements.some(a=>a.outcome==='forgotten'&&a.durableCommit));
 same(await x.counts(),baseline);
 assert.deepEqual(await x.store.listSuppressedMemoryIds(x.scope),[]);
});

test('K07 permanently suppressed content in one member vetoes the entire batch',async t=>{
 const x=await fixture(t);
 const first=await x.accept('Remember that I like tea');
 assert.equal((await x.dispatch(first)).acknowledgements[0].outcome,'saved');
 const memoryId=stableM5CommandId({line:first,scope:x.scope});
 await x.service.trash({scope:x.scope,targetId:memoryId});
 x.advance(8*86400000);
 await x.service.purgeExpired({scope:x.scope});
 const baseline=await x.counts();
 const line=await x.accept('Remember that I like coffee; remember that I like tea');
 // Identical bytes of a purged memory stay suppressed, so the sibling
 // "coffee" member must not survive on its own.
 noSaved(await x.dispatch(line));
 same(await x.counts(),baseline);
});

test('K07 commitCommandBatch refuses effects that are not derivable from the exact accepted line',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I like tea; remember that I like coffee');
 const base=stableM5CommandId({line,scope:x.scope});
 const op=(i,content,extra={})=>({scope:x.scope,commandId:compoundCommandId(base,i),
  requestedByLineId:line.recordId,operation:'remember',origin:'explicit_player',recordType:'player_claim',
  content,contentHash:sha(content),pin:false,evidenceRecordIds:[line.recordId],targetRecordId:null,
  correctionMode:null,subjectCertainty:'reported',requestedAtUtc:line.committedAtUtc,...extra});
 const good=[op(0,'I like tea'),op(1,'I like coffee')];
 const baseline=await x.counts();
 const bad=[
  ['single member',[good[0]]],
  ['three members',[...good,op(1,'I like coffee')]],
  ['forged content',[op(0,'I like tea'),op(1,'My bank password is hunter2')]],
  ['wrong command id',[op(0,'I like tea'),op(1,'I like coffee',{commandId:id()})]],
  ['reordered members',[good[1],good[0]]],
  ['smuggled forget',[good[0],{...op(1,'I like coffee'),operation:'forget',targetRecordId:line.recordId,
    evidenceRecordIds:[line.recordId]}]],
  ['pin escalation',[op(0,'I like tea',{pin:true}),good[1]]],
  ['foreign source line',[op(0,'I like tea',{requestedByLineId:id()}),good[1]]]
 ];
 for(const [label,operations] of bad){
  await assert.rejects(x.commands.commitCommandBatch({scope:x.scope,line,operations}),
   /m5_batch_source_mismatch|m5_invalid_atomic_batch|m5_atomic_source_invalid/,label);
  same(await x.counts(),baseline);
 }
 // A line whose bytes differ from the durable journal is never authority.
 await assert.rejects(x.commands.commitCommandBatch({scope:x.scope,
  line:{...line,content:line.content+' '},operations:good}),/m5_batch_source_mismatch|m5_line_not_durable/);
 await assert.rejects(x.commands.commitCommandBatch({scope:x.scope,
  line:{...line,recordId:id()},operations:good}),/m5_batch_source_mismatch|m5_line_not_durable|m5_atomic_source_invalid/);
 // Wrong avatar is a different source identity.
 await assert.rejects(x.commands.commitCommandBatch({scope:x.scopeFor('michael'),line,operations:good}));
 same(await x.counts(),baseline);
 // The genuine batch still commits exactly once.
 const receipts=await x.commands.commitCommandBatch({scope:x.scope,line,operations:good});
 assert.equal(receipts.length,2);assert.equal((await x.counts()).memories,2);
 await x.commands.commitCommandBatch({scope:x.scope,line,operations:good});
 assert.equal((await x.counts()).memories,2);
});

test('K07 lost timeline authority and a different host run fail closed with zero effects',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I like tea; remember that I like coffee');
 const base=stableM5CommandId({line,scope:x.scope});
 const operations=[0,1].map(i=>({scope:x.scope,commandId:compoundCommandId(base,i),
  requestedByLineId:line.recordId,operation:'remember',origin:'explicit_player',recordType:'player_claim',
  content:i?'I like coffee':'I like tea',contentHash:sha(i?'I like coffee':'I like tea'),pin:false,
  evidenceRecordIds:[line.recordId],targetRecordId:null,correctionMode:null,subjectCertainty:'reported',
  requestedAtUtc:line.committedAtUtc}));
 x.store.setVerifiedHostContext(null);
 await assert.rejects(x.commands.commitCommandBatch({scope:x.scope,line,operations}),/m5_current_source_required/);
 // Losing the native source suspends the timeline writer (it does not resume
 // by merely restoring the context); recover through a confirmed restart.
 await x.restart();
 assert.equal((await x.counts()).memories,0);
 // A different host run than the one that accepted the line suspends the
 // timeline writer; the batch still has no effect.
 x.store.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:1});
 await assert.rejects(x.commands.commitCommandBatch({scope:x.scope,line,operations}),
  /m5_line_not_durable|m5_current_source_required|timeline_write_suspended/);
 await x.restart();
 assert.equal((await x.counts()).memories,0);
 assert.equal((await x.counts()).commands,0);
});

test('K07 a partially committed legacy replay is never disguised as a completed atomic batch',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I like tea; remember that I like coffee');
 const base=stableM5CommandId({line,scope:x.scope});
 await x.commands.commitCommand({scope:x.scope,commandId:base,requestedByLineId:line.recordId,
  operation:'remember',origin:'explicit_player',recordType:'player_claim',content:'I like tea',
  contentHash:sha('I like tea'),pin:false,evidenceRecordIds:[line.recordId],targetRecordId:null,
  correctionMode:null,subjectCertainty:'reported',requestedAtUtc:line.committedAtUtc});
 const result=await x.dispatch(line);
 noSaved(result);
 assert.equal(result.status,'compound_partial_replay');
 assert.equal((await x.counts()).memories,1);
});

// ------------------------------------------------------- K-07 clarifications

async function ambiguous(x,avatar='franklin'){
 const sedan=await x.accept('I drove a sedan through town',{avatar});
 const truck=await x.accept('I drove a truck through town',{avatar});
 const ask=await x.accept('Forget that',{avatar});
 const asked=await x.dispatch(ask,{avatar});
 assert.equal(asked.acknowledgements[0].outcome,'clarify');
 return {sedan,truck,ask,commandId:asked.actions[0].commandId};
}

test('K07 clarification survives a full store restart and only the accepted reply resolves it',async t=>{
 const x=await fixture(t);
 const q=await ambiguous(x);
 await x.restart();
 const found=await x.commands.findPendingClarification({scope:x.scope,
  atUtc:at(Date.now()),excludeLineId:id()});
 assert.equal(found.commandId,q.commandId);
 const reply=await x.accept('first');
 const done=await x.dispatch(reply);
 assert.equal(done.acknowledgements[0].outcome,'forgotten');
 assert.equal(done.acknowledgements[0].durableCommit,true);
 assert.equal((await x.counts()).openClarifications,0);
 assert.equal(await x.commands.findPendingClarification({scope:x.scope,atUtc:at(Date.now()),excludeLineId:id()}),null);
});

test('K07 an ambiguity asked as Franklin is answered by the accepted reply as Michael',async t=>{
 const x=await fixture(t);
 const q=await ambiguous(x,'franklin');
 const found=await x.commands.findPendingClarification({scope:x.scopeFor('michael'),
  atUtc:at(Date.now()),excludeLineId:id()});
 assert.equal(found.commandId,q.commandId);
 const reply=await x.accept('second',{avatar:'michael'});
 const done=await x.dispatch(reply,{avatar:'michael'});
 assert.equal(done.acknowledgements[0].outcome,'forgotten');
 const suppressed=await x.store.listSuppressedMemoryIds(x.scope);
 // Exactly the frozen second alternative, selected by the Michael reply.
 assert.equal(suppressed.filter(v=>[q.sedan.recordId,q.truck.recordId].includes(v)).length,1);
});

test('K07 stale, replayed, predated and forged replies never resolve a clarification',async t=>{
 const x=await fixture(t);
 const early=await x.accept('first');            // accepted BEFORE any question existed
 const q=await ambiguous(x);
 const baseline=await x.counts();

 // predated reply
 const predated=await x.dispatch(early);
 assert.equal(predated.handled,false);
 same(await x.counts(),baseline);

 // fabricated line, never journaled
 const fabricated={...early,recordId:id(),committedAtUtc:at(Date.now()+5)};
 noSaved(await x.dispatch(fabricated));
 // genuine row whose bytes were altered in the replay
 const genuine=await x.accept('second');
 noSaved(await x.dispatch({...genuine,content:'first'}));
 // NPC speech cannot answer
 noSaved(await x.dispatch({...genuine,speaker:'npc'}));
 // forged clarification pointer
 const forged=await x.dispatch(genuine,{clarificationId:id()});
 noSaved(forged);
 same({...await x.counts(),tombstones:0},{...baseline,tombstones:0});
 assert.equal((await x.counts()).tombstones,baseline.tombstones);

 // wrong NPC/world/timeline scope can neither see nor resolve it
 for(const wrong of [{...x.scope,characterId:id()},{...x.scope,timelineId:id()},{...x.scope,worldProfileId:id()}])
  await assert.rejects(x.commands.findPendingClarification({scope:wrong,atUtc:at(Date.now()),excludeLineId:id()}));

 // genuine answer works exactly once; a different later line cannot re-answer it
 const done=await x.dispatch(genuine);
 assert.equal(done.acknowledgements[0].outcome,'forgotten');
 const afterAnswer=await x.counts();
 const late=await x.accept('first');
 assert.equal((await x.dispatch(late)).handled,false);
 // Re-delivery of the already-resolved reply has no effect at all.
 const replayed=await x.dispatch(genuine);
 noSaved(replayed);
 same(await x.counts(),afterAnswer);
 assert.ok(q.commandId);
});

test('K07 an expired clarification is not found and its late reply is ordinary dialogue',async t=>{
 const x=await fixture(t);
 await ambiguous(x);
 x.advance(6*60000);
 assert.equal(await x.commands.findPendingClarification({scope:x.scope,atUtc:at(Date.now()),excludeLineId:id()}),null);
 const baseline=await x.counts();
 const reply=await x.accept('first');
 assert.equal((await x.dispatch(reply)).handled,false);
 same(await x.counts(),baseline);
});

test('K07 a newer question retires the older one; an old pointer cannot be replayed',async t=>{
 const x=await fixture(t);
 const older=await ambiguous(x);
 x.advance(1000);
 const again=await x.accept('Forget that');
 const second=await x.dispatch(again);
 assert.equal(second.acknowledgements[0].outcome,'clarify');
 const newer=second.actions[0].commandId;
 assert.notEqual(newer,older.commandId);
 const found=await x.commands.findPendingClarification({scope:x.scope,atUtc:at(Date.now()+10),excludeLineId:id()});
 assert.equal(found.commandId,newer);
 const reply=await x.accept('first');
 const blocked=await x.dispatch(reply,{clarificationId:older.commandId});
 noSaved(blocked);
 assert.equal((await x.counts()).tombstones,0);
});

test('K07 forgetting an offered alternative revokes the pending clarification',async t=>{
 const x=await fixture(t);
 const q=await ambiguous(x);
 await x.service.trash({scope:x.scope,targetId:q.sedan.recordId});
 assert.equal(await x.commands.findPendingClarification({scope:x.scope,atUtc:at(Date.now()),excludeLineId:id()}),null);
 const baseline=await x.counts();
 const reply=await x.accept('second');
 noSaved(await x.dispatch(reply));
 same(await x.counts(),baseline);
});

// ------------------------------------------------------------------- K-12

test('K12 contradicting a witnessed observation creates an attributed claim, never revokes the evidence',async t=>{
 const x=await fixture(t);
 const event=await x.witnessEvent();
 const line=await x.accept("That's not what happened, it was a bus");
 const result=await x.dispatch(line);
 assert.equal(result.acknowledgements[0].outcome,'corrected');
 assert.equal(result.acknowledgements[0].durableCommit,true);

 const stored=await x.sql(db=>db.prepare('SELECT target_id AS target,correction_mode AS mode FROM memory_corrections').all().map(r=>({...r})));
 assert.deepEqual(stored,[{target:event.recordId,mode:'counter_claim'}]);

 const rows=(await x.recall()).rows;
 const witnessed=rows.find(r=>r.recordId===event.recordId);
 assert.ok(witnessed,'witnessed event stays in recall');
 assert.equal(witnessed.sourceKind,'journal_event');
 const claim=rows.find(r=>r.isCorrectionOverlay);
 assert.ok(claim,'counter-claim is linked as an overlay');
 assert.equal(claim.envelope.mode,'reported_claim');
 assert.match(claim.envelope.content,/^Player counter-claim \(reported/);
 assert.match(claim.envelope.content,/: a bus$/);
 assert.deepEqual(claim.envelope.sourceEvidenceIds,[event.recordId]);
 assert.equal(claim.supersedesTarget,false);

 assert.equal((await x.store.listSuppressedMemoryIds(x.scope)).includes(event.recordId),false);
 assert.ok((await x.store.findCandidates({scope:x.scope})).some(c=>c.recordId===event.recordId),
  'witnessed event remains a command candidate');
 assert.ok((await x.store.readCommittedEvidencePage({scope:x.scope})).items.some(i=>i.recordId===event.recordId),
  'witnessed event is still replayable');
 const overlay=(await x.store.readCorrectionOverlays(x.scope))[0];
 assert.equal(overlay.supersedesTarget,false);assert.equal(overlay.correctionMode,'counter_claim');

 // The player can still forget the witnessed record; then claim and event both go.
 await x.service.trash({scope:x.scope,targetId:event.recordId});
 const after=(await x.recall()).rows;
 assert.equal(after.some(r=>r.recordId===event.recordId),false);
 assert.equal(after.some(r=>r.isCorrectionOverlay),false);
});

test('K12 a second contradiction may need a durable clarification over witnessed evidence; every claim stays non-superseding',async t=>{
 const x=await fixture(t);
 const event=await x.witnessEvent();
 const first=await x.dispatch(await x.accept("That's not what happened, it was a bus"));
 assert.equal(first.acknowledgements[0].outcome,'corrected');
 const second=await x.dispatch(await x.accept("that's wrong, it was a van"));
 let finished=second;
 if(second.acknowledgements[0].outcome==='clarify'){
  // The ambiguity includes the witnessed event; it must be offered and
  // frozen durably (previously this crashed with clarification_evidence_changed).
  assert.equal((await x.counts()).openClarifications,1);
  finished=await x.dispatch(await x.accept('first'));
 }
 assert.equal(finished.acknowledgements[0].outcome,'corrected');
 const modes=await x.sql(db=>db.prepare('SELECT correction_mode AS mode FROM memory_corrections').all().map(r=>r.mode));
 assert.deepEqual(modes,['counter_claim','counter_claim']);
 const rows=(await x.recall()).rows;
 assert.ok(rows.some(r=>r.recordId===event.recordId),'witnessed event still stands');
 assert.equal(rows.filter(r=>r.isCorrectionOverlay).length,2);
 assert.ok(rows.filter(r=>r.isCorrectionOverlay).every(r=>r.supersedesTarget===false));
});

test('K12 a genuine STT mishearing correction still supersedes the misheard line',async t=>{
 const x=await fixture(t);
 const original=await x.accept('I like brue',{source:'stt'});
 const r=await x.dispatch(await x.accept('No, I actually said blue'));
 assert.equal(r.acknowledgements[0].outcome,'corrected');
 const stored=await x.sql(db=>({...db.prepare('SELECT target_id AS target,correction_mode AS mode FROM memory_corrections').get()}));
 assert.deepEqual(stored,{target:original.recordId,mode:'transcript'});
 const rows=(await x.recall()).rows;
 assert.equal(rows.some(row=>row.recordId===original.recordId),false,'misheard text is superseded in recall');
 const overlay=rows.find(row=>row.isCorrectionOverlay);
 assert.equal(overlay.envelope.content,'Player correction (reported): blue');
 assert.equal(overlay.supersedesTarget,true);
 // original bytes are preserved in the immutable journal
 assert.ok((await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.timelineId}))
  .some(l=>l.recordId===original.recordId&&l.content==='I like brue'));
});

test('K12 a counter-claim about the player\'s own typed line leaves that line in recall',async t=>{
 const x=await fixture(t);
 const typed=await x.accept('I saw a red car');
 const r=await x.dispatch(await x.accept("That's not what happened, it was blue"));
 assert.equal(r.acknowledgements[0].outcome,'corrected');
 const rows=(await x.recall()).rows;
 assert.ok(rows.some(row=>row.recordId===typed.recordId));
 assert.equal(rows.find(row=>row.isCorrectionOverlay).supersedesTarget,false);
});

test('K12 store-level guards: transcript cannot target witnessed evidence, modes are validated, legacy rows are safe',async t=>{
 const x=await fixture(t);
 const event=await x.witnessEvent();
 const cmdLine=await x.accept('placeholder command line');
 const op=(extra)=>({scope:x.scope,commandId:id(),requestedByLineId:cmdLine.recordId,operation:'correct',
  origin:'explicit_player',recordType:'correction',content:'a bus',contentHash:sha('a bus'),pin:false,
  evidenceRecordIds:[event.recordId,cmdLine.recordId],targetRecordId:event.recordId,
  subjectCertainty:'reported',requestedAtUtc:cmdLine.committedAtUtc,...extra});
 await assert.rejects(x.store.commitCommand(op({correctionMode:'transcript'})),/memory_transcript_target_invalid/);
 await assert.rejects(x.store.commitCommand(op({correctionMode:'bogus'})),/memory_invalid_correction_mode/);
 assert.equal((await x.counts()).corrections,0);
 // A legacy low-level caller without a mode is stored as NULL and, because its
 // target is witnessed evidence, can only ever be read as a counter-claim.
 const legacy=op({correctionMode:null});
 await x.store.commitCommand(legacy);
 const row=await x.sql(db=>db.prepare('SELECT correction_mode AS mode FROM memory_corrections WHERE command_id=?').get(legacy.commandId));
 assert.equal(row.mode,null);
 assert.ok((await x.recall()).rows.some(r=>r.recordId===event.recordId));
 const overlay=(await x.store.readCorrectionOverlays(x.scope))[0];
 assert.equal(overlay.correctionMode,'counter_claim');assert.equal(overlay.supersedesTarget,false);
 // The direct M5 atomic port enforces the same enum.
 await assert.rejects(x.service.commitAtomicBatch({scope:x.scope,line:cmdLine,
  operations:[{...op({correctionMode:null}),commandId:id()}]}),/memory_invalid_correction_mode|m5_atomic/);
});

test('K12 the correction_mode column migrates in place and pre-existing rows stay readable',async t=>{
 const x=await fixture(t);
 const event=await x.witnessEvent();
 await x.dispatch(await x.accept("That's not what happened, it was a bus"));
 await x.store.close();
 const raw=new DatabaseSync(x.filePath);
 try{raw.exec('ALTER TABLE memory_corrections DROP COLUMN correction_mode');}finally{raw.close();}
 await x.restart();
 const cols=await x.sql(db=>db.prepare('PRAGMA table_info(memory_corrections)').all().map(c=>c.name));
 assert.ok(cols.includes('correction_mode'));
 const rows=(await x.recall()).rows;
 assert.ok(rows.some(r=>r.recordId===event.recordId),'witnessed event survives the migration');
 assert.equal(rows.find(r=>r.isCorrectionOverlay).supersedesTarget,false);
});
