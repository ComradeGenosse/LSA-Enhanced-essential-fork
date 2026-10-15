// H1-C: real P2 SQLite plus original M2 journal and M5 privacy operations.
// Only the external native/D03 current-turn authority boundary is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createP2MemoryStorage} from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {profile} from '../p2-fixtures.mjs';
import {prepareH1ConversationHistory,openH1ConversationSource} from '../../src/memory/h1ConversationHistory.mjs';

const uid=()=>randomUUID();
const sha=text=>createHash('sha256').update(text).digest('hex');
async function setup(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'h1c-p2-'));
  const filePath=path.join(dir,'memory.sqlite'),worldProfileId=uid();
  let store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  t.after(async()=>{await store.close();await rm(dir,{force:true,recursive:true});});
  await store.initialize();
  const people=[await store.create(profile()),await store.create(profile())];
  const timelineId=await store.createTimeline({label:'H1-C original P2'});
  let host={hostContextVersion:1,hostRunId:uid(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId);
  let index=0;
  const identity=()=>({pedId:'101',turnId:'h1c-'+ ++index,generationId:'gen-1',sessionNonce:'h1c-session'});
  const record=async(person,text,{avatar='franklin',source='typed',secondsAgo=0,npc=false}={})=>{
    const id=identity();
    const recorder=createConversationJournalRecorder(store);
    const committedAtUtc=new Date(Date.now()-secondsAgo*1000).toISOString();
    const common={characterId:person.characterId,identity:id,text,committedAtUtc,
      attribution:{protagonist:avatar}};
    if(npc)return recorder.recordNpcCompleted({...common,
      receipt:{...id,type:'playback_ended',reason:'completed',playbackStarted:true,hadAudio:true,
        wasInterrupted:false,ok:true}});
    return recorder.recordPlayerAccepted({...common,source});
  };
  const scope=person=>({characterId:person.characterId,worldProfileId,timelineId,
    protagonistKey:'franklin'});
  const args=(person,receipt,text,{avatar='franklin',source='player_text'}={})=>({
    store,turn:{characterProjection:{persistent:true,profile:{characterId:person.characterId,
      promotion:{ownerAlias:person.promotion.ownerAlias}}},
      characterInputs:{profile:{characterId:person.characterId}},
      // D03/M2/native are a simulated protocol-boundary receipt, not a mock P2 database.
      m2Capture:{openMemoryCurrent:async()=>true,verifyMemoryCurrent:()=>true}},
    acceptedReceipt:{status:'stored',durable:true,recordId:receipt.recordId,protagonistKey:avatar},
    input:text,source,isCurrent:()=>true,nowUtc:new Date().toISOString()
  });
  const privacy=()=>createM5SqliteServices({store,filePath,authorize:()=>true});
  const restart=async()=>{
    await store.close();
    store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
    await store.initialize();
    host={hostContextVersion:1,hostRunId:uid(),worldEpoch:host.worldEpoch+1};
    store.setVerifiedHostContext(host);
    await store.confirmTimeline(timelineId);
  };
  return {people,scope,args,record,privacy,restart,get store(){return store;},timelineId};
}

test('H1-C P2: live SQLite accepts only durable matching current source and separates NPCs',async t=>{
  const x=await setup(t),[a,b]=x.people;
  const older=await x.record(a,'“Café” — 你好 😀 !?',{secondsAgo:35});
  await x.record(b,'other NPC private details',{secondsAgo:22});
  const current=await x.record(a,'What did I say?');
  const arg=x.args(a,current,'What did I say?');
  const h=await prepareH1ConversationHistory(arg);
  assert.equal(h.status,'ready');
  assert.deepEqual(h.conversationJournal.recent,[{role:'user',content:'“Café” — 你好 😀 !?'}]);
  assert.equal((await h.verifyPrepared()).status,'ready');
  assert.equal(h.sendCurrent(),true);
  for(const bad of [
    {...arg,acceptedReceipt:null},
    {...arg,acceptedReceipt:{...arg.acceptedReceipt,recordId:uid()}},
    {...arg,acceptedReceipt:{...arg.acceptedReceipt,protagonistKey:'trevor'}},
    {...arg,input:'partial STT'},
    {...arg,source:'player_mic'},
    {...arg,turn:{...arg.turn,characterProjection:{persistent:true,profile:b}}}
  ]){
    const denied=await prepareH1ConversationHistory(bad);
    assert.equal(denied.status,'unavailable');
    assert.equal(denied.conversationJournal,null);
  }
  assert.ok(older.recordId);
});

test('H1-C P2: freeze every recent/archive entry, not merely the outer arrays',async t=>{
  const x=await setup(t),a=x.people[0];
  await x.record(a,'older archived privacy item',{secondsAgo:400});
  await x.record(a,'recent privacy item',{secondsAgo:15});
  const current=await x.record(a,'current prompt');
  const h=await prepareH1ConversationHistory(x.args(a,current,'current prompt'));
  assert.equal(h.status,'ready');
  assert.equal(h.conversationJournal.recent.length,1);
  assert.equal(h.conversationJournal.earlier.length,1);
  for(const entry of [...h.conversationJournal.recent,...h.conversationJournal.earlier]){
    assert(Object.isFrozen(entry),'individual model-visible entry must be immutable');
    assert.throws(()=>{entry.content='unexpected private source';},TypeError);
  }
  assert.equal((await h.verifyPrepared()).status,'ready');
  assert.equal(h.sendCurrent(),true);
});

test('H1-C P2: forget recent and archived lines; restart cannot resurrect either',async t=>{
  const x=await setup(t),a=x.people[0];
  const recentText='private recent password banana';
  const archiveText='archived hidden green lantern';
  const archive=await x.record(a,archiveText,{secondsAgo:600});
  const recent=await x.record(a,recentText,{secondsAgo:20});
  const current=await x.record(a,'What do you recall?');
  const arg=x.args(a,current,'What do you recall?');
  const before=await prepareH1ConversationHistory(arg);
  assert.equal(before.status,'ready');
  assert(JSON.stringify(before.conversationJournal).includes(recentText));
  assert(JSON.stringify(before.conversationJournal).includes(archiveText));
  assert.equal((await before.verifyPrepared()).status,'ready');
  await x.privacy().trash({scope:x.scope(a),targetId:recent.recordId});
  await x.privacy().trash({scope:x.scope(a),targetId:archive.recordId});
  assert.equal(before.sendCurrent(),false,'fence must revoke previous success');
  assert.equal((await before.verifyPrepared()).status,'invalidated');
  const after=await prepareH1ConversationHistory(arg);
  assert.equal(after.status,'ready');
  assert(!JSON.stringify(after.conversationJournal).includes(recentText));
  assert(!JSON.stringify(after.conversationJournal).includes(archiveText));
  await x.restart();
  const next=await x.record(a,'What about after restarting?');
  const reopened=await prepareH1ConversationHistory(x.args(a,next,'What about after restarting?'));
  assert.equal(reopened.status,'ready');
  assert(!JSON.stringify(reopened.conversationJournal).includes(recentText));
  assert(!JSON.stringify(reopened.conversationJournal).includes(archiveText));
});

test('H1-C P2: correction of previously accepted STT never exposes original transcript',async t=>{
  const x=await setup(t),a=x.people[0];
  const stale='speech recognition wrongly heard sapphire broom';
  const corrected='speech recognition correctly heard sapphire moon';
  const target=await x.record(a,stale,{source:'stt',secondsAgo:30});
  const command=await x.record(a,'Please correct my last transcript',{secondsAgo:15});
  const beforeCorrection=await prepareH1ConversationHistory(x.args(a,command,
    'Please correct my last transcript'));
  assert.equal(beforeCorrection.status,'ready');
  assert(JSON.stringify(beforeCorrection.conversationJournal).includes(stale));
  assert.equal((await beforeCorrection.verifyPrepared()).status,'ready');
  assert.equal((await x.store.commitCommand({scope:x.scope(a),commandId:uid(),
    requestedByLineId:command.recordId,operation:'correct',correctionMode:'transcript',
    content:corrected,contentHash:sha(corrected),
    evidenceRecordIds:[command.recordId,target.recordId],targetRecordId:target.recordId,
    requestedAtUtc:(await x.store.readDialogueLines({...x.scope(a),limit:20}))
      .find(row=>row.recordId===command.recordId).committedAtUtc})).status,'committed');
  assert.equal(beforeCorrection.sendCurrent(),false,
    'durable correction must retire earlier successful verification');
  assert.equal((await beforeCorrection.verifyPrepared()).status,'invalidated');
  const current=await x.record(a,'What did I correct?');
  const h=await prepareH1ConversationHistory(x.args(a,current,'What did I correct?'));
  assert.equal(h.status,'ready');
  assert(!JSON.stringify(h.conversationJournal).includes(stale));
  assert.equal((await h.verifyPrepared()).status,'ready');
});

test('H1-C P2: privacy mutation during asynchronous journal read fails closed on initial prepare',async t=>{
  const x=await setup(t),a=x.people[0];
  const target=await x.record(a,'secret before async wait',{secondsAgo:20});
  const current=await x.record(a,'Ask a question');
  const original=x.store.readDialogueLines.bind(x.store);
  let calls=0,release,entered;
  const reached=new Promise(resolve=>entered=resolve);
  x.store.readDialogueLines=async scope=>{
    const rows=await original(scope);
    if(++calls===2){entered();await new Promise(resolve=>release=resolve);}
    return rows;
  };
  const pending=prepareH1ConversationHistory(x.args(a,current,'Ask a question'));
  await reached;
  try{
    await x.privacy().trash({scope:x.scope(a),targetId:target.recordId});
  }finally{release();}
  const h=await pending;
  assert.equal(h.status,'unavailable','cannot return stale ready after privacy commit mid-read');
  assert.equal(h.conversationJournal,null);
});

test('H1-C P2: forgotten source and read error revoke prior verification even on retry',async t=>{
  const x=await setup(t),a=x.people[0];
  const source=await x.record(a,'retry-sensitive private fact',{secondsAgo:15});
  const current=await x.record(a,'retry question');
  const h=await prepareH1ConversationHistory(x.args(a,current,'retry question'));
  assert.equal((await h.verifyPrepared()).status,'ready');
  assert.equal(h.sendCurrent(),true);
  const original=x.store.readDialogueLines.bind(x.store);
  x.store.readDialogueLines=async()=>{throw Error('simulated SQLite I/O failure');};
  assert.equal((await h.verifyPrepared()).status,'invalidated');
  assert.equal(h.sendCurrent(),false);
  x.store.readDialogueLines=original;
  assert.equal((await h.verifyPrepared()).status,'ready');
  await x.privacy().trash({scope:x.scope(a),targetId:source.recordId});
  assert.equal(h.sendCurrent(),false);
  assert.equal((await h.verifyPrepared()).status,'invalidated');
  assert.equal(h.sendCurrent(),false);
});

test('H1-C P2: legitimate earlier Franklin/Michael/Trevor lines survive new host and NPC split',async t=>{
  const x=await setup(t),[a,b]=x.people;
  await x.record(a,'Franklin remembers one',{avatar:'franklin',secondsAgo:60});
  await x.record(a,'Michael remembers two',{avatar:'michael',secondsAgo:40});
  await x.record(a,'Trevor remembers three',{avatar:'trevor',secondsAgo:20});
  await x.record(b,'another promoted NPC secret',{avatar:'trevor',secondsAgo:10});
  await x.restart();
  const current=await x.record(a,'Ask across avatars',{avatar:'franklin'});
  const h=await prepareH1ConversationHistory(x.args(a,current,'Ask across avatars'));
  assert.equal(h.status,'ready');
  const s=JSON.stringify(h.conversationJournal);
  for(const fragment of ['Franklin remembers one','Michael remembers two','Trevor remembers three'])
    assert(s.includes(fragment),fragment);
  assert(!s.includes('another promoted NPC secret'));
  assert.equal((await h.verifyPrepared()).status,'ready');
  assert.equal(h.sendCurrent(),true);
  const old=await openH1ConversationSource({...x.args(a,current,'Ask across avatars'),
    acceptedReceipt:{status:'stored',durable:true,recordId:uid(),protagonistKey:'franklin'}});
  assert.equal(old.status,'unavailable');
});

test('H1-C pin exact #138 original assembly behavior; compare extracted H1 with original code', {
  skip:!process.env.H1C_ORIGINAL_138_PATH
},async t=>{
  const {pathToFileURL}=await import('node:url');
  const baseline=await import(pathToFileURL(path.join(process.env.H1C_ORIGINAL_138_PATH,
    'lsa-essential-e1-candidate/src/memory/liveTurnMemory.mjs')).href);
  const candidate=await import('../../src/memory/h1ConversationHistory.mjs');
  const x=await setup(t),a=x.people[0],b=x.people[1];
  await x.record(a,'history recent 😀',{secondsAgo:30});
  await x.record(a,'history archived 🕰',{secondsAgo:500});
  await x.record(a,'history interrupted owner other',{secondsAgo:90,npc:true});
  await x.record(b,'wrong character',{secondsAgo:15});
  const current=await x.record(a,'Current question');
  const scope=x.scope(a);
  const rows=await x.store.readDialogueLines({...scope,limit:200});
  const accepted=rows.find(row=>row.recordId===current.recordId);
  assert.ok(accepted);
  for(const hidden of [[],[rows.find(row=>row.content==='history archived 🕰').recordId]]){
    const input={rows,accepted,scope,suppressed:hidden,nowUtc:new Date().toISOString()};
    assert.deepEqual(candidate.assembleJournalConversation(input),
      baseline.assembleJournalConversation(input),
      'same stored source rows, bounded windows, exclusions, labels and roles');
  }
});

test('H1-C P2: switching a turn projection to a retired/different owner revokes prepared bytes',async t=>{
  const x=await setup(t),a=x.people[0];
  await x.record(a,'one owner private words',{secondsAgo:20});
  const current=await x.record(a,'Do you still know me?');
  const args=x.args(a,current,'Do you still know me?');
  const h=await prepareH1ConversationHistory(args);
  assert.equal(h.status,'ready');
  assert.equal((await h.verifyPrepared()).status,'ready');
  args.turn.characterProjection.profile.promotion.ownerAlias='retired.or.replaced';
  assert.equal(h.sendCurrent(),false);
  assert.equal((await h.verifyPrepared()).status,'invalidated');
});

test('H1-C P2: forgotten completed NPC speech vanishes, not just player lines',async t=>{
  const x=await setup(t),a=x.people[0];
  await x.record(a,'Earlier player comment',{secondsAgo:70});
  const npc=await x.record(a,'Never repeat the NPC private reply',{secondsAgo:55,npc:true});
  const current=await x.record(a,'What did you say?');
  const args=x.args(a,current,'What did you say?');
  const before=await prepareH1ConversationHistory(args);
  assert.equal(before.status,'ready');
  assert(JSON.stringify(before.conversationJournal).includes('Never repeat the NPC private reply'));
  assert.equal((await before.verifyPrepared()).status,'ready');
  await x.privacy().trash({scope:x.scope(a),targetId:npc.recordId});
  assert.equal(before.sendCurrent(),false);
  assert.equal((await before.verifyPrepared()).status,'invalidated');
  const next=await prepareH1ConversationHistory(args);
  assert.equal(next.status,'ready');
  assert(!JSON.stringify(next.conversationJournal).includes('Never repeat the NPC private reply'));
});

test('H1-C P2: native disconnect/epoch loss retires a verified read even with same NPC',async t=>{
  const x=await setup(t),a=x.people[0];
  await x.record(a,'Private host-bound line',{secondsAgo:20});
  const current=await x.record(a,'What just happened?');
  const h=await prepareH1ConversationHistory(x.args(a,current,'What just happened?'));
  assert.equal((await h.verifyPrepared()).status,'ready');
  x.store.onBoundary({reason:'native_disconnect'});
  assert.equal(h.sendCurrent(),false);
  assert.equal((await h.verifyPrepared()).status,'invalidated');
});
