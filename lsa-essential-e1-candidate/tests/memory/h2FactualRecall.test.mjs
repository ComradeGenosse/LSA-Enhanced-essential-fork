// H2: independent M4 factual recall on the REAL production P2 SQLite store,
// recorder, M3 event sidecars, M4 engine and evidence policy. See
// h2-p2-fixture.mjs for exactly which parts are doubles (M2/D02 callbacks only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {p2Fixture,ago,id,sha} from './h2-p2-fixture.mjs';
import {prepareFactualRecall,createFactualRecall} from '../../src/memory/h2FactualRecall.mjs';

const items=r=>r.preparedRecall?.contribution?.items??[];
const contents=r=>items(r).map(x=>x.content);

test('H2 exact quote from an earlier session is byte-exact Unicode with speaker/source attribution; the current line is excluded',async t=>{
 const f=await p2Fixture(t);
 const quote='I hid the 🚗 blue Zentorno under the pier — ñandú 日本語  trailing  ';
 const old=await f.say(quote,{at:ago(86400*3),avatar:'michael',sessionNonce:'older-session'});
 const {h2,receipt}=await f.ask('Quote exactly what I said about the blue Zentorno');
 assert.equal(h2.status,'ready');
 assert.equal(h2.preparedRecall.contribution.contributor,'m4_recall');
 assert.equal(h2.preparedRecall.contribution.lane,'RECALLED');
 assert.deepEqual(contents(h2),[quote],'byte-exact, untrimmed, no reconstruction');
 const [item]=items(h2);
 assert.equal(item.mode,'exact_quote');assert.equal(item.recordId,old.recordId);
 assert.equal(item.sourceAvatar,'michael','source avatar attribution is retained');
 assert.equal(item.freshness,'archive');
 assert(!items(h2).some(x=>x.recordId===receipt.recordId),'current accepted line is not history');
 assert.equal(await h2.verifyPrepared(),true);assert.equal(h2.sendCurrent(),true);
});

test('H2 recent factual retrieval returns completed NPC speech and never failed/undelivered speech',async t=>{
 const f=await p2Fixture(t);
 await f.say('The informant meets us at the marina at midnight',{speaker:'npc',at:ago(240)});
 const {h2}=await f.ask('What did you tell me about the marina informant?');
 assert.equal(h2.status,'ready');
 assert.deepEqual(contents(h2),['The informant meets us at the marina at midnight']);
 assert.equal(items(h2)[0].freshness,'live');
 assert.equal(h2.timings.totalMs>=h2.timings.retrievalMs,true);
});

test('H2 recalls witnessed events with M3 recording absent; dialogue mentions confer no witnessing',async t=>{
 const f=await p2Fixture(t);
 // Only committed, sidecar-verified evidence exists; no M3 recorder/tap runs here.
 const {event}=await f.event(1,{at:ago(600)});
 await f.say('I think you saw the explosion on the bridge',{at:ago(500)});
 const seen=await f.ask('What gunshot firing did you see happen?');
 assert.equal(seen.h2.status,'ready');
 const [fact]=items(seen.h2);
 assert.equal(fact.recordId,event.recordId);assert.equal(fact.sourceKind,'journal_event');
 assert.equal(fact.category,'directly_observed_fact');
 assert.equal(seen.h2.preparedRecall.answerEvidence.witness.status,'witnessed');
 assert.equal(seen.h2.preparedRecall.answerEvidence.negativeWitnessing,'unavailable');
 // The player's remark is dialogue, not an event. No event proof => unknown.
 const bridge=await f.ask('Did you witness the explosion on the bridge?');
 assert(!items(bridge.h2).some(x=>/explosion on the bridge/.test(x.content)&&x.sourceKind==='journal_event'));
 assert(['witnessed','unknown'].includes(bridge.h2.preparedRecall?.answerEvidence?.witness?.status??'unknown'));
 assert.notEqual(bridge.h2.preparedRecall?.answerEvidence?.witness?.status,'did_not_witness');
});

test('H2 needs no H1 context, M5 commands, M6/M7 curation, M8 interpretation, PS3 salience or M3 recording',async t=>{
 const f=await p2Fixture(t);
 await f.say('My lucky number is seventeen',{at:ago(7200)});
 const touched=new Set();
 // Any access to a consumer-owned surface is recorded; none may occur.
 const forbidden=/curation|m5|m6|m7|m8|interpret|salience|appendJournalEvent|appendDialogueLine|commitCommand|withTimelineWrite|withP2SqliteTransaction|enqueue|claim|reserve/i;
 const spy=new Proxy(f.store,{get(target,key,receiver){
  if(typeof key==='string'&&forbidden.test(key))touched.add(key);
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const {h2}=await f.ask('What did I say about my lucky number?',{storeOverride:spy});
 assert.equal(h2.status,'ready');assert.deepEqual(contents(h2),['My lucky number is seventeen']);
 assert.equal(await h2.verifyPrepared(),true);
 assert.deepEqual([...touched],[],'no writer, curation, command or interpretation surface was touched');
 // No wired consumer: the combined-path services are not even imported by H2.
 const text=(await import('node:fs')).readFileSync(new URL('../../src/memory/h2FactualRecall.mjs',import.meta.url),'utf8');
 for(const banned of ['liveTurnMemory','m5Runtime','m8Interpretation','lunaCurator','m6Coordinator','salience'])
  assert(!new RegExp("^import .*"+banned,'m').test(text),'H2 must not import '+banned);
});

test('H2 disabled performs no retrieval, no store access and no contribution',async t=>{
 const f=await p2Fixture(t);
 await f.say('I like the red car',{at:ago(900)});
 const accessed=[];
 const spy=new Proxy(f.store,{get(target,key){accessed.push(String(key));return Reflect.get(target,key,target);}});
 const off=createFactualRecall(); // default off
 const accepted=await f.say('What do I like?');
 const r=await off.prepare({store:spy,turn:f.turnFor(0),acceptedReceipt:{status:'stored',durable:true,
  recordId:accepted.recordId,protagonistKey:'franklin'},input:'What do I like?',source:'player_text',isCurrent:()=>true});
 assert.equal(r.status,'disabled');assert.equal(r.preparedRecall,null);
 assert.equal(await r.verifyPrepared(),false);assert.equal(r.sendCurrent(),false);
 assert.deepEqual(accessed,[],'disabled H2 never touched the store');
 assert.throws(()=>createFactualRecall({mode:'shadow'}),/h2_invalid_mode/);
 const on=createFactualRecall({mode:'on'});
 const ready=await on.prepare({store:f.store,turn:f.turnFor(0),acceptedReceipt:{status:'stored',durable:true,
  recordId:accepted.recordId,protagonistKey:'franklin'},input:'What do I like?',source:'player_text',isCurrent:()=>true});
 assert.equal(ready.status,'ready');
});

test('H2 isolates NPCs and timelines and never leaks another NPC memory',async t=>{
 const f=await p2Fixture(t,{characters:2});
 await f.say('Nathan keeps his plasma pistol in the freezer',{character:0,at:ago(3000)});
 await f.say('Bianca keeps her plasma pistol in the piano',{character:1,at:ago(3000)});
 await f.event(1,{character:1,at:ago(1000)});
 const a=await f.ask('Quote what I said about the plasma pistol',{character:0});
 const b=await f.ask('Quote what I said about the plasma pistol',{character:1});
 assert(contents(a.h2).some(x=>/freezer/.test(x)));assert(!contents(a.h2).some(x=>/piano/.test(x)));
 assert(contents(b.h2).some(x=>/piano/.test(x)));assert(!contents(b.h2).some(x=>/freezer/.test(x)));
 const aEvents=await f.ask('What firing did you see?',{character:0});
 assert(!items(aEvents.h2).some(x=>x.sourceKind==='journal_event'),'another NPC event never leaks');
 // A new timeline is a different memory scope for the same NPC.
 const second=await f.store.createTimeline({label:'H2 second'});
 await f.store.confirmTimeline(second);
 const c=await f.ask('Quote what I said about the plasma pistol',{character:0});
 assert(!contents(c.h2).some(x=>/freezer/.test(x)),'earlier timeline line is outside the new timeline scope');
});

test('H2 treats Franklin, Michael and Trevor as one human within the NPC/world/timeline scope',async t=>{
 const f=await p2Fixture(t);
 await f.say('Franklin told you about the harbor safe',{avatar:'franklin',at:ago(5000)});
 await f.say('Michael told you about the harbor map',{avatar:'michael',at:ago(4000)});
 await f.say('Trevor told you about the harbor boat',{avatar:'trevor',at:ago(3000)});
 const {h2}=await f.ask('Quote what I said about the harbor',{avatar:'trevor'});
 assert.equal(h2.status,'ready');
 const got=Object.fromEntries(items(h2).map(x=>[x.sourceAvatar,x.content]));
 assert.match(got.franklin,/safe/);assert.match(got.michael,/map/);assert.match(got.trevor,/boat/);
});

test('H2 excludes forgotten and superseded text before preparation and exposes the corrected quote',async t=>{
 const f=await p2Fixture(t);
 const secret=await f.say('The confidential lilac bicycle is in the shed',{at:ago(4000)});
 const wrong=await f.say('The quarry code is 4417 for the gate',{at:ago(3000)});
 await f.forget(secret.recordId);
 await f.correct(wrong.recordId,'The quarry code is 7714 for the gate');
 const lilac=await f.ask('Quote what I said about the lilac bicycle shed');
 assert(!JSON.stringify(lilac.h2.preparedRecall??{}).includes('lilac bicycle is in the shed'));
 const quarry=await f.ask('Quote what I said about the quarry code gate');
 const all=contents(quarry.h2).join('|');
 assert(!all.includes('4417'),'superseded text is never presented as current');
 assert(all.includes('7714'),'the corrected quote is what was retained');
});

test('H2 prepared recall becomes unusable after forgetting or correcting a recalled record before send',async t=>{
 for(const change of ['forget','correct']){
  const f=await p2Fixture(t);
  const line=await f.say('My garage code is 2468 for the gate',{at:ago(3000)});
  const {h2}=await f.ask('Quote what I said about the garage code gate');
  assert.equal(h2.status,'ready');assert.equal(await h2.verifyPrepared(),true);
  assert.equal(h2.sendCurrent(),true);
  if(change==='forget')await f.forget(line.recordId);
  else await f.correct(line.recordId,'My garage code is 1357 for the gate');
  assert.equal(h2.sendCurrent(),false,change+': the read fence moved, send is no longer current');
  assert.equal(await h2.verifyPrepared(),false,change);
  assert.equal(h2.sendCurrent(),false);
  assert.equal(await h2.verifyPrepared(),false,'retry after invalidation stays invalid');
  assert.equal(h2.recallCurrent([],{...h2.preparedRecall.stamp}),true,'stamp identity itself is unchanged');
  assert.equal(h2.revalidationMs()!==null,true);
 }
});

test('H2 privacy change between query and final-send verification is caught even after a successful verification',async t=>{
 const f=await p2Fixture(t);
 const line=await f.say('My bank PIN joke is one two three four',{at:ago(2000)});
 const {h2}=await f.ask('Quote what I said about the bank PIN joke');
 assert.equal(await h2.verifyPrepared(),true);assert.equal(h2.sendCurrent(),true);
 await f.forget(line.recordId); // privacy action between verify and fetch
 assert.equal(h2.sendCurrent(),false,'synchronous fence closes the gap to the request');
 assert.equal(await h2.verifyPrepared(),false);
});

test('H2 revalidation fails on source retirement, host/world-epoch, owner and timeline changes and never revives',async t=>{
 const scenarios={
  'source retired (M2/D02 lease)':f=>{f.live=false;},
  'host reconnect (new run id)':f=>{f.newHost();},
  'world epoch change':f=>{f.newHost(f.host.worldEpoch+1);},
  'timeline change':async f=>{const tl=await f.store.createTimeline({label:'later'});await f.store.confirmTimeline(tl);},
 };
 for(const [name,change] of Object.entries(scenarios)){
  const f=await p2Fixture(t);
  await f.say('The rooftop key is under the mat',{at:ago(1500)});
  const {h2}=await f.ask('Quote what I said about the rooftop key');
  assert.equal(h2.status,'ready',name);assert.equal(await h2.verifyPrepared(),true,name);
  const stamp={...h2.preparedRecall.stamp};
  await change(f);
  assert.equal(h2.recallCurrent([],stamp),false,name+': stale stamp');
  assert.equal(await h2.verifyPrepared(),false,name);
  assert.equal(h2.sendCurrent(),false,name);
  // Replay from the earlier generation: restoring the old context cannot revive it.
  f.live=true;
  assert.equal(await h2.verifyPrepared(),false,name+': prepared object latches invalid');
  assert.equal(h2.sendCurrent(),false,name);
 }
});

test('H2 owner (alias) change invalidates a prepared recall',async t=>{
 const f=await p2Fixture(t);
 await f.say('The warehouse code is blue',{at:ago(1500)});
 let alias=f.chars[0].promotion.ownerAlias;
 const moving=new Proxy(f.store,{get(target,key){
  if(key==='get')return characterId=>{
   const p=target.get(characterId);return p&&{...p,promotion:{...p.promotion,ownerAlias:alias}};};
  const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
 const {h2}=await f.ask('Quote what I said about the warehouse code',{storeOverride:moving});
 assert.equal(await h2.verifyPrepared(),true);
 alias='promoted.someone-else';
 assert.equal(await h2.verifyPrepared(),false);assert.equal(h2.sendCurrent(),false);
});

test('H2 refuses to prepare when authority is missing, forged or revoked; no config/guessed identity can substitute',async t=>{
 const f=await p2Fixture(t);
 await f.say('Remember the green boat',{at:ago(900)});
 const accepted=await f.say('What do I remember about the green boat?');
 const receipt={status:'stored',durable:true,recordId:accepted.recordId,protagonistKey:'franklin'};
 const base={store:f.store,turn:f.turnFor(0),acceptedReceipt:receipt,input:'What do I remember about the green boat?',
  source:'player_text',isCurrent:()=>true};
 const blocked=async(over,why)=>{
  const r=await prepareFactualRecall({...base,...over});
  assert.equal(r.status,'blocked',why);assert.equal(r.preparedRecall,null,why);
  assert.equal(await r.verifyPrepared(),false,why);return r;
 };
 assert.equal((await prepareFactualRecall(base)).status,'ready');
 await blocked({acceptedReceipt:{...receipt,status:'not_stored'}},'receipt not stored');
 await blocked({acceptedReceipt:{...receipt,durable:false}},'receipt not durable');
 await blocked({acceptedReceipt:{...receipt,recordId:id()}},'receipt for another line');
 await blocked({acceptedReceipt:null},'no receipt');
 await blocked({input:'What do I remember about the green boat? (forged)'},'input differs from journal bytes');
 await blocked({source:'model_output'},'non-player source');
 await blocked({isCurrent:()=>false},'turn no longer current');
 await blocked({isCurrent:undefined},'no turn predicate');
 // A guessed/other NPC identity: line is not that NPC's accepted line.
 await blocked({turn:f.turnFor(1)},'another NPC identity');
 // M2 not current / no D02 identity.
 f.live=false;await blocked({},'M2 memory source retired');f.live=true;
 const noIdentity=f.turnFor(0);noIdentity.m2Capture.memoryIdentity=()=>null;
 const r=await blocked({turn:noIdentity},'no D02 source identity');assert.equal(r.reason,'no_source_identity');
 // A caller-supplied authority field or configuration flag is simply ignored.
 const sneaky=await prepareFactualRecall({...base,authority:{ok:true},memoryRead:{verified:true},
  config:{memory:{recall:true}},enabled:true,live:true});
 assert.equal(sneaky.status,'ready','extra fields change nothing');
 const wrongSource=f.turnFor(0);
 wrongSource.m2Capture.memoryIdentity=()=>({...f.turnFor(0).m2Capture.memoryIdentity(),hostRunId:id()});
 await blocked({turn:wrongSource},'D02 identity from another host run');
});

test('H2 abstains honestly: unsupported queries, first/earliest, missing evidence, non-literal counts',async t=>{
 const f=await p2Fixture(t);
 await f.say('I like painting the lighthouse',{at:ago(5000)});
 const none=await f.ask('Do you remember my favorite quasar telescope?');
 assert.equal(none.h2.status,'abstained');assert.deepEqual(items(none.h2),[]);
 assert(['not_recorded','unsupported_or_insufficient_evidence'].includes(none.h2.reason));
 const earliest=await f.ask('What is the first thing I ever said about the lighthouse?');
 assert.equal(earliest.h2.status,'abstained','a bounded page never claims all-time oldest');
 assert.deepEqual(items(earliest.h2),[]);
 const fuzzy=await f.ask('How many times did we talk about lighthouses?');
 assert.equal(fuzzy.h2.status,'abstained');
 const evidence=fuzzy.h2.preparedRecall.answerEvidence.dialogueCount;
 assert.equal(evidence.status,'incomplete');assert.equal(evidence.exactCount,null);
 assert.equal(evidence.reason,'unsupported_query');
 assert.equal(fuzzy.h2.preparedRecall.contribution.items.length,0);
});

test('H2 exact counts are exhaustive (beyond the 384 candidate page) or absent; first/last honour coverage',async t=>{
 const f=await p2Fixture(t);
 for(let i=0;i<402;i++)await f.say('telescope entry '+i,{at:ago(10000-i),avatar:['michael','franklin','trevor'][i%3]});
 await f.say('I looked through the binoculars',{at:ago(60)});
 const count=await f.ask('How many times did I say "telescope"?');
 assert.equal(count.h2.status,'ready');
 const c=count.h2.preparedRecall.answerEvidence.dialogueCount;
 assert.equal(c.status,'complete');assert.equal(c.exactCount,402,'excludes the current question line');
 assert.equal(c.first.sourceAvatar,'michael');assert.equal(c.last.sourceAvatar,'trevor');
 assert.equal(await count.h2.verifyPrepared(),true);
 const zero=await f.ask('How many times did I say "zeppelin"?');
 assert.equal(zero.h2.preparedRecall.answerEvidence.dialogueCount.exactCount,0);
 assert.equal(zero.h2.status,'ready','a verified complete zero is an answer, not an invention');
}, {timeout:120000});

test('H2 bounds results and never truncates a quote while labelling it exact',async t=>{
 const f=await p2Fixture(t);
 const long='zyx-long '+'abcdefghij '.repeat(330); // > 3072 code points, accepted by the journal
 assert(long.length>3072&&long.length<12000);
 await f.say(long,{at:ago(3000)});
 const exact=await f.ask('Quote exactly what I said about the zyx-long text');
 assert(!items(exact.h2).some(x=>x.mode==='exact_quote'&&x.content!==long),'never a truncated exact quote');
 assert(!items(exact.h2).some(x=>x.content.length<long.length&&long.startsWith(x.content)));
 for(let i=0;i<60;i++)await f.say('alpaca saddle number '+i+' '+'x'.repeat(180),{at:ago(2000-i)});
 const many=await f.ask('What did I say about the alpaca saddle?',{args:{maxContributionBytes:2048}});
 assert.equal(many.h2.status,'ready');
 const bytes=Buffer.byteLength(JSON.stringify(many.h2.preparedRecall.contribution));
 assert(bytes<=2048+512,'bounded contribution: '+bytes);
 assert(items(many.h2).length<=12);
 const quote=await f.ask('Quote exactly what I said about the alpaca saddle');
 assert(items(quote.h2).length<=4,'exact-quote intent has the smaller cap');
}, {timeout:120000});

test('H2 never presents a tampered retained row: unreadable evidence is honestly unavailable, with no fabricated text',async t=>{
 const f=await p2Fixture(t);
 const bad=await f.say('Tampered voucher code is 9999 for sure',{at:ago(4000)});
 await f.say('Genuine voucher code is 1111 for sure',{at:ago(3000)});
 const before=await f.ask('Quote what I said about the voucher code');
 assert.equal(before.h2.status,'ready');
 // Corrupt the retained bytes behind the content hash (inherited P2 fail-closed read).
 await f.store.withTimelineSqliteWrite(f.scope(),db=>db.prepare(
  'UPDATE dialogue_journal SET content=? WHERE record_id=?').run('Tampered voucher code is 0000 for sure',bad.recordId));
 assert.equal(await before.h2.verifyPrepared(),false,'a prepared recall cannot outlive damaged evidence');
 const after=await f.ask('Quote what I said about the voucher code');
 assert.equal(after.h2.status,'unavailable');assert.equal(after.h2.preparedRecall,null);
 assert(!JSON.stringify(after.h2).includes('0000'));
});

test('H2 drops a witnessed event whose immutable source sidecar is damaged and never reports it as witnessed',async t=>{
 const f=await p2Fixture(t);
 await f.say('Genuine voucher code is 1111 for sure',{at:ago(3000)});
 const {event}=await f.event(1,{at:ago(2000)});
 await f.store.withTimelineSqliteWrite(f.scope(),db=>db.prepare(
  'UPDATE event_source_evidence SET source_evidence_json=? WHERE record_id=?').run('{"format":"damaged"}',event.recordId));
 const q=await f.ask('Quote what I said about the voucher code');
 assert(contents(q.h2).join('|').includes('1111'),'unrelated verified dialogue is still recalled');
 const e=await f.ask('What firing did you see?');
 assert(!items(e.h2).some(x=>x.sourceKind==='journal_event'),'event with a damaged sidecar is not evidence');
 assert.notEqual(e.h2.preparedRecall?.answerEvidence?.witness?.status,'witnessed');
});

test('H2 revalidation fails when the evidence sidecar is damaged after preparation',async t=>{
 const f=await p2Fixture(t);
 const {event}=await f.event(1,{at:ago(2000)});
 const {h2}=await f.ask('What firing did you see?');
 assert.equal(h2.status,'ready');assert.equal(await h2.verifyPrepared(),true);
 await f.store.withTimelineSqliteWrite(f.scope(),db=>
  db.prepare('UPDATE event_source_evidence SET source_evidence_json=? WHERE record_id=?').run('{"format":"damaged"}',event.recordId));
 assert.equal(await h2.verifyPrepared(),false);
});

test('H2 contribution is byte-identical to the combined-path M4 contribution for the same turn',async t=>{
 const {prepareLiveTurnMemory}=await import('../../src/memory/liveTurnMemory.mjs');
 const f=await p2Fixture(t);
 await f.say('The vault door sticks when it rains',{at:ago(5000),speaker:'npc'});
 await f.say('I said the vault door worked fine',{at:ago(4000)});
 const nowUtc=new Date().toISOString();
 const input='Quote what you said about the vault door';
 const receipt=await f.say(input,{at:nowUtc});
 const args={store:f.store,turn:f.turnFor(0),acceptedReceipt:{status:'stored',durable:true,
  recordId:receipt.recordId,protagonistKey:'franklin'},input,source:'player_text',isCurrent:()=>true,nowUtc};
 const queryId=id();
 const h2=await prepareFactualRecall({...args,queryId});
 const combined=await prepareLiveTurnMemory(args); // read-only reference, unchanged
 assert.equal(h2.status,'ready');assert.equal(combined.status,'ready');
 const strip=c=>({...c,queryId:'*'});
 assert.deepEqual(strip(h2.preparedRecall.contribution),strip(combined.preparedRecall.contribution));
 assert.deepEqual(h2.preparedRecall.stamp,combined.preparedRecall.stamp);
 assert.deepEqual(h2.preparedRecall.answerEvidence,combined.preparedRecall.answerEvidence);
});

