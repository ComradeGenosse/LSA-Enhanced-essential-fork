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

// Read-only F11 intent eligibility. A validated native hello, explicit capability
// opt-in and all pinned probes are necessary but not proof of world execution.
export function inspectGameplayMenuReadiness(activities, configured={}) {
  const navigation=inspectNavigationReadiness(activities,configured);
  const engine=activities?.engine,config=engine?.config || configured || {};
  const intents=Object.freeze({
    approach_and_face:['approach_person','stop_and_face'],
    board_vehicle:['enter_vehicle_seat'],
    ride_along:['enter_vehicle_seat'],
    exit_vehicle_and_hold:['exit_vehicle','hold_position'],
    leave_scene:['walk_away_from','resume_ambient'],
    take_cover_and_hold:['take_cover'],
    scenario_here:['scenario_here'],
  });
  const inspect=capabilities=>{
    const rows=capabilities.map(id=>engine?.registry?.get(id));
    const enabled=config.mode==='on' && rows.every((row,i)=>row?.phase==='ACT3'
      ? config.act3Capabilities?.includes(capabilities[i])===true
      : row?.phase==='ACT2');
    const valid=rows.every(row=>row && row.execution.path!=='none' &&
      row.allowedSources.includes('player_ux') && row.allowedPriority.includes('player_direct'));
    const nativeAdvertised=capabilities.every(id=>engine?.hello?.capabilities?.[id]===true);
    const missingProbes=[...new Set(rows.flatMap(row=>row?.probes || []))].filter(p=>!config.passedProbes?.includes(p));
    const reason=!enabled?'capability_disabled':!valid?'capability_unavailable':
      !navigation.nativeConnected?'native_unavailable':!nativeAdvertised?'native_capability_missing':
      missingProbes.length?'native_probes_missing':null;
    return Object.freeze({eligibleForPreflight:reason===null,reason,missingProbes});
  };
  return Object.freeze({...navigation,act3:Object.freeze(Object.fromEntries(
    Object.entries(intents).map(([id,capabilities])=>[id,inspect(capabilities)])))});
}
