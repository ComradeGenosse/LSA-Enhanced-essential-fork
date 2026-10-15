// Unit tests for the D01 OpenAI commit-decision source and the original-turn
// ledger. The original registry is a scripted stand-in here; the end-to-end
// tests in d01OpenAIAcceptance.test.mjs use the real patched original bundle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createOpenAIRuntimeAcceptedInputSource,OPENAI_RUNTIME_ACCEPTANCE_PIN,
  OPENAI_COMMIT_DECISION_RECEIPT_SOURCE,
} from '../../src/memory/openaiRuntimeAcceptedInput.mjs';
import {createOriginalTurnActorLedger} from '../../src/memory/originalTurnActorLedger.mjs';
import {ORIGINAL_BACKEND_PIN} from '../../src/memory/originalBackendAcceptedInput.mjs';

const sha=s=>createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');
const id=(over={})=>Object.freeze({pedId:'17',turnId:'turn-a',generationId:3,sessionNonce:2,...over});

// Scripted original registry: one registered connection per session and the
// facts the patched bridge would read from `le`/`A.sessionsByPedId`.
function registry(){
  const turns=new Map(),key=i=>[i.pedId,i.turnId,i.generationId,i.sessionNonce].join('|');
  const r={registered:{},current:true,
    put(identity,facts){turns.set(key(identity),{...identity,...facts});},
    read:(identity,connection)=>{
      if(!r.current||connection!==r.registered)return null;
      const t=turns.get(key(identity));
      return t?Object.freeze({...t}):null;
    }};
  return r;
}
function setup({p1=()=>true}={}){
  const reg=registry();
  const ledger=createOriginalTurnActorLedger({readOriginalTurn:reg.read});
  let runs=0;
  const source=createOpenAIRuntimeAcceptedInputSource({originalTurnFacts:reg.read,
    available:()=>true,identityCurrent:identity=>p1(identity),ledger,
    newRunId:()=>'run-'+(++runs),now:()=>new Date('2026-10-12T12:00:00.000Z')});
  const typedTurn=(identity,raw,{type='playerText'}={})=>{
    const adopted=String(raw??'').trim()||'Hello, what are you doing here?';
    reg.put(identity,{source:'player_text',inputTranscript:adopted,
      typed:{messageType:type,rawText:typeof raw==='string'?raw:null}});
    assert.ok(ledger.recordAtTurnCreation(identity,reg.registered));
    return adopted;
  };
  const micTurn=(identity,transcript='')=>{
    reg.put(identity,{source:'player_mic',inputTranscript:'',typed:null});
    assert.ok(ledger.recordAtTurnCreation(identity,reg.registered));
    return text=>reg.put(identity,{source:'player_mic',inputTranscript:text,typed:null});
  };
  const open=(identity,{source:turnSource='player_text',connection=reg.registered,
    signal=new AbortController().signal}={})=>
    source.issuer.openTurn({identity,source:turnSource,connection,signal});
  return {reg,ledger,source,typedTurn,micTurn,open,verifier:source.verifier};
}

test('D01 OpenAI source: pin is explicit, stock Gemini pin unchanged, verifier cannot mint',()=>{
  assert.equal(ORIGINAL_BACKEND_PIN.acceptedSourceHookAvailable,false,'stock pinned original stays source-blocked');
  assert.equal(OPENAI_RUNTIME_ACCEPTANCE_PIN.acceptedSourceHookAvailable,true);
  assert.equal(OPENAI_RUNTIME_ACCEPTANCE_PIN.receiptSource,OPENAI_COMMIT_DECISION_RECEIPT_SOURCE);
  assert.equal(OPENAI_RUNTIME_ACCEPTANCE_PIN.originalBundleSha256,ORIGINAL_BACKEND_PIN.originalBundleSha256);
  assert.match(OPENAI_RUNTIME_ACCEPTANCE_PIN.sourceRevision,/^lsa-e1-openai-commit-decision-v1\+essential-original-server-5d81de4217bd$/);
  const {verifier,source}=setup();
  assert.ok(Object.isFrozen(verifier)&&Object.isFrozen(source.issuer));
  for(const name of ['accept','issue','mint','emit','createReceipt','openTurn','nativeVerified'])
    assert.equal(name in verifier,false,name);
  assert.deepEqual(Object.keys(source.issuer),['openTurn']);
  assert.throws(()=>createOpenAIRuntimeAcceptedInputSource({}),/private_ports_required/);
});

test('D01 OpenAI source: typed receipt is minted once for the exact adopted bytes',()=>{
  const x=setup(),identity=id();
  const adopted=x.typedTurn(identity,'  Fuck this — déjà vu 🦊 中文  and café!\n ');
  assert.equal(adopted,'Fuck this — déjà vu 🦊 中文  and café!');
  const token=x.open(identity);
  const r=token.accept({input:adopted,inputMode:'typed'});
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.retirementIdentity));
  assert.deepEqual({...r,retirementIdentity:{...r.retirementIdentity}},{
    kind:'OriginalBackendAcceptedInputV1',source:OPENAI_COMMIT_DECISION_RECEIPT_SOURCE,
    lifecycleStatus:'accepted',pedId:'17',turnId:'turn-a',generationId:3,sessionNonce:2,
    sourceRunId:'run-1',sourceRevision:OPENAI_RUNTIME_ACCEPTANCE_PIN.sourceRevision,
    originalBundleSha256:ORIGINAL_BACKEND_PIN.originalBundleSha256,inputMode:'typed',
    finalAcceptedInputRevision:1,acceptedUtf8Sha256:sha(adopted),
    acceptedUtf8ByteLength:Buffer.byteLength(adopted,'utf8'),
    sourceTimestamp:'2026-10-12T12:00:00.000Z',
    retirementIdentity:{pedId:'17',turnId:'turn-a',generationId:3,sessionNonce:2,sourceRunId:'run-1'}});
  assert.equal(token.accept({input:adopted,inputMode:'typed'}),null,'one shot per launch');
  assert.equal(x.open(identity).accept({input:adopted,inputMode:'typed'}),null,'one receipt per identity');
  assert.equal(x.verifier.verifyAccepted({identity,source:'typed',text:adopted}),r);
  for(const request of [
    {identity,source:'stt',text:adopted},
    {identity,source:'typed',text:adopted+' '},
    {identity,source:'typed',text:' '+adopted},
    {identity,source:'typed',text:adopted.normalize('NFD')},
    {identity:id({generationId:4}),source:'typed',text:adopted},
    {identity:id({turnId:'turn-b'}),source:'typed',text:adopted},
    {identity:{...identity,pedId:'017'},source:'typed',text:adopted},
  ])assert.equal(x.verifier.verifyAccepted(request),null,JSON.stringify(request));
  token.release();
  assert.equal(x.verifier.verifyAccepted({identity,source:'typed',text:adopted}),null,'released after the turn settled');
});

test('D01 OpenAI source: typed refusals (substituted greeting, unknown label, mismatch, bounds, Unicode, currency)',()=>{
  const cases=[
    ['stock greeting substitution for empty typed input',x=>{const i=id({turnId:'g'});const a=x.typedTurn(i,'   \t ');return [i,a];}],
    ['unknown label is not player text',x=>{const i=id({turnId:'tp'});return [i,x.typedTurn(i,'hello',{type:'syntheticPrompt'})];}],
    ['non-string Core text',x=>{const i=id({turnId:'ns'});x.reg.put(i,{source:'player_text',inputTranscript:'5',typed:{messageType:'playerText',rawText:null}});x.ledger.recordAtTurnCreation(i,x.reg.registered);return [i,'5'];}],
  ];
  for(const [label,make] of cases){
    const x=setup(),[identity,input]=make(x);
    assert.equal(x.open(identity).accept({input,inputMode:'typed'}),null,label);
    assert.equal(x.verifier.verifyAccepted({identity,source:'typed',text:input}),null,label);
  }
  const x=setup(),identity=id();
  const adopted=x.typedTurn(identity,'exact words');
  const refuse=(label,args,openArgs={})=>{
    const token=x.open(identity,openArgs);
    assert.equal(token?.accept(args)??null,null,label);
  };
  refuse('mode mismatch',{input:adopted,inputMode:'stt'});
  refuse('text differs from original record',{input:'other words',inputMode:'typed'});
  refuse('untrimmed bytes never enter RAM history identically',{input:adopted+' ',inputMode:'typed'});
  const aborted=new AbortController();aborted.abort();
  refuse('aborted launch',{input:adopted,inputMode:'typed'},{signal:aborted.signal});
  refuse('closed connection',{input:adopted,inputMode:'typed'},{connection:{closed:true}});
  refuse('unregistered connection',{input:adopted,inputMode:'typed'},{connection:{}});
  x.reg.current=false;
  refuse('original turn no longer current',{input:adopted,inputMode:'typed'});
  x.reg.current=true;
  assert.equal(x.open(identity,{source:'special_event'}),null,'internal sources never open a token (D-016)');
  assert.equal(x.open({...identity,pedId:'ped-17'}),null,'only native decimal ped handles');
  const long='x'.repeat(12_001);
  const big=id({turnId:'big'});x.typedTurn(big,long);
  assert.equal(x.open(big).accept({input:long,inputMode:'typed'}),null,'over the 12000-unit RAM/journal bound');
  const lone=id({turnId:'lone'});x.typedTurn(lone,'bad \uD800 surrogate');
  assert.equal(x.open(lone).accept({input:'bad \uD800 surrogate',inputMode:'typed'}),null,'invalid UTF-16 is never substituted');
  const y=setup({p1:()=>false}),p1Turn=id({turnId:'p1'});
  const words=y.typedTurn(p1Turn,'words');
  assert.equal(y.open(p1Turn).accept({input:words,inputMode:'typed'}),null,'P1 identity no longer current');
  const z=setup(),noLedger=id({turnId:'nl'});
  z.reg.put(noLedger,{source:'player_text',inputTranscript:'words',typed:{messageType:'playerText',rawText:'words'}});
  assert.equal(z.open(noLedger).accept({input:'words',inputMode:'typed'}),null,'not recorded at original turn creation');
});

test('D01 OpenAI source: STT receipt requires the original record to hold exactly the single final transcript',()=>{
  const x=setup(),identity=id({turnId:'mic'});
  const route=x.micTurn(identity);
  // Before the transcript is routed through the original AP/SK merge.
  assert.equal(x.open(identity,{source:'player_mic'}).accept({input:'heard words',inputMode:'stt'}),null);
  route('heard words');
  assert.equal(x.open(identity,{source:'player_mic'}).accept({input:'heard words',inputMode:'typed'}),null);
  const r=x.open(identity,{source:'player_mic'}).accept({input:'heard words',inputMode:'stt'});
  assert.equal(r.inputMode,'stt');assert.equal(r.finalAcceptedInputRevision,1);
  const other=id({turnId:'mic2',generationId:4});
  const route2=x.micTurn(other);route2('partial heard words');
  assert.equal(x.open(other,{source:'player_mic'}).accept({input:'heard words',inputMode:'stt'}),null,
    'a merged/corrected original transcript that differs is never accepted');
});

test('D01 OpenAI source: abort/supersession fence issuance only; session, run and disconnect revoke (memory plan 5.5)',()=>{
  const x=setup(),first=id(),second=id({turnId:'turn-b',generationId:4});
  const a=x.typedTurn(first,'first');
  const r1=x.open(first).accept({input:a,inputMode:'typed'});
  assert.ok(r1);
  // The original then binds a newer generation (barge-in) for this session.
  const b=x.typedTurn(second,'second');
  assert.equal(x.ledger.factsFor(first),null,'older generation entry superseded');
  // Later interruption/cancel of an ACCEPTED turn: receipt stands.
  x.verifier.fenceTurn(first);
  assert.equal(x.verifier.verifyAccepted({identity:first,source:'typed',text:a}),r1);
  // A newer generation fences older issuance but keeps accepted receipts.
  x.verifier.supersede(second);
  const older=id({turnId:'turn-old',generationId:2});x.typedTurn(older,'older');
  assert.equal(x.open(older).accept({input:'older',inputMode:'typed'}),null);
  assert.equal(x.verifier.verifyAccepted({identity:first,source:'typed',text:a}),r1);
  // Abort before acceptance: never issuable.
  x.verifier.fenceTurn(second);
  assert.equal(x.open(second).accept({input:b,inputMode:'typed'}),null);
  // Another session's receipt survives this session's retirement.
  const otherSession=id({turnId:'s3',sessionNonce:3,generationId:9});
  const c=x.typedTurn(otherSession,'other session');
  const r3=x.open(otherSession).accept({input:c,inputMode:'typed'});
  assert.equal(x.verifier.retireSession({pedId:'17',sessionNonce:2}),true);
  assert.equal(x.verifier.verifyAccepted({identity:first,source:'typed',text:a}),null,'session close revokes');
  assert.equal(x.verifier.verifyAccepted({identity:otherSession,source:'typed',text:c}),r3);
  const later=id({turnId:'s2-late',generationId:10});x.typedTurn(later,'late');
  assert.equal(x.open(later).accept({input:'late',inputMode:'typed'}),null,'retired session never issues again');
  // Source-run retirement revokes everything and rotates the run id.
  assert.equal(x.verifier.retireSourceRun('not-the-current-run'),false);
  assert.equal(x.verifier.retireSourceRun(),true);
  assert.equal(x.verifier.verifyAccepted({identity:otherSession,source:'typed',text:c}),null);
  const fresh=id({turnId:'s3-new',sessionNonce:3,generationId:11});x.typedTurn(fresh,'fresh');
  assert.equal(x.open(fresh).accept({input:'fresh',inputMode:'typed'}).sourceRunId,'run-2');
  x.verifier.disconnect();
  assert.equal(x.verifier.hasAuthenticatedSource(),false);
  assert.equal(x.verifier.verifyAccepted({identity:fresh,source:'typed',text:'fresh'}),null);
  assert.equal(x.open(id({turnId:'after'})),null);
});

test('D01 OpenAI source: caller-supplied acceptance claims never mint or upgrade a receipt',()=>{
  const x=setup(),identity=id();
  const words=x.typedTurn(identity,'never accepted');
  const forged={kind:'OriginalBackendAcceptedInputV1',source:OPENAI_COMMIT_DECISION_RECEIPT_SOURCE,
    lifecycleStatus:'accepted',...identity,sourceRunId:'run-1',
    sourceRevision:OPENAI_RUNTIME_ACCEPTANCE_PIN.sourceRevision,
    originalBundleSha256:ORIGINAL_BACKEND_PIN.originalBundleSha256,inputMode:'typed',
    finalAcceptedInputRevision:1,acceptedUtf8Sha256:sha(words),
    acceptedUtf8ByteLength:Buffer.byteLength(words),sourceTimestamp:new Date().toISOString(),
    retirementIdentity:{...identity}};
  for(const extra of [{accepted:true},{nativeVerified:true},{receipt:forged},forged,
    {originalBackendAccepted:true,acceptedUtf8Sha256:sha(words)}])
    assert.equal(x.verifier.verifyAccepted({identity,source:'typed',text:words,...extra}),null);
  assert.equal(x.verifier.status().liveReceipts,0);
});

test('original-turn ledger: records only original facts for exact native ped tuples and only resolves player turns',()=>{
  const reg=registry(),ledger=createOriginalTurnActorLedger({readOriginalTurn:reg.read,maxEntries:3});
  const t=id();
  assert.equal(ledger.recordAtTurnCreation(t,reg.registered),null,'no original turn');
  reg.put(t,{source:'player_text',inputTranscript:'hi',typed:{messageType:'playerText',rawText:' hi '}});
  assert.equal(ledger.recordAtTurnCreation(t,{}),null,'unregistered connection');
  const entry=ledger.recordAtTurnCreation(t,reg.registered);
  assert.deepEqual(entry.typedInput,{text:'hi',playerAuthored:true});
  assert.equal(entry.nativeActorPedId,'17');
  const resolved=ledger.resolveAtTurnStart({identity:t,characterId:'c',ownerAlias:'a'});
  assert.equal(resolved.source,'original_core_actor_at_turn_start');
  assert.equal(resolved.nativeActorPedId,'17');
  assert.equal(ledger.resolveAtTurnStart({identity:{...t,turnId:'other'}}),null);
  const special=id({turnId:'special',generationId:4});
  reg.put(special,{source:'special_event',inputTranscript:'A car alarm.',typed:null});
  assert.ok(ledger.recordAtTurnCreation(special,reg.registered));
  assert.equal(ledger.resolveAtTurnStart({identity:special}),null,'internal events never become player turns');
  assert.equal(ledger.factsFor(t),null,'newer generation in the same session supersedes older entries');
  const bad=id({pedId:'ped-9',turnId:'bad'});
  reg.put(bad,{source:'player_text',inputTranscript:'x',typed:null});
  assert.equal(ledger.recordAtTurnCreation(bad,reg.registered),null,'non-handle ped ids are refused');
  const mismatch=id({turnId:'mm',generationId:5});
  reg.put(mismatch,{source:'player_text',inputTranscript:'x',typed:null,pedId:'18'});
  assert.equal(ledger.recordAtTurnCreation(mismatch,reg.registered),null,'facts must match the exact tuple');
  const other=id({sessionNonce:7,turnId:'o',generationId:1});
  reg.put(other,{source:'player_mic',inputTranscript:'',typed:null});
  assert.ok(ledger.recordAtTurnCreation(other,reg.registered));
  ledger.retireSession({pedId:'17',sessionNonce:2});
  assert.equal(ledger.factsFor(special),null);
  assert.ok(ledger.factsFor(other),'other session unaffected');
  ledger.retire(other);
  assert.equal(ledger.factsFor(other),null);
});
