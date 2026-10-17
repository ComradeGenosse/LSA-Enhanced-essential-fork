// The production sequential runner with scripted GTA/provider seams, proving the
// Director callback preparation hook is reached only for a non-player special_event
// turn carrying a Director ticket, is isolated from turn failure, and hands its
// result to the single PS4 frame finalizer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSegmentDecoder} from '../src/openai/segmentDecoder.mjs';
import {runSequentialTurn} from '../src/openai/runSequentialTurn.mjs';

const ticketFor = () => { const id = randomUUID();
  return Object.freeze({schemaVersion:1,ticketId:id,dedupeKey:'ps:' + id,priority:'director_routine'}); };
const playback = identity => Object.freeze({...identity,type:'playback_ended',reason:'completed',
  playbackStarted:true,hadAudio:true,wasInterrupted:false,ok:true});

async function run({source = 'special_event',ticket = ticketFor(),prepare}) {
  const identity = Object.freeze({pedId:'17',turnId:'t-' + randomUUID(),generationId:1,sessionNonce:1});
  const controller = new AbortController();
  const done = playback(identity);
  let observed = () => {}, terminal = () => {};
  const host = {assertCapabilities() {},isCurrent:() => true,async authorize() {return true;},
    observe(_i,_s,onTerminal,onObserved) {observed = onObserved;terminal = onTerminal;
      return {authorization:async () => {observed({...identity,type:'audio_turn_accepted'});return {ok:true};},
        completion:async () => {observed(done);terminal(done);return done;},dispose() {}};},
    async emit() {return true;},
    async validateDecision(d) {return {identityValid:true,internalTranscript:d.dialogue,actionCount:0};},
    async failTurn() {}};
  const history = {readForSession:() => [],commitPlayerInput:() => true,stage() {},
    markModelAndTtsSucceeded() {},acceptPlaybackResult:() => true,discard:() => true};
  const seen = {prepareCalls:[],finalizedWith:undefined};
  const services = {
    config:{structuredStreamingEnabled:true,earlyTtsEnabled:false,streamingMaxSegments:6,
      streamingMaxPcmBytes:1024 * 1024,providerWorkDeadlineMs:10000,playbackCompletionMinMs:1000,
      playbackCompletionMaxMs:10000,playbackCompletionGraceMs:1000},
    providerStack:{reasoning:{id:'test.reasoning'},speech:{id:'test.speech'},
      decideStreaming:async () => { const d = createSegmentDecoder();
        d.append(JSON.stringify({mode:'dialogue_only',segments:[{text:'Hello.'}],command:''}));
        d.takeNewSegments();return d.finish(); }},
    async speak({onPcm}) {await onPcm(Uint8Array.of(1,2));return {bytes:2,chunks:1};},
    ...(prepare ? {async prepareDirectorCallbackMemory(args) {
      seen.prepareCalls.push({source:args.source,hasTicket:!!args.turn.directorTicket,current:args.isCurrent()});
      return prepare(args);
    }} : {}),
    finalizeKnowledgeFrame(turn) {seen.finalizedWith = turn.memoryPrepared;return null;},
  };
  const outcome = await runSequentialTurn({connection:{detachAbort() {}},
    turn:{identity,source,input:source === 'special_event' ? '' : 'Hi',context:{},
      ...(ticket ? {directorTicket:ticket} : {})},services,history,host,speech:null,controller});
  return {outcome,seen};
}

test('a Director special_event turn receives the prepared memory in the single frame finalizer',async () => {
  const prepared = Object.freeze({status:'ready',marker:randomUUID()});
  const x = await run({prepare:async () => prepared});
  assert.equal(x.outcome.status,'completed');
  assert.deepEqual(x.seen.prepareCalls,[{source:'special_event',hasTicket:true,current:true}]);
  assert.equal(x.seen.finalizedWith,prepared);
});

test('the hook is never called for player turns or for special events without a Director ticket',async () => {
  for (const options of [{source:'player_text',ticket:null},{source:'player_mic',ticket:null},
    {source:'special_event',ticket:null}]) {
    const x = await run({...options,prepare:async () => ({status:'ready'})});
    assert.equal(x.outcome.status,'completed');
    assert.equal(x.seen.prepareCalls.length,0,JSON.stringify(options));
    assert.equal(x.seen.finalizedWith ?? null,null);
  }
});

test('a failing or null preparation never breaks the turn and leaves no memory',async () => {
  const thrown = await run({prepare:async () => {throw new Error('boom');}});
  assert.equal(thrown.outcome.status,'completed');
  assert.equal(thrown.seen.finalizedWith,null);
  const none = await run({prepare:async () => null});
  assert.equal(none.outcome.status,'completed');
  assert.equal(none.seen.finalizedWith,null);
});

test('with no callbacks service the Director turn is byte-for-byte the previous behavior',async () => {
  const x = await run({});
  assert.equal(x.outcome.status,'completed');
  assert.equal(x.seen.finalizedWith ?? undefined,undefined);
});
