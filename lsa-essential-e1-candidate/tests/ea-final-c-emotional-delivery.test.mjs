import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery, DELIVERY_VALUES } from '../src/voice/emotion/deliveryContract.mjs';
import { renderElevenSpeech, verifiedElevenTagForDelivery,
  sanitizeElevenSpeechDialogue } from '../src/voice/emotion/elevenTags.mjs';
import { wasElevenTagApplied } from '../src/providers/elevenlabs/speechProvider.mjs';
import { createSpeechDeliveryResolver } from '../src/voice/emotion/resolveSpeechDelivery.mjs';
import { MoodStore } from '../src/voice/emotion/moodStore.mjs';
import { emitTagged } from './helpers/eaFinalApplied.mjs';

const id = Object.freeze({pedId:'17',sessionNonce:2,turnId:'fresh-turn',generationId:4});
const emotion = (value,source='dialogue_cue')=>createDelivery({
  value,source,confidence:source==='verified_scene'?'supported':'soft',
});
const native = identity=>({...identity,type:'playback_ended',ok:true,
  reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true});
function fixture({value='fearful',source='player_text',mode='experimental',
  modelId='eleven_v4_turbo',max=2,identity=id,selectorSource='dialogue_cue'}={}) {
  const calls=[],events=[];
  const resolver=createSpeechDeliveryResolver({
    config:{speechProvider:'elevenlabs',elevenLabs:{modelId},
      expressiveDelivery:{mode,intensity:'subtle',maxTaggedSegmentsPerTurn:max}},
    identity,source,turn:Object.freeze({}),isActive:()=>true,clock:()=>1000,
    telemetry:{event:(name,data)=>events.push({name,data})},
    adapter:{
      resolveDelivery:({sequence})=>emotion(typeof value==='function' ? value(sequence) : value,selectorSource),
      onSpeechCompleted:data=>{calls.push(data);return true;},
    },
  });
  return {resolver,calls,events,identity};
}

test('all EA0 values map only to supported verified Turbo tags',()=>{
  const expected={whisper:'[whispers]',excited:'[excited]',fearful:'[scared]',
    angry:'[angry]',amused:'[laughs]',sad:'[sad]',sarcastic:'[sarcastic]'};
  for (const value of DELIVERY_VALUES) {
    const tag=verifiedElevenTagForDelivery(value,'eleven_v4_turbo');
    assert.equal(tag,expected[value]??null,value);
    assert.equal(verifiedElevenTagForDelivery(value,'some_other_model'),null);
    const branded=emotion(value,value==='neutral'?'neutral':'dialogue_cue');
    assert.equal(renderElevenSpeech({
      dialogue:'Hello.',delivery:branded,enabled:true,modelId:'eleven_v4_turbo',
    }),tag?tag+' Hello.':'Hello.');
    assert.equal(renderElevenSpeech({
      dialogue:'Hello.',delivery:branded,enabled:true,modelId:'unsupported',
    }),'Hello.');
  }
  assert.equal(verifiedElevenTagForDelivery('concerned','eleven_v4_turbo'),null);
});

test('fearful selected by EA2 corresponds to the EXACT sent [scared] directive',async()=>{
  const f=fixture();
  const d=f.resolver.forSegment({text:'There is danger.',sequence:1});
  assert.equal(d.value,'fearful');
  const {result,sockets}=await emitTagged({identity:id,delivery:d,dialogue:'There is danger.'});
  const frames=sockets[0].frames;
  assert.equal(frames[1].inputs[0].text,'[scared] There is danger.');
  assert.equal(result.tagApplied,true);
  assert.equal(result.appliedTag,'[scared]');
  assert.equal(wasElevenTagApplied(result,{identity:id,delivery:d}),true);
  assert.equal(wasElevenTagApplied({...result},{identity:id,delivery:d}),false,
    'serialized or spread result is not provider proof');
  const r=native(id);
  assert.equal(f.resolver.synthesized(d,r,result),true);
  assert.equal(f.resolver.complete(r,{historyAccepted:true}),true);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].delivery.value,'fearful');
  assert.equal(f.events.filter(e=>e.name==='acting_tag_confirmed').length,1);
});

test('selected-but-unapplied, omitted and unsupported tags cannot create mood',async()=>{
  const f=fixture({value:'sad'});
  const d=f.resolver.forSegment({text:'So sad.',sequence:1});
  const off=await emitTagged({identity:id,delivery:d,dialogue:'So sad.',mode:'shadow'});
  assert.equal(off.result.tagApplied,false);
  assert.equal(f.resolver.synthesized(d,native(id),off.result),false);
  assert.equal(f.resolver.synthesized(d,native(id),{tagApplied:true,appliedTag:'[sad]'}),false);
  assert.equal(f.resolver.complete(native(id),{historyAccepted:true}),false);
  assert.equal(f.calls.length,0);
  for (const value of ['concerned','fearful']) {
    const model=value==='fearful'?'unsupported_model':'eleven_v4_turbo';
    const g=fixture({value,modelId:model});
    assert.equal(g.resolver.forSegment({text:'Safe.',sequence:1}),null);
    const raw=await emitTagged({identity:id,delivery:emotion(value),
      dialogue:'Safe.',modelId:model});
    assert.equal(raw.result.tagApplied,false);
    assert.equal(raw.sockets[0].frames[1].inputs[0].text,'Safe.');
  }
});

test('native failure, owner mismatch and rejected accepted-history block mood',async()=>{
  const f=fixture({value:'amused'});
  const d=f.resolver.forSegment({text:'Funny.',sequence:1});
  const {result}=await emitTagged({identity:id,delivery:d});
  const failed=[
    {ok:false},{reason:'superseded'},{wasInterrupted:true},
    {hadAudio:false},{playbackStarted:false},{type:'playback_started'},
    {pedId:'foreign'},{sessionNonce:999},{turnId:'old'},
    {generationId:3},
  ];
  for(const delta of failed)
    assert.equal(f.resolver.synthesized(d,{...native(id),...delta},result),false);
  assert.equal(f.resolver.complete(native(id),{historyAccepted:false}),false);
  assert.equal(f.calls.length,0);
  assert.equal(f.resolver.synthesized(d,native(id),result),true);
  assert.equal(f.resolver.complete(native(id),{historyAccepted:true}),true);
  assert.equal(f.resolver.complete(native(id),{historyAccepted:true}),false);
  assert.equal(f.resolver.synthesized(d,native(id),result),false);
  assert.equal(f.calls.length,1);
});

test('last fresh actually tagged segment wins regardless of callback order',async()=>{
  // Different emotions remain eligible inside the cooldown and preserve the
  // last-actual-delivery ordering contract.
  const f=fixture({value:sequence=>sequence===1?'sad':'amused'});
  const one=f.resolver.forSegment({text:'First.',sequence:1});
  const two=f.resolver.forSegment({text:'Second.',sequence:2});
  assert.notEqual(one,two,'two segments get independent in-process brands');
  const a=(await emitTagged({identity:id,delivery:one})).result;
  const b=(await emitTagged({identity:id,delivery:two})).result;
  const r=native(id);
  assert.equal(f.resolver.synthesized(two,r,b),true);
  assert.equal(f.resolver.synthesized(one,r,a),true);
  assert.equal(f.resolver.synthesized(one,r,a),false);
  assert.equal(f.resolver.complete(r,{historyAccepted:true}),true);
  assert.equal(f.calls[0].delivery,two);
});

test('source paths share one model cap, and a stale or foreign result cannot be reused',async()=>{
  for(const source of ['player_text','player_mic','stt','director']) {
    const f=fixture({value:'fearful',source,max:1});
    const d=f.resolver.forSegment({text:'First.',sequence:1});
    assert.ok(d,source);
    assert.equal(f.resolver.forSegment({text:'Second.',sequence:2}),null);
    const wrongId={...id,pedId:'99'};
    const foreign=await emitTagged({identity:wrongId,delivery:d});
    assert.equal(f.resolver.synthesized(d,native(id),foreign.result),false);
    const own=await emitTagged({identity:id,delivery:d});
    assert.equal(f.resolver.synthesized(d,native(id),own.result),true);
    f.resolver.complete(native(id),{historyAccepted:true});
    assert.equal(f.calls.length,1);
  }
});

test('off/shadow socket text is byte-identical and cannot create applied proof',async()=>{
  const dialogue='Quoted [gunshot] ⟦scared⟧ ［angry］ and 😀 text.';
  const selected=emotion('fearful');
  const a=await emitTagged({identity:id,delivery:selected,dialogue,mode:'off'});
  const b=await emitTagged({identity:id,delivery:selected,dialogue,mode:'shadow'});
  assert.deepEqual(a.sockets[0].frames,b.sockets[0].frames);
  assert.equal(a.sockets[0].frames[1].inputs[0].text,dialogue);
  assert.equal(a.result.tagApplied,false);
  assert.equal(b.result.tagApplied,false);
  assert.equal(wasElevenTagApplied(b.result,{delivery:selected,identity:id}),false);
});

test('experimental sanitizes bracket/confusable injection without mutating text',async()=>{
  const dialogue='[explosion] ［scared］ ⟦angry⟧ 【laughs】 〔sad〕 😀';
  const chosen=emotion('fearful');
  const emitted=await emitTagged({identity:id,delivery:chosen,dialogue});
  assert.equal(emitted.sockets[0].frames[1].inputs[0].text,
    '[scared] '+sanitizeElevenSpeechDialogue(dialogue));
  assert.equal(dialogue.startsWith('[explosion]'),true);
  assert.equal(emitted.result.tagApplied,true);
  assert.throws(()=>renderElevenSpeech({
    dialogue:'\uD800',delivery:chosen,enabled:true,modelId:'eleven_v4_turbo',
  }),/Unicode/);
  const long='x'.repeat(2992);
  const budget=await emitTagged({identity:id,delivery:chosen,dialogue:long});
  assert.equal(budget.result.tagApplied,false,'no tag may overflow 3000 UTF-16 units');
  assert.equal(budget.sockets[0].frames[1].inputs[0].text,long);
});

test('post-is_final abort during async native PCM forwarding cannot acknowledge applied tag',async()=>{
  const controller=new AbortController();
  await assert.rejects(emitTagged({identity:id,delivery:emotion('sad'),
    signal:controller.signal,onPcm:async()=>controller.abort()}),/cancelled/);
});

test('misaligned PCM is rejected rather than reported as rendered emotional audio',async()=>{
  await assert.rejects(emitTagged({identity:id,delivery:emotion('sad'),
    messages:[{audio:Buffer.from([1,2,3]).toString('base64')},{is_final:true}]}),
    /elevenlabs_invalid/);
});

test('expired generation tombstone does not allow duplicate callback to revive mood',()=>{
  const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const ctx=(generationId)=>{
    const identity={...id,turnId:'t-'+generationId,generationId};
    const binding={characterId:uuid(1),bindingId:uuid(2),bindingRevision:1,
      serverRunId:uuid(3),pedId:identity.pedId,sessionNonce:identity.sessionNonce,
      claim:{worldProfileId:uuid(4),sourceNamespace:'comrade.authored',
        sourceKey:'npc',adapterEpoch:uuid(5),incarnationId:uuid(6),claimRevision:1}};
    return {identity,binding,characterSnapshot:{nativeIdentity:identity,
      bindingId:binding.bindingId,bindingRevision:1,
      resolution:{kind:'persistent',characterId:uuid(1)}},
      hostContext:{hostContextVersion:1,hostRunId:uuid(7),worldEpoch:1},
      timelineId:uuid(8),protagonist:'franklin',isCurrent:()=>true};
  };
  const store=new MoodStore(),first=ctx(4),later=ctx(5);
  const receipt=identity=>({...identity,verified:true,playbackSucceeded:true,
    playbackStarted:true,hadAudio:true,wasInterrupted:false});
  assert.equal(store.commitPlayed({context:first,nowMs:0,delivery:emotion('sad'),
    receipt:receipt(first.identity)}),true);
  assert.equal(store.take({context:later,nowMs:22_000}),null);
  assert.equal(store.size,0);
  assert.equal(store.commitPlayed({context:first,nowMs:25_000,
    delivery:emotion('sad'),receipt:receipt(first.identity)}),false);
  assert.equal(store.take({context:later,nowMs:25_001}),null);
});
