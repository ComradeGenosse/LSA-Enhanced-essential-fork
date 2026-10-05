import net from 'node:net';
import { BOUNDS } from './contracts.mjs';
import { ShadowRuntime } from './shadowRuntime.mjs';

const COUNTER_MAX = 2147483647;
const counter = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(COUNTER_MAX, value) : 0;

// Scalar-only persistence projection for E4 JSONL telemetry. The richer console
// companion_shadow report remains unchanged; only explicitly selected counters
// cross the persistent telemetry boundary.
export function createCompanionShadowTelemetry(summary = {}) {
  const ps2 = summary?.ps2 && typeof summary.ps2 === 'object' ? summary.ps2 : {};
  const ps3 = summary?.ps3 && typeof summary.ps3 === 'object' ? summary.ps3 : {};
  return Object.freeze({
    anchors: counter(summary.anchors),
    queued: counter(summary.queued),
    received: counter(summary.received),
    dropped: counter(summary.dropped),
    stale: counter(summary.stale),
    malformed: counter(summary.malformed),
    duplicate: counter(summary.duplicate),
    gaps: counter(summary.gaps),
    expired: counter(summary.expired),
    resets: counter(summary.resets),
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
  });
}

// Fixed same-user native factual endpoint; no actor integration blocks or commands.
export class IntelligenceClient {
  constructor(config,{connect=options=>net.createConnection(options),now,report=summary=>console.info('[PS] companion_shadow '+JSON.stringify(summary)),telemetry=()=>{}}={}) {
    this.config=config;this.connect=connect;this.runtime=new ShadowRuntime({mode:config.mode,now});this.report=report;this.telemetry=telemetry;this.closed=false;this.socket=null;this.lastReport=0;
  }
  persist(event,data={}) { try { this.telemetry(event,data); } catch {} }
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
      this.persist('intelligence_status',{stage:'disconnected'});
      if(this.work) clearImmediate(this.work);this.work=null;frames=[];this.socket=null;this.runtime.reset();if(!this.closed) this.retry=setTimeout(()=>this.start(),1000).unref();
    });
    this.watch=setInterval(()=>{
      this.runtime.expire();if(!this.runtime.epoch && hello) fail();
      if(this.runtime.epoch && this.runtime.now()-this.lastReport>=10000) {
        this.lastReport=this.runtime.now();
        const summary={anchors:this.runtime.anchors.size,queued:this.runtime.signals.length,...this.runtime.counters,capabilities:this.runtime.capabilities,damageCallbacks:this.runtime.diagnostics?.damageCallbacks??{ped_damage:0,player_damage:0,vehicle_damage:0},ps2:{...this.runtime.ps2Diagnostics,playerSpeechGate:this.runtime.diagnostics?.playerSpeechGate??'unsupported_capture_receipt',speech:this.runtime.transcripts.diagnostics},ps3:{...this.runtime.ps3Diagnostics}};
        try {this.report(summary);}catch{}
        this.persist('companion_shadow',createCompanionShadowTelemetry(summary));
      }
    },500).unref();
    socket.once('close',()=>clearInterval(this.watch));
    this.helloDeadline=setTimeout(()=>{if(!hello) fail();},3000).unref();socket.once('close',()=>clearTimeout(this.helloDeadline));
  }
  stop() {this.closed=true;clearTimeout(this.retry);clearInterval(this.watch);clearTimeout(this.helloDeadline);if(this.work) clearImmediate(this.work);this.socket?.destroy();this.runtime.reset();}
}
