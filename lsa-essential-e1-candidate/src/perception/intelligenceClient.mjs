import { captureKnowledgeInputs, assertKnowledgeCurrent } from '../context/knowledgeInputs.mjs';
import net from 'node:net';
import { BOUNDS } from './contracts.mjs';
import { ShadowRuntime } from './shadowRuntime.mjs';
import {DirectorPlaybackRegistry} from './directorPlayback.mjs';
import {serializeDirectorRequest,serializeDirectorPs3Receipt,serializeDirectorOriginalOwnerReceipt,serializeDirectorStockIntake,serializeDirectorOriginalTurnBinding} from './directorWire.mjs';

const COUNTER_MAX = 2147483647;
const counter = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(COUNTER_MAX, value) : 0;

// Scalar-only persistence projection for E4 JSONL telemetry. The richer console
// companion_shadow report remains available, but only explicitly selected
// counters and lifecycle flags cross the persistent telemetry boundary.
export function createCompanionShadowTelemetry(summary = {}) {
  const ps2 = summary?.ps2 && typeof summary.ps2 === 'object' ? summary.ps2 : {};
  const ps3 = summary?.ps3 && typeof summary.ps3 === 'object' ? summary.ps3 : {};
  const reasons = ps3?.reasons && typeof ps3.reasons === 'object' ? ps3.reasons : {};
  const history = summary?.history && typeof summary.history === 'object' ? summary.history : {};
  const resets = summary?.resetReasons && typeof summary.resetReasons === 'object' ? summary.resetReasons : {};
  const drops = summary?.dropReasons && typeof summary.dropReasons === 'object' ? summary.dropReasons : {};
  const damage = summary?.damageCallbacks && typeof summary.damageCallbacks === 'object' ? summary.damageCallbacks : {};
  const native = summary?.nativeDiagnostics && typeof summary.nativeDiagnostics === 'object' ? summary.nativeDiagnostics : {};
  const radioCatalog = summary?.radioCatalog && typeof summary.radioCatalog === 'object' ? summary.radioCatalog : {};
  return Object.freeze({
    anchors: counter(summary.anchors),
    retainedSignals: counter(summary.retainedSignals),
    received: counter(summary.received),
    dropped: counter(summary.dropped),
    stale: counter(summary.stale),
    malformed: counter(summary.malformed),
    duplicate: counter(summary.duplicate),
    gaps: counter(summary.gaps),
    expired: counter(summary.expired),
    resets: counter(summary.resets),
    historyExpired: counter(history.expired),
    historyEvicted: counter(history.evicted),
    historySkipped: counter(history.skipped),
    historyHighWater: counter(history.highWater),
    dropAnchorCapacity: counter(drops.anchorCapacity),
    dropObserverCapacity: counter(drops.observerCapacity),
    resetInitializations: counter(resets.initializations),
    resetDisconnects: counter(resets.disconnects),
    resetFaults: counter(resets.faults),
    resetTimeouts: counter(resets.timeouts),
    resetManual: counter(resets.manual),
    nativeDropped: counter(native.dropped),
    nativeStaleRejected: counter(native.staleRejected),
    pedDamageCallbacks: counter(damage.ped_damage),
    playerDamageCallbacks: counter(damage.player_damage),
    vehicleDamageCallbacks: counter(damage.vehicle_damage),
    ps2Correlated: counter(ps2.correlated),
    ps2Witnessed: counter(ps2.witnessed),
    ps2Duplicates: counter(ps2.duplicates),
    ps2Dropped: counter(ps2.dropped),
    ps3Decisions: counter(ps3.decisions),
    ps3Urgent: counter(ps3.urgent),
    ps3Eligible: counter(ps3.eligible),
    ps3Staged: counter(ps3.staged),
    ps3Suppressed: counter(ps3.suppressed),
    ps3Faults: counter(ps3.faults),
    ps3ReasonSafetySelfDanger: counter(reasons.safetySelfDanger),
    ps3ReasonSafetyPlayerHarm: counter(reasons.safetyPlayerHarm),
    ps3ReasonSafetyNearbyThreat: counter(reasons.safetyNearbyThreat),
    ps3ReasonRepetitionSuppressed: counter(reasons.repetitionSuppressed),
    ps3ReasonRevisionStale: counter(reasons.revisionStale),
    ps3ReasonNoveltyEscalation: counter(reasons.noveltyEscalation),
    ps3ReasonSuppressionCapacity: counter(reasons.suppressionCapacity),
    radioUnknownTextIds: counter(radioCatalog.unknownTextIds),
    radioCatalogMismatches: counter(radioCatalog.catalogMismatches),
    finalSnapshot: summary.finalSnapshot === true,
  });
}

// Fixed same-user native factual endpoint; no actor integration blocks or commands.
export class IntelligenceClient {
  subscribeKnowledgeInvalidation(listener) {
    if(typeof listener!=='function' || this.knowledgeListeners.size>=32)throw new Error('knowledge_listener_capacity');
    this.knowledgeListeners.add(listener);return ()=>this.knowledgeListeners.delete(listener);
  }
  notifyKnowledgeInvalidation() {for(const listener of [...this.knowledgeListeners])try{listener();}catch{}}

  captureKnowledgeInputs(input) {return captureKnowledgeInputs({...input,perception:this.runtime});}
  assertKnowledgeCurrent(inputs) {return assertKnowledgeCurrent(inputs,this.runtime);}
  acceptPlayerTranscript(input) {return this.runtime.acceptPlayerTranscript(input);}
  // Preview-only in v1.0's unaccepted native stage: no PS6 decisions are
  // selected here and the native preview endpoint cannot admit Essential turns.
  // Future admitted requests MUST use the same closed v1 encoder.
  sendDirectorPreview(args) {
    if(this.closed || this.runtime.directorRequestVersion!==1 ||
        !this.socket || this.socket.destroyed || !this.socket.writable ||
        this.socket.writableLength>BOUNDS.frameBytes) return false;
    try {
      const line=serializeDirectorRequest(args);
      if(Buffer.byteLength(line)>BOUNDS.frameBytes)return false;
      this.socket.write(line);return true; // Queued, NOT accepted by native; await exact receipt.
    }catch{return false;}
  }

  // Real companion PS2/PS3 source reader for the existing Director
  // coordinator. Never trust entitlementCurrent or a request's copied
  // observation/grant IDs as proof. Channel, epoch and negotiated native
  // Director protocol must be current; this is NOT native authorization.
  directorOriginalEntitlement(proposal,stamp) {
    if(this.closed || this.config.mode!=='shadow' ||
       !this.socket || this.socket.destroyed || !this.socket.writable ||
       this.runtime.directorRequestVersion!==1 || !this.runtime.epoch)return null;
    try{return this.runtime.directorOriginalEntitlementFor(proposal,stamp);}
    catch{return null;}
  }

  // A genuine PS3-ledger read produces this sideband only on the negotiated
  // existing user-ACL PS pipe. It cannot stand in for native signal/challenge
  // verification or native C-06, and never invokes Essential/kb.
  sendDirectorPs3Receipt(ticket,original) {
    if(this.closed || this.config.mode!=='shadow' ||
       this.runtime.directorRequestVersion!==1 || !this.runtime.epoch ||
       !this.socket || this.socket.destroyed || !this.socket.writable ||
       this.socket.writableLength>BOUNDS.frameBytes)return false;
    try {
      const line=serializeDirectorPs3Receipt(ticket,original);
      if(Buffer.byteLength(line)>BOUNDS.frameBytes)return false;
      this.socket.write(line);return true;
    }catch{return false;}
  }

  // Original stock backend turn stores are independently observed; a
  // synchronous quiet snapshot can only suppress a busy candidate here.
  // It is NOT a source-versioned native Core player/Essential idle receipt.
  originalBackendEvidence(source) {
    let state=source;
    if(state===undefined)try {state=this.originalTurnPriority();}catch{return null;}
    return state?.schemaVersion===1 &&
      state.source==='original_essential_backend_lifecycle' &&
      typeof state.sourceRun==='string' &&
      Number.isSafeInteger(state.revision) && state.revision>0 &&
      Number.isSafeInteger(state.observationSerial) && state.observationSerial>0 &&
      state.evidence?.source==='original_essential_server_turn_stores' &&
      state.evidence.quiet===true && state.quiet===true &&
      state.grantsNativeAdmission===false ? state : null;
  }
  originalBackendQuiet() {return this.originalBackendEvidence()!==null;}
  // Same authenticated PS pipe, strictly ordered before the matching
  // native reserve/submit. No sender-provided idle boolean is sufficient:
  // the bounded original store sample and lifecycle epoch are mandatory.
  sendDirectorOwnerReceipt(ticket,stamp,source) {
    if(this.closed || !this.socket || this.socket.destroyed ||
       !this.socket.writable || this.socket.writableLength>BOUNDS.frameBytes)
      return false;
    try {
      const message=serializeDirectorOriginalOwnerReceipt(ticket,stamp,source);
      if(Buffer.byteLength(message)>BOUNDS.frameBytes)return false;
      this.socket.write(message);return true;
    }catch{return false;}
  }

  // One outstanding native request per exact ticket; no implicit retries.
  // Negative/late/ambiguous receipts never become Essential authorization.
  requestDirector(args,{timeoutMs=900}={}) {
    const ticketId=args?.ticket?.ticketId;
    // Release local source authority even if native cancel cannot be sent.
    // A rejected reserve must not block every subsequent Director attempt.
    if(args?.operation==='cancel' && typeof ticketId==='string') {
      this.directorOwnerReservations.delete(ticketId);
      this.directorNativeSubmitted.delete(ticketId);
      this.directorStockDispatched.delete(ticketId);
      this.directorStockContexts.delete(ticketId);
      this.directorStockClaims.delete(ticketId);
      this.directorPlaybacks.clear(ticketId);
      try {this.originalTurnRelease(ticketId);}catch{}
    }
    // Every reserve/submit must re-read the original companion ledger as an
    // independent source. Cancel remains available after grant expiration so
    // a previously reserved native ticket can always be retired.
    const original=args?.operation==='cancel'?null:
      this.directorOriginalEntitlement(args?.proposal,args?.stamp);
    // The stock backend's single JS event loop owns this lease. It is
    // sampled synchronously at each original C-11 stage, and a mic/text/
    // session/terminal transition irrevocably retires its ticket before
    // a new quiet snapshot could re-authorize it.
    let owner=null;
    if(args?.operation!=='cancel') {
      try {
        const originalLease=args.operation==='reserve' ?
          this.originalTurnReserve(ticketId) :
          args.operation==='submit' ? this.originalTurnCurrent(ticketId) : null;
        owner=this.originalBackendEvidence(originalLease);
      }catch{owner=null;}
    }
    if(args?.operation!=='cancel' && (!original || !owner))
      return Promise.resolve(null);
    // The coordinator's ageMs starts at Director selection, not at the
    // witnessed event. Native PS3 admission compares against the original
    // PS2 observation age sealed in the one-use producer receipt. Reuse
    // that independently checked source age for this exact request so
    // the two ordered frames cannot falsely report grant_age_regressed.
    // Do not change cancellation or relax native age/expiry validation.
    const nativeArgs=args.operation==='cancel'?args:
      {...args,ageMs:original.ageMs};
    const prior=this.directorOwnerReservations.get(ticketId);
    // A newly observed source revision after reserve is a player/Essential
    // takeover, even if its final state is quiet again. It cannot be
    // silently rebased at submit.
    if(args?.operation==='submit' &&
       (!prior || prior.run!==owner.sourceRun || prior.revision!==owner.revision))
      return Promise.resolve(null);
    if(typeof ticketId!=='string' || !Number.isSafeInteger(timeoutMs) ||
       timeoutMs<1 || timeoutMs>1500 || this.directorPending.size>=32 ||
       this.directorPending.has(ticketId)) return Promise.resolve(null);
    return new Promise(resolve=>{
      const finish=value=>{
        const entry=this.directorPending.get(ticketId);
        if(!entry || entry.resolve!==finish)return;
        this.directorPending.delete(ticketId);
        clearTimeout(entry.timeout);
        resolve(value);
      };
      const timeout=setTimeout(()=>finish(null),timeoutMs);
      timeout.unref?.();
      this.directorPending.set(ticketId,{resolve:finish,timeout,operation:args.operation});
      // Native consumes these FIFO on its owner fiber: a source-backed PS3
      // receipt BEFORE reserve; submit reuses only the sealed original grant.
      // If the original native source proof is missing, nothing is sent.
      if(args.operation!=='cancel' &&
         !this.sendDirectorOwnerReceipt(args.ticket,args.stamp,owner)) {
        finish(null);return;
      }
      if(args.operation==='reserve' && !this.sendDirectorPs3Receipt(args.ticket,original)) {
        finish(null);return;
      }
      if(!this.sendDirectorPreview(nativeArgs)) {finish(null);return;}
      if(args.operation==='reserve')this.directorOwnerReservations.set(ticketId,
        {run:owner.sourceRun,revision:owner.revision,stamp:args.stamp,
         proposal:args.proposal,priority:args.ticket.priority});
    });
  }
  // Bounded 3A intake for a *previously native-submitted* ticket only.
  // Returns true for bytes queued on the pipe, never for stock scheduling
  // success or playback. No implicit retries. #3B will consume callbacks.
  sendDirectorStockIntake(ticket,context) {
    const id=ticket?.ticketId,record=this.directorOwnerReservations.get(id);
    if(this.closed || this.config.mode!=='shadow' ||
       this.runtime.directorRequestVersion!==1 || !this.runtime.epoch ||
       !this.directorNativeSubmitted.has(id) || !record ||
       ticket.dedupeKey!==`ps:${id}` ||
       !this.directorOriginalEntitlement(record.proposal,record.stamp)) {
      this.handoff('stock_intake','rejected','missing_source_or_submission');
      return false;
    }
    let current;
    try {current=this.originalBackendEvidence(this.originalTurnCurrent(id));}
    catch{this.handoff('stock_intake','rejected','backend_read_failed');return false;}
    if(!current || current.sourceRun!==record.run ||
       current.revision!==record.revision) {
      this.handoff('stock_intake','rejected','backend_revision_mismatch');return false;
    }
    let line;
    try {line=serializeDirectorStockIntake(ticket,context);}
    catch{this.handoff('stock_intake','rejected','invalid_wire_context');return false;}
    // One shot is spent before any writable checks or sends.
    this.directorNativeSubmitted.delete(id);
    if(!this.sendDirectorOwnerReceipt(ticket,record.stamp,current) ||
       !this.socket || this.socket.destroyed || !this.socket.writable ||
       this.socket.writableLength>BOUNDS.frameBytes) {
      this.handoff('stock_intake','rejected','owner_receipt_or_pipe_unavailable');return false;
    }
    try {
      this.socket.write(line);
      this.directorStockDispatched.add(id);
      this.directorStockContexts.set(id,context);
      this.handoff('stock_intake','accepted','queued_on_pipe');
      return true;
    }catch{
      this.handoff('stock_intake','rejected','pipe_write_failed');return false;
    }
  }
  // The stock kb payload itself is UNTRUSTED. Match an exact content/Ped
  // invocation to a locally retained native-submitted AND subsequently
  // dispatched ticket on the original companion's authenticated PS channel.
  // Never claim on the basis of a ps: key or reason alone.
  claimDirectorStockTicket(input) {
    if(!input || Object.prototype.hasOwnProperty.call(input,'directorTicket') ||
       input.reason!=='ps6_observer' || input.faceListener===true ||
       input.interruptExisting===true || typeof input.dedupeKey!=='string' ||
       !/^ps:[0-9a-f-]{36}$/.test(input.dedupeKey) ||
       typeof input.speakerPedId!=='string' || !input.speakerPedId.trim() ||
       typeof input.listenerPedId!=='string' || !input.listenerPedId.trim() ||
       input.speakerPedId===input.listenerPedId)return null;
    const id=input.dedupeKey.slice(3);
    const record=this.directorOwnerReservations.get(id);
    if(this.closed || this.config.mode!=='shadow' ||
       !this.runtime.epoch || !record ||
       !this.directorStockDispatched.has(id) ||
       this.directorStockContexts.get(id)!==input.content ||
       !this.runtime.current(record.proposal.speakerCaptureRef) ||
       !this.runtime.current(record.proposal.playerCaptureRef) ||
       !this.directorOriginalEntitlement(record.proposal,record.stamp))return null;
    let proof;
    try {proof=this.originalBackendEvidence(this.originalTurnCurrent(id));}
    catch{return null;}
    if(!proof || proof.sourceRun!==record.run ||
       proof.revision!==record.revision)return null;
    const ticket=Object.freeze({
      schemaVersion:1,ticketId:id,dedupeKey:input.dedupeKey,
      hostRunId:record.stamp.hostRunId,worldEpoch:record.stamp.worldEpoch,
      ownerIncarnationId:record.stamp.ownerIncarnationId,
      proofRevision:record.stamp.proofRevision,
      playerTurnVersion:record.stamp.playerTurnVersion,
      speakerCaptureRef:record.proposal.speakerCaptureRef,
      playerCaptureRef:record.proposal.playerCaptureRef,
      observationId:record.proposal.observationId,
      observationRevision:record.proposal.observationRevision,
      decisionKey:record.proposal.decisionKey,
      policyVersion:record.proposal.policyVersion,
      priority:record.priority,
      sourceRun:record.run,sourceRevision:record.revision,
    });
    this.directorStockDispatched.delete(id);
    this.directorStockContexts.delete(id);
    this.directorStockClaims.set(id,{ticket,input,record,pedId:input.speakerPedId,playerId:input.listenerPedId});
    return ticket;
  }
  // Native/PS3 authority was already established. Hydration must remain on
  // the SAME stock call, with the originally captured actor/player, and a
  // source lease that has not been rebased by intervening player activity.
  verifyDirectorTicket(ticket,input,hydrated) {
    const claim=this.directorStockClaims.get(ticket?.ticketId);
    if(!claim || claim.ticket!==ticket || claim.input!==input || !this.runtime.epoch) {
      this.handoff('post_hydration','rejected','claim_or_epoch_missing');return false;
    }
    if(!this.runtime.current(claim.record.proposal.speakerCaptureRef) ||
       !this.runtime.current(claim.record.proposal.playerCaptureRef)) {
      this.handoff('post_hydration','rejected','actor_or_player_retired');return false;
    }
    if(String(hydrated?.actorContext?.pedId||'')!==claim.pedId ||
       String(hydrated?.targetContext?.pedId||'')!==claim.playerId) {
      this.handoff('post_hydration','rejected','hydrated_ped_mismatch');return false;
    }
    if(!this.directorOriginalEntitlement(claim.record.proposal,claim.record.stamp)) {
      this.handoff('post_hydration','rejected','original_grant_expired');return false;
    }
    let current;
    try {current=this.originalBackendEvidence(this.originalTurnCurrent(ticket.ticketId));}
    catch{this.handoff('post_hydration','rejected','backend_read_failed');return false;}
    // On a warm actor session, kb goes directly from special_dispatch to
    // Xi; on the first encounter its stock Zi->WP session_open happens
    // before Xi. Require the exact phase AND source revision for either
    // original lifecycle path, never an arbitrary new quiet snapshot.
    const phase=this.originalTurnPhase(ticket.ticketId);
    const expectedAdvance=phase==='dispatch'?1:phase==='session'?2:null;
    if(!current || current.sourceRun!==claim.record.run) {
      this.handoff('post_hydration','rejected','backend_source_mismatch');return false;
    }
    if(expectedAdvance===null) {
      this.handoff('post_hydration','rejected','unexpected_stock_phase');return false;
    }
    if(current.revision!==claim.record.revision+expectedAdvance) {
      this.handoff('post_hydration','rejected','backend_revision_mismatch');return false;
    }
    return true;
  }
  // Called only from the actual source-pinned Xn generation path, after the
  // stock kb ticket was independently hydrated. Never acknowledges playback.
  // Native separately compares the original source incarnation and retained
  // speaker/player anchor before it binds once on the native owner fiber.
  // The source Core kb path is the only place these hydration/publication
  // hooks run. A coordinator-side early callback cannot substitute for them.
  confirmDirectorHydration(ticket) {
    if(!this.directorProductionRequired)return true;
    // requireDirectorTicket called verifyDirectorTicket on this same frozen
    // kb claim before reaching here. Recheck its exact retained reference:
    // no copied ticket, arbitrary ps: key or latest conversation target can
    // become the owner of an already reserved Director playback.
    const claimed=this.directorStockClaims.get(ticket?.ticketId);
    if(claimed?.ticket!==ticket ||
       !this.directorPlaybacks.registerVerifiedClaim(ticket)) {
      this.handoff('post_hydration','rejected','playback_ticket_identity_mismatch');
      return false;
    }
    return this.directorPlaybacks.hydration(ticket);
  }
  // OpenAI snapshots the source-verified kb claim, rather than retaining
  // its JS reference. A matching native-bound turn tuple is also mandatory.
  failDirectorOriginalTurn(ticket,identity) {
    const failed=this.directorPlaybacks.failVerifiedTurn(ticket,identity);
    if(failed)this.handoff('binding_wait','failed','original_turn_failed');
    return failed;
  }
  async dispatchDirector({ticket,gates,eventContext}) {
    const original=this.directorPlaybacks.begin(ticket,gates);
    if(!original){this.handoff('binding_wait','rejected','playback_slot_unavailable');return null;}
    if(!this.sendDirectorStockIntake(ticket,eventContext)) {
      this.directorPlaybacks.clear(ticket.ticketId);return null;
    }
    const result=await original.bound;
    if(!result){this.directorPlaybacks.clear(ticket.ticketId);return null;}
    return result;
  }
  sendDirectorOriginalTurnBinding(ticket,identity) {
    const id=ticket?.ticketId,record=this.directorOwnerReservations.get(id);
    const claimed=this.directorStockClaims.get(id);
    if(this.closed || this.config.mode!=='shadow' ||
       !this.runtime.epoch || claimed?.ticket!==ticket ||
       this.originalTurnPhase(id)!=='generation' ||
       !record || ticket.dedupeKey!==`ps:${id}` ||
       !this.directorOriginalEntitlement(record.proposal,record.stamp) ||
       !this.socket || this.socket.destroyed || !this.socket.writable ||
       this.socket.writableLength>BOUNDS.frameBytes) {
      this.handoff('binding_emit','rejected','source_phase_or_pipe_denied');return false;
    }
    let line;
    try {
      line=serializeDirectorOriginalTurnBinding({
        ticketId:id,sourceRun:record.run,sourceRevision:record.revision,
        hostRunId:record.stamp.hostRunId,worldEpoch:record.stamp.worldEpoch,
        speakerCaptureRef:record.proposal.speakerCaptureRef,
      },identity);
    }catch{this.handoff('binding_emit','rejected','binding_encoding_failed');return false;}
    if(Buffer.byteLength(line)>BOUNDS.frameBytes) {
      this.handoff('binding_emit','rejected','binding_frame_oversize');return false;
    }
    // The original source cannot consume a queued wire write as permission.
    // A separate, exact ticket-bound native response resolves this waiter.
    // The timeout covers a missed/late native drain without a model call.
    if(this.directorBindingPending.has(id) || this.directorProductionRequired && !this.directorPlaybacks.identify(ticket,identity)) {
      this.handoff('binding_emit','rejected','identity_or_pending_conflict');return false;
    }
    let finish;
    const result=new Promise(resolve=>{
      finish=accepted=>{
        const current=this.directorBindingPending.get(id);
        if(!current || current.finish!==finish)return;
        clearTimeout(current.timeout);
        resolve(accepted===true);
      };
    });
    const timeout=setTimeout(()=>{
      this.handoff('binding_ack','timeout','native_ack_timeout');
      finish(false);
    },900);
    timeout.unref?.();
    this.directorBindingPending.set(id,{ticket,finish,timeout,result});
    this.directorStockClaims.delete(id); // no retry or identity reassignment
    try {
      this.socket.write(line);
      this.handoff('binding_emit','accepted','queued_on_pipe');return true;
    }catch{
      this.handoff('binding_emit','rejected','pipe_write_failed');
      finish(false);return false;
    }
  }
  async awaitDirectorNativeBinding(ticket) {
    const id=ticket?.ticketId,pending=this.directorBindingPending.get(id);
    if(!pending || pending.ticket!==ticket) {
      this.handoff('binding_ack','rejected','binding_waiter_missing');return false;
    }
    try {
      const accepted=await pending.result===true;
      if(!accepted)return false;
      const published=!this.directorProductionRequired || this.directorPlaybacks.publication(ticket);
      this.handoff('binding_ack',published?'accepted':'rejected',
        published?'generation_published':'publication_gate_denied');
      return published;
    }
    finally {
      if(this.directorBindingPending.get(id)===pending)this.directorBindingPending.delete(id);
    }
  }
  acceptDirectorResponse(payload) {
    if(!payload || this.runtime.directorRequestVersion!==1)return false;
    if(['started','completed','failed'].includes(payload.status))
      return this.directorPlaybacks.onNativeStatus(payload.ticketId,payload.status);
    const nativeBinding=this.directorBindingPending.get(payload.ticketId);
    if(nativeBinding && (payload.status==='bound'||payload.status==='unsafe')) {
      this.handoff('binding_ack',payload.status==='bound'?'accepted':'rejected',
        payload.status==='bound'?'native_bound':'native_binding_denied');
      nativeBinding.finish(payload.status==='bound');
      return true;
    }
    const pending=this.directorPending.get(payload.ticketId);
    if(!pending)return false;
    const allowed={
      reserve:['reserved','busy','invalid','unsafe','stale'],
      submit:['submitted','busy','invalid','unsafe','stale'],
      cancel:['cancelled','not_found','invalid','unsafe','stale'],
    }[pending.operation];
    if(pending.operation==='submit' && payload.status==='submitted')
      this.directorNativeSubmitted.add(payload.ticketId);
    pending.resolve(allowed?.includes(payload.status) ?
      Object.freeze({ticketId:payload.ticketId,status:payload.status}) : null);
    return true;
  }
  cancelDirectorRequests() {
    this.directorPlaybacks.reset();
    for(const item of [...this.directorPending.values()])item.resolve(null);
    for(const item of [...this.directorBindingPending.values()])item.finish(false);
    this.directorBindingPending.clear();
    for(const ticketId of this.directorOwnerReservations.keys())
      try {this.originalTurnRelease(ticketId);}catch{}
    this.directorOwnerReservations.clear();this.directorNativeSubmitted.clear();this.directorStockDispatched.clear();this.directorStockContexts.clear();this.directorStockClaims.clear();
  }

  constructor(config,{connect=options=>net.createConnection(options),directorProductionRequired=false,now,situationFor,radioCatalog,originalTurnPriority=()=>null,originalTurnReserve=()=>null,originalTurnCurrent=()=>null,originalTurnRelease=()=>false,originalTurnPhase=()=>null,report=summary=>console.info('[PS] companion_shadow '+JSON.stringify(summary)),telemetry=()=>{}}={}) {
    this.knowledgeListeners=new Set();this.config=config;this.connect=connect;this.runtime=new ShadowRuntime({mode:config.mode,radio:config.radio,radioCatalog,now,situationFor});this.report=report;this.telemetry=telemetry;this.originalTurnPriority=typeof originalTurnPriority==='function'?originalTurnPriority:()=>null;
    this.originalTurnReserve=typeof originalTurnReserve==='function'?originalTurnReserve:()=>null;
    this.originalTurnCurrent=typeof originalTurnCurrent==='function'?originalTurnCurrent:()=>null;
    this.originalTurnRelease=typeof originalTurnRelease==='function'?originalTurnRelease:()=>false;
    this.originalTurnPhase=typeof originalTurnPhase==='function'?originalTurnPhase:()=>null;
    this.directorProductionRequired=directorProductionRequired===true;
    this.directorPlaybacks=new DirectorPlaybackRegistry({
      onTimeout:code=>this.handoff('binding_wait','timeout',code),
    });
    this.closed=false;this.socket=null;this.lastReport=0;this.frameRejections=new Map();this.directorPending=new Map();this.directorOwnerReservations=new Map();this.directorNativeSubmitted=new Set();this.directorStockDispatched=new Set();this.directorStockContexts=new Map();this.directorStockClaims=new Map();this.directorBindingPending=new Map();
  }
  persist(event,data={}) { try { this.telemetry(event,data); } catch {} }
  handoff(stage,status,code) {
    // Fixed diagnostic strings only. Never persist the private ticket, actor,
    // source observation, model prompt or native identifiers.
    this.persist('director_handoff',{stage,status,code});
  }
  summary(finalSnapshot=false) {
    const diagnostics=this.runtime.diagnostics;
    return {
      anchors:this.runtime.anchors.size,
      retainedSignals:this.runtime.signals.length,
      ...this.runtime.counters,
      history:{...this.runtime.historyDiagnostics},
      dropReasons:{...this.runtime.dropDiagnostics},
      resetReasons:{...this.runtime.resetDiagnostics},
      nativeDiagnostics:{dropped:diagnostics?.dropped??0,staleRejected:diagnostics?.staleRejected??0},
      capabilities:this.runtime.capabilities,
      damageCallbacks:diagnostics?.damageCallbacks??{ped_damage:0,player_damage:0,vehicle_damage:0},
      ps2:{...this.runtime.ps2Diagnostics,playerSpeechGate:diagnostics?.playerSpeechGate??'unsupported_capture_receipt',speech:this.runtime.transcripts.diagnostics},
      ps3:{...this.runtime.ps3Diagnostics,reasons:{...this.runtime.ps3Diagnostics.reasons}},
      radioCatalog:{unknownTextIds:counter(this.runtime.radioCatalog?.unknownTextIds),catalogMismatches:counter(this.runtime.radioCatalog?.catalogMismatches)},
      finalSnapshot,
    };
  }
  emitReport(finalSnapshot=false) {
    const summary=this.summary(finalSnapshot);
    try {this.report(summary);}catch{}
    this.persist('companion_shadow',createCompanionShadowTelemetry(summary));
  }
  start() {
    if(this.config.mode!=='shadow' || this.closed || this.socket) return;
    this.persist('intelligence_status',{stage:'connecting'});
    const socket=this.connect({path:`\\\\.\\pipe\\${this.config.pipeName}`});this.socket=socket;
    let buffer=Buffer.alloc(0),frames=[],hello=false;
    const fail=()=>socket.destroy();
    const processFrames=()=>{
      this.work=null;
      for(let n=0;n<32 && frames.length;n++) {
        let v;try {v=JSON.parse(frames.shift());} catch {
          this.persist('intelligence_frame_rejected',{frameType:'other',reason:'invalid_json',count:1});fail();return;
        }
        if(!hello && v?.type!=='hello' || hello && v?.type==='hello') {
          this.persist('intelligence_frame_rejected',{frameType:'hello',reason:'invalid_order',count:1});fail();return;
        }
        const before={malformed:this.runtime.counters.malformed,gaps:this.runtime.counters.gaps,faults:this.runtime.resetDiagnostics.faults};
        const accepted=this.runtime.ingest(v,{authenticated:true});
        if(!accepted) {
          // Never include source payloads, NPC identities or raw frames in
          // persistent diagnostics. A strict invalid frame stays invalid.
          const allowed=['hello','anchors','retire','retire_batch','observer_index',
            'observer_situation','world_epoch','director_priority','director_response',
            'signal','diagnostics'];
          const frameType=allowed.includes(v?.type)?v.type:'other';
          const reason=this.runtime.counters.malformed>before.malformed?'invalid_contract':
            this.runtime.counters.gaps>before.gaps?'sequence_gap':
            this.runtime.resetDiagnostics.faults>before.faults?'runtime_consistency':'rejected';
          const key=frameType+':'+reason,count=(this.frameRejections.get(key)||0)+1;
          this.frameRejections.set(key,count);
          if(count<=3 || count===10 || count%100===0)
            this.persist('intelligence_frame_rejected',{
              frameType,reason,count,frameBytes:Buffer.byteLength(JSON.stringify(v),'utf8')});
        }
        if(accepted && v?.type==='world_epoch')this.cancelDirectorRequests();
        if(accepted && v?.type==='director_response')this.acceptDirectorResponse(v.payload);
        this.notifyKnowledgeInvalidation();
        if(!hello && !accepted || !this.runtime.epoch) {fail();return;}
        if(!hello) { hello=true;this.persist('intelligence_status',{stage:'initialized'}); }
      }
      if(frames.length) this.work=setImmediate(processFrames);
    };
    socket.once('connect',()=>this.persist('intelligence_status',{stage:'connected'}));
    socket.on('data',chunk=>{
      // Slice before allocation: an arbitrary socket chunk cannot grow retained RAM.
      for(let offset=0;offset<chunk.length;) {
        const end=chunk.indexOf(10,offset),limit=end<0?chunk.length:end;
        if(buffer.length+limit-offset>BOUNDS.frameBytes) {fail();return;}
        buffer=Buffer.concat([buffer,chunk.subarray(offset,limit)]);
        if(end<0) break;
        if(frames.length>=BOUNDS.companionFrames) {fail();return;}
        frames.push(buffer.toString('utf8'));buffer=Buffer.alloc(0);offset=end+1;
      }
      if(!this.work) this.work=setImmediate(processFrames);
    });
    socket.on('error',()=>{});
    socket.on('close',()=>{
      if(hello) this.emitReport(true);
      this.persist('intelligence_status',{stage:'disconnected'});
      if(this.work) clearImmediate(this.work);this.work=null;frames=[];this.cancelDirectorRequests();this.socket=null;this.runtime.reset('disconnect');this.notifyKnowledgeInvalidation();if(!this.closed) this.retry=setTimeout(()=>this.start(),1000).unref();
    });
    this.watch=setInterval(()=>{
      this.runtime.expire();this.runtime.refreshSalience();this.notifyKnowledgeInvalidation();if(!this.runtime.epoch && hello) fail();
      if(this.runtime.epoch && this.runtime.now()-this.lastReport>=10000) {
        this.lastReport=this.runtime.now();
        this.emitReport(false);
      }
    },500).unref();
    socket.once('close',()=>clearInterval(this.watch));
    this.helloDeadline=setTimeout(()=>{if(!hello) fail();},3000).unref();socket.once('close',()=>clearTimeout(this.helloDeadline));
  }
  stop() {
    this.cancelDirectorRequests();this.closed=true;clearTimeout(this.retry);clearInterval(this.watch);clearTimeout(this.helloDeadline);if(this.work) clearImmediate(this.work);
    if(this.socket) this.socket.destroy(); else if(this.runtime.epoch) {this.emitReport(true);this.runtime.reset('disconnect');this.notifyKnowledgeInvalidation();}
  }
}
