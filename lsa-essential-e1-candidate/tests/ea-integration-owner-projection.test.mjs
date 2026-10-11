import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActingEvidence } from '../src/voice/emotion/sceneOwnerProjection.mjs';

const ID=Object.freeze({pedId:'17',sessionNonce:2,turnId:'turn-1',generationId:4});
const HOST='11111111-1111-4111-8111-111111111111';
const RUN='22222222-2222-4222-8222-222222222222';
const REF='33333333-3333-4333-8333-333333333333';
const INC='44444444-4444-4444-8444-444444444444';
const CHAR='55555555-5555-4555-8555-555555555555';
const CLAIM=Object.freeze({worldProfileId:RUN,sourceNamespace:'comrade.authored',
  sourceKey:'source',adapterEpoch:RUN,incarnationId:INC,claimRevision:1});
function fixture(){
  const hostContext=Object.freeze({hostContextVersion:1,hostRunId:HOST,worldEpoch:2});
  const association=Object.freeze({owned:true,captureRef:REF,encounterId:RUN,
    incarnationId:INC});
  const binding=Object.freeze({bindingId:RUN,bindingRevision:5,
    characterId:CHAR,claim:CLAIM});
  const snapshot=Object.freeze({nativeIdentity:ID,bindingId:RUN,bindingRevision:5,
    resolution:Object.freeze({kind:'persistent',characterId:CHAR})});
  const knowledgeInputs=Object.freeze({association,ownerClaim:CLAIM,
    ownerPendingProof:false,reason:null,turn:ID,anchorStatus:'verified_observer',
    hostRunId:HOST,worldEpoch:2,psAdapterEpoch:RUN,psStreamId:'stream-1'});
  const observation=Object.freeze({observer:Object.freeze({captureRef:REF}),
    expiresAtMonotonicMs:12000});
  const foreign=Object.freeze({observer:Object.freeze({captureRef:RUN}),
    expiresAtMonotonicMs:12000});
  const perception={
    epoch:RUN,stream:'stream-1',hostContext,channelFresh:()=>true,
    now:()=>10000,current:()=>true,
    anchors:new Map([[REF,{kind:'ped'}]]),
    observerIndex:new Map([[REF,{kind:'ped',owned:true,encounterId:RUN,incarnationId:INC}]]),
    observations:{entries:new Map([['a',{value:observation,observedAtMonotonicMs:9900}],
      ['foreign',{value:foreign,observedAtMonotonicMs:9900}]])},
    directorOwnerProofFor:()=>Object.freeze({speakerCaptureRef:REF,
      hostRunId:HOST,worldEpoch:2,ownerIncarnationId:INC,proofRevision:7}),
  };
  return {identity:ID,turn:{knowledgeInputs,characterSnapshot:snapshot},
    perception,identityService:{bindings:{get:()=>binding},
      evidence:{hostContext,isCurrent:()=>true}}};
}
test('verified P1 owner plus live PS2 observer produces frozen, bounded evidence for THIS character',()=>{
  const f=fixture(),x=projectActingEvidence(f);
  assert.ok(x);assert.equal(x.verifiedOwner,true);
  assert.equal(x.identity.characterId,CHAR);
  assert.equal(x.identity.observerCaptureRef,REF);
  assert.equal(x.identity.ownerProofRevision,7);
  assert.equal(x.identity.turnId,ID.turnId);
  assert.equal(x.observations.length,1);
  assert.equal(x.observations[0].observedAtMonotonicMs,9900);
  assert.ok(Object.isFrozen(x)&&Object.isFrozen(x.identity)&&Object.isFrozen(x.observations));
});
test('failed owner, native turn and PS2 lifetime proofs are never upgraded',()=>{
  const checks=[
    f=>{f.turn.knowledgeInputs={...f.turn.knowledgeInputs,ownerPendingProof:true};},
    f=>{f.turn.characterSnapshot={...f.turn.characterSnapshot,bindingRevision:99};},
    f=>{f.turn.characterSnapshot={...f.turn.characterSnapshot,
      nativeIdentity:{...f.identity,turnId:'other'}};},
    f=>{f.identityService.evidence.isCurrent=()=>false;},
    f=>{f.perception.current=()=>false;},
    f=>{f.perception.observerIndex.clear();},
    f=>{f.perception.directorOwnerProofFor=()=>({...f.perception.directorOwnerProofFor(),worldEpoch:99});},
    f=>{f.perception.channelFresh=()=>false;},
    f=>{f.perception.epoch=HOST;},
  ];
  // Isolate every mutation from the next one.
  for(const change of checks){
    const f=fixture();
    if(change.toString().includes('directorOwnerProofFor=')){
      f.perception.directorOwnerProofFor=()=>({speakerCaptureRef:REF,hostRunId:HOST,
        worldEpoch:99,ownerIncarnationId:INC,proofRevision:7});
    } else change(f);
    assert.equal(projectActingEvidence(f),null);
  }
});
test('missing proof and expired observations fail closed',()=>{
  assert.equal(projectActingEvidence(),null);
  const f=fixture();
  f.perception.observations.entries.get('a').observedAtMonotonicMs=11000;
  assert.equal(projectActingEvidence(f).observations.length,0);
  f.perception.observations.entries.get('a').observedAtMonotonicMs=9800;
  f.perception.now=()=>12001;
  assert.equal(projectActingEvidence(f).observations.length,0);
});
