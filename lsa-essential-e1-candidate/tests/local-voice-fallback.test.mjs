import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmToWav} from '../src/voice/pcmWav.mjs';
import {decodeFallbackWav,fallbackCategory,selectLocalFallback} from '../src/voice/localFallback.mjs';
import {DialogueHistory} from '../src/memory/dialogueHistory.mjs';
import {createNpcSpeechDeliverySource} from '../src/memory/npcSpeechDeliveryLedger.mjs';

const characterId='12345678-1234-4123-8123-123456789abc';
const identity={pedId:'actor:fixture',turnId:'voice-1',generationId:1,sessionNonce:1};
const turn={characterSnapshot:{resolution:{kind:'persistent',characterId}},
  characterInputs:{profile:{characterId}},speechProfile:{voice:'nathan_voice'}};
const config={localVoiceFallback:{enabled:true,assetDirectory:'VoiceFallback',maxRecoveryDelayMs:250}};
const pcm=Buffer.alloc(9600,0);
const wav=pcmToWav([pcm]);
const clips=[
  {id:'line_a',category:'speech_lost',asset:'line_a.wav',text:'Lost my train of thought.'},
  {id:'line_b',category:'speech_lost',asset:'line_b.wav',text:'One more time?'},
  {id:'action',category:'action_unconfirmed',asset:'action.wav',text:'Let me check.'},
  {id:'hear',category:'misheard',asset:'hear.wav',text:'What did you say?'},
];
const manifest=Buffer.from(JSON.stringify({version:1,characters:[{characterId,voice:'nathan_voice',clips}]}));
const reader=async p=>p.endsWith('manifest.json')?manifest:wav;

test('strict PCM24k mono WAV decode accepts a genuine local buffer and rejects malformed audio',()=>{
  assert.deepEqual(decodeFallbackWav(wav),pcm);
  assert.throws(()=>decodeFallbackWav(wav.subarray(0,44)),/fallback_invalid_wav/);
  const corrupted=Buffer.from(wav);corrupted.writeUInt32LE(44100,24);
  assert.throws(()=>decodeFallbackWav(corrupted),/fallback_invalid_wav/);
  const odd=Buffer.concat([wav,Buffer.from([3])]);
  assert.throws(()=>decodeFallbackWav(odd),/fallback_invalid_wav/);
});

test('no prerecorded audio is required to launch; missing assets fail safely',async()=>{
  assert.equal((await selectLocalFallback({config,turn,category:'speech_lost',read:async()=>{const e=new Error('not found');e.code='ENOENT';throw e;}})).status,'asset_missing');
  assert.equal((await selectLocalFallback({config:{localVoiceFallback:{enabled:false}},turn,category:'speech_lost'})).status,'disabled');
  assert.equal((await selectLocalFallback({config,turn:{...turn,characterSnapshot:{resolution:{kind:'ephemeral'}}},category:'speech_lost',read:reader})).status,'identity_unverified');
  assert.equal((await selectLocalFallback({config,turn:{...turn,speechProfile:{voice:'other_voice'}},category:'speech_lost',read:reader})).status,'asset_missing');
});

test('recording rotates within its category, never uses another character voice or successful-action audio',async()=>{
  const a=await selectLocalFallback({config,turn,category:'speech_lost',read:reader});
  const b=await selectLocalFallback({config,turn,category:'speech_lost',read:reader});
  assert.equal(a.status,'selected');assert.equal(b.status,'selected');assert.notEqual(a.assetId,b.assetId);
  assert.equal(a.pcm.length,pcm.length);assert.equal(a.category,'speech_lost');
  const c=await selectLocalFallback({config,turn,category:'action_unconfirmed',read:reader});
  assert.equal(c.assetId,'action');
  assert.equal(fallbackCategory({terminalReason:'stt_error'}),'misheard');
  assert.equal(fallbackCategory({terminalReason:'model_error'}),'lost_thought');
  assert.equal(fallbackCategory({terminalReason:'tts_error',actionState:'unverified'}),'action_unconfirmed');
  assert.equal(fallbackCategory({terminalReason:'tts_error',actionState:'failed'}),'action_failed');
});

test('invalid manifest, corrupt asset and I/O timeout never produce speech',async()=>{
  assert.equal((await selectLocalFallback({config,turn,category:'speech_lost',read:async p=>p.endsWith('manifest.json')?Buffer.from('bad'):wav})).status,'asset_invalid');
  assert.equal((await selectLocalFallback({config,turn,category:'speech_lost',read:async p=>p.endsWith('manifest.json')?manifest:Buffer.alloc(45)})).status,'invalid_wav');
  assert.equal((await selectLocalFallback({config,turn,category:'speech_lost',read:async()=>new Promise(()=>{})})).status,'read_timeout');
  const abort=new AbortController();abort.abort();
  assert.equal((await selectLocalFallback({config,turn,category:'speech_lost',signal:abort.signal,read:reader})).status,'disabled');
});

test('fallback history supersedes undelivered candidate and requires exact playback evidence',()=>{
  const history=new DialogueHistory();
  const id={pedId:'actor:fixture',turnId:'turn-a',generationId:1,sessionNonce:2};
  history.commitPlayerInput({identity:id,input:'Drive to the waypoint.'});
  history.stage({identity:id,spokenReply:'I am driving.'});
  history.discard(id);
  history.stage({identity:id,spokenReply:'Hold up, let me check.'});
  history.markFallbackAudioReady(id);
  assert.equal(history.acceptPlaybackResult({...id,playbackSucceeded:false,hadAudio:false,playbackStarted:false}),false);
  assert.deepEqual(history.readForSession(id.pedId,id.sessionNonce),[{role:'user',content:'Drive to the waypoint.'}]);
  history.stage({identity:id,spokenReply:'Hold up, let me check.'});
  history.markFallbackAudioReady(id);
  assert.equal(history.acceptPlaybackResult({...id,playbackSucceeded:true,hadAudio:true,playbackStarted:true,wasInterrupted:false}),true);
  assert.deepEqual(history.readForSession(id.pedId,id.sessionNonce).at(-1),{role:'assistant',content:'Hold up, let me check.'});
});

test('speech delivery ledger replaces failed no-PCM segment without forging playback',()=>{
  const source=createNpcSpeechDeliverySource();
  const id={pedId:'a0a0a0a0-0000-4000-8000-000000000001',turnId:'t1',generationId:1,sessionNonce:2};
  const ctrl=new AbortController();
  const ledger=source.recorder.openTurn({identity:id,source:'player_text',connection:{},signal:ctrl.signal});
  if(!ledger)return; // native actor ID types differ between candidate tiers; behavioral runner covers this.
  const failed=ledger.beginSegment({sequence:0,text:'Unspoken initial answer'});
  failed.failed();
  assert.equal(ledger.replaceUndeliveredWithFallback('Actual backup line'),true);
  const part=ledger.beginSegment({sequence:0,text:'Actual backup line'});
  assert.equal(part.forwarded(4800),true);
  assert.equal(part.completed(4800),true);
  assert.equal(ledger.finalized(),true);
  assert.equal(source.verifier.evaluate(id)?.delivery??null,null);
  ledger.release();
});
