import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  ORIGINAL_BACKEND_PIN, ORIGINAL_BACKEND_ACCEPTED_INPUT_V1,
  createOriginalBackendAcceptedInput, digestExactUtf8,
} from '../../src/memory/originalBackendAcceptedInput.mjs';

const identity=Object.freeze({pedId:'100',turnId:'turn-1',generationId:11,sessionNonce:4});
const context={identity,sourceRunId:'original-run-1',sourceRevision:ORIGINAL_BACKEND_PIN.sourceRevision};
const auth=()=>createOriginalBackendAcceptedInput();
const denied=(service,details,reason)=>{
  const result=service.describeSignal({...context,...details});
  assert.equal(result.status,'not_accepted');
  assert.equal(result.reason,reason);
  assert.equal(service.verifyAccepted({identity,source:'player_text',text:'hi',host:{}}),null);
  assert.equal(Object.isFrozen(result),true);
};

test('C01 backend is explicitly not a native claim or an available original source',()=>{
  assert.equal(ORIGINAL_BACKEND_PIN.acceptedSourceHookAvailable,false);
  assert.equal(ORIGINAL_BACKEND_ACCEPTED_INPUT_V1.source,'original_essential_backend_post_acceptance');
  const a=auth();
  assert.equal(a.source.status,'source_capability_unavailable');
  assert.equal('accept' in a,false);
  assert.equal('emit' in a,false);
  assert.equal('createReceipt' in a,false);
  assert.equal('nativeVerified' in a,false);
  assert.equal(Object.isFrozen(a),true);
});

test('SHA-256 covers exact UTF-8 including Unicode, punctuation, whitespace and profanity',()=>{
  const values=['  fuck!  😁 café\n','fuck! 😁 café\n','  fuck!  😁 cafe\n','He said: “naïve—你好”\t  '];
  const hashes=values.map(x=>digestExactUtf8(x));
  hashes.forEach((v,i)=>{
    assert.equal(v.sha256,createHash('sha256').update(Buffer.from(values[i],'utf8')).digest('hex'));
    assert.equal(v.byteLength,Buffer.byteLength(values[i],'utf8'));
    assert.equal(Object.isFrozen(v),true);
  });
  assert.equal(new Set(hashes.map(x=>x.sha256)).size,values.length);
  assert.equal(digestExactUtf8(' \n\t '),null);
  assert.equal(digestExactUtf8('\uD800'),null);
  assert.equal(digestExactUtf8('\uDC00'),null);
  assert.equal(digestExactUtf8('\uD800X'),null);
});

test('typed submission, provider send, input transcript, history, generation and output all fail closed',()=>{
  const a=auth();
  for(const signal of ['typed_submission','provider_send_resolved','history_commit','input_transcript',
    'generation_allocated','generation_started','provider_output','model_complete','turn_complete'])
    denied(a,{signal,text:'  fuck! 🐈  '},'no_post_acceptance_source_hook');
  denied(a,{signal:'accepted',text:'hello'},'unrecognized_or_unsupported_source_event');
  denied(a,{signal:'original_backend_accepted',text:'hello'},'unrecognized_or_unsupported_source_event');
  denied(a,{signal:'typed_submission',text:' \n'},'empty_or_invalid_utf8');
});

test('mic release, partial STT, delayed transcript, correction and replay cannot become proof',()=>{
  const a=auth();
  for(const signal of ['mic_start','mic_audio','mic_stop','stt_fragment','stt_correction','input_transcript'])
    denied(a,{signal,text:'  corrected STT 😐  '},'no_post_acceptance_source_hook');
  assert.equal(a.supersede({pedId:'100',sessionNonce:4,generationId:12}),true);
  denied(a,{signal:'input_transcript',text:'old revision'},'superseded_generation');
  denied(a,{identity:{...identity,generationId:12},signal:'input_transcript',text:'current correction'},'no_post_acceptance_source_hook');
  a.retire({...identity,generationId:12});
  denied(a,{identity:{...identity,generationId:12},signal:'input_transcript',text:'late'},'retired_identity');
});

test('invalid tuple, nonce, source revision, host/run and disconnected sessions always reject',()=>{
  const a=auth();
  for(const patch of [{pedId:''},{turnId:''},{sessionNonce:0},{generationId:-1},{generationId:1.2},
    {sessionNonce:NaN},{pedId:' 100'},{generationId:Infinity}])
    denied(a,{identity:{...identity,...patch},signal:'typed_submission',text:'hi'},'invalid_identity');
  denied(a,{signal:'typed_submission',sourceRevision:'changed',text:'hi'},'unverified_source_revision_or_run');
  denied(a,{signal:'typed_submission',sourceRunId:'',text:'hi'},'unverified_source_revision_or_run');
  denied(a,{signal:'typed_submission',sessionConnected:false,text:'hi'},'disconnected_session');
  a.disconnect();
  denied(a,{signal:'typed_submission',text:'hi'},'authority_retired');
});

test('original pinned Essential AST and hash prove only submission/transcript mechanisms',async()=>{
  const {auditPinnedOriginalBackendSource}=await import('../../src/memory/originalBackendSourceAudit.mjs');
  const root=fileURLToPath(new URL('../../upstream/server.bundle.mjs',import.meta.url));
  const original=readFileSync(root,'utf8');
  const result=auditPinnedOriginalBackendSource(original);
  assert.equal(result.status,'source_verified_missing_capability',JSON.stringify(result));
  assert.equal(result.originalPostAcceptanceHook,false);
  assert.equal(result.typedFinalExactBytes,false);
  assert.equal(result.sttFinalAcceptedIndicator,false);
  for(const name of ['ib','lb','wd','$y','Xn','AP','NK','YK','ZP','vi','SK']){
    const anchor=result.anchors[name];
    assert.ok(anchor && anchor.start>=0 && anchor.end>anchor.start,name);
    assert.equal(anchor.sha256,createHash('sha256').update(original.slice(anchor.start,anchor.end)).digest('hex'));
  }
  assert.equal(auditPinnedOriginalBackendSource(original+'changed').reason,'pinned_source_hash_mismatch');
});
