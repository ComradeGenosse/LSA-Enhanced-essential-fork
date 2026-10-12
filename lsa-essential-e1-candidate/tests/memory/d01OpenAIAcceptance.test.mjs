// OFFLINE end-to-end D01 -> D03 acceptance tests. See d01-harness.mjs for
// exactly what is real (patched pinned original bundle, runtime, runner, D01,
// ledger, D02 port + IntelligenceClient, D03, P2 SQLite) and what is scripted
// (native frames, P1 owner pipe, providers, playback ACKs). Not GTA evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {d01Harness,waitFor,sleep} from './d01-harness.mjs';
import {ProviderRequestError} from '../../src/openai/request.mjs';
import {createRuntime} from '../../src/integration/essentialGlue.mjs';
import {normalizeConfig} from '../../src/config/e1Config.mjs';
import {ORIGINAL_BACKEND_PIN} from '../../src/memory/originalBackendAcceptedInput.mjs';

const sha=s=>createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');
const GREETING='Hello, what are you doing here?';
// Observe every D03 accept call made by the production runner.
function recordSpy(x){
  const original=x.h.runtime.services.recordM2Player;
  const spy={calls:0,results:[],args:[]};
  x.h.runtime.services.recordM2Player=async args=>{
    spy.calls++;spy.args.push(args);
    const result=await original(args);
    spy.results.push(result);
    return result;
  };
  spy.original=original;
  return spy;
}
const evidenceOf=row=>JSON.parse(row.source_json);
const users=x=>x.h.runtime.history.readForSession('17',1).filter(m=>m.role==='user').map(m=>m.content);

test('D01 E2E typed: the exact bytes the original backend adopted become one receipt-backed durable line',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const turn=await x.typed('  \tFuck this — déjà vu 🦊 中文  and   café!\r\n  ');
  const identity=x.identityOf(turn);
  assert.equal((await x.settled(turn)).status,'completed');
  const adopted='Fuck this — déjà vu 🦊 中文  and   café!';
  assert.equal(turn.input.transcript,adopted,'original ib/Xi adopted Fr(t.text): ends trimmed, inner whitespace kept');
  assert.equal(x.replies[0].input,adopted,'model received the identical words');
  assert.deepEqual(users(x),[adopted],'RAM history committed the identical words once');
  assert.equal(spy.results[0].status,'stored');
  assert.equal(spy.results[0].durable,true);
  assert.equal(spy.results[0].humanPlayerScope,'single_local_human');
  const j=await x.journal();
  assert.equal(j.rows.length,1);
  assert.deepEqual({...j.rows[0],session_id:undefined},{speaker:'player',source:'typed',content:adopted,
    content_sha256:sha(adopted),protagonist:'franklin',session_id:undefined,delivery:'accepted'});
  const e=evidenceOf(j.sources[0]);
  assert.equal(sha(j.sources[0].source_json),j.sources[0].source_sha256);
  assert.deepEqual(e.identity,identity);
  assert.equal(e.receiptSource,'essential_openai_runtime_commit_decision');
  assert.equal(e.sourceRevision,'lsa-e1-openai-commit-decision-v1+essential-original-server-5d81de4217bd');
  assert.equal(e.originalBundleSha256,ORIGINAL_BACKEND_PIN.originalBundleSha256);
  assert.equal(e.inputMode,'typed');
  assert.equal(e.finalAcceptedInputRevision,1);
  assert.equal(e.acceptedUtf8Sha256,sha(adopted));
  assert.equal(e.acceptedUtf8ByteLength,Buffer.byteLength(adopted,'utf8'));
  assert.equal(e.characterId,x.profile.characterId);
  assert.equal(e.ownerAlias,x.profile.promotion.ownerAlias);
  assert.equal(e.incarnationId,x.owned.claim.incarnationId,'D02 native incarnation == P1 verified claim');
  assert.equal(e.observerCaptureRef,x.native.npcRef);
  assert.equal(e.avatarKey,'franklin');
  // NPC reply: native playback completed, RAM history committed it, but no
  // source-verified W03 delivery proof exists, so nothing is journaled.
  assert.equal(x.h.runtime.history.readForSession('17',1).filter(m=>m.role==='assistant').length,1);
  assert.equal(j.rows.filter(r=>r.speaker==='npc').length,0,'NPC line never journaled without audible-delivery proof');
  // Unicode whitespace at the ends (NBSP, ideographic space) is trimmed by the
  // original backend's Fr (String.prototype.trim); inner NBSP is preserved.
  const second=await x.typed(' 　 inner nbsp kept 　');
  assert.equal((await x.settled(second)).status,'completed');
  const rows=(await x.journal()).rows;
  assert.equal(rows.length,2);
  assert.equal(rows[1].content,'inner nbsp kept');
});

test('D01 E2E STT: real original mic path, single final transcript routed once, durable stt line',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const text='Mic words, café 😐 — exact';
  let calls=0;
  x.h.runtime.services.transcribe=async({pcm})=>{calls++;assert.deepEqual([...pcm],[1,2,3,4]);return text;};
  const turn=await x.mic();
  assert.equal(turn.source,'player_mic');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.equal(calls,1);
  assert.equal(x.h.evaluate('d01MicTurn.input.transcript'),text,'original AP/SK record holds exactly the final transcript');
  assert.equal(x.replies[0].input,text);
  assert.deepEqual(users(x),[text]);
  assert.equal(spy.results[0].status,'stored');
  const j=await x.journal();
  assert.equal(j.rows.length,1);
  assert.equal(j.rows[0].source,'stt');
  assert.equal(j.rows[0].content,text);
  const e=evidenceOf(j.sources[0]);
  assert.equal(e.inputMode,'stt');
  assert.equal(e.finalAcceptedInputRevision,1);
  assert.equal(e.acceptedUtf8Sha256,sha(text));
});

test('D01 E2E STT retry: one transient failure, one final transcript, one revision, one line',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  let calls=0;
  x.h.runtime.services.transcribe=async()=>{
    if(++calls===1)throw new ProviderRequestError('connection reset',{code:'econnreset'});
    return 'second attempt words';
  };
  const turn=await x.mic();
  assert.equal((await x.settled(turn)).status,'completed');
  assert.equal(calls,2,'provider executor retried STT once before any result');
  assert.equal(x.h.evaluate('d01MicTurn.input.transcript'),'second attempt words');
  assert.equal(spy.results.length,1);
  const j=await x.journal();
  assert.equal(j.rows.length,1);
  assert.equal(evidenceOf(j.sources[0]).finalAcceptedInputRevision,1);
});

test('D01 E2E empty input: stock greeting substitution, testPrompt and empty STT never become player memory',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const blank=await x.typed('  \t ');
  assert.equal((await x.settled(blank)).status,'completed');
  assert.equal(blank.input.transcript,GREETING,'original ib substitutes its default greeting');
  assert.equal(x.replies[0].input,GREETING,'stock behaviour towards the model is unchanged');
  assert.equal(spy.results[0].status,'not_stored');
  const debug=await x.typed('debug words',{type:'testPrompt'});
  assert.equal((await x.settled(debug)).status,'completed');
  assert.equal(spy.results[1].status,'not_stored');
  x.h.runtime.services.transcribe=async()=>{
    throw new ProviderRequestError('OpenAI transcription was empty or too long.',{code:'invalid_transcript'});
  };
  const mic=await x.mic();
  const result=await x.settled(mic);
  assert.notEqual(result.status,'completed');
  assert.equal(spy.calls,2,'no commit and no accept attempt without a final transcript');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E supersession during STT: late transcript after a newer generation gets no receipt',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  x.h.runtime.services.transcribe=async()=>{entered();await gate;return 'late mic words';};
  const micTurn=await x.mic();
  const oldIdentity=x.identityOf(micTurn);
  await started;
  const micDone=x.settled(micTurn); // whenSettled only tracks the active launch
  const typed=await x.typed('barge-in words');
  assert.equal((await x.settled(typed)).status,'completed');
  assert.equal(x.h.runtime.host.isCurrent(oldIdentity),false);
  assert.equal(x.h.runtime.host.originalTurnFacts(oldIdentity,x.session.connection),null,
    'the original registry refuses the stale tuple');
  release();
  assert.notEqual((await micDone).status,'completed');
  assert.deepEqual(users(x),['barge-in words']);
  const rows=(await x.journal()).rows;
  assert.deepEqual(rows.map(r=>r.content),['barge-in words']);
  assert.equal(spy.calls,1);
});

test('D01 E2E cancel AFTER acceptance: the accepted line stands (memory plan 5.5)',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  x.native.stop(); // D03 must now wait for an owner sample newer than its lease
  const turn=await x.typed('Remember the fountain.');
  const identity=x.identityOf(turn);
  await waitFor(()=>spy.calls===1,'D03 write pending after the commit decision');
  assert.deepEqual(users(x),['Remember the fountain.'],'input already genuinely accepted');
  x.h.context.cancelAfterAcceptance=turn;
  await x.h.evaluate('Qi(cancelAfterAcceptance.id, ke.PLAYER_BARGE_IN)');
  assert.equal(x.h.runtime.host.isCurrent(identity),false,'turn interrupted');
  await x.native.sample();
  const result=await x.settled(turn);
  assert.notEqual(result.status,'completed');
  assert.equal(spy.results[0].status,'stored');
  const j=await x.journal();
  assert.deepEqual(j.rows.map(r=>r.content),['Remember the fountain.']);
  assert.equal(x.h.runtime.history.readForSession('17',1).some(m=>m.role==='assistant'),false);
});

for(const [label,revoke] of [
  ['session close',x=>x.session.connection.close()],
  ['P1 owner/identity retirement',x=>x.f.evidence.retire('17')],
  ['native intelligence disconnect',x=>x.native.socket.destroy()],
])test(`D01 E2E revocation between acceptance and COMMIT: ${label}`,{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  x.native.stop();
  const turn=await x.typed('Words accepted just before the '+label+'.');
  await waitFor(()=>spy.calls===1,'D03 write pending');
  revoke(x);
  try{await x.native.sample();}catch{}
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'D03 settled');
  assert.equal(spy.results[0].status,'not_stored',label);
  assert.equal((await x.journal()).rows.length,0,label);
});

test('D01 E2E world epoch change while the write is pending revokes it',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  x.native.stop();
  const turn=await x.typed('Before the save was loaded.');
  await waitFor(()=>spy.calls===1,'D03 write pending');
  x.native.worldEpoch=2;
  await x.native.send('world_epoch',{epoch:2,reason:'clock_regression'});
  await x.native.sample();
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'D03 settled');
  assert.equal(spy.results[0].status,'not_stored');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E source revocation INSIDE the open P2 transaction rolls back line and provenance',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const store=x.store,originalTx=store.withP2SqliteTransaction.bind(store);
  let inTransaction=false,revoked=false;
  store.withP2SqliteTransaction=(scope,operation)=>originalTx(scope,db=>{
    inTransaction=true;try{return operation(db);}finally{inTransaction=false;}
  });
  const bindings=x.h.runtime.identityService.bindings,get=bindings.get.bind(bindings);
  bindings.get=session=>{
    const binding=get(session);
    // First P1 read inside the transaction (before INSERT): close the session.
    // The pre-COMMIT re-verification after both INSERTs must observe it.
    if(inTransaction&&!revoked){revoked=true;x.session.connection.close();}
    return binding;
  };
  const turn=await x.typed('Rolled back if the session closes mid-commit.');
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'D03 settled');
  assert.equal(revoked,true);
  assert.equal(spy.results[0].status,'not_stored');
  assert.equal(spy.results[0].reason,'d03_transaction_rejected');
  const j=await x.journal();
  assert.equal(j.rows.length,0,'dialogue INSERT rolled back');
  assert.equal(j.sources.length,0,'provenance sidecar (and its DDL) rolled back');
});

test('D01 E2E wrong ped: native roster places the promoted owner on another handle',{timeout:30000},async t=>{
  const x=await d01Harness(t,{roster:{nativePedId:'18'}}),spy=recordSpy(x);
  const turn=await x.typed('Talking to ped 17.');
  assert.equal((await x.settled(turn)).status,'completed','the conversation itself is unaffected');
  assert.deepEqual(spy.results,[null],'D03 never bound a lease, so no write was attempted');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E recycled ped mid-turn: new anchor/incarnation for the same handle denies the write',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  x.native.stop();
  const turn=await x.typed('Said to the old incarnation.');
  await waitFor(()=>spy.calls===1,'D03 write pending');
  x.native.npcRef=randomUUID();x.native.incarnationId=randomUUID();x.native.encounterId=randomUUID();
  await x.native.roster();await x.native.sample();
  x.native.start();
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'D03 settled');
  assert.equal(spy.results[0].status,'not_stored');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E P1/D02 incarnation mismatch denies the write',{timeout:30000},async t=>{
  const x=await d01Harness(t,{roster:{incarnationId:randomUUID()}}),spy=recordSpy(x);
  const turn=await x.typed('Native roster disagrees with the P1 owner claim.');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.equal(spy.results[0].status,'not_stored');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E foreign alias on the turn ped never binds',{timeout:30000},async t=>{
  const x=await d01Harness(t,{roster:{ownerAlias:'promoted.'+randomUUID()}}),spy=recordSpy(x);
  const turn=await x.typed('Another promoted character owns this handle.');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.deepEqual(spy.results,[null]);
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E protagonist switch between turns keeps one human scope; avatar is provenance',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const first=await x.typed('Said as Franklin.');
  assert.equal((await x.settled(first)).status,'completed');
  x.native.avatar='trevor';
  const before=x.native.samples;
  await waitFor(()=>x.native.samples>=before+2&&x.d02.port.status().settled===true,'two samples as Trevor');
  const second=await x.typed('Said as Trevor.');
  assert.equal((await x.settled(second)).status,'completed');
  assert.deepEqual(spy.results.map(r=>[r.status,r.protagonistKey,r.humanPlayerScope]),[
    ['stored','franklin','single_local_human'],['stored','trevor','single_local_human']]);
  const rows=(await x.journal()).rows;
  assert.deepEqual(rows.map(r=>[r.content,r.protagonist]),[['Said as Franklin.','franklin'],['Said as Trevor.','trevor']]);
  assert.equal(rows[0].session_id,rows[1].session_id,'same conversation session and character journal');
});

test('D01 E2E protagonist switch mid-turn: ambiguous avatar provenance is not written',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  x.native.stop();
  const turn=await x.typed('Who said this?');
  await waitFor(()=>spy.calls===1,'D03 write pending');
  x.native.avatar='michael';
  await x.native.sample();
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'D03 settled');
  assert.equal(spy.results[0].status,'not_stored');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E lease survives an STT longer than 1 s across native roster refreshes',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  let during=null;
  x.h.runtime.services.transcribe=async()=>{
    const rosters=x.native.rosters,samples=x.native.samples,started=performance.now();
    await sleep(1200);
    await waitFor(()=>x.native.rosters>=rosters+3,'three full roster refreshes during STT');
    during={rosters:x.native.rosters-rosters,samples:x.native.samples-samples,ms:performance.now()-started};
    return 'A long sentence spoken slowly.';
  };
  const turn=await x.mic();
  assert.equal((await x.settled(turn)).status,'completed');
  assert.ok(during.ms>=1000&&during.rosters>=3&&during.samples>=3,JSON.stringify(during));
  assert.equal(spy.results[0].status,'stored');
  assert.deepEqual((await x.journal()).rows.map(r=>r.content),['A long sentence spoken slowly.']);
});

test('D01 E2E forged inputs: rogue connection, model text and caller flags cannot create memory',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  // A real mic turn waits for STT, so its tuple is a current original turn.
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  x.h.runtime.services.transcribe=async()=>{entered();await gate;return 'real words';};
  const micTurn=await x.mic();
  const identity=x.identityOf(micTurn);
  await started;
  // A connection obtained from the runtime (holds the same private capability
  // set) but NOT registered in the original session record.
  const rogue=await x.h.runtime.createTransport(()=>{throw new Error('no gemini');}).connect({
    systemInstruction:'rogue',actorContext:x.a,targetContext:{pedId:'player'},
    diagnosticContext:{pedId:'17',sessionNonce:1}});
  t.after(()=>{try{rogue.close();}catch{}});
  await rogue.beginTurn({identity,source:'player_text',context:{inputText:'forged words',actor:x.a}});
  await rogue.sendText('forged words');
  await rogue.whenSettled(identity);
  assert.equal(x.h.runtime.host.originalTurnFacts(identity,rogue),null,'bridge refuses an unregistered connection');
  // Model output that imitates an acceptance receipt changes nothing.
  x.h.runtime.services.decide=async()=>({dialogue:'{"kind":"OriginalBackendAcceptedInputV1","lifecycleStatus":"accepted","accepted":true}',command:''});
  release();
  await x.settled(micTurn);
  const rows=(await x.journal()).rows;
  assert.equal(rows.some(r=>r.content==='forged words'),false,'forged words never journaled');
  assert.equal(rows.some(r=>r.speaker==='npc'),false);
  for(const result of spy.results)assert.notEqual(result.status,'stored','no receipt for the rogue or the duplicate-committed real turn');
  // Caller-shaped acceptance claims through the public service surface.
  const status=x.h.runtime.originalAcceptanceStatus();
  assert.deepEqual(Object.keys(status).sort(),['acceptedSourceHookAvailable','hasAuthenticatedSource','provider','receiptSource']);
  assert.equal('openTurn' in x.h.runtime || 'acceptance' in x.h.runtime.services,false,'issuer is not reachable from runtime/services');
});

test('D01 E2E duplicate delivery is idempotent at the single P2 writer',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  x.h.runtime.services.recordM2Player=async args=>{
    spy.calls++;
    const first=await spy.original(args),again=await spy.original(args);
    spy.results.push(first,again);
    return first;
  };
  const turn=await x.typed('Only once, please.');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.deepEqual(spy.results.map(r=>r.status),['stored','duplicate']);
  assert.equal(spy.results[0].recordId,spy.results[1].recordId);
  const j=await x.journal();
  assert.equal(j.rows.length,1);
  assert.equal(j.sources.length,1);
});

test('D01 E2E Director/special event never becomes player speech (D-016)',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const turn=await x.h.evaluate('kb({ speakerPedId: "17", listenerPedId: "player", content: "A car alarm is sounding.", reason: "scene_event" })');
  assert.equal(turn.source,'special_event');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.equal(spy.calls,0);
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E invalid UTF-16 typed text is not substituted into memory',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=recordSpy(x);
  const turn=await x.typed('bad \uD800 surrogate');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.equal(spy.results[0].status,'not_stored');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 E2E without a live D02 source nothing is written and the turn is not delayed',{timeout:30000},async t=>{
  const x=await d01Harness(t,{corroboration:false}),spy=recordSpy(x);
  const started=performance.now();
  const turn=await x.typed('No native owner source configured.');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.ok(performance.now()-started<1500);
  assert.deepEqual(spy.results,[null],'no D03 capture without D02');
  assert.equal((await x.journal()).rows.length,0);
});

test('D01 Gemini provider stays fail-closed: stock denial-only source, no journal path',()=>{
  const runtime=createRuntime(normalizeConfig({provider:'gemini'},{}),{fetchImpl:()=>{throw new Error('offline');}});
  assert.deepEqual(runtime.originalAcceptanceStatus(),{provider:'gemini',receiptSource:null,
    acceptedSourceHookAvailable:false,hasAuthenticatedSource:false});
  assert.equal(ORIGINAL_BACKEND_PIN.acceptedSourceHookAvailable,false);
  const gemini={connect(){}};
  assert.equal(runtime.createTransport(()=>gemini),gemini,'Gemini keeps its native transport');
  assert.equal(runtime.services.bindM2Turn({turn:{identity:{pedId:'17',turnId:'g',generationId:1,sessionNonce:1},
    characterProjection:{persistent:true,profile:{characterId:randomUUID(),promotion:{ownerAlias:'promoted.'+randomUUID()}}}},
    isCurrent:()=>true}),null);
});
