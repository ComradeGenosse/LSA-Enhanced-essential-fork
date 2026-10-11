// EA6 adapter. Only the authenticated C-13 IntelligenceClient subscriptions
// are acceptable sources. This module never manufactures a host epoch or save ID.
// Final integrator wires this at bootstrap before the native stream is started.
export function bindTrustedTimelineSource({store,intelligenceClient}={}) {
  if (!store || typeof store.setVerifiedHostContext !== 'function' ||
      typeof store.onBoundary !== 'function' ||
      typeof intelligenceClient?.subscribeVerifiedHostContext !== 'function' ||
      typeof intelligenceClient?.subscribeWorldBoundary !== 'function')
    throw new Error('authenticated_timeline_source_unavailable');
  let closed=false;
  let lastTrustedHost=null;
  let lastBoundary=null; // same native incarnation must never replay an epoch boundary
  const revoke=(reason='unknown_source')=>{
    lastTrustedHost=null;
    try {store.setVerifiedHostContext(null);} finally {
      store.onBoundary({reason});
    }
  };
  // Listen to post-validation C-13 events only, never raw socket messages or
  // unqualified actor metadata. Unrecognized frame values suspend authority.
  const host=(context)=>{
    if(closed)return;
    try {
      if(context===null){revoke('native_disconnect');return;}
      if(!context || context.hostContextVersion!==1) {
        revoke('unknown_source');return;
      }
      store.setVerifiedHostContext(context);
      lastTrustedHost=Object.freeze({hostRunId:context.hostRunId,worldEpoch:context.worldEpoch});
    } catch {revoke('unknown_source');}
  };
  const boundary=(event)=>{
    if(closed)return;
    const reason=['clock_regression','timeline_change','host_reload','world_epoch',
      'save_fork','native_disconnect','unknown_source','source_change'].includes(event?.reason)
        ? event.reason : 'unknown_source';
    // M1 C-13 publishes the accepted NEW host context before the ordered
    // world_epoch boundary. Preserve ONLY that authenticated new context,
    // never the old epoch or a free-floating boundary payload.
    const qualified=lastTrustedHost && event?.hostRunId===lastTrustedHost.hostRunId &&
      event?.worldEpoch===lastTrustedHost.worldEpoch &&
      Number.isSafeInteger(event?.previousEpoch) && event.previousEpoch>0 &&
      event.worldEpoch===event.previousEpoch+1 &&
      !(lastBoundary?.hostRunId===event.hostRunId &&
        event.worldEpoch<=lastBoundary.worldEpoch);
    if(!qualified || ['native_disconnect','unknown_source','source_change'].includes(reason)){
      revoke(reason==='native_disconnect' ? reason : 'unknown_source');
      return;
    }
    try {
      lastBoundary={hostRunId:event.hostRunId,worldEpoch:event.worldEpoch};
      store.onBoundary({reason});
      // host_reload revokes even the newly published context. Do not
      // reconstruct a C-13 receipt from cached scalars; a subsequent accepted
      // native HELLO is required before the operator may confirm again.
      if (reason==='host_reload') lastTrustedHost=null;
    } catch {revoke('unknown_source');}
  };
  // Both subscriptions are required; roll back partial setup safely.
  let stopHost,stopBoundary;
  try {
    stopHost=intelligenceClient.subscribeVerifiedHostContext(host);
    stopBoundary=intelligenceClient.subscribeWorldBoundary(boundary);
    if(typeof stopHost!=='function' || typeof stopBoundary!=='function')
      throw new Error('authenticated_timeline_source_unavailable');
  } catch (error) {
    try {stopHost?.();} catch {}
    revoke('unknown_source');
    throw error;
  }
  return Object.freeze({
    close(){
      if(closed)return;
      closed=true;
      try{stopHost();}finally{
        try{stopBoundary();}finally{revoke('native_disconnect');}
      }
    },
    // Introspection only: never grants permission and never selects a timeline.
    get status(){return store.timelineSourceStatus;}
  });
}
