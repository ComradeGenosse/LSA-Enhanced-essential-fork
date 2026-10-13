// Transport-scoped capability reporting. Configuration does not prove GTA
// operation; every native disconnect revokes any observed activation state.
const TRANSPORT_DEPENDENT = Object.freeze([
  'native_host_ipc', 'native_diagnostics', 'actor_probing',
  'typed_conversation', 'tts', 'physical_audio', 'lip_sync', 'early_speech'
]);

export function createActivationReporter(activation, publish) {
  if (!activation?.valid || typeof publish !== 'function')
    throw new TypeError('activation_reporter_requires_valid_policy');
  let connected = false;
  let suspended = false;
  const latest = new Map();
  const emit = (name, activated = false, operational = 'not_observed', blocked = []) => {
    const entry = activation.capabilities[name];
    if (!entry) throw new Error('unknown_activation_capability');
    // A late provider/PCM callback from a retired transport cannot resurrect
    // operational evidence from that dead native connection.
    const suspended = activated && TRANSPORT_DEPENDENT.includes(name) && !connected;
    if (suspended && operational !== 'router_constructed_no_PCM_evidence' &&
        operational !== 'stream_adapter_loaded_no_segment_evidence') {
      activated = false;
      operational = 'suspended_native_transport';
      blocked = [...blocked, 'native_transport_unavailable'];
    }
    const snapshot = Object.freeze({
      component: 'lsa_standalone', event: 'activation_capability',
      capability: name, configured: entry.requested,
      available: entry.implementationAvailable,
      configurationReady: entry.configurationReady && !blocked.length,
      activated, blocked: [...entry.blockedBy, ...blocked],
      operational, gtaValidated: false,
      evidenceRequired: entry.evidenceRequired
    });
    latest.set(name, snapshot);
    publish(snapshot);
    return snapshot;
  };
  const transportStatus = type => {
    if (type === 'native_connected') {
      connected = true;
      suspended = false;
      emit('native_host_ipc', true, 'pipe_handshake_not_GTA_acceptance');
      // Only registered adapters, NOT actor control or physical GTA effects.
      if (activation.capabilities.typed_conversation.requested)
        emit('typed_conversation', true, 'native_pipe_connected_polling_no_GTA_turn_evidence');
      if (activation.capabilities.tts.requested)
        emit('tts', true, 'router_constructed_no_PCM_evidence');
      if (activation.capabilities.early_speech.requested)
        emit('early_speech', true, 'stream_adapter_loaded_no_segment_evidence');
    } else if (type === 'native_disconnected' || type === 'native_unavailable') {
      connected = false;
      if (suspended) return; // repeated reconnect attempts are not new events
      suspended = true;
      for (const name of TRANSPORT_DEPENDENT)
        if (activation.capabilities[name].requested)
          emit(name, false, 'suspended_native_transport',
            ['native_transport_unavailable']);
    }
  };
  const initialize = () => {
    for (const name of Object.keys(activation.capabilities))
      emit(name, false, activation.capabilities[name].requested
        ? 'configured_awaiting_runtime_evidence' : 'off');
  };
  return Object.freeze({ emit, transportStatus, initialize,
    snapshot: name => latest.get(name) ?? null });
}
