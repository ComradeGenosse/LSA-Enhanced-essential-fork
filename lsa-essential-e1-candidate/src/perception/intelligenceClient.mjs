import net from 'node:net';
import { BOUNDS } from './contracts.mjs';
import { ShadowRuntime } from './shadowRuntime.mjs';
import { selectRadioContext } from './radioContextProjector.mjs';

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
  constructor(config,{connect=options=>net.createConnection(options),now,report=summary=>console.info('[PS] companion_shadow '+JSON.stringify(summary)),telemetry=()=>{},radioCatalog}={}) {
    this.config=config;this.connect=connect;this.runtime=new ShadowRuntime({mode:config.mode,radio:config.radio,radioCatalog,now});this.report=report;this.telemetry=telemetry;this.closed=false;this.socket=null;this.lastReport=0;
  }
  persist(event,data={}) { try { this.telemetry(event,data); } catch {} }
  projectTurnContext({input}={}) { return selectRadioContext(this.runtime,input); }
  acknowledgeTurnContext(projection,outcome='delivered') {
    if (projection?.kind!=='radio' || typeof projection.decisionKey!=='string' || !['delivered','rejected','expired'].includes(outcome)) return false;
    return this.runtime.salience.acknowledge(projection.decisionKey,'ps4_context',outcome);
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
        let v;try {v=JSON.parse(frames.shift());} catch {fail();return;}
        if(!hello && v?.type!=='hello' || hello && v?.type==='hello') {fail();return;}
        const accepted=this.runtime.ingest(v,{authenticated:true});
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
      if(this.work) clearImmediate(this.work);this.work=null;frames=[];this.socket=null;this.runtime.reset('disconnect');if(!this.closed) this.retry=setTimeout(()=>this.start(),1000).unref();
    });
    this.watch=setInterval(()=>{
      this.runtime.expire();if(!this.runtime.epoch && hello) fail();
      if(this.runtime.epoch && this.runtime.now()-this.lastReport>=10000) {
        this.lastReport=this.runtime.now();
        this.emitReport(false);
      }
    },500).unref();
    socket.once('close',()=>clearInterval(this.watch));
    this.helloDeadline=setTimeout(()=>{if(!hello) fail();},3000).unref();socket.once('close',()=>clearTimeout(this.helloDeadline));
  }
  stop() {
    this.closed=true;clearTimeout(this.retry);clearInterval(this.watch);clearTimeout(this.helloDeadline);if(this.work) clearImmediate(this.work);
    if(this.socket) this.socket.destroy(); else if(this.runtime.epoch) {this.emitReport(true);this.runtime.reset('disconnect');}
  }
}
