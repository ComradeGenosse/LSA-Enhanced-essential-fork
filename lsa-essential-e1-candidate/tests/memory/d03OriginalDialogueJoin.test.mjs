// D03 CONTRACT FIXTURES ONLY. Deliberately NO original accepted backend or
// physical GTA native evidence is claimed by any positive fixture in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createD03OriginalDialogueJoin} from '../../src/memory/d03OriginalDialogueJoin.mjs';
import {createOriginalBackendAcceptedInput} from '../../src/memory/originalBackendAcceptedInput.mjs';
import {createP2MemoryStorage} from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {profile} from '../p2-fixtures.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const n=()=>randomUUID();
const stamp='2026-10-12T13:00:00.000Z';
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'d03-source-unit-'));
 const store=createP2MemoryStorage({filePath:path.join(dir,'p2.sqlite'),
   worldProfileId,sourceRequired:true});
 await store.initialize();
 const npc=await store.create(profile());
 const timelineId=await store.createTimeline({label:'D03 synthetic port contract only'});
 const host={hostContextVersion:1,hostRunId:n(),worldEpoch:1};
 store.setVerifiedHostContext(host);
 await store.confirmTimeline(timelineId,{confirmation:timelineId});
 t.after(async()=>{try{await store.close()}catch{}await rm(dir,{recursive:true,force:true});});
 const identity={pedId:'101',turnId:n(),generationId:1,sessionNonce:1};
 const captureRef=n(),incarnationId=n(),encounterId=n(),playerCaptureRef=n(),streamId=n(),adapterEpoch=n();
 const state={actor:true,d02:true,backend:true,source:true,avatar:'franklin',revision:1,
   retired:false,binds:0,verifies:0,sourceReads:0};
 const bundle=sha('UNIT_ONLY_NOT_ORIGINAL');
 const acceptedText='Exact café 😊 — this is fucking literal.';
 const backend={
   source:{acceptedSourceHookAvailable:true,sourceRevision:'UNIT_ONLY',originalBundleSha256:bundle},
   hasAuthenticatedSource:()=>state.source,
   verifyAccepted:({identity:requested,source,text})=>{
     state.sourceReads++;
     if(state.revokeAtBackendRead===state.sourceReads||
        !state.backend||state.retired||requested.turnId!==identity.turnId)return null;
     const bytes=Buffer.from(text,'utf8');
     return {kind:'OriginalBackendAcceptedInputV1',
       source:'original_essential_backend_post_acceptance',
       lifecycleStatus:'accepted',inputMode:source,...identity,
       sourceRunId:'unit-only-original-simulation',sourceRevision:'UNIT_ONLY',
       originalBundleSha256:bundle,finalAcceptedInputRevision:state.revision,
       acceptedUtf8Sha256:sha(text),acceptedUtf8ByteLength:bytes.length,
       sourceTimestamp:stamp,retirementIdentity:{turnId:identity.turnId}};
   }
 };
 const originalActor={resolveAtTurnStart:({identity:given})=>
   state.actor&&given.turnId===identity.turnId?{
     source:'original_core_actor_at_turn_start',identity:{...identity},
     nativeActorPedId:'101',characterId:npc.characterId,
     ownerAlias:npc.promotion.ownerAlias}:null};
 const d02={
   bindActorAtTurnStart:({pedId})=>{state.binds++;return state.d02&&pedId==='101'?Object.freeze({}):null;},
   verifyCurrentOwnerAndPlayer:({identity:given})=>{
     state.verifies++;
     if(!state.d02||given.turnId!==identity.turnId)return null;
     return {kind:'NativeCurrentPlayerAndOwnerV1',
       nativeCurrentOwnerVerified:true,originalBackendAccepted:false,
       identity:{...identity},nativeActorPedId:'101',
       characterId:npc.characterId,ownerAlias:npc.promotion.ownerAlias,
       observerCaptureRef:captureRef,incarnationId,encounterId,
       playerCaptureRef,streamId,adapterEpoch,
       avatarKey:state.avatar,humanPlayerScope:'single_local_human',
       hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,sequence:2};
   },
   revokeLease:()=>{state.revocations=(state.revocations??0)+1}
 };
 const factory=createD03OriginalDialogueJoin({store,backend,d02,originalActor});
 const begin=()=>factory.begin({identity,characterId:npc.characterId,
   ownerAlias:npc.promotion.ownerAlias,isCurrent:()=>!state.retired});
 const read=()=>store.withP2SqliteRead({characterId:npc.characterId,
   worldProfileId,timelineId},db=>({
     dialogue:db.prepare('SELECT record_id,content,protagonist,content_sha256 FROM dialogue_journal').all(),
     source:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_d03_accepted_sources'").get(),
     details:db.prepare("SELECT record_id,source_json,source_sha256 FROM memory_d03_accepted_sources").all()
   }));
 return {store,npc,timelineId,host,identity,state,backend,d02,originalActor,
   factory,begin,read,acceptedText};
}
test('D01 pinned source denies D03 before any original actor lease or SQLite write',async t=>{
 const x=await fixture(t);
 let actorCalls=0,leases=0,transactions=0;
 const stock=createD03OriginalDialogueJoin({store:{
   ...x.store,worldProfileId:x.store.worldProfileId,
   get timelineWritable(){return x.store.timelineWritable;},
   withP2SqliteTransaction:()=>{transactions++;throw Error('never enter');}
 },backend:createOriginalBackendAcceptedInput(),
   originalActor:{resolveAtTurnStart:()=>{actorCalls++;return null;}},
   d02:{bindActorAtTurnStart:()=>{leases++;return null;}}});
 assert.equal(stock.sourceReady(),false);
 assert.equal(stock.begin({identity:x.identity,characterId:x.npc.characterId,
   ownerAlias:x.npc.promotion.ownerAlias,isCurrent:()=>true}),null);
 assert.equal(actorCalls,0);assert.equal(leases,0);assert.equal(transactions,0);
});
test('D03 UNIT fixture commits original-acceptance-shaped plus native-shaped receipts atomically to ONE actual P2 SQLite writer',async t=>{
 const x=await fixture(t),capture=x.begin();
 assert.ok(capture);
 const r=await capture.acceptPlayer({source:'typed',text:x.acceptedText});
 assert.equal(r.status,'stored');assert.equal(r.durable,true);
 assert.equal(r.protagonistKey,'franklin');
 const tables=await x.read();
 assert.equal(tables.dialogue.length,1);assert.equal(tables.details.length,1);
 assert.equal(tables.dialogue[0].content,x.acceptedText);
 assert.equal(tables.dialogue[0].content_sha256,sha(x.acceptedText));
 assert.equal(tables.source.name,'memory_d03_accepted_sources');
 const receipt=JSON.parse(tables.details[0].source_json);
 assert.equal(receipt.finalAcceptedInputRevision,1);
 assert.equal(receipt.humanPlayerScope,'single_local_human');
 assert.equal(receipt.acceptedUtf8Sha256,sha(x.acceptedText));
 assert.equal(sha(tables.details[0].source_json),tables.details[0].source_sha256);
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'duplicate');
 assert.equal((await x.read()).dialogue.length,1);
 capture.retire();
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'not_stored');
});
test('D03 UNIT fixture rolls back mismatched accepted text/revision, stale player, and timeline changes',async t=>{
 const x=await fixture(t),capture=x.begin();
 assert.ok(capture);
 x.state.backend=false;
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'not_stored');
 x.state.backend=true;
 x.state.d02=false;
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'not_stored');
 x.state.d02=true;
 x.state.source=false;
 assert.equal((await capture.acceptPlayer({source:'stt',text:x.acceptedText})).status,'not_stored');
 x.state.source=true;
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).durable,true);
 x.state.avatar='trevor'; // same human, different provenance: cannot rewrite original turn
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'not_stored');
 x.state.avatar='franklin';x.state.revision=2;
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'not_stored');
 x.state.revision=1;
 x.state.retired=true;
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'not_stored');
 x.state.retired=false;
 assert.equal((await x.read()).dialogue.length,1);
});

test('D03 UNIT fixture revocation AFTER journal INSERT rolls back BOTH dialogue and provenance sidecar',async t=>{
 const x=await fixture(t),capture=x.begin();
 assert.ok(capture);
 // Read #1 before queue admission, #2 at transaction start,
 // #3 after both inserts but before the P2 COMMIT.
 x.state.revokeAtBackendRead=3;
 const attempted=await capture.acceptPlayer({source:'typed',text:x.acceptedText});
 assert.equal(attempted.status,'not_stored');
 assert.equal(attempted.reason,'d03_transaction_rejected');
 const committed=await x.store.withP2SqliteRead({
   characterId:x.npc.characterId,worldProfileId,timelineId:x.timelineId
 },db=>({
   dialogue:db.prepare('SELECT COUNT(*) AS n FROM dialogue_journal').get().n,
   sidecarTable:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_d03_accepted_sources'").get()
 }));
 assert.equal(committed.dialogue,0);
 // DDL itself was rolled back: no orphaned source provenance table/record.
 assert.equal(committed.sidecarTable,undefined);
 x.state.revokeAtBackendRead=null;
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'stored');
 assert.equal((await x.read()).details.length,1);
});


test('D03 synthetic original owner sample briefly stalls then recovers under the SAME preacceptance lease',async t=>{
 const x=await fixture(t),capture=x.begin();
 assert.ok(capture);
 assert.equal(x.state.binds,1);
 x.state.d02=false;
 x.d02.status=()=>({connected:false});
 const restored=setTimeout(()=>{x.state.d02=true;},55);
 t.after(()=>clearTimeout(restored));
 const result=await capture.acceptPlayer({source:'typed',text:x.acceptedText});
 assert.equal(result.status,'stored');
 assert.equal(result.durable,true);
 assert.equal(x.state.binds,1,'never retroactively bind a new owner lease');
 assert.equal((await x.read()).dialogue.length,1);
 assert.equal((await capture.acceptPlayer({source:'typed',text:x.acceptedText})).status,'duplicate');
 assert.equal((await x.read()).details.length,1);
});

test('D03 synthetic stalled owner never gains authority after a timeline or avatar switch',async t=>{
 const x=await fixture(t),capture=x.begin();
 assert.ok(capture);
 // The mock D02 port must enforce the same original-player lease fence as
 // nativeCurrentOwnerPlayerAuthority does on any avatar substitution.
 const nativeVerify=x.d02.verifyCurrentOwnerAndPlayer;
 x.d02.verifyCurrentOwnerAndPlayer=args=>
   x.state.avatar==='franklin'?nativeVerify(args):null;
 x.state.d02=false;
 const restored=setTimeout(()=>{x.state.avatar='michael';x.state.d02=true;},50);
 t.after(()=>clearTimeout(restored));
 const outcome=await capture.acceptPlayer({source:'typed',text:x.acceptedText});
 assert.equal(outcome.status,'not_stored');
 // The original preacceptance player subject must not change during recovery.
 const rows=await x.store.withP2SqliteRead({characterId:x.npc.characterId,
   worldProfileId,timelineId:x.timelineId},db=>
   db.prepare('SELECT count(*) AS total FROM dialogue_journal').get().total);
 assert.equal(rows,0);
});
