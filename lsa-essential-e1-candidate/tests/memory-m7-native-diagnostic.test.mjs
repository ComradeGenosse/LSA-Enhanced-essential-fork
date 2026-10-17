import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CAPABILITIES,validateFrame,validateM7NativeIdleDiagnostic,
  M7_NATIVE_CORE_QUIET_FIELDS,M7_UNAVAILABLE_CORE_FIELDS} from '../src/perception/contracts.mjs';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {validateM7IdleProof} from '../../lsa-shared-brain/src/memory/m7Consent.mjs';

const uuid=()=>randomUUID();
function fixture(){
  const hostRunId=uuid(),adapterEpoch=uuid(),streamId=uuid(),observerCaptureRef=uuid(),
    incarnationId=uuid(),encounterId=uuid();let sequence=0;
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>1000});
  const frame=(type,payload)=>({version:1,type,adapterEpoch,streamId,sequence:++sequence,payload});
  const hello={version:1,type:'hello',adapterEpoch,streamId,hostContextVersion:1,
    hostRunId,worldEpoch:1,observerIndexVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))};
  assert.equal(runtime.ingest(hello,{authenticated:true}),true);
  assert.equal(runtime.ingest(frame('anchors',[
    {captureRef:observerCaptureRef,kind:'ped',observer:true,owned:true}
  ]),{authenticated:true}),true);
  assert.equal(runtime.ingest(frame('observer_index',[
    {captureRef:observerCaptureRef,kind:'ped',owned:true,incarnationId,encounterId}
  ]),{authenticated:true}),true);
  const payload=()=>({nativeM7DiagnosticVersion:1,kind:'native_idle_diagnostic_v1',
    nativeVerified:false,hostRunId,worldEpoch:1,sampledGameTick:500,
    observerCaptureRef,incarnationId,encounterId,
    priorityEvidence:Object.fromEntries([...M7_NATIVE_CORE_QUIET_FIELDS.map(x=>[x,true]),
      ...M7_UNAVAILABLE_CORE_FIELDS.map(x=>[x,false])]),
    missingCoreCapabilities:[...M7_UNAVAILABLE_CORE_FIELDS]});
  return {runtime,frame,payload,incarnationId};
}
test('W07 diagnostic retains 21 real-native quiet fields but cannot mint global idle',()=>{
  const f=fixture(),native=f.payload();
  assert.equal(M7_NATIVE_CORE_QUIET_FIELDS.length,21);
  assert.equal(M7_UNAVAILABLE_CORE_FIELDS.length,4);
  assert.equal(validateM7NativeIdleDiagnostic(native),true);
  const frame=f.frame('memory_m7_idle_diagnostic',native);
  assert.equal(validateFrame(frame),true);
  assert.equal(f.runtime.ingest(frame,{authenticated:true}),true);
  assert.throws(()=>validateM7IdleProof(native,{
    store:{},characterId:uuid(),nowUtc:new Date().toISOString()
  }),/m7_native_idle_proof_required/);
});
test('W07 native diagnosis rejects unknown fields, fabricated permits, and missing source',()=>{
  const f=fixture(),p=f.payload();
  for(const k of M7_UNAVAILABLE_CORE_FIELDS){
    assert.equal(validateM7NativeIdleDiagnostic({...p,
      priorityEvidence:{...p.priorityEvidence,[k]:true}}),false,k);
  }
  for(const k of M7_NATIVE_CORE_QUIET_FIELDS){
    assert.equal(validateM7NativeIdleDiagnostic({...p,
      priorityEvidence:{...p.priorityEvidence,[k]:null}}),false,k);
  }
  for(const wrong of [
    {...p,nativeVerified:true},
    {...p,kind:'verified_native_idle_v1'},
    {...p,missingCoreCapabilities:[]},
    {...p,incarnationId:uuid()},
    {...p,priorityEvidence:{...p.priorityEvidence,isIdle:true}}
  ]){
    if(wrong.incarnationId!==p.incarnationId){
      assert.equal(validateM7NativeIdleDiagnostic(wrong),true);
      assert.equal(f.runtime.ingest(f.frame('memory_m7_idle_diagnostic',wrong),
        {authenticated:true}),false);
    }else assert.equal(validateM7NativeIdleDiagnostic(wrong),false);
  }
  assert.equal(f.runtime.ingest(f.frame('memory_m7_idle_diagnostic',{
    ...p,worldEpoch:2}),{authenticated:true}),false);
  assert.equal(f.runtime.ingest(f.frame('memory_m7_idle_diagnostic',p)),false,
    'a caller-supplied synthetic frame is never authenticated');
});
