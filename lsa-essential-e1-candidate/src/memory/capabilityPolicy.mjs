// Workstream B: descriptive configuration policy only. No optional runtime
// capability is started, stopped, shadowed or revoked by this module.
// In particular, an 'off' request is NOT evidence that legacy wiring is off.
export const MEMORY_K_MODES = Object.freeze(['off', 'shadow', 'on']);

// Edges describe *required capabilities*, not incidental current bootstrap
// coupling. Existing native, P2 and privacy gates remain authoritative.
const rows = [
  { id:'source.core', modes:['on'], kind:'prerequisite', dependencies:[], support:'conditional', reason:'authenticated_source_unavailable' },
  { id:'p2.sqlite', modes:['on'], kind:'prerequisite', dependencies:[], support:'conditional', reason:'sqlite_store_unavailable' },
  { id:'authority.native', modes:['on'], kind:'prerequisite', dependencies:['source.core'], support:'conditional', reason:'native_authority_unavailable' },
  { id:'privacy.core', modes:['on'], kind:'prerequisite', dependencies:['p2.sqlite'], support:'conditional', reason:'mandatory_privacy_unavailable' },
  { id:'ps1.producers', modes:['off','shadow','on'], dependencies:['source.core'], support:'conditional', reason:'producer_runtime_unavailable' },
  { id:'ps2.observations', modes:['off','shadow','on'], dependencies:['source.core'], support:'conditional', reason:'observation_runtime_unavailable' },
  { id:'ps3.salience', modes:['off','shadow','on'], dependencies:['ps2.observations'], support:'conditional', reason:'salience_runtime_unavailable' },
  { id:'ps4.perceived', modes:['off','shadow','on'], dependencies:['source.core'], support:'conditional', reason:'ps4_contributor_unavailable' },
  { id:'ps6.speech', modes:['off','shadow','on'], dependencies:['ps2.observations','ps3.salience'], support:'conditional', reason:'native_speech_admission_unavailable' },
  { id:'memory.dialogue.player', modes:['off','on'], dependencies:['source.core','p2.sqlite','authority.native','privacy.core'], support:'conditional', reason:'accepted_player_capture_unavailable' },
  // D03 recordNpcOutcome refuses d03_no_durable_player_line for this reply.
  { id:'memory.dialogue.npc', modes:['off','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'npc_delivery_capture_unavailable' },
  // PS2 accepts mundane observations without PS3/notability entitlement.
  { id:'memory.events', modes:['off','shadow','on'], dependencies:['ps2.observations','p2.sqlite','authority.native','privacy.core'], support:'conditional', reason:'witnessed_event_intake_unavailable' },
  // Authenticated coverage is independent of positive event journaling.
  { id:'memory.coverage', modes:['off','shadow','on'], dependencies:['source.core','p2.sqlite','authority.native','privacy.core'], support:'conditional', reason:'coverage_tracker_unavailable' },
  { id:'memory.promotionGrace', modes:['off','shadow','on'], dependencies:['memory.events'], support:'absent', reason:'promotion_grace_not_registered' },
  { id:'memory.journalContext', modes:['off','shadow','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'journal_context_unavailable' },
  // These are LIVE turn contributors. Offline retained-data queries are separate.
  { id:'memory.recall', modes:['off','shadow','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'recall_contributor_unavailable' },
  { id:'memory.commands', modes:['off','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'memory_command_dispatch_unavailable' },
  // M6 processes already committed evidence, whether or not M2/M3 intake runs.
  { id:'memory.deterministic', modes:['off','on'], dependencies:['source.core','p2.sqlite','privacy.core'], support:'absent', reason:'production_worker_not_registered' },
  // M7 consumes *existing* authorized queue entries without M6 scheduling.
  { id:'memory.cloudCuration', modes:['off','on'], dependencies:['source.core','p2.sqlite','privacy.core'], support:'absent', reason:'production_worker_not_registered' },
  { id:'memory.interpretation', modes:['off','shadow','on'], dependencies:['p2.sqlite','privacy.core'], support:'conditional', reason:'interpretation_reader_unavailable' },
  { id:'memory.callbacks', modes:['off','shadow','on'], dependencies:['memory.events','ps3.salience','ps4.perceived','ps6.speech'], support:'absent', reason:'production_callback_not_registered' },
  { id:'memory.inspector', modes:['off','on'], dependencies:['p2.sqlite','privacy.core'], support:'absent', reason:'learned_memory_inspector_not_implemented' },
  // M9 source producers are independent of M3 consumer registration.
  { id:'events.rollover', modes:['off','shadow','on'], dependencies:['source.core'], support:'absent', reason:'native_producer_not_in_production_build' },
  { id:'events.wasted', modes:['off','shadow','on'], dependencies:['source.core'], support:'absent', reason:'native_producer_not_in_production_build' },
  { id:'events.busted', modes:['off','shadow','on'], dependencies:['source.core'], support:'absent', reason:'native_producer_not_in_production_build' },
  { id:'ps7.social', modes:['off','shadow','on'], dependencies:['source.core'], support:'absent', reason:'capability_not_implemented' },
];

export const MEMORY_K_CAPABILITIES = Object.freeze(rows.map(row => Object.freeze({
  ...row,
  modes:Object.freeze([...row.modes]),
  dependencies:Object.freeze([...row.dependencies]),
})));
const byId = new Map(MEMORY_K_CAPABILITIES.map(row => [row.id,row]));

export function normalizeMemoryKConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => key !== 'capabilities'))
    throw new TypeError('memoryK supports only capabilities.');
  const requested = value.capabilities ?? {};
  if (!requested || typeof requested !== 'object' || Array.isArray(requested))
    throw new TypeError('memoryK.capabilities must be an object.');
  const normalized = {};
  for (const [id,mode] of Object.entries(requested)) {
    const descriptor = byId.get(id);
    if (!descriptor || descriptor.kind === 'prerequisite')
      throw new TypeError(`memoryK.capabilities contains unsupported capability ${id}.`);
    if (!descriptor.modes.includes(mode))
      throw new TypeError(`memoryK.capabilities.${id} mode is unsupported.`);
    normalized[id] = mode;
  }
  return Object.freeze({capabilities:Object.freeze(normalized)});
}

const registrationStatus = value => value === true || value === 'registered' ? 'registered'
  : value === false || value === 'missing' ? 'missing' : 'unverified';

// Static diagnostics deliberately cannot infer live readiness from a constructor,
// method, stale hostContext, or requested mode. Workstream C must provide a
// verified lifecycle/operation receipt before effectiveMode can be known.
export function resolveMemoryKCapabilities({config = {}, available = {}} = {}) {
  const requests = config.memoryK?.capabilities ?? config.capabilities ?? {};
  const resolved = new Map(), resolving = new Set();
  const resolve = id => {
    if (resolved.has(id)) return resolved.get(id);
    const descriptor = byId.get(id);
    if (!descriptor) throw new TypeError(`Unknown capability dependency: ${id}`);
    if (resolving.has(id)) throw new Error(`Memory K capability dependency cycle at ${id}.`);
    resolving.add(id);
    const prerequisite = descriptor.kind === 'prerequisite';
    const requestedMode = prerequisite ? 'on' : (requests[id] ?? 'off');
    const dependencies = descriptor.dependencies.map(resolve);
    const missingDependencies = dependencies
      .filter(row => row.requestedMode === 'off' || row.implementationStatus === 'absent')
      .map(row => row.id);
    const registration = registrationStatus(available[id]);
    const implementationStatus = descriptor.support === 'absent' ? 'absent' : 'candidate_unverified';
    const requested = requestedMode !== 'off';
    const blockers = [];
    if (requested) {
      if (implementationStatus === 'absent') blockers.push(descriptor.reason);
      for (const dep of missingDependencies) blockers.push(`dependency_not_requested_or_supported:${dep}`);
      if (registration === 'missing') blockers.push(`runtime_seam_missing:${id}`);
      else if (registration === 'unverified') blockers.push(`runtime_registration_unverified:${id}`);
      // Even registered seams do not prove current source, writer or owner health.
      if (descriptor.dependencies.includes('source.core') || id === 'source.core')
        blockers.push('source_freshness_unverified');
      if (descriptor.dependencies.includes('p2.sqlite') || id === 'p2.sqlite')
        blockers.push('sqlite_writer_health_unverified','timeline_confirmation_unverified');
      if (descriptor.dependencies.includes('authority.native') || id === 'authority.native')
        blockers.push('native_owner_proof_unverified');
      if (descriptor.dependencies.includes('privacy.core') || id === 'privacy.core')
        blockers.push('privacy_enforcement_unverified');
      if (id === 'memory.dialogue.player') blockers.push('d01_acceptance_unverified','d03_durable_line_unverified');
      if (id === 'memory.dialogue.npc') blockers.push('d03_reply_to_durable_player_unverified','npc_speech_delivery_unverified');
      if (id === 'memory.events') blockers.push('ps2_accepted_observation_unverified','observation_time_attribution_unverified');
      if (id === 'memory.coverage') blockers.push('native_coverage_sample_unverified');
      if (id === 'memory.deterministic') blockers.push('retained_evidence_eligibility_unverified','replay_cursor_unverified');
      if (id === 'memory.cloudCuration')
        blockers.push('persisted_consent_unverified','authorized_queue_unverified','native_idle_unverified','cloud_budget_unverified');
      if (id === 'ps6.speech') blockers.push('native_director_admission_unverified');
      if (id === 'memory.callbacks') blockers.push('committed_witness_and_ps3_grant_unverified');
      blockers.push('operational_receipt_unverified');
    }
    const state = !requested ? 'not_requested' : implementationStatus === 'absent' ?
      'unavailable' : missingDependencies.length ? 'blocked' : registration === 'missing' ?
      'unavailable' : 'unverified';
    const result = Object.freeze({
      id, requestedMode, requested,
      // There is no runtime switch or lifecycle ownership in Workstream B.
      effectiveMode:null, actualRuntimeState:'unknown', operationalState:'unverified',
      implementationStatus, registrationStatus:registration,
      state, blocked:state === 'blocked', unavailable:state === 'unavailable',
      dependencies:descriptor.dependencies,
      missingDependencies:Object.freeze(missingDependencies),
      blockers:Object.freeze(blockers),
      reason:!requested ? null : blockers[0] ?? 'operational_receipt_unverified',
    });
    resolving.delete(id);
    resolved.set(id,result);
    return result;
  };
  for (const descriptor of MEMORY_K_CAPABILITIES) resolve(descriptor.id);
  return Object.freeze(Object.fromEntries(resolved));
}
