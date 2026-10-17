// W08: source-time PS2 evidence and committed P2 event/sidecar readback.
// Deliberately no store writes, cached authority, network, or PS6 calls.
// K must supply independently sourced synchronous ports. A candidate is NEVER a memory.
import {isUuid, immutableSnapshot} from '../util/identity.mjs';

const sync = (fn,arg) => {
  try {const r=fn(arg);return r && typeof r.then==='function'?null:r;}
  catch{return null;}
};
const nat = n=>Number.isSafeInteger(n)&&n>=0;
const events=new Set(['vehicle_crash','vehicle_rollover','airborne_stunt',
  'vehicle_entered_water','vehicle_submerged','wanted_level_changed','wasted','busted']);
const uuidKeys=(o,keys)=>keys.every(k=>isUuid(o?.[k]));
const same=(a,b,keys)=>keys.every(k=>a?.[k]!==undefined&&a[k]===b?.[k]);
const SOURCE_FIELDS=['nativeRun','hostRunId','worldEpoch','playerCaptureRef'];
const PS2_FIELDS=['candidateEventId','nativeEvidenceId','observerCaptureRef',
  'observationId','witnessReceiptId','hostRunId','worldEpoch','nativeRun'];
const P2_SCOPE=['characterId','worldProfileId','timelineId'];
const OWNER_FIELDS=['hostRunId','worldEpoch','observerCaptureRef','incarnationId','encounterId'];
const reject=reason=>Object.freeze({authorized:false,reason});

export class M9CommittedWitnessAuthority {
  #native;#ps2;#event;#sidecar;
  constructor({readCurrentNativeScope,readSourceTimePs2Witness,
    readCommittedP2Event,readCommittedP2Sidecar}={}) {
    if(![readCurrentNativeScope,readSourceTimePs2Witness,
      readCommittedP2Event,readCommittedP2Sidecar]
      .every(fn=>typeof fn==='function'))
      throw new TypeError('m9_original_source_and_p2_readback_ports_required');
    this.#native=readCurrentNativeScope;
    this.#ps2=readSourceTimePs2Witness;
    this.#event=readCommittedP2Event;
    this.#sidecar=readCommittedP2Sidecar;
  }
  // Supply authorizeWitness: ({candidate,witness}) =>
  //   authority.check({candidate,witness}).authorized === true.
  // readCommittedP2Event/Sidecar MUST query the original P2 SQLite owner.
  check({candidate,witness}={}) {
    if(candidate?.kind!=='m9_candidate'||!events.has(candidate.eventType)||
      !uuidKeys(candidate,['eventId',...SOURCE_FIELDS.filter(k=>k!=='worldEpoch')])||
      !nat(candidate.worldEpoch)||!nat(candidate.gameTick)||
      !nat(candidate.observedAtMonotonicMs)||
      typeof candidate.nativeEvidenceId!=='string'||
      witness?.status!=='witnessed'||witness?.certainty!=='direct'||
      !['self','visual','auditory'].includes(witness.modality)||
      !uuidKeys(witness,['observationId','witnessReceiptId','journalRecordId',
        ...P2_SCOPE,'observerCaptureRef','incarnationId','encounterId'])||
      !same(candidate,witness,['nativeRun','hostRunId','worldEpoch','playerCaptureRef'])||
      witness.candidateEventId!==candidate.eventId||
      !['franklin','michael','trevor','unknown'].includes(witness.protagonistKey))
      return reject('invalid_candidate_or_witness');

    const native=sync(this.#native,Object.freeze({candidate,witness}));
    if(native?.authenticated!==true||native?.current!==true||
      !same(candidate,native,SOURCE_FIELDS)||
      !same(witness,native,['worldProfileId','timelineId','protagonistKey'])||
      native.timelineWritable!==true||
      !nat(native.gameTick)||
      ((native.gameTick-candidate.gameTick)>>>0)>30000||
      native.observerCaptureRef!==witness.observerCaptureRef||
      native.incarnationId!==witness.incarnationId||
      native.encounterId!==witness.encounterId)
      return reject('current_native_scope_unverified');

    const ps2=sync(this.#ps2,Object.freeze({candidate,witness,native}));
    if(ps2?.status!=='witnessed'||ps2?.nativeVerified!==true||
      ps2?.sourceAtObservation?.nativeVerified!==true||
      ps2.sourceAtObservation.gameTick!==candidate.gameTick||
      !same(witness,ps2,PS2_FIELDS)||
      ps2.observedGameTick!==candidate.gameTick||
      ps2.eventType!==candidate.eventType||
      !same(witness,ps2,['incarnationId','encounterId'])||
      !same(witness,ps2.sourceAtObservation,
        ['observerCaptureRef','incarnationId','encounterId','nativeRun',
          'hostRunId','worldEpoch'])||
      ps2.modality!==witness.modality||ps2.certainty!=='direct'||
      ps2.coverage!=='witnessed')
      return reject('ps2_source_time_witness_unverified');

    // Event and sidecar MUST independently read back as committed from the
    // ONE P2 SQLite writer; an enqueued promise or receipt.status=accepted
    // is not a durable memory. Different rows/epochs/profiles cannot join.
    const query=Object.freeze({candidateEventId:candidate.eventId,
      journalRecordId:witness.journalRecordId,observationId:witness.observationId,
      characterId:witness.characterId,worldProfileId:witness.worldProfileId,
      timelineId:witness.timelineId});
    const event=sync(this.#event,query);
    if(event?.kind!=='journal_event'||event.receiptStatus!=='witnessed'||
      event.recordId!==witness.journalRecordId||
      event.observationId!==witness.observationId||
      event.eventType!==candidate.eventType||
      !same(witness,event,P2_SCOPE)||
      !event.ownerProof||
      !same(witness,event.ownerProof,OWNER_FIELDS)||
      event.ownerProof.ownerAlias!=='promoted.'+witness.characterId||
      typeof event.sourceHash!=='string'||!/^[0-9a-f]{64}$/i.test(event.sourceHash)||
      !Array.isArray(event.claims)||!event.claims.some(c=>
        c?.certainty==='direct'&&['self','visual','auditory'].includes(c?.modality)&&
        c.sourceEvidenceId===witness.witnessReceiptId)||
      event.tombstoned===true||event.deleted===true)
      return reject('p2_event_not_committed_or_incorrect');

    const sidecar=sync(this.#sidecar,query);
    if(sidecar?.committed!==true||sidecar?.deleted===true||
      sidecar?.candidateEventId!==candidate.eventId||
      sidecar?.nativeEvidenceId!==candidate.nativeEvidenceId||
      sidecar?.journalRecordId!==event.recordId||
      sidecar?.observationId!==event.observationId||
      sidecar?.witnessReceiptId!==witness.witnessReceiptId||
      sidecar?.sourceHash!==event.sourceHash||
      !same(witness,sidecar,P2_SCOPE)||
      !same(candidate,sidecar,SOURCE_FIELDS)||
      sidecar.eventType!==candidate.eventType||
      sidecar.gameTick!==candidate.gameTick)
      return reject('p2_sidecar_not_committed_or_incorrect');

    // Prevent TOCTOU between the three reads and PS6 proposal admission.
    const after=sync(this.#native,Object.freeze({candidate,witness,stage:'after_p2_readback'}));
    if(after?.authenticated!==true||after.current!==true||
      after.timelineWritable!==true||
      !same(native,after,[...SOURCE_FIELDS,...P2_SCOPE,'protagonistKey',
        'observerCaptureRef','incarnationId','encounterId']))
      return reject('native_scope_changed');
    return Object.freeze({authorized:true,
      receipt:immutableSnapshot({candidateEventId:candidate.eventId,
        journalRecordId:event.recordId,witnessReceiptId:witness.witnessReceiptId,
        observationId:event.observationId,sourceHash:event.sourceHash,
        worldProfileId:witness.worldProfileId,timelineId:witness.timelineId,
        characterId:witness.characterId})});
  }
}
