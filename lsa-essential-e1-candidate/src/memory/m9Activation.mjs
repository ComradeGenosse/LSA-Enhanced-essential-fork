import {resolveMemoryKCapabilities} from './capabilityPolicy.mjs';
import {memoryKConsumersAllowed} from './runtimeComposition.mjs';

// Startup-only M9 controls. M9 is NEVER legacy-on: an absent request is off,
// so installing this build changes nothing until a family is named explicitly.
// Dependencies describe the source pipeline only. M7 curation, M8
// interpretation and H1 conversation history are deliberately not inputs.
export const M9_EVENT_FAMILIES = Object.freeze({
  'events.crash':Object.freeze(['vehicle_crash']),
  'events.rollover':Object.freeze(['vehicle_rollover']),
  'events.airborne':Object.freeze(['airborne_stunt']),
  'events.water':Object.freeze(['vehicle_entered_water','vehicle_submerged']),
  'events.wanted':Object.freeze(['wanted_level_changed']),
  'events.wasted':Object.freeze(['wasted']),
  'events.busted':Object.freeze(['busted']),
});
export const M9_EVENT_TYPES = Object.freeze(Object.values(M9_EVENT_FAMILIES).flat());

// The legacy bundle (no independent consumer map) already runs PS1/PS2/PS3 and
// the M3 recorder; M9 is additive to it. In an explicit map the operator must
// request the upstream stages, exactly as for every other independent consumer.
const LEGACY_UPSTREAM = Object.freeze({
  'ps1.producers':'on','ps2.observations':'on','ps3.salience':'on',
  'memory.events':'on','ps6.speech':'on',
});

export function memoryKM9Activation(config) {
  const requests = config?.memoryK?.capabilities ?? {};
  const legacy = memoryKConsumersAllowed(config ?? {});
  const effective = legacy ? {...LEGACY_UPSTREAM,...requests} : requests;
  const policy = resolveMemoryKCapabilities({config:{memoryK:{capabilities:effective}}});
  const families = {};
  const modeByEventType = {};
  for (const [id,types] of Object.entries(M9_EVENT_FAMILIES)) {
    const row = policy[id], requestedMode = requests[id] ?? 'off';
    const reason = requestedMode === 'off' ? 'optional_producer_stopped' :
      row.state === 'blocked' || row.state === 'unavailable' ?
        (row.missingDependencies.length ? 'dependency_blocked' : row.reason) : null;
    const mode = reason ? 'off' : requestedMode;
    families[id] = Object.freeze({requestedMode,mode,reason,
      missingDependencies:row.missingDependencies});
    for (const type of types) modeByEventType[type] = mode;
  }
  const cb = policy['memory.callbacks'], cbRequested = requests['memory.callbacks'] ?? 'off';
  const cbReason = cbRequested === 'off' ? 'optional_consumer_stopped' :
    cb.state === 'blocked' || cb.state === 'unavailable' ? 'dependency_blocked' : null;
  const anyEvent = Object.values(families).some(f => f.mode !== 'off');
  const journalMode = effective['memory.events'] ?? 'off';
  return Object.freeze({
    explicit:!legacy,
    requested:Object.values(families).some(f => f.requestedMode !== 'off') || cbRequested !== 'off',
    families:Object.freeze(families),
    modeByEventType:Object.freeze(modeByEventType),
    anyEvent,
    // Whether the M3 recorder will turn accepted M9 observations into rows.
    journalMode,
    callbacks:Object.freeze({requestedMode:cbRequested,mode:cbReason ? 'off' : cbRequested,
      reason:cbReason,missingDependencies:cb.missingDependencies}),
  });
}

// Bounded operational rows for the K diagnostics read model. They report what
// this process has actually observed, never in-game proof: an M9 family is only
// 'operational' after an authenticated native sample has been ingested, and even
// then durable-write and audible-delivery proof stay absent.
export function m9OperationalStates({activation,m9Events=null,callbacks=null,closed=false}={}) {
  if (!activation?.requested && !activation?.anyEvent) return Object.freeze({});
  const snap = m9Events?.snapshot() ?? null;
  const rows = {};
  for (const [id,family] of Object.entries(activation.families)) {
    if (family.requestedMode === 'off') continue;
    const stopped = closed || family.mode === 'off';
    const sampled = (snap?.counters.samples ?? 0) > 0;
    const state = stopped ? 'stopped' : !m9Events ? 'blocked' : sampled ? 'operational' : 'waiting';
    rows[id] = Object.freeze({requestedMode:family.requestedMode,
      effectiveMode:closed ? 'off' : family.mode,state,operationalState:state,
      reason:closed ? 'runtime_stopped' : family.reason ?? (!m9Events ? 'm9_runtime_unavailable' :
        sampled ? null : 'native_m9_sample_not_observed'),
      counters:snap ? Object.freeze({samples:snap.counters.samples,candidates:snap.counters.candidates,
        observations:snap.counters.observations,duplicates:snap.counters.duplicates,
        shadowOnly:snap.counters.shadowOnly,rejected:snap.counters.rejected}) : Object.freeze({}),
      restartRequired:true});
  }
  const cb = activation.callbacks;
  if (cb.requestedMode !== 'off') {
    const c = callbacks?.snapshot() ?? null;
    const stopped = closed || cb.mode === 'off';
    const state = stopped ? 'stopped' : !callbacks ? 'blocked' :
      (c.counters.prepared ?? 0) > 0 ? 'operational' : 'waiting';
    rows['memory.callbacks'] = Object.freeze({requestedMode:cb.requestedMode,
      effectiveMode:closed ? 'off' : cb.mode,state,operationalState:state,
      reason:closed ? 'runtime_stopped' : cb.reason ?? (!callbacks ? 'callbacks_runtime_unavailable' :
        state === 'waiting' ? 'no_callback_prepared_yet' : null),
      counters:c ? Object.freeze({...c.counters}) : Object.freeze({}),restartRequired:true});
  }
  return Object.freeze(rows);
}
