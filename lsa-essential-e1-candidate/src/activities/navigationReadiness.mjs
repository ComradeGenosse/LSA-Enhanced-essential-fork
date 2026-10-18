// Read-only ACT6 diagnostics. Configuration and hello are necessary for
// admission, but they are NOT proof of physical GTA navigation success.
export function inspectNavigationReadiness(activities,configured={}) {
  const engine=activities?.engine;
  const config=engine?.config || configured || {};
  const runtime=activities?.client?.runtime;
  const nativeConnected=runtime?.ready===true &&
    engine?.hello?.nativeRun===runtime.nativeRun &&
    engine?.hello?.adapterEpoch===runtime.adapterEpoch;
  const inspect=capability=>{
    const enabled=config.mode==='on' && config.act6Capabilities?.includes(capability)===true;
    const row=engine?.registry?.get(capability);
    const nativeAdvertised=engine?.hello?.capabilities?.[capability]===true;
    const missingProbes=row?.probes?.filter(probe=>!config.passedProbes?.includes(probe)) || [];
    const reason=!enabled?'capability_disabled':
      !row || row.phase!=='ACT6' || row.execution.path==='none' ||
        !row.allowedSources.includes('player_dialogue') || !row.allowedPriority.includes('player_direct')
        ?'capability_unavailable':
      !nativeConnected?'native_unavailable':
      !nativeAdvertised?'native_capability_missing':
      missingProbes.length?'native_probes_missing':null;
    return Object.freeze({enabled,reason,eligibleForPreflight:reason===null,
      nativeAdvertised,requiredProbes:Object.freeze([...(row?.probes || [])]),
      missingProbes:Object.freeze(missingProbes)});
  };
  return Object.freeze({mode:config.mode || 'off',act5SuggestionsEnabled:config.act5===true,
    nativeConnected,drive:inspect('drive_to'),walk:inspect('walk_to')});
}
