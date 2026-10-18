// Regression for E6 structured streaming (1-based model segment ordinals)
// crossing into the actual WS-5a speech ledger (0-based PCM segment indexes).
// Runs the PRODUCTION sequential runner and speech ledger. GTA, model and TTS
// input/native events are deterministic test doubles; no forged memory receipt
// is sent to the production ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSegmentDecoder} from '../src/openai/segmentDecoder.mjs';
import {runSequentialTurn} from '../src/openai/runSequentialTurn.mjs';
import {createNpcSpeechDeliverySource} from '../src/memory/npcSpeechDeliveryLedger.mjs';

const identity=Object.freeze({pedId:'17',turnId:'stream-ledger-regression',generationId:1,sessionNonce:1});
const playback=Object.freeze({...identity,type:'playback_ended',reason:'completed',
  playbackStarted:true,hadAudio:true,wasInterrupted:false,ok:true});

// Only the external GTA/native and provider seams are scripted; the actual
// structured decoder, runner PCM accounting and ledger evidence are reused.
async function run({texts=['Hello ','Nathan.'],early=true,reportedBytes=4,
  mutateOrdinal=null,nativeReceipt=playback}={}){
  const src=createNpcSpeechDeliverySource();
  const controller=new AbortController();
  const connection={detachAbort(){}};
  const speech=src.recorder.openTurn({identity,source:'player_text',connection,signal:controller.signal});
  assert.ok(speech);
  const receipts=[],handoffs=[],nativeCalls=[];
  let observed=()=>{},terminal=()=>{};
  const host={
    assertCapabilities(){},
    isCurrent:()=>true,
    async authorize(){return true;},
    observe(_id,_signal,onTerminal,onObserved){
      observed=onObserved;terminal=onTerminal;
      return {
        authorization:async()=>{
          observed({...identity,type:'audio_turn_accepted'});
          return {ok:true};
        },
        completion:async()=>{
          observed(nativeReceipt);
          terminal(nativeReceipt);
          return nativeReceipt;
        },
        dispose(){}
      };
    },
    async emit(event){handoffs.push(event);return true;},
    async validateDecision(decision){
      return {identityValid:true,internalTranscript:decision.dialogue,actionCount:0};
    },
    async failTurn(){nativeCalls.push('failed');},
  };
  const history={
    readForSession:()=>[],
    commitPlayerInput:()=>true,
    stage(){},
    markModelAndTtsSucceeded(){},
    acceptPlaybackResult:()=>true,
    discard:()=>true,
  };
  const services={
    config:{structuredStreamingEnabled:true,earlyTtsEnabled:early,streamingMaxSegments:6,
      streamingMaxPcmBytes:1024*1024,providerWorkDeadlineMs:10000,
      playbackCompletionMinMs:1000,playbackCompletionMaxMs:10000,playbackCompletionGraceMs:1000},
    providerStack:{
      reasoning:{id:'test.reasoning'},speech:{id:'test.speech'},
      decideStreaming:async({onSegment})=>{
        const decoder=createSegmentDecoder();
        decoder.append(JSON.stringify({mode:'dialogue_only',
          segments:texts.map(text=>({text})),command:''}));
        const emitted=decoder.takeNewSegments();
        assert.deepEqual(emitted.map(s=>s.sequence),texts.map((_,i)=>i+1),
          'public model segments intentionally remain 1-based');
        if(early)for(const item of emitted){
          await onSegment(mutateOrdinal ? {...item,sequence:mutateOrdinal(item.sequence)} : item,'dialogue_only');
        }
        return decoder.finish();
      },
    },
    async speak({onPcm}){
      await onPcm(Uint8Array.of(1,2));
      await onPcm(Uint8Array.of(3,4));
      return {bytes:reportedBytes,chunks:2};
    },
    async recordM2Npc(){
      // Corresponds to the D03 read-only speech evidence gate. A real D03 writer
      // additionally requires a durable player line and current native owner.
      const evidence=src.verifier.evaluate(identity);
      receipts.push(evidence);
      return evidence?{status:'stored',durable:true,delivery:evidence.delivery}
        :{status:'not_stored',reason:'d03_npc_no_outcome'};
    }
  };
  const outcome=await runSequentialTurn({connection,turn:{identity,source:'player_text',
    input:'Tell me something.',context:{}},services,history,host,speech,controller});
  return {outcome,receipts,handoffs,nativeCalls};
}

test('streamed first segment 1 becomes ledger 0; multiple pieces are durably admissible',async()=>{
  for(const texts of [['Hello Nathan.'],['Hello ','Nathan.'],['One. ','Two. ','Three. ','Four. ','Five. ','Six. ']]){
    const x=await run({texts});
    assert.equal(x.outcome.status,'completed');
    assert.equal(x.receipts.length,1);
    const proof=x.receipts[0];
    assert.ok(proof,'completed native playback must create a ledger outcome');
    assert.equal(proof.kind,'NpcSpeechDeliveryEvidenceV1');
    assert.equal(proof.delivery,'completed');
    assert.deepEqual(proof.segments.map(s=>s.sequence),texts.map((_,i)=>i));
    assert.equal(proof.text,texts.join(''));
    assert.equal(proof.nativeTerminal.reason,'completed');
    assert.equal(proof.historyAccepted,true);
    assert.equal(proof.streamEnded,true);
    assert.ok(proof.segments.every(s=>s.forwardedBytes===4&&s.providerBytes===4));
    assert.equal(x.handoffs.filter(e=>e.type==='turn_complete').length,1);
  }
});

test('buffered structured response retains the unchanged zero-based ledger path',async()=>{
  const x=await run({texts:['Buffered.'],early:false});
  assert.equal(x.outcome.status,'completed');
  assert.equal(x.receipts[0]?.delivery,'completed');
  assert.deepEqual(x.receipts[0]?.segments.map(s=>s.sequence),[0]);
});

test('invalid one-based external ordinal cannot authorize a completed NPC receipt',async()=>{
  for(const mutateOrdinal of [()=>0,()=>2,()=>1.5,()=>null]){
    const x=await run({mutateOrdinal});
    assert.equal(x.outcome.status,'completed','optional ledger cannot break audible AI');
    assert.notEqual(x.receipts[0]?.delivery,'completed');
  }
});

test('real runner denies completed ledger proof on mismatched provider PCM totals',async()=>{
  const x=await run({reportedBytes:6});
  assert.equal(x.outcome.status,'completed');
  assert.notEqual(x.receipts[0]?.delivery,'completed');
});

test('native playback result must correspond to exact original identity',async()=>{
  const x=await run({nativeReceipt:{...playback,turnId:'different-turn'}});
  assert.equal(x.outcome.status,'completed','host fake may report success');
  assert.notEqual(x.receipts[0]?.delivery,'completed',
    'WS-5a must refuse unrelated native proof even if the mocked host reports success');
});
