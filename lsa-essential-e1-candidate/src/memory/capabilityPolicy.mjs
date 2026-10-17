// Workstream B: descriptive configuration policy only. No optional runtime
// capability is started, stopped, shadowed or revoked by this module.
// In particular, an 'off' request is NOT evidence that legacy wiring is off.
export const MEMORY_K_MODES = Object.freeze(['off', 'shadow', 'on']);

// Edges describe *required capabilities*, not incidental current bootstrap
// coupling. Existing native, P2 and privacy gates remain authoritative.
const rows = [
  { id:'source.core', modes:['on'], kind:'prerequisite', dependencies:[], support:'conditional', reason:'authenticated_source_unavailable' },
  { id:'p2.sqlite', modes:['on'], kind:'prerequisite', dependencies:[], support:'conditional', reason:'sqlite_store_unavailable' },
  // D02 proves current player/owner identity for accepted dialogue; M3 independently
  // verifies source-time witness ownership. Neither is a substitute for the other.
  { id:'authority.d02', modes:['on'], kind:'prerequisite', dependencies:['source.core'], support:'conditional', reason:'d02_owner_authority_unavailable' },
  { id:'authority.witness', modes:['on'], kind:'prerequisite', dependencies:['source.core'], support:'conditional', reason:'m3_witness_authority_unavailable' },
  { id:'privacy.core', modes:['on'], kind:'prerequisite', dependencies:['p2.sqlite'], support:'conditional', reason:'mandatory_privacy_unavailable' },
  { id:'ps1.producers', modes:['off','shadow','on'], dependencies:['source.core'], support:'conditional', reason:'producer_runtime_unavailable' },
  // Accepted PS2 observations require PS1-qualified native signals, not SQLite.
  { id:'ps2.observations', modes:['off','shadow','on'], dependencies:['ps1.producers'], support:'conditional', reason:'observation_runtime_unavailable' },
  { id:'ps3.salience', modes:['off','shadow','on'], dependencies:['ps2.observations'], support:'conditional', reason:'salience_runtime_unavailable' },
  // PS4's single assembler remains mandatory; PERCEIVED is only one optional lane.
  { id:'ps4.assembler', modes:['on'], kind:'prerequisite', dependencies:[], support:'conditional', reason:'sole_ps4_assembler_unavailable' },
  { id:'ps4.perceived', modes:['off','shadow','on'], dependencies:['ps3.salience','ps4.assembler'], support:'conditional', reason:'ps4_perceived_contributor_unavailable' },
  { id:'ps6.speech', modes:['off','shadow','on'], dependencies:['ps2.observations','ps3.salience','ps4.assembler'], support:'conditional', reason:'native_speech_admission_unavailable' },
  { id:'memory.dialogue.player', modes:['off','on'], dependencies:['source.core','p2.sqlite','authority.d02','privacy.core'], support:'conditional', reason:'accepted_player_capture_unavailable' },
  // D03 recordNpcOutcome refuses d03_no_durable_player_line for this reply.
  { id:'memory.dialogue.npc', modes:['off','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'npc_delivery_capture_unavailable' },
  // PS2 accepts mundane observations without PS3/notability entitlement.
  { id:'memory.events', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations','p2.sqlite','authority.witness','privacy.core'], support:'conditional', reason:'witnessed_event_intake_unavailable' },
  // Authenticated coverage is independent of positive event journaling.
  { id:'memory.coverage', modes:['off','shadow','on'], dependencies:['source.core','p2.sqlite','authority.witness','privacy.core'], support:'conditional', reason:'coverage_tracker_unavailable' },
  { id:'memory.promotionGrace', modes:['off','shadow','on'], dependencies:['memory.events'], support:'absent', reason:'promotion_grace_not_registered' },
  { id:'memory.journalContext', modes:['off','shadow','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'journal_context_unavailable' },
  // These are LIVE turn contributors. Offline retained-data queries are separate.
  { id:'memory.recall', modes:['off','shadow','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'recall_contributor_unavailable' },
  { id:'memory.commands', modes:['off','on'], dependencies:['memory.dialogue.player'], support:'conditional', reason:'memory_command_dispatch_unavailable' },
  // M6 processes already committed evidence, whether or not M2/M3 intake runs.
  { id:'memory.deterministic', modes:['off','on'], dependencies:['source.core','p2.sqlite','privacy.core'], support:'conditional', reason:'retention_runtime_unavailable' },
  // M7 consumes *existing* authorized queue entries without M6 scheduling.
  { id:'memory.cloudCuration', modes:['off','on'], dependencies:['source.core','p2.sqlite','privacy.core'], support:'absent', reason:'production_worker_not_registered' },
  // The live reader needs the native-verified accepted-turn identity M2 proves; it
  // needs none of M4/H1/M5/M7.
  { id:'memory.interpretation', modes:['off','shadow','on'], dependencies:['p2.sqlite','privacy.core','memory.dialogue.player'], support:'conditional', reason:'interpretation_reader_unavailable' },
  // Callback admission needs the existing single PS4 assembler, NOT the optional
  // PERCEIVED lane. M3 committed evidence, PS3 grant and PS6 remain required.
  { id:'memory.callbacks', modes:['off','shadow','on'], dependencies:['memory.events','ps3.salience','ps4.assembler','ps6.speech'], support:'conditional', reason:'production_callback_unavailable' },
  { id:'memory.inspector', modes:['off','on'], dependencies:['p2.sqlite','privacy.core'], support:'conditional', reason:'privileged_editor_unavailable' },
  // M9 source producers are independent of M3 consumer registration: each
  // family needs the authenticated native producer and the PS2 correlator, NOT
  // memory.events. Durable journaling additionally needs memory.events=on;
  // with it off/shadow a family is classified (or counted) but never written.
  { id:'events.crash', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
  { id:'events.rollover', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
  { id:'events.airborne', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
  { id:'events.water', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
  { id:'events.wanted', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
  { id:'events.wasted', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
  { id:'events.busted', modes:['off','shadow','on'], dependencies:['ps1.producers','ps2.observations'], support:'conditional', reason:'m9_native_producer_unavailable' },
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
      Object.keys(value).some(key => !['capabilities','profile','pauseLearned','autoResumeSingleTimeline'].includes(key)))
    throw new TypeError('memoryK supports only capabilities, profile, pauseLearned and autoResumeSingleTimeline.');
  if(value.pauseLearned!==undefined&&typeof value.pauseLearned!=='boolean')
    throw new TypeError('memoryK.pauseLearned must be boolean.');
  if(value.autoResumeSingleTimeline!==undefined&&typeof value.autoResumeSingleTimeline!=='boolean')
    throw new TypeError('memoryK.autoResumeSingleTimeline must be boolean.');
  if(value.profile!==undefined&&value.profile!=='storage-only')
    throw new TypeError('memoryK.profile is unsupported.');
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
    if(value.profile==='storage-only'&&id!=='memory.inspector'&&(id.startsWith('memory.')||id.startsWith('events.'))&&mode!=='off')
      throw new TypeError(`memoryK storage-only profile requires ${id} off.`);
    normalized[id] = mode;
  }
  if(value.profile==='storage-only') {
    for(const descriptor of MEMORY_K_CAPABILITIES)
      if((descriptor.id.startsWith('memory.')||descriptor.id.startsWith('events.'))&&descriptor.id!=='memory.inspector') normalized[descriptor.id]='off';
    normalized['memory.inspector']??='off';
  }
  return Object.freeze({...value.profile?{profile:value.profile}:{},
    ...(value.pauseLearned!==undefined?{pauseLearned:value.pauseLearned}:{}),
    ...(value.autoResumeSingleTimeline!==undefined?{autoResumeSingleTimeline:value.autoResumeSingleTimeline}:{}),capabilities:Object.freeze(normalized)});
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
    // On consumers cannot rely on shadow-only upstream previews: these have
    // no production mutation, native admission or model-visible contribution.
    // Shadow consumers can use shadow or on inputs, but neither mode is proof
    // of effective operation (that remains Workstream C's responsibility).
    const missingDependencyRows = dependencies.filter(row =>
      row.requestedMode === 'off' || row.state === 'blocked' ||
      row.state === 'unavailable' ||
      (requestedMode === 'on' && row.requestedMode === 'shadow'));
    const missingDependencies = missingDependencyRows.map(row => row.id);
    const registration = registrationStatus(available[id]);
    const implementationStatus = descriptor.support === 'absent' ? 'absent' : 'candidate_unverified';
    const requested = requestedMode !== 'off';
    const blockers = [];
    if (requested) {
      if (implementationStatus === 'absent') blockers.push(descriptor.reason);
      for (const dep of missingDependencyRows) {
        if (requestedMode === 'on' && dep.requestedMode === 'shadow')
          blockers.push(`dependency_mode_incompatible:${dep.id}:requires_on`);
        if (dep.requestedMode === 'off' || dep.state === 'blocked' || dep.state === 'unavailable')
          blockers.push(`dependency_not_requested_or_available:${dep.id}`);
      }
      if (registration === 'missing') blockers.push(`runtime_seam_missing:${id}`);
      else if (registration === 'unverified') blockers.push(`runtime_registration_unverified:${id}`);
      // Even registered seams do not prove current source, writer or owner health.
      if (descriptor.dependencies.includes('source.core') || id === 'source.core')
        blockers.push('source_freshness_unverified');
      if (descriptor.dependencies.includes('p2.sqlite') || id === 'p2.sqlite')
        blockers.push('sqlite_writer_health_unverified','timeline_confirmation_unverified');
      if (descriptor.dependencies.includes('authority.d02') || id === 'authority.d02')
        blockers.push('native_owner_proof_unverified');
      if (descriptor.dependencies.includes('authority.witness') || id === 'authority.witness')
        blockers.push('native_witness_proof_unverified');
      if (descriptor.dependencies.includes('ps4.assembler') || id === 'ps4.assembler')
        blockers.push('sole_ps4_assembly_unverified');
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
      if (id === 'memory.callbacks') blockers.push('committed_witness_and_ps3_grant_unverified','native_player_priority_and_c06_unverified');
      if (id.startsWith('events.')) blockers.push('m9_native_sample_and_witness_unverified');
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
