// H2 on the full D01 -> D03 -> D02 harness: the original pinned runner, real
// accepted-line receipts, the production P2 SQLite store and a native D02 source
// stream. Native frames are scripted offline fixtures, not GTA receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {h2Harness} from './h2-fixture.mjs';
import {prepareFactualRecall} from '../../src/memory/h2FactualRecall.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';

const ago=s=>new Date(Date.now()-s*1000).toISOString();
const items=r=>r.preparedRecall?.contribution?.items??[];

test('H2 real D03/D02 authority: exact earlier-session quote equals the combined path M4 contribution',{timeout:60000},async t=>{
 const x=await h2Harness(t);
 const quote='I stashed the blue Zentorno 日本語 under the pier';
 await x.seed([{content:quote,at:ago(86400*3),avatar:'trevor'}]);
 const seen={};
 const {h2,combined}=await x.ask('Quote exactly what I said about the blue Zentorno',{during:async({h2})=>{
  seen.verified=await h2.verifyPrepared();seen.send=h2.sendCurrent();}});
 assert.equal(h2.status,'ready');assert.equal(combined.status,'ready');
 assert.deepEqual(items(h2).map(i=>i.content),[quote]);
 assert.equal(items(h2)[0].sourceAvatar,'trevor');
 const strip=c=>({...c,queryId:'*',items:c.items.map(({category,sourceAvatar,sourceEvidenceIds,...i})=>i)});
 assert.deepEqual(strip(h2.preparedRecall.contribution),strip(combined.preparedRecall.contribution));
 assert.deepEqual(h2.preparedRecall.stamp,combined.preparedRecall.stamp);
 assert.equal(seen.verified,true,'verified while the original turn owns the source');
 assert.equal(seen.send,true);
 assert.equal(await h2.verifyPrepared(),false,'after the turn ends, the prepared recall is dead');
 assert.equal(h2.sendCurrent(),false);
});

test('H2 real D02 source retirement: expiry fails revalidation and retries; only a NEW preparation on a new authenticated hello works',{timeout:60000},async t=>{
 const x=await h2Harness(t);
 await x.seed([{content:'The rooftop key is under the red mat',at:ago(900)}]);
 const seen={};
 const first=await x.ask('Quote what I said about the rooftop key',{during:async({h2,args})=>{
  seen.before=await h2.verifyPrepared();
  // Retire the native source through the real ShadowRuntime expiry path.
  x.native.stop();await x.native.idle();
  x.client.runtime.lastReceipt=x.client.runtime.now()-3001;x.client.runtime.expire();
  seen.epochGone=x.client.runtime.epoch===null;
  seen.afterExpiry=await h2.verifyPrepared();seen.send=h2.sendCurrent();
  seen.retry=await h2.verifyPrepared();
  seen.freshPrepare=(await prepareFactualRecall({...args,store:x.h.runtime.characterService.store})).status;
 }});
 assert.equal(first.h2.status,'ready');
 assert.deepEqual(seen,{before:true,epochGone:true,afterExpiry:false,send:false,retry:false,freshPrepare:'blocked'});
 // Reconnect with a NEW authenticated stream; the old preparation stays dead.
 await x.native.renew();
 await x.waitFor(()=>x.d02.port.status()?.settled===true&&x.client.runtime.stream===x.native.streamId,'new authenticated hello');
 assert.equal(await first.h2.verifyPrepared(),false,'the earlier-generation preparation stays invalid');
 const second=await x.ask('Quote what I said about the rooftop key',{during:async({h2})=>h2.verifyPrepared()});
 assert.equal(second.h2.status,'ready');assert.equal(second.duringResult,true);
});

test('H2 real receipts: a forged, missing or wrong-line receipt never reaches the model',{timeout:60000},async t=>{
 const x=await h2Harness(t);
 await x.seed([{content:'The garage code is 2468',at:ago(900)}]);
 const {args}=await x.ask('Quote what I said about the garage code');
 const store=x.h.runtime.characterService.store;
 for(const [name,over] of Object.entries({
  'not stored':{acceptedReceipt:{...args.acceptedReceipt,status:'not_stored'}},
  'not durable':{acceptedReceipt:{...args.acceptedReceipt,durable:false}},
  'other line':{acceptedReceipt:{...args.acceptedReceipt,recordId:randomUUID()}},
  'forged text':{input:args.input+' '},
 })){
  const r=await prepareFactualRecall({...args,store,...over});
  assert.equal(r.status,'blocked',name);assert.equal(r.preparedRecall,null,name);
 }
});

test('H2 real P2: forgetting a recalled line between preparation and send is caught on the production store',{timeout:60000},async t=>{
 const x=await h2Harness(t);
 const [line]=await x.seed([{content:'My secret handshake is two taps and a wink',at:ago(900)}]);
 const scope={...x.scope,protagonistKey:'franklin'};
 const seen={};
 const first=await x.ask('Quote what I said about the secret handshake',{during:async({h2})=>{
  seen.before=await h2.verifyPrepared();seen.sendBefore=h2.sendCurrent();
  await createM5SqliteServices({store:x.store,filePath:x.store.filePath,authorize:()=>true})
   .trash({scope,targetId:line.recordId,operationId:randomUUID()});
  seen.sendAfter=h2.sendCurrent();seen.after=await h2.verifyPrepared();
 }});
 assert.equal(first.h2.status,'ready');
 assert.deepEqual(seen,{before:true,sendBefore:true,sendAfter:false,after:false});
 const after=await x.ask('Quote what I said about the secret handshake wink');
 assert(!JSON.stringify(after.h2.preparedRecall??{}).includes('two taps and a wink'));
});

