import { captureKnowledgeInputs, assertKnowledgeCurrent } from '../context/knowledgeInputs.mjs';
import net from 'node:net';
import { BOUNDS } from './contracts.mjs';
import { ShadowRuntime } from './shadowRuntime.mjs';
import {serializeDirectorRequest,serializeDirectorPs3Receipt,serializeDirectorOriginalOwnerReceipt} from './directorWire.mjs';

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
  originalBackendEvidence() {
    let state;
    try {state=this.originalTurnPriority();}catch{return null;}
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
    // Every reserve/submit must re-read the original companion ledger as an
    // independent source. Cancel remains available after grant expiration so
    // a previously reserved native ticket can always be retired.
    const original=args?.operation==='cancel'?null:
      this.directorOriginalEntitlement(args?.proposal,args?.stamp);
    const owner=args?.operation==='cancel'?null:this.originalBackendEvidence();
    if(args?.operation!=='cancel' && (!original || !owner))
      return Promise.resolve(null);
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
      if(!this.sendDirectorPreview(args)) {finish(null);return;}
      if(args.operation==='reserve')this.directorOwnerReservations.set(ticketId,
        {run:owner.sourceRun,revision:owner.revision});
      if(args.operation==='cancel')this.directorOwnerReservations.delete(ticketId);
    });
  }
  acceptDirectorResponse(payload) {
    if(!payload || this.runtime.directorRequestVersion!==1)return false;
    const pending=this.directorPending.get(payload.ticketId);
    if(!pending)return false;
    const allowed={
      reserve:['reserved','busy','invalid','unsafe','stale'],
      submit:['submitted','busy','invalid','unsafe','stale'],
      cancel:['cancelled','not_found','invalid','unsafe','stale'],
    }[pending.operation];
    pending.resolve(allowed?.includes(payload.status) ?
      Object.freeze({ticketId:payload.ticketId,status:payload.status}) : null);
    return true;
  }
  cancelDirectorRequests() {
    for(const item of [...this.directorPending.values()])item.resolve(null);
    this.directorOwnerReservations.clear();
  }

  constructor(config,{connect=options=>net.createConnection(options),now,situationFor,originalTurnPriority=()=>null,report=summary=>console.info('[PS] companion_shadow '+JSON.stringify(summary)),telemetry=()=>{}}={}) {
    this.knowledgeListeners=new Set();this.config=config;this.connect=connect;this.runtime=new ShadowRuntime({mode:config.mode,now,situationFor});this.report=report;this.telemetry=telemetry;this.originalTurnPriority=typeof originalTurnPriority==='function'?originalTurnPriority:()=>null;this.closed=false;this.socket=null;this.lastReport=0;this.directorPending=new Map();this.directorOwnerReservations=new Map();
  }
  persist(event,data={}) { try { this.telemetry(event,data); } catch {} }
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
        let v;try {v=JSON.parse(frames.shift());} catch {fail();return;}
        if(!hello && v?.type!=='hello' || hello && v?.type==='hello') {fail();return;}
        const accepted=this.runtime.ingest(v,{authenticated:true});if(accepted && v?.type==='director_response')this.acceptDirectorResponse(v.payload);this.notifyKnowledgeInvalidation();
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
