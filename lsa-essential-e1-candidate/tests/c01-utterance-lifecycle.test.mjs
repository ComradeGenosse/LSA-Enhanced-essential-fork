import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CAPABILITIES,validateFrame} from '../src/perception/contracts.mjs';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {validateUtteranceFact,UtteranceLifecycle} from '../src/perception/utteranceLifecycle.mjs';

const setup=()=>{
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),
    hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,utteranceLifecycleVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,false]))};
  let sequence=0,now=1000;
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>now});
  const frame=(type,payload)=>({version:1,type,adapterEpoch:hello.adapterEpoch,
    streamId:hello.streamId,sequence:++sequence,payload});
  const fact=(id,phase,terminal,monotonicMs)=>({utteranceVersion:1,utteranceId:id,phase,terminal,
    hostRunId:hello.hostRunId,worldEpoch:1,gameTick:420,
    monotonicMs,inputSource:'essential_mic',micPedRef:null});
  assert.equal(runtime.ingest(hello,{authenticated:true}),true);
  return {hello,runtime,frame,fact,now:n=>{now=n}};
};

test('C-01 exact source-time frames are opt-in, bounded and never speech knowledge',()=>{
  const {runtime,frame,fact}=setup(),id=randomUUID();
  const start=fact(id,'started',null,100),end=fact(id,'ended','released',180);
  assert.equal(validateFrame(frame('utterance',start)),true);
  assert.equal(runtime.ingest(frame('utterance',start),{authenticated:true}),true);
  assert.equal(runtime.utterances.active,id);
  assert.equal(runtime.ingest(frame('utterance',end),{authenticated:true}),true);
  assert.equal(runtime.utterances.active,null);
  assert.equal(runtime.utterances.diagnostics.started,1);
  assert.equal(runtime.utterances.diagnostics.ended,1);
  assert.equal(runtime.observations.entries.size,0);
  assert.equal(runtime.transcripts.entries.size,0);
  assert.equal(runtime.capabilities.playerSpeech,false);
  assert.equal(runtime.ingest(frame('utterance',end),{authenticated:true}),false);
});

test('C-01 fails closed on mismatched run, epoch, duplicate starts, and fabricated text',()=>{
  const {runtime,frame,fact}=setup(),id=randomUUID(),start=fact(id,'started',null,10);
  for(const invalid of [
    {...start,hostRunId:randomUUID()},{...start,worldEpoch:2},
    {...start,inputSource:'ux4_ptt'}, {...start,transcript:'private data'},
    {...start,micPedRef:'fake'}, {...start,phase:'ended',terminal:null},
  ]) {
    if(validateUtteranceFact(invalid))
      assert.equal(runtime.ingest(frame('utterance',invalid),{authenticated:true}),false);
    else
      assert.equal(validateFrame(frame('utterance',invalid)),false);
  }
  assert.equal(runtime.ingest(frame('utterance',start),{authenticated:true}),true);
  assert.equal(runtime.ingest(frame('utterance',start),{authenticated:true}),false);
  assert.equal(runtime.ingest(frame('utterance',fact(id,'ended','released',9)),{authenticated:true}),false);
  assert.equal(runtime.utterances.active,id);
});

test('C-01 host changes and legacy hello do not inherit recordings',()=>{
  const {hello,runtime,frame,fact}=setup(),id=randomUUID();
  assert.equal(runtime.ingest(frame('utterance',fact(id,'started',null,10)),{authenticated:true}),true);
  assert.equal(runtime.ingest(frame('world_epoch',{epoch:2,reason:'timeline_change'}),{authenticated:true}),true);
  assert.equal(runtime.utterances.entries.size,0);
  assert.equal(runtime.utterances.active,null);
  assert.equal(runtime.ingest(frame('utterance',fact(id,'ended','released',20)),{authenticated:true}),false);
  const legacy=new ShadowRuntime({mode:'shadow'});
  const {utteranceLifecycleVersion,...unextended}=hello;
  assert.equal(legacy.ingest(unextended,{authenticated:true}),true);
  assert.equal(legacy.ingest({version:1,type:'utterance',adapterEpoch:hello.adapterEpoch,
    streamId:hello.streamId,sequence:1,payload:fact(id,'started',null,10)},{authenticated:true}),false);
  assert.equal(legacy.utterances.entries.size,0);
});

test('C-01 ledger applies finite capacity and timeout, never invents missing start',()=>{
  let now=0;const ledger=new UtteranceLifecycle({now:()=>now});
  const host={hostRunId:randomUUID(),worldEpoch:1},id=randomUUID();
  const fact=(phase,terminal,ms)=>({utteranceVersion:1,utteranceId:id,phase,terminal,
    hostRunId:host.hostRunId,worldEpoch:1,gameTick:1,monotonicMs:ms,
    inputSource:'essential_mic',micPedRef:null});
  assert.equal(ledger.accept(fact('ended','released',20),host),false);
  assert.equal(ledger.accept(fact('started',null,10),host),true);
  assert.equal(ledger.accept(fact('ended','released',45),host),true);
  now=31000;
  assert.equal(ledger.accept(fact('ended','released',60),host),false);
  assert.equal(ledger.entries.size,0);
});
