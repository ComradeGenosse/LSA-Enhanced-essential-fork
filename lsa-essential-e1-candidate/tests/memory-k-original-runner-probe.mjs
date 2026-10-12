// This is a fail-closed ORIGINAL production runner + real P2 SQLite probe.
// Mock services allow deterministic runner execution but never establish
// authenticated native current owner, original backend acceptance or audio.
// No fixture calls recordPlayerAccepted: fake admission is forbidden here.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {runSequentialTurn} from '../src/openai/runSequentialTurn.mjs';
import {createP2MemoryStorage} from '../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {profile} from './p2-fixtures.mjs';
import {worldProfileId} from './identity-fixtures.mjs';
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const BLOCKERS=Object.freeze({
  S01:'D01_ACCEPTED_BACKEND_TURN_AND_T3_M2_DURABLE_PLAYER_RECEIPT_MISSING',
  S02:'T2_SOURCE_TIME_NATIVE_FIRING_WITNESS_AND_T5_M4_RECALL_MISSING',
  S03:'T2_INDEPENDENT_PROMOTED_NPC_NATIVE_WITNESS_PROOFS_MISSING',
  S04:'T4_POST_COMMIT_COMMAND_CLARIFICATION_AND_ACK_PROOF_MISSING',
  S05:'T6_ATOMIC_M6_CURSOR_AND_T7_AUTHENTIC_IDLE_CONSENT_RECOVERY_MISSING',
  S06:'T5_SINGLE_PS4_PERSONALITY_FRAME_FROM_IDENTICAL_COMMITTED_FACTS_MISSING',
  S07:'T1_NATIVE_HOST_ROLLBACK_AND_K_ORIGINAL_RUNNER_TIMELINE_FENCE_MISSING',
  S08:'T2_SAME_NATIVE_PED_SOURCE_TIME_PREPROMOTION_WINDOW_PROOF_MISSING',
  S09:'D01_FINAL_STT_CORRECTION_AND_T4_T5_SUPPRESSION_SOURCE_MISSING',
  S10:'T8_AUTHENTIC_PS3_PS6_DIRECTOR_SOURCE_COOLDOWN_AND_PLAYER_PRIORITY_MISSING'
});
const scenarioTexts=Object.freeze({
  S01:'  Fuck this — déjà vu 🦊 中文 and café!\n  ',
  S02:'I fired a single unremarkable shot over three minutes ago.',
  S03:'Only the first promoted NPC saw the player fire.',
  S04:'Remember that. Which one do you mean?',
  S05:'Keep the memory locally if Luna is offline.',
  S06:'We remember the same event but react very differently.',
  S07:'Switching saves should suspend your memory writes.',
  S08:'This was said before I promoted that same ped.',
  S09:'Actually I said blue, not glue.',
  S10:'Do not interrupt the player for a spontaneous memory.'
});
const actualSource=source=>source==='player_mic'?'stt':'typed';
export async function executeOriginalRunnerProbe(scenarioId){
  if(!BLOCKERS[scenarioId])throw new TypeError('unknown_original_M0_scenario');
  const filePath=process.env.MEMORY_K_W09_DB_PATH;
  if(typeof filePath!=='string'||!filePath.endsWith('.sqlite'))
    throw new Error('W09_PARENT_OWNED_SQLITE_FILE_REQUIRED');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const hostContext={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
  try{
    const a=await store.create(profile());
    const b=await store.create(profile());
    assert.notEqual(a.characterId,b.characterId);
    const timelineId=await store.createTimeline({label:'W09 honest runner probe '+scenarioId});
    // Real P2 guard is exercised, but this synthetic source confirmation
    // is test setup, NOT a native authenticated C-13 observation.
    store.setVerifiedHostContext(hostContext);
    await store.confirmTimeline(timelineId);
    const text=scenarioTexts[scenarioId];
    const accepted=[],emitted=[],events=[],provider=[];
    const identity={pedId:'101',turnId:'w09-probe-'+scenarioId,
      generationId:1,sessionNonce:1};
    const stt=scenarioId==='S09',source=stt?'player_mic':'player_text';
    const turn={identity,source,input:stt?'misheard glue':text,
      pcm:stt?Buffer.from([1,0,2,0]):null,sampleRate:24000,
      context:{},speechProfile:{}};
    const connection={detachAbort:()=>{}};
    const history={
      readForSession:()=>[],
      commitPlayerInput:({identity:turnIdentity,input})=>{
        assert.equal(turnIdentity,identity);
        accepted.push(input);return true;
      },
      stage:()=>{},markModelAndTtsSucceeded:()=>{},
      acceptPlaybackResult:()=>false,discard:()=>false
    };
    const host={
      isCurrent:subject=>subject===identity,
      log:(_identity,stage)=>events.push(stage),
      telemetry:null,
      assertCapabilities:()=>{},
      emit:async event=>{emitted.push(event);return true;},
      observe:()=>({
        authorization:async()=>({ok:false,reason:'native_source_unavailable'}),
        completion:async()=>({ok:false,reason:'native_source_unavailable'}),
        dispose:()=>{}
      }),
      // Never counterfeit native authorization.
      authorize:async()=>false,
      validateDecision:async decision=>({
        identityValid:true,internalTranscript:decision.dialogue,actionCount:0
      }),
      failTurn:async()=>{}
    };
    const services={
      config:{providerWorkDeadlineMs:10000,turnDeadlineMs:10000,
        structuredStreamingEnabled:false},
      decide:async()=>{provider.push('reasoning_mock');return {
        dialogue:'No source-authorized memory action.',command:''
      };},
      transcribe:async()=>{provider.push('stt_mock');return text;},
      speak:async ({onPcm})=>{
        provider.push('tts_mock');
        await onPcm(Buffer.from([1,0,2,0]));
        return {bytes:4,chunks:1};
      }
      // Deliberately NO recordM2Player / source-accepted D01 port, no
      // native receipt and no fake journal write through the runner.
    };
    const outcome=await runSequentialTurn({connection,turn,services,history,host});
    assert.equal(accepted.length,1,'actual original runner commits to RAM');
    assert.equal(accepted[0],text,'original runner exact accepted input bytes');
    if(stt)assert.ok(emitted.some(e=>e.type==='input_transcript'&&e.text===text));
    assert.ok(provider.includes('reasoning_mock'));
    assert.ok(provider.includes('tts_mock'));
    assert.notEqual(outcome.status,'completed','unverified native playback MUST fail');
    const rows=await store.readDialogueLines({
      characterId:a.characterId,timelineId,limit:100
    });
    assert.equal(rows.length,0,'no speculative P2 accepted memory without D01/D02');
    if(scenarioId==='S07'){
      store.onBoundary({reason:'clock_regression'});
      assert.equal(store.timelineWritable,false);
    }
    return Object.freeze({scenarioId,blocker:BLOCKERS[scenarioId],
      actualRunnerInvoked:true,p2StoreUsed:true,avatarMetadata:['franklin','michael','trevor'],
      oneHumanPlayer:true,npcIds:[a.characterId,b.characterId],
      utf8Sha256:sha(text),providerMockCalls:provider,
      nativePlaybackVerified:false,originalBackendAccepted:false,
      nativeOwnerVerified:false,durableAcceptedRows:rows.length});
  } finally {await store.close();}
}
export function expectedSourceBlocker(id){return BLOCKERS[id]??null;}
