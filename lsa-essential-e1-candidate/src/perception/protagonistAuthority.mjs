import { readProtagonistFrame, PROTAGONIST_EVENT, PROTAGONIST_FRESH_MS } from './protagonistProtocol.mjs';

// Standalone EA5 adapter. Only the final integration owner may connect
// acceptAuthenticatedFrame to the PRE-VALIDATED native intelligence pipe.
// getNativeStream must be an independent, trusted snapshot of that actual pipe,
// not values supplied by this frame or by the actor/model/LLM.
export function createProtagonistAuthority({
  getNativeStream, clock=()=>performance.now(), freshMs=PROTAGONIST_FRESH_MS,
}={}) {
  if(typeof getNativeStream!=='function' || typeof clock!=='function' ||
      !Number.isFinite(freshMs) || freshMs<250 || freshMs>3000)
    throw new TypeError('native_protagonist_source_required');
  let current=null, last=null, lastProtagonist=null, acceptedAt=-1, acceptedSequence=0;
  let session=null, host=null, maxRevision=0;

  // An expired proof grants no authority, but authenticated transport lineage
  // must survive the short proof TTL so an ordered native heartbeat can
  // establish a DIFFERENT proof before the 60s channel reset. Only source
  // revocation/mismatch or malformed evidence clears that resumable lineage.
  const drop=()=>{
    current=null;last=null;lastProtagonist=null;acceptedAt=-1;acceptedSequence=0;
  };
  const live=()=>{
    let state,now;
    try {state=getNativeStream();now=clock();} catch {drop();return false;}
    if(!state || state.connected!==true || state.authenticated!==true ||
       !state.sessionToken || state.sessionToken!==session ||
       state.adapterEpoch!==last?.adapterEpoch ||
       state.streamId!==last?.streamId ||
       state.hostRunId!==last?.hostRunId ||
       state.worldEpoch!==last?.worldEpoch ||
       !Number.isSafeInteger(state.lastSequence) ||
       state.lastSequence<acceptedSequence || !Number.isFinite(now) ||
       now<acceptedAt) {drop();return false;}
    if(now-acceptedAt>freshMs) {
      current=null; // expiry revokes the proof, not the native stream lineage
      return false;
    }
    return current!==null;
  };
  return Object.freeze({
    // This is an internal observer, NOT a public IPC parser or an
    // authentication flag. Call only after the existing client has
    // accepted the exact frame on its authenticated ordered connection.
    acceptAuthenticatedFrame(frame) {
      if(frame?.type!==PROTAGONIST_EVENT)return false;
      const payload=readProtagonistFrame(frame);
      let source,now;
      try {source=getNativeStream();now=clock();} catch {drop();return false;}
      if(!payload || !source || source.connected!==true ||
         source.authenticated!==true || !source.sessionToken ||
         source.adapterEpoch!==frame.adapterEpoch ||
         source.streamId!==frame.streamId ||
         source.hostRunId!==payload.hostRunId ||
         source.worldEpoch!==payload.worldEpoch ||
         source.lastSequence!==frame.sequence ||
         !Number.isFinite(now) ||
         (acceptedAt>=0 && now<acceptedAt)) {drop();return false;}
      const lineage=payload.hostRunId;
      // One native host's revisions MUST advance through connection
      // replacement, world epoch and protagonist ABA; never rebase them
      // merely because the companion reconnected to a new stream.
      const sameStream=source.sessionToken===session && last &&
        frame.adapterEpoch===last.adapterEpoch && frame.streamId===last.streamId &&
        payload.hostRunId===last.hostRunId && payload.worldEpoch===last.worldEpoch;
      const heartBeat=host===lineage && sameStream &&
        payload.revision===maxRevision &&
        lastProtagonist===payload.protagonist &&
        frame.sequence>acceptedSequence;
      if(host===lineage && (payload.revision<maxRevision ||
          (payload.revision===maxRevision && !heartBeat))) {drop();return false;}
      if(last && source.sessionToken===session &&
         (frame.adapterEpoch!==last.adapterEpoch ||
          frame.streamId!==last.streamId ||
          frame.sequence<=acceptedSequence)) {drop();return false;}
      // Check the OLD proof's age before updating acceptedAt. A heartbeat within
      // TTL preserves its reference; one after TTL mints a frozen replacement
      // even when no readVerified()/isCurrent() happened during the gap.
      const reuseProof=heartBeat && current!==null && acceptedAt>=0 &&
        now-acceptedAt<=freshMs;
      if(host!==lineage){host=lineage;maxRevision=0;}
      maxRevision=payload.revision;
      session=source.sessionToken;
      acceptedSequence=frame.sequence;
      last=Object.freeze({
        adapterEpoch:frame.adapterEpoch,streamId:frame.streamId,
        hostRunId:payload.hostRunId,worldEpoch:payload.worldEpoch,
      });
      lastProtagonist=payload.protagonist;
      acceptedAt=now;
      // Even valid source-certified UNKNOWN never becomes the last good
      // known protagonist; it actively revokes that record.
      current=payload.protagonist==='unknown'?null:
        reuseProof ? current : Object.freeze({...payload});
      return true;
    },
    readVerified() {if(!current || !live())return null;return current;},
    isCurrent(record) {
      // Reference identity is intentional: matching JSON, a clone, and a
      // revoked Franklin record after Michael->Franklin cannot authenticate.
      return record!==null && record===current && live() && current===record;
    },
    revoke() {drop();},
  });
}
