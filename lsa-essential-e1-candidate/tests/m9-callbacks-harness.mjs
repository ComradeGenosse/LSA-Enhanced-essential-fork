// Callback harness: REAL pipe parser, PS2, M3, P2 SQLite store, M9 events,
// native owner authority, M9 cue/authority/admission and the callbacks runtime.
// Only the PS3 candidate list and the SceneDirectorSpeech coordinator (the
// native C-06/C-11 + stock Essential turn) are stubbed, and the Director's own
// owner-proof read is synthesized from the real observer index.
import {randomUUID} from 'node:crypto';
import {createM9Harness,ALL_ON} from './m9-harness.mjs';
import {memoryKM9Activation} from '../src/memory/m9Activation.mjs';
import {createM9Callbacks} from '../src/memory/m9Callbacks.mjs';
import {createLearnedMemoryPause} from '../src/memory/learnedMemoryPause.mjs';
import {projectPreparedRecall} from '../src/context/knowledgeSelector.mjs';

export const wallOf = ms => Date.UTC(2026,9,13,12,0,0) + ms;
export const crash = (damage = 60,id = randomUUID()) =>
  ({nativeReceiptId:id,sourceType:'damage_tracker_vehicle_collision',damage});

export async function createCallbackHarness(t,{callbackMode = 'on',families = ALL_ON,limits = {},npcCount = 2,
    quiet = true,live = true,...rest} = {}) {
  const h = await createM9Harness(t,{families,npcCount,...rest});
  t.after(() => h.close());
  await h.connect();
  await h.sample(100);
  await h.settle();
  const pause = createLearnedMemoryPause();
  const activation = memoryKM9Activation({memoryK:{capabilities:{...families,'memory.callbacks':callbackMode}}});
  const real = h.client.runtime;
  const runtime = Object.create(real,{
    directorOwnerProofFor:{value:ref => {
      const index = real.observerIndex.get(ref);
      return index?.owned && real.current(ref) ? Object.freeze({hostRunId:h.host.hostRunId,
        worldEpoch:h.host.worldEpoch,speakerCaptureRef:ref,ownerIncarnationId:index.incarnationId,
        proofRevision:1}) : null;
    }},
    directorCandidatesFor:{value:() => []},
  });
  const control = {quiet,live};
  const callbacks = createM9Callbacks({activation,store:pause.optionalStore(h.store),runtime,
    native:h.m3.authority,quiet:() => control.quiet,directorLive:() => control.live,m9Events:h.m9Events,
    pause,now:() => h.clock.ms,wallNow:() => wallOf(h.clock.ms),limits});
  const attempts = [];
  const hooks = {onAttempt:null};
  const coordinator = {originalGrantCurrent:() => true,
    async attempt(input) {
      attempts.push(input);
      return (await hooks.onAttempt?.(input)) ?? {status:'delivered'};
    }};
  const wrapped = callbacks?.wrapDirector(coordinator) ?? coordinator;
  let serial = 0;
  const director = npc => {
    const now = h.clock.ms, observationId = randomUUID(), decisionKey = 'dk-' + (++serial);
    return {candidates:[{
      observation:{observationId,revision:1,observer:{captureRef:npc.ref,kind:'ped'},
        expiresAtMonotonicMs:now + 8000,claims:[{certainty:'supported',evidence:{channel:'visual'}}]},
      decision:{observationId,revision:1,decisionKey,policyVersion:1,response:'eligible',
        expiresAtMonotonicMs:now + 8000},
      situation:{lifetimeCurrent:true,channelHealthy:true,perceptionSupported:true,playerCaptureRef:h.playerRef},
      entitlementCurrent:true,observedAtMonotonicMs:now}],
    facts:{speakerCaptureRef:npc.ref,playerCaptureRef:h.playerRef,nowMonotonicMs:now},
    stamp:{hostRunId:h.host.hostRunId,worldEpoch:h.host.worldEpoch,speakerCaptureRef:npc.ref,
      playerCaptureRef:h.playerRef,ownerIncarnationId:npc.incarnationId,proofRevision:1,
      playerTurnVersion:1,policyVersion:1},decisionKey,observationId};
  };
  const turnFor = (npc,input,{profileOf = npc,persistent = true} = {}) => ({
    identity:{pedId:2000 + h.npcs.indexOf(npc),turnId:'turn-' + serial,generationId:'g1',sessionNonce:'nonce'},
    directorTicket:{speakerCaptureRef:npc.ref,decisionKey:input.decisionKey,observationId:input.observationId},
    characterProjection:{persistent,profile:{characterId:profileOf.characterId,
      promotion:{ownerAlias:profileOf.ownerAlias}}}});
  const recalled = prepared => projectPreparedRecall(prepared?.preparedRecall ?? null);
  // One simulated Director attempt for `npc`. While the (stub) coordinator is
  // "running the turn", the stock turn runner would call prepareForTurn.
  async function runDirector(npc,{turnProfile = npc,prepare = true,before = null,verify = true,sampleBody = {}} = {}) {
    await h.sample(100,sampleBody);await h.settle();       // fresh authenticated sample + leases
    const input = director(npc), result = {input,prepared:null,projected:null,verified:null};
    hooks.onAttempt = async attempt => {
      await before?.(attempt);
      if (!prepare) return {status:'delivered'};
      result.prepared = (await callbacks?.prepareForTurn({
        turn:turnFor(npc,input,{profileOf:turnProfile}),source:'special_event',isCurrent:() => true})) ?? null;
      if (result.prepared && verify) result.verified = await result.prepared.verifyPrepared();
      if (result.prepared) result.projected = recalled(result.prepared);
      return {status:'delivered'};
    };
    const before_ = attempts.length;
    result.outcome = await wrapped.attempt({candidates:input.candidates,facts:input.facts,stamp:input.stamp});
    result.attempted = attempts.length - before_;
    return result;
  }
  const crashFor = async (npc,{receipt = crash()} = {}) => {
    await h.sample(100,tick => ({vehicle:h.vehicleState({collision:receipt}),witnessReceipts:[h.witness(npc,tick)]}));
    await h.settle();
  };
  // Advance simulated native time with owner frames so leases stay current.
  const age = async ms => {await h.advance(ms,{stepMs:1000});};
  return {...h,callbacks,pause,control,coordinator,attempts,hooks,wrapped,director,turnFor,runDirector,
    crashFor,age,activation,runtime,recalled};
}
