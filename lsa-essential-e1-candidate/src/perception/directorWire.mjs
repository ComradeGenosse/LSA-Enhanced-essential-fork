import {isUuid} from '../identity/identityContract.mjs';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const required = Object.freeze([
  'version','type','operation','ticketId','dedupeKey','hostRunId',
  'worldEpoch','speakerCaptureRef','playerCaptureRef','ownerIncarnationId',
  'proofRevision','playerTurnVersion','policyVersion','observationId',
  'observationRevision','decisionKey','ageMs',
]);
const operations = new Set(['reserve','submit','cancel']);

// A separately-versioned *closed* PS6 application request on the existing
// intelligence socket. Never carried in a PS2 factual Signal frame.
export function validateDirectorRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== required.length ||
      !required.every(field=>Object.hasOwn(value,field)) ||
      value.version !== 1 || value.type !== 'director.request' ||
      !operations.has(value.operation) || !isUuid(value.ticketId) ||
      value.dedupeKey !== `ps:${value.ticketId}` ||
      ![value.hostRunId,value.speakerCaptureRef,value.playerCaptureRef,
         value.ownerIncarnationId,value.observationId].every(isUuid) ||
      !positive(value.worldEpoch) || !positive(value.proofRevision) ||
      !integer(value.playerTurnVersion) || value.policyVersion !== 1 ||
      !positive(value.observationRevision) || !integer(value.ageMs) ||
      value.ageMs > 2000 ||
      typeof value.decisionKey !== 'string' || !value.decisionKey.length ||
      value.decisionKey.length > 160 || /[\u0000-\u001f\u007f]/.test(value.decisionKey)) return false;
  return Buffer.byteLength(JSON.stringify(value)) <= 8192;
}

export function serializeDirectorRequest({operation,ticket,proposal,stamp,ageMs}) {
  const value={
    version:1,type:'director.request',operation,
    ticketId:ticket?.ticketId,
    dedupeKey:ticket?.dedupeKey,
    hostRunId:stamp?.hostRunId,worldEpoch:stamp?.worldEpoch,
    speakerCaptureRef:proposal?.speakerCaptureRef,
    playerCaptureRef:proposal?.playerCaptureRef,
    ownerIncarnationId:stamp?.ownerIncarnationId,
    proofRevision:stamp?.proofRevision,
    playerTurnVersion:stamp?.playerTurnVersion,
    policyVersion:proposal?.policyVersion,
    observationId:proposal?.observationId,
    observationRevision:proposal?.observationRevision,
    decisionKey:proposal?.decisionKey,
    ageMs,
  };
  if(!validateDirectorRequest(value))throw new TypeError('director_request_invalid');
  // JSON + LF; native channel independently handles CRLF but never trusts
  // additional fields. No network operation is performed by this serializer.
  return JSON.stringify(value)+'\n';
}


// Distinct one-way original-PS3 producer message, ordered before a Director
// reserve on the SAME native pipe. The native server requires its own recent
// challenge and source signal; a matching request alone cannot grant C-06.
const receiptKeys=Object.freeze([
 'version','type','source','challenge','ticketId','hostRunId','worldEpoch',
 'speakerCaptureRef','playerCaptureRef','ownerIncarnationId','proofRevision',
 'situationRevision','signalId','observationId','observationRevision',
 'decisionKey','policyVersion','ageMs',
]);
export function serializeDirectorPs3Receipt(ticket,proof) {
 const value={
  version:1,type:'director.ps3_receipt',source:proof?.source,
  challenge:proof?.challenge,ticketId:ticket?.ticketId,
  hostRunId:proof?.hostRunId,worldEpoch:proof?.worldEpoch,
  speakerCaptureRef:proof?.speakerCaptureRef,playerCaptureRef:proof?.playerCaptureRef,
  ownerIncarnationId:proof?.ownerIncarnationId,proofRevision:proof?.proofRevision,
  situationRevision:proof?.situationRevision,signalId:proof?.signalId,
  observationId:proof?.observationId,observationRevision:proof?.observationRevision,
  decisionKey:proof?.decisionKey,policyVersion:proof?.policyVersion,
  ageMs:proof?.ageMs,
 };
 if(Object.keys(value).length!==receiptKeys.length ||
    !receiptKeys.every(k=>Object.hasOwn(value,k))||
    value.source!=='original_companion_ps2_ps3' ||
    ![value.challenge,value.ticketId,value.hostRunId,value.speakerCaptureRef,
      value.playerCaptureRef,value.ownerIncarnationId,value.signalId,
      value.observationId].every(isUuid)||
    !positive(value.worldEpoch)||!positive(value.proofRevision)||
    !positive(value.situationRevision)||value.situationRevision>2147483647||
    !positive(value.observationRevision)||value.policyVersion!==1||
    !integer(value.ageMs)||value.ageMs>=2000||
    typeof value.decisionKey!=='string'||!value.decisionKey.length||
    value.decisionKey.length>160||/[\u0000-\u001f\u007f]/.test(value.decisionKey)||
    Buffer.byteLength(JSON.stringify(value))>8192)
    throw new TypeError('original_ps3_receipt_invalid');
 return JSON.stringify(value)+'\n';
}


// Read-only acknowledgement from the exact original Essential backend
// lifecycle/turn-store sampler. It is separate from PS3 grants and from the
// Director request. It does not itself certify synchronized native idle.
const ownerFields=Object.freeze([
  'version','type','source','sourceRun','ticketId','hostRunId',
  'worldEpoch','playerTurnVersion','revision','observationSerial','quiet',
]);
export function serializeDirectorOriginalOwnerReceipt(ticket,stamp,owner) {
  const value={
    version:1,type:'director.original_owner_receipt',
    source:owner?.source,sourceRun:owner?.sourceRun,
    ticketId:ticket?.ticketId,hostRunId:stamp?.hostRunId,
    worldEpoch:stamp?.worldEpoch,playerTurnVersion:stamp?.playerTurnVersion,
    revision:owner?.revision,observationSerial:owner?.observationSerial,
    quiet:owner?.quiet,
  };
  if(Object.keys(value).length!==ownerFields.length ||
     !ownerFields.every(key=>Object.hasOwn(value,key)) ||
     value.source!=='original_essential_backend_lifecycle' ||
     ![value.sourceRun,value.ticketId,value.hostRunId].every(isUuid) ||
     !positive(value.worldEpoch) || !integer(value.playerTurnVersion) ||
     !positive(value.revision) || !positive(value.observationSerial) ||
     value.quiet!==true || owner?.grantsNativeAdmission!==false ||
     owner?.evidence?.source!=='original_essential_server_turn_stores' ||
     owner?.evidence?.quiet!==true ||
     Buffer.byteLength(JSON.stringify(value))>8192)
    throw new TypeError('original_owner_receipt_unverified');
  return JSON.stringify(value)+'\n';
}
