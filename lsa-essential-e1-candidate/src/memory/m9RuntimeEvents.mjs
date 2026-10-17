// Production M9 source intake. This composes the EXISTING classifier and PS2
// bridge; it adds no new event semantics. A candidate is neither a witness
// nor a memory: it is offered to PS2, whose native witness receipts (computed
// at the same sample tick) decide which promoted observers actually saw it,
// and the unchanged M3/P2 path decides whether anything is journaled.
import {M9NativeEventProducer} from '../../../lsa-shared-brain/src/events/m9EventProducers.mjs';
import {M9Ps2CandidateBridge} from '../../../lsa-shared-brain/src/events/m9Ps2CandidateBridge.mjs';
import {M9_EVENT_TYPES} from './m9Activation.mjs';
import {m9SignalId} from '../perception/episodeCorrelator.mjs';

const MAX = 2147483647;
const bump = (target,key,by=1) => {target[key] = Math.min(MAX,(target[key] ?? 0) + by);};

export function createM9RuntimeEvents({activation,now=()=>Math.floor(performance.now())}={}) {
  const modes = activation?.modeByEventType ?? {};
  if (!activation?.anyEvent) return null; // nothing requested or all blocked
  let active = null;
  let lastSampledAtMs = -1;
  let latest = null;
  const listeners = new Set();
  // Signal ids already offered to PS2 in this companion process. Survives
  // reset() (hello/reconnect): the same native receipt re-presented after a
  // reconnect, at a later sample tick, must not create a second observation.
  // The id embeds host run, world epoch, player and evidence, so a new world
  // epoch or host run starts clean on its own.
  const spent = new Set();
  const counters = {samples:0,rejected:0,candidates:0,familyOff:0,shadowOnly:0,
    submitted:0,bridgeRejected:0,ps2Accepted:0,ps2Unqualified:0,observations:0,duplicates:0,faults:0};
  const byType = Object.fromEntries(M9_EVENT_TYPES.map(type => [type,0]));
  const rejectReasons = {};

  const currentHost = rt => rt.hostContext && rt.epoch ? rt.hostContext : null;
  const frameCurrent = (a,snapshotLike) => {
    if (!a || a.done) return false;
    const rt = a.runtime, host = currentHost(rt);
    return !!host && snapshotLike.hostRunId === host.hostRunId &&
      snapshotLike.worldEpoch === host.worldEpoch &&
      (snapshotLike.nativeRun === undefined || snapshotLike.nativeRun === rt.epoch) &&
      rt.anchors.get(snapshotLike.playerCaptureRef)?.kind === 'player' &&
      rt.current(snapshotLike.playerCaptureRef);
  };
  const producer = new M9NativeEventProducer({now,
    // Only the frame currently being ingested, by object identity, from the
    // authenticated pipe path of ShadowRuntime, is ever a native source.
    verifySource:({snapshot,source}) => !!active && active.snapshot === snapshot &&
      active.source === source && frameCurrent(active,snapshot) &&
      (snapshot.vehicleCaptureRef === null ||
        active.runtime.anchors.get(snapshot.vehicleCaptureRef)?.kind === 'vehicle' &&
        active.runtime.current(snapshot.vehicleCaptureRef))});
  const bridge = new M9Ps2CandidateBridge({now,
    verifyNativeCandidate:({candidate,nativeReceipt}) => {
      const a = active;
      if (!a || nativeReceipt !== a.receipt || !frameCurrent(a,candidate) ||
          candidate.playerCaptureRef !== a.payload.playerCaptureRef ||
          candidate.gameTick !== a.payload.sampledGameTick) return false;
      if (candidate.participantCaptureRef !== null &&
          candidate.participantCaptureRef !== a.payload.vehicleCaptureRef &&
          candidate.participantCaptureRef !== a.payload.playerCaptureRef) return false;
      const collision = a.payload.vehicle?.collision?.nativeReceiptId;
      const outcome = a.payload.outcome?.nativeReceiptId;
      if (candidate.eventType === 'vehicle_crash') return candidate.nativeEvidenceId === collision;
      if (candidate.eventType === 'wasted' || candidate.eventType === 'busted')
        return candidate.nativeEvidenceId === outcome && a.payload.outcome?.kind === candidate.eventType;
      return true; // edge events are fenced by the sample tick + monotone sample stream
    },
    submitForPs2Qualification:envelope => {
      const a = active, candidate = a?.candidates.get(envelope.candidateEventId);
      if (!candidate) return null;
      const mode = modes[candidate.eventType] ?? 'off';
      if (mode !== 'on') {bump(counters,'shadowOnly');return {status:'accepted_for_qualification',
        candidateEventId:candidate.eventId,grantsWitness:false,memoryCommitted:false};}
      const signalId = m9SignalId(candidate);
      if (spent.has(signalId)) {
        bump(counters,'replaysBlocked');
        return {status:'accepted_for_qualification',candidateEventId:candidate.eventId,
          grantsWitness:false,memoryCommitted:false};
      }
      spent.add(signalId);
      while (spent.size > 1024) spent.delete(spent.values().next().value);
      const result = a.runtime.acceptM9Candidate({candidate,
        witnessReceipts:a.payload.witnessReceipts,sourceAgeMs:a.payload.ageMs});
      if (result.duplicate) bump(counters,'duplicates');
      else if (result.accepted) {
        bump(counters,'ps2Accepted');
        if (result.observations.length) {
          bump(counters,'observations',result.observations.length);
          // Notification only: a PS2-accepted observation is NOT yet a durable
          // memory. The callback runtime must read P2 back before using it.
          const event = Object.freeze({candidate,signalId:m9SignalId(candidate),
            nativeRun:a.runtime.epoch,
            observations:Object.freeze(result.observations.map(o => Object.freeze({
              observationId:o.observationId,observerCaptureRef:o.observer.captureRef})))});
          for (const listener of listeners) {try {listener(event);} catch {bump(counters,'listenerFaults');}}
        } else bump(counters,'ps2Unqualified'); // unknown coverage, never "did not witness"
      }
      if (!result.accepted) return null;
      return {status:'accepted_for_qualification',candidateEventId:candidate.eventId,
        grantsWitness:false,memoryCommitted:false};
    }});

  return Object.freeze({
    // Called synchronously from ShadowRuntime.ingest after frame authentication
    // and exact host/world/anchor checks. No async work, no SQLite, no model.
    ingest({runtime,payload}) {
      bump(counters,'samples');
      const t = now();
      const sampledAtMs = Math.max(lastSampledAtMs + 1,t - payload.ageMs);
      lastSampledAtMs = sampledAtMs;
      latest = Object.freeze({nativeRun:runtime.epoch,hostRunId:payload.hostRunId,
        worldEpoch:payload.worldEpoch,gameTick:payload.sampledGameTick,
        wantedLevel:payload.wantedLevel,atMs:t});
      const snapshot = {
        nativeRun:runtime.epoch,hostRunId:payload.hostRunId,worldEpoch:payload.worldEpoch,
        playerCaptureRef:payload.playerCaptureRef,vehicleCaptureRef:payload.vehicleCaptureRef,
        gameTick:payload.sampledGameTick,sampledAtMs,wantedLevel:payload.wantedLevel,
        vehicle:payload.vehicle,outcome:payload.outcome};
      const source = {authenticated:true,adapterEpoch:runtime.epoch,hostRunId:payload.hostRunId,
        worldEpoch:payload.worldEpoch,playerCaptureRef:payload.playerCaptureRef};
      const receipt = Object.freeze({gameTick:payload.sampledGameTick});
      active = {runtime,payload,snapshot,source,receipt,candidates:new Map(),done:false};
      try {
        const result = producer.ingest({snapshot,source});
        if (!result.accepted) {
          bump(counters,'rejected');
          bump(rejectReasons,result.reason ?? 'unknown');
          return;
        }
        for (const candidate of result.candidates) {
          bump(counters,'candidates');
          bump(byType,candidate.eventType);
          if ((modes[candidate.eventType] ?? 'off') === 'off') {bump(counters,'familyOff');continue;}
          active.candidates.set(candidate.eventId,candidate);
          const outcome = bridge.submit({candidate,nativeReceipt:receipt});
          if (outcome.accepted) bump(counters,'submitted');
          else bump(counters,'bridgeRejected');
        }
      } catch {
        bump(counters,'faults');
      } finally {
        if (active) active.done = true;
        active = null;
      }
    },
    // Hello, world epoch, disconnect, timeout or any runtime reset.
    reset() {
      producer.reset();bridge.reset();lastSampledAtMs = -1;active = null;latest = null;
    },
    // The newest authenticated sample (never a durable-write proof).
    latestSample:() => latest,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('m9_listener');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot:() => Object.freeze({
      counters:Object.freeze({...counters}),byType:Object.freeze({...byType}),
      rejectReasons:Object.freeze({...rejectReasons}),
      modes:Object.freeze({...modes}),
      // Honest limits: nothing here proves a durable write or an in-game observation.
      durableWriteProof:false,
    }),
  });
}
