import test from 'node:test';
import assert from 'node:assert/strict';
import { MoodStore, createMoodStore } from '../src/voice/emotion/moodStore.mjs';

const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12,'0');
const host = () => ({ hostContextVersion:1,hostRunId:uuid(30),worldEpoch:1 });
const receipt = c => ({ verified:true, playbackSucceeded:true, playbackStarted:true,hadAudio:true,
  wasInterrupted:false,turnId:c.identity.turnId,generationId:c.identity.generationId,
  pedId:c.identity.pedId,sessionNonce:c.identity.sessionNonce });
const delivery = (value='amused',source='verified_scene') => ({version:1,value,source,confidence:'supported',intensity:'normal',evidenceRef:null});
function fixture({character=1,ped='17',session=1,generation=1,world=10,epoch=1,run=30,
  timeline=20,protagonist='franklin',bindingId=100,incarnation=120}={}) {
  const identity={pedId:ped,sessionNonce:session,generationId:generation,turnId:'turn-'+ped+'-'+session+'-'+generation};
  const binding={serverRunId:uuid(4),bindingId:uuid(bindingId),bindingRevision:1,characterId:uuid(character),pedId:ped,sessionNonce:session,
    claim:{worldProfileId:uuid(world),sourceNamespace:'comrade.authored',sourceKey:'promoted.'+character,
      adapterEpoch:uuid(5),incarnationId:uuid(incarnation),claimRevision:1}};
  return {identity, binding, characterSnapshot:{nativeIdentity:identity,resolution:{kind:'persistent',characterId:uuid(character)},bindingId:binding.bindingId,bindingRevision:1},
    hostContext:{...host(),hostRunId:uuid(run),worldEpoch:epoch},timelineId:uuid(timeline),protagonist,isCurrent:()=>true};
}
const follow = (context,generation) => ({...context,identity:{...context.identity,generationId:generation,turnId:'turn-'+context.identity.pedId+'-'+context.identity.sessionNonce+'-'+generation},
  characterSnapshot:{...context.characterSnapshot,nativeIdentity:{...context.characterSnapshot.nativeIdentity,generationId:generation,turnId:'turn-'+context.identity.pedId+'-'+context.identity.sessionNonce+'-'+generation}}});
const recorded = (store,context,nowMs=1000,value='amused')=>store.commitPlayed({context,nowMs,delivery:delivery(value),receipt:receipt(context)});

test('EA4 normal follow-up is soft, one-use, idempotent within the same turn',()=>{
  const store=createMoodStore(), a=fixture();
  assert.equal(recorded(store,a),true); assert.equal(store.take({context:a,nowMs:1100}),null,'no current-turn reuse');
  const next=follow(a,2), hint=store.take({context:next,nowMs:1200});
  assert.deepEqual(hint,{value:'amused',confidence:'soft',intensity:'subtle'});
  assert.equal(Object.isFrozen(hint),true); assert.equal(hint.evidenceRef,undefined);
  assert.deepEqual(store.take({context:next,nowMs:1210}),hint,'streaming segment reuse');
  assert.equal(store.take({context:follow(a,3),nowMs:1220}),null,'cannot serve a second follow-up');
});

test('never commit unplayed, partial, rejected or interrupted playback',()=>{
  const a=fixture(),s=createMoodStore();
  for (const invalid of [{verified:false},{wasInterrupted:true},{hadAudio:false},{playbackStarted:false},
    {playbackSucceeded:false},{turnId:'other'},{generationId:5},{sessionNonce:5},{pedId:'99'}]) {
    assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:delivery(),receipt:{...receipt(a),...invalid}}),false);
  }
  assert.equal(s.size,0);
});

test('require fresh trusted speech-origin intent, no promoted fear from old memory',()=>{
  const a=fixture(),s=createMoodStore();
  for(const value of ['neutral','angry','sarcastic','excited','[laughs]',null])
    assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:delivery(value),receipt:receipt(a)}),false);
  for(const source of ['ephemeral_mood','memory','reported_claim',null])
    assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:delivery('amused',source),receipt:receipt(a)}),false);
  assert.equal(s.size,0);
});

test('do not retain string contents or claim previous evidence as new witnessed scene',()=>{
  const a=fixture(), s=createMoodStore();
  const source={...delivery(),evidenceRef:'private evidence',dialogue:'Secret text',memory:'private'};
  assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:source,receipt:receipt(a)}),true);
  const p=s.take({context:follow(a,2),nowMs:2000});
  assert.deepEqual(Object.keys(p).sort(),['confidence','intensity','value']);
  assert.equal(JSON.stringify(p).includes('private'),false);
});

test('expire at TTL boundary and return neutral on expired or restart',()=>{
  const a=fixture(),s=createMoodStore({ttlMs:15000}); recorded(s,a);
  assert.ok(s.take({context:follow(a,2),nowMs:15999}));
  assert.equal(s.take({context:follow(a,2),nowMs:16000}),null); assert.equal(s.size,0);
  recorded(s,a,20000);
  assert.equal(createMoodStore().take({context:follow(a,3),nowMs:20100}),null);
});

test('strict construction bounds',()=>{
  for(const ttlMs of [0,14999,30001,Infinity,'22000']) assert.throws(()=>new MoodStore({ttlMs}),/ttl/);
  for(const maxEntries of [-1,0,129,1.5]) assert.throws(()=>new MoodStore({maxEntries}),/capacity/);
  assert.doesNotThrow(()=>new MoodStore({ttlMs:30000,maxEntries:128}));
});

test('separate promoted NPCs never share mood, even same ped/session or timeline',()=>{
  const a=fixture(),b=fixture({character:2,bindingId:101,incarnation:121}), s=createMoodStore();
  recorded(s,a); assert.equal(s.take({context:follow(b,2),nowMs:1100}),null);
  recorded(s,b,1200,'sad');
  assert.equal(s.take({context:follow(a,2),nowMs:1300}).value,'amused');
  assert.equal(s.take({context:follow(b,2),nowMs:1300}).value,'sad');
});

test('incarnation, owner binding and native session fencing',()=>{
  const s=createMoodStore(),a=fixture(); recorded(s,a);
  for(const candidate of [fixture({bindingId:101}),fixture({incarnation:130}),fixture({session:2}),fixture({ped:'18'}),fixture({character:2})])
    assert.equal(s.take({context:follow(candidate,2),nowMs:1100}),null);
});

test('mismatch between native snapshot, binding and turn rejects tainted claims',()=>{
  const s=createMoodStore(),a=fixture();
  const variants=[
    {...a,characterSnapshot:{...a.characterSnapshot,resolution:{kind:'ephemeral',characterId:null}}},
    {...a,characterSnapshot:{...a.characterSnapshot,bindingRevision:2}},
    {...a,characterSnapshot:{...a.characterSnapshot,bindingId:uuid(999)}},
    {...a,binding:{...a.binding,characterId:uuid(2)}},
    {...a,identity:{...a.identity,pedId:'999'}},
    {...a,identity:{...a.identity,turnId:'stale-reused-snapshot'}},
    {...a,hostContext:{...a.hostContext,worldEpoch:0}},
    {...a,isCurrent:()=>false}, {...a,isCurrent:()=>{throw new Error('disconnected');}},
    {...a,isCurrent:null}, {...a,timelineId:null}, {...a,protagonist:'unknown'},
    {...a,characterSnapshot:null}, {...a,binding:null},
  ];
  for(const c of variants) assert.equal(recorded(s,c),false);
  assert.equal(s.size,0);
});

test('Franklin Michael Trevor are one player: model changes preserve one eligible follow-up',()=>{
  for(const [before,after] of [['franklin','michael'],['michael','trevor'],
    ['trevor','franklin'],['franklin','trevor']]) {
    const a=fixture({protagonist:before}),s=createMoodStore();
    assert.equal(recorded(s,a),true);
    const next=follow({...a,protagonist:after},2);
    assert.deepEqual(s.take({context:next,nowMs:1100}),
      {value:'amused',confidence:'soft',intensity:'subtle'});
    assert.ok(s.take({context:next,nowMs:1150}),'one follow-up reuses idempotently');
    assert.equal(s.take({context:follow({...a,protagonist:before},3),nowMs:1200}),null,
      'switching back cannot grant a second use');
  }
});

test('save forks and new host epochs actively retire old mood',()=>{
  for(const changed of [{timelineId:uuid(99)},{hostContext:{...host(),worldEpoch:2}},
    {hostContext:{...host(),hostRunId:uuid(888)}}]){
    const a=fixture(),s=createMoodStore();recorded(s,a);
    const swapped=follow({...a,...changed},2);
    assert.equal(s.take({context:swapped,nowMs:1100}),null);
    assert.equal(s.take({context:follow(a,2),nowMs:1200}),null,
      'old mood cannot reappear after verified save/host boundary');
  }
});

test('cancel after receiving tendency and explicit owner retirement both clear it',()=>{
  const a=fixture(),s=createMoodStore();recorded(s,a);
  const next=follow(a,2); assert.ok(s.take({context:next,nowMs:1100}));
  s.invalidate({context:next,scope:'turn'}); assert.equal(s.size,0);
  recorded(s,a,1200); s.invalidate({context:a,scope:'binding'}); assert.equal(s.size,0);
});

test('revoked proof flushes, unknown identity fails closed; clock regression evicts',()=>{
  const a=fixture(),s=createMoodStore();recorded(s,a,2000);
  s.invalidate({context:{...a,isCurrent:()=>false}});assert.equal(s.size,0);
  recorded(s,a,3000);assert.equal(s.take({context:follow(a,2),nowMs:1000}),null);assert.equal(s.size,0);
});

test('old delayed cancellation and playback cannot clobber newer committed mood',()=>{
  const s=createMoodStore(),a=fixture(),b=follow(a,2); recorded(s,a);
  assert.ok(s.take({context:b,nowMs:1100}));
  assert.equal(recorded(s,b,1200,'sad'),true);
  s.invalidate({context:a,scope:'turn'});
  assert.equal(s.take({context:follow(a,3),nowMs:1300}).value,'sad');
  assert.equal(recorded(s,a,1400),false);
});

test('bounded map evicts oldest and maintains isolation without accumulating tombstones',()=>{
  const s=createMoodStore({maxEntries:2});
  const a=fixture({character:1,bindingId:101}),b=fixture({character:2,bindingId:102}),c=fixture({character:3,bindingId:103});
  recorded(s,a,1000);recorded(s,b,1100);recorded(s,c,1200);assert.equal(s.size,2);
  assert.equal(s.take({context:follow(a,2),nowMs:1300}),null);
  assert.ok(s.take({context:follow(b,2),nowMs:1300}));
  assert.ok(s.take({context:follow(c,2),nowMs:1300}));
  s.clear();assert.equal(s.size,0);
});
