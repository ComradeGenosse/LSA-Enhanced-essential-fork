// Policy and diagnostic inventory only. This module never constructs or starts
// a Memory K worker; production wiring is introduced by later workstreams.

export const MEMORY_K_MODES = Object.freeze(['off', 'shadow', 'on']);

const rows = [
  { id: 'source.core', modes: ['on'], dependencies: [], kind: 'prerequisite', support: 'conditional', reason: 'authenticated_source_unavailable' },
  { id: 'p2.sqlite', modes: ['on'], dependencies: [], kind: 'prerequisite', support: 'conditional', reason: 'sqlite_store_unavailable' },
  { id: 'authority.native', modes: ['on'], dependencies: [], kind: 'prerequisite', support: 'conditional', reason: 'native_authority_unavailable' },
  { id: 'privacy.core', modes: ['on'], dependencies: [], kind: 'prerequisite', support: 'conditional', reason: 'mandatory_privacy_unavailable' },
  { id: 'ps1.producers', modes: ['off', 'shadow', 'on'], dependencies: ['source.core'], support: 'conditional', reason: 'producer_runtime_unavailable' },
  { id: 'ps2.observations', modes: ['off', 'shadow', 'on'], dependencies: ['source.core'], support: 'conditional', reason: 'observation_runtime_unavailable' },
  { id: 'ps3.salience', modes: ['off', 'shadow', 'on'], dependencies: ['ps2.observations'], support: 'conditional', reason: 'salience_runtime_unavailable' },
  { id: 'ps4.perceived', modes: ['off', 'shadow', 'on'], dependencies: ['source.core'], support: 'conditional', reason: 'ps4_contributor_unavailable' },
  { id: 'ps6.speech', modes: ['off', 'shadow', 'on'], dependencies: ['source.core'], support: 'conditional', reason: 'native_speech_admission_unavailable' },
  { id: 'memory.dialogue.player', modes: ['off', 'on'], dependencies: ['source.core', 'p2.sqlite'], support: 'conditional', reason: 'accepted_player_capture_unavailable' },
  { id: 'memory.dialogue.npc', modes: ['off', 'on'], dependencies: ['source.core', 'p2.sqlite'], support: 'conditional', reason: 'npc_delivery_capture_unavailable' },
  { id: 'memory.events', modes: ['off', 'shadow', 'on'], dependencies: ['source.core', 'p2.sqlite'], support: 'conditional', reason: 'witnessed_event_intake_unavailable' },
  { id: 'memory.coverage', modes: ['off', 'shadow', 'on'], dependencies: ['memory.events'], support: 'conditional', reason: 'coverage_tracker_unavailable' },
  { id: 'memory.promotionGrace', modes: ['off', 'shadow', 'on'], dependencies: ['memory.events'], support: 'absent', reason: 'promotion_grace_not_registered' },
  { id: 'memory.journalContext', modes: ['off', 'shadow', 'on'], dependencies: ['memory.dialogue.player'], support: 'conditional', reason: 'journal_context_unavailable' },
  { id: 'memory.recall', modes: ['off', 'shadow', 'on'], dependencies: ['memory.dialogue.player'], support: 'conditional', reason: 'recall_contributor_unavailable' },
  { id: 'memory.commands', modes: ['off', 'on'], dependencies: ['memory.dialogue.player'], support: 'conditional', reason: 'memory_command_dispatch_unavailable' },
  { id: 'memory.deterministic', modes: ['off', 'on'], dependencies: ['p2.sqlite', 'memory.events'], support: 'absent', reason: 'production_worker_not_registered' },
  { id: 'memory.cloudCuration', modes: ['off', 'on'], dependencies: ['p2.sqlite', 'memory.deterministic'], support: 'absent', reason: 'production_worker_not_registered' },
  { id: 'memory.interpretation', modes: ['off', 'shadow', 'on'], dependencies: ['p2.sqlite'], support: 'conditional', reason: 'interpretation_reader_unavailable' },
  { id: 'memory.callbacks', modes: ['off', 'shadow', 'on'], dependencies: ['memory.events', 'ps3.salience', 'ps4.perceived', 'ps6.speech'], support: 'absent', reason: 'production_callback_not_registered' },
  { id: 'memory.inspector', modes: ['off', 'on'], dependencies: ['p2.sqlite'], support: 'absent', reason: 'learned_memory_inspector_not_implemented' },
  { id: 'events.rollover', modes: ['off', 'shadow', 'on'], dependencies: ['source.core', 'memory.events'], support: 'absent', reason: 'native_producer_not_in_production_build' },
  { id: 'events.wasted', modes: ['off', 'shadow', 'on'], dependencies: ['source.core', 'memory.events'], support: 'absent', reason: 'native_producer_not_in_production_build' },
  { id: 'events.busted', modes: ['off', 'shadow', 'on'], dependencies: ['source.core', 'memory.events'], support: 'absent', reason: 'native_producer_not_in_production_build' },
  { id: 'ps7.social', modes: ['off', 'shadow', 'on'], dependencies: ['source.core'], support: 'absent', reason: 'capability_not_implemented' },
];

export const MEMORY_K_CAPABILITIES = Object.freeze(rows.map(row => Object.freeze({
  ...row,
  modes: Object.freeze([...row.modes]),
  dependencies: Object.freeze(row.kind === 'prerequisite' ? [...row.dependencies] : [...new Set([...row.dependencies, 'authority.native', 'privacy.core'])]),
})));
const byId = new Map(MEMORY_K_CAPABILITIES.map(row => [row.id, row]));

export function normalizeMemoryKConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'capabilities')) {
    throw new TypeError('memoryK supports only capabilities.');
  }
  const requested = value.capabilities ?? {};
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new TypeError('memoryK.capabilities must be an object.');
  const normalized = {};
  for (const [id, mode] of Object.entries(requested)) {
    const descriptor = byId.get(id);
    if (!descriptor || descriptor.kind === 'prerequisite') throw new TypeError(`memoryK.capabilities contains unsupported capability ${id}.`);
    if (!descriptor.modes.includes(mode)) throw new TypeError(`memoryK.capabilities.${id} mode is unsupported.`);
    normalized[id] = mode;
  }
  return Object.freeze({ capabilities: Object.freeze(normalized) });
}

/**
 * Resolve requested modes against current, trusted runtime probes.
 * `available[id]` is true only when the named runtime seam is registered and
 * its existing authority/privacy checks are in force; false means unavailable.
 */
export function resolveMemoryKCapabilities({ config = {}, available = {} } = {}) {
  const requests = config.memoryK?.capabilities ?? config.capabilities ?? {};
  const rowsById = new Map();
  const resolving = new Set();
  const resolve = id => {
    if (rowsById.has(id)) return rowsById.get(id);
    const descriptor = byId.get(id);
    if (!descriptor) return null;
    if (resolving.has(id)) throw new Error(`Memory K capability dependency cycle at ${id}.`);
    resolving.add(id);
    const prerequisite = descriptor.kind === 'prerequisite';
    const requestedMode = prerequisite ? 'on' : (requests[id] ?? 'off');
    const dependencyRows = descriptor.dependencies.map(resolve);
    const missingDependencies = dependencyRows.filter(row => !row || !row.enabled).map(row => row?.id ?? 'unknown');
    const probe = available[id];
    let state, reason = null;
    if (requestedMode === 'off') {
      state = 'disabled';
    } else if (descriptor.support === 'absent' || probe === false) {
      state = 'unavailable'; reason = descriptor.reason;
    } else if (missingDependencies.length) {
      state = 'blocked'; reason = `dependency_not_enabled:${missingDependencies.join(',')}`;
    } else if (probe !== true) {
      state = 'blocked'; reason = descriptor.reason;
    } else {
      state = 'enabled';
    }
    const result = Object.freeze({
      id,
      requestedMode,
      effectiveMode: state === 'enabled' ? requestedMode : 'off',
      state,
      requested: requestedMode !== 'off',
      enabled: state === 'enabled',
      blocked: state === 'blocked',
      unavailable: state === 'unavailable',
      dependencies: descriptor.dependencies,
      missingDependencies: Object.freeze(missingDependencies),
      reason,
    });
    resolving.delete(id);
    rowsById.set(id, result);
    return result;
  };
  for (const descriptor of MEMORY_K_CAPABILITIES) resolve(descriptor.id);
  return Object.freeze(Object.fromEntries(rowsById));
}
