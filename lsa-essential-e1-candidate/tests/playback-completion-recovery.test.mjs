import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackCompletionPolicy} from '../src/openai/playbackCompletionPolicy.mjs';
import {observeNative} from '../src/integration/nativeDelivery.mjs';

const identity = Object.freeze({pedId:'NPC-1',turnId:'turn-12',generationId:12,sessionNonce:3});
const policy = (pcmBytes, extra = {}) => playbackCompletionPolicy({
  pcmBytes, nativeStartedAt:1000, sealedAt:4000, ...extra,
});

test('October 18: 142080 bytes = 2960 ms; fallback retires unacknowledged short playback well before 45 seconds, never grants completion', () => {
  const result = policy(142080);
  assert.equal(result.expectedDurationMs,2960);
  assert.equal(result.estimatedRemainingMs,0);
  assert.equal(result.watchdogMs,14960);
  assert.equal(result.durationCapped,false);
  assert.equal(result.bufferState,'unavailable');
});

test('genuinely long speech gets clip-duration-plus-grace, not an unrelated short fixed timeout', () => {
  const result = policy(48_000 * 105_000 / 1000);
  assert.equal(result.expectedDurationMs,105000);
  assert.ok(result.watchdogMs >= 117000);
  assert.equal(result.durationCapped,false);
});

test('provider finish does not claim audible playback from wall time when native start is unknown', () => {
  const result = policy(142080,{nativeStartedAt:null});
  assert.equal(result.estimatedRemainingMs,2960);
  assert.equal(result.watchdogMs,14960);
});

test('explicit playback cap is observable and cannot masquerade as authoritative success', () => {
  const result = policy(48_000 * 120,{minimumMs:10,graceMs:5000,maximumMs:50});
  assert.equal(result.durationCapped,true);
  assert.equal(result.watchdogMs,50);
  assert.equal(result.bufferState,'unavailable');
});

test('identity-scoped listener rejects foreign and superseded completions without creating success', async () => {
  const listeners = new Set(), onTerminal=[];
  const bridge={onNativeEvent(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
  const controller=new AbortController();
  const observer=observeNative(bridge,identity,controller.signal,event=>onTerminal.push(event));
  const emit=(id,type,extra={})=>{for(const listener of [...listeners]) listener({...id,type,...extra});};
  emit({...identity,generationId:13},'playback_ended',{reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true});
  emit(identity,'audio_turn_accepted');
  assert.deepEqual(await observer.authorization(20),{ok:true});
  const completion=observer.completion(100);
  emit(identity,'playback_started');
  emit(identity,'playback_ended',{reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true});
  emit(identity,'playback_ended',{reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true});
  assert.equal((await completion).ok,true);
  assert.equal(onTerminal.length,1);
  observer.dispose();
  emit(identity,'playback_ended',{reason:'cleared',wasInterrupted:true});
  assert.equal(onTerminal.length,1);
  assert.equal(listeners.size,0);
});

test('acknowledgment absent remains unknown, including when a newer turn has begun', async () => {
  const listeners=new Set();
  const bridge={onNativeEvent(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
  const controller=new AbortController();
  const observer=observeNative(bridge,identity,controller.signal,()=>{});
  const completion=observer.completion(15);
  for(const listener of [...listeners])listener({...identity,turnId:'turn-13',type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true});
  const result=await completion;
  assert.deepEqual(result,{ok:false,reason:'native_ack_timeout'});
  observer.dispose();
});
