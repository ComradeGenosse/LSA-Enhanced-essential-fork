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
