// Tests execute the pinned ORIGINAL minified backend's real NK/AP/SK bodies.
// They prove observable submission/transcript behavior; they MUST NOT report
// proof of a nonexistent final acceptance callback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {auditPinnedOriginalBackendSource} from '../../src/memory/originalBackendSourceAudit.mjs';
import {
  ORIGINAL_BACKEND_PIN,createOriginalBackendAcceptedInput,digestExactUtf8,
} from '../../src/memory/originalBackendAcceptedInput.mjs';

const bundlePath=fileURLToPath(new URL('../../upstream/server.bundle.mjs',import.meta.url));
const pinnedSource=readFileSync(bundlePath,'utf8');
const audit=auditPinnedOriginalBackendSource(pinnedSource);
const id=Object.freeze({pedId:'npc-7',turnId:'orig-88',generationId:3,sessionNonce:19});
const ctx=Object.freeze({
  identity:id,sourceRevision:ORIGINAL_BACKEND_PIN.sourceRevision,
  sourceRunId:'original-backend-run-1',originalBundleSha256:ORIGINAL_BACKEND_PIN.originalBundleSha256,
});
const signal=(authority,values={})=>authority.describeSignal({
  ...ctx,signal:'input_transcript',text:'  fuck! 🐉 café  ',...values,
});

test('pinned source path witness binds actual original functions, with no accepted-input transition',()=>{
  assert.equal(audit.status,'source_verified_missing_capability',JSON.stringify(audit));
  assert.equal(audit.sha256,createHash('sha256').update(Buffer.from(pinnedSource,'utf8')).digest('hex'));
  assert.equal(audit.originalPostAcceptanceHook,false);
  assert.equal(audit.typedFinalExactBytes,false);
  assert.equal(audit.sttFinalAcceptedIndicator,false);
  assert.deepEqual(audit.observedInputPaths.map(x=>x.pathId),[
    'typed_trim_and_fallback','typed_transport_submission','mic_activity_end_is_submission',
    'stt_transcript_no_final_marker','transcript_merge_is_mutable','fragment_merger',
    'misnamed_recovery_timestamp','recovery_replays_on_new_generation',
    'generation_binding_precedes_transport',
  ]);
  for(const witness of audit.observedInputPaths){
    assert.equal(witness.permitsFinalAcceptedReceipt,false);
    assert.equal(witness.sourceAnchorSha256,audit.anchors[witness.functionName].sha256);
  }
});

test('execute ORIGINAL NK/AP/SK: STT correction mutates original transcript but never accepts it',async()=>{
  assert.equal(audit.status,'source_verified_missing_capability');
  const events=[];
  const turn={id:id.turnId,pedId:id.pedId,generationId:id.generationId,
    status:'generating',input:{transcript:''}};
  const scope={
    Ee:{INPUT_TRANSCRIPT:'input_transcript',TURN_COMPLETE:'turn_complete',
      SETUP_COMPLETE:'setup_complete',SESSION_RESUMPTION:'session_resumption',
      INTERRUPTED:'interrupted',OUTPUT_TRANSCRIPT:'output_transcript',
      AUDIO:'audio',GENERATION_COMPLETE:'generation_complete',RAW:'raw'},
    se(){},le:{getTurn:turnId=>turnId===turn.id?turn:null},
    xP:()=>true,Vt:()=>false,Wa(){},
    pt:(type,actual,details)=>events.push({type,text:details?.text,turn:actual.id}),
    Zt:()=>{throw Error('unexpected original terminal path');},
  };
  const originalBodies=['SK','NK','AP'].map(name=>{
    const {start,end}=audit.anchors[name];
    return pinnedSource.slice(start,end);
  });
  // The event handler bodies are unchanged original source, with only their
  // surrounding globals supplied to execute the isolated ingress path.
  const {NK,AP}=runInNewContext(originalBodies.join(';\n')+';({NK,AP})',scope);
  const preliminary=NK({serverContent:{inputTranscription:{text:'  fuck! 🐉'}}});
  const corrected=NK({serverContent:{inputTranscription:{text:'  fuck! 🐉 café  '}}});
  assert.equal(preliminary[0].type,'input_transcript');
  assert.equal(corrected[0].type,'input_transcript');
  assert.equal(await AP({...preliminary[0],...id}),true);
  assert.equal(turn.input.transcript,'  fuck! 🐉');
  assert.equal(await AP({...corrected[0],...id}),true);
  assert.equal(turn.input.transcript,'  fuck! 🐉 café  ');
  assert.equal(events.length,2);
  assert.equal(events.every(x=>x.type==='input_transcript'),true);
  const digest=digestExactUtf8(turn.input.transcript);
  assert.equal(digest.sha256,createHash('sha256').update(Buffer.from(turn.input.transcript,'utf8')).digest('hex'));
  const authority=createOriginalBackendAcceptedInput();
  assert.equal(authority.verifyAccepted({identity:id,text:turn.input.transcript,sourceEvent:events[1]}),null);
  assert.equal(signal(authority,{text:turn.input.transcript}).reason,'no_post_acceptance_source_hook');
  // Transport transcript delivery is NOT original backend acceptance.
  assert.equal(audit.originalPostAcceptanceHook,false);
});

test('typed original ib trims and wraps input before vi transport, not final raw-byte acceptance',()=>{
  const typed='  fuck! 🐉 café  ';
  const originalFn=pinnedSource.slice(audit.anchors.ib.start,audit.anchors.ib.end);
  const transportFn=pinnedSource.slice(audit.anchors.vi.start,audit.anchors.vi.end);
  assert.ok(originalFn.includes('l=Fr(t.text)||"Hello, what are you doing here?"'));
  assert.ok(originalFn.includes('await vi(h,d)'));
  assert.ok(transportFn.includes('await t.connection.sendText(n)'));
  assert.notEqual(digestExactUtf8(typed).sha256,digestExactUtf8(typed.trim()).sha256);
  const authority=createOriginalBackendAcceptedInput();
  for(const candidate of [typed,typed.trim()]){
    assert.equal(signal(authority,{signal:'typed_submission',text:candidate}).status,'not_accepted');
    assert.equal(authority.verifyAccepted({identity:id,text:candidate,receivedAt:Date.now(),nativeVerified:true}),null);
  }
});

test('actor/session borrowing, replayed transcript, incorrect build, and source-run retirement stay denied',()=>{
  const a=createOriginalBackendAcceptedInput();
  assert.equal(a.hasAuthenticatedSource(),false);
  for(const malicious of [
    {signal:'original_backend_accepted',finalAcceptedInputRevision:9},
    {signal:'provider_send_resolved',nativeVerified:true},
    {signal:'input_transcript',finalAcceptedInputRevision:400,backendAccepted:true},
    {identity:{...id,pedId:'npc-8'},sourceRunId:'original-backend-run-1'},
    {identity:{...id,sessionNonce:20},sourceRunId:'original-backend-run-1'},
  ])assert.equal(a.verifyAccepted({...ctx,...malicious}),null);
  assert.equal(signal(a,{originalBundleSha256:'0'.repeat(64)}).reason,'pinned_build_mismatch');
  assert.equal(a.retireSession({pedId:id.pedId,sessionNonce:id.sessionNonce}),true);
  assert.equal(signal(a).reason,'retired_session');
  assert.equal(signal(a,{identity:{...id,sessionNonce:20}}).reason,'no_post_acceptance_source_hook');
  assert.equal(a.retireSourceRun(ctx.sourceRunId),true);
  assert.equal(signal(a,{identity:{...id,sessionNonce:20}}).reason,'retired_source_run');
  assert.equal(a.verifyAccepted({ ...ctx, identity:{...id,pedId:'npc-8'}}),null);
});

test('generation supersession, turn retirement and disconnection prevent late STT borrowing',()=>{
  const a=createOriginalBackendAcceptedInput();
  assert.equal(a.supersede({pedId:id.pedId,sessionNonce:id.sessionNonce,generationId:4}),true);
  assert.equal(signal(a).reason,'superseded_generation');
  const next={...id,generationId:4};
  assert.equal(signal(a,{identity:next}).reason,'no_post_acceptance_source_hook');
  a.retire(next);
  assert.equal(signal(a,{identity:next}).reason,'retired_identity');
  a.disconnect();
  assert.equal(signal(a,{identity:next,sessionConnected:true}).reason,'authority_retired');
  assert.equal(a.verifyAccepted({identity:next}),null);
});
