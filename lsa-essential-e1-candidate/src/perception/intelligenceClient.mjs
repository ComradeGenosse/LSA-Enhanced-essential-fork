import net from 'node:net';
import { BOUNDS } from './contracts.mjs';
import { ShadowRuntime } from './shadowRuntime.mjs';

// Fixed same-user native factual endpoint; no actor integration blocks or commands.
export class IntelligenceClient {
  constructor(config,{connect=options=>net.createConnection(options),now,report=summary=>console.info('[PS] companion_shadow '+JSON.stringify(summary))}={}) {this.config=config;this.connect=connect;this.runtime=new ShadowRuntime({mode:config.mode,radio:config.radio,now});this.report=report;this.closed=false;this.socket=null;this.lastReport=0;}
  start() {
    if(this.config.mode!=='shadow' || this.closed || this.socket) return;
    const socket=this.connect({path:`\\\\.\\pipe\\${this.config.pipeName}`});this.socket=socket;
    let buffer=Buffer.alloc(0),frames=[],hello=false;
    const fail=()=>socket.destroy();
    const processFrames=()=>{
      this.work=null;
      for(let n=0;n<32 && frames.length;n++) {
        let v;try {v=JSON.parse(frames.shift());} catch {fail();return;}
        if(!hello && v?.type!=='hello' || hello && v?.type==='hello') {fail();return;}
        const accepted=this.runtime.ingest(v,{authenticated:true});
        if(!hello && !accepted || !this.runtime.epoch) {fail();return;} hello=true;
      }
      if(frames.length) this.work=setImmediate(processFrames);
    };
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
    socket.on('close',()=>{ if(this.work) clearImmediate(this.work);this.work=null;frames=[];this.socket=null;this.runtime.reset();if(!this.closed) this.retry=setTimeout(()=>this.start(),1000).unref(); });
    this.watch=setInterval(()=>{
      this.runtime.expire();if(!this.runtime.epoch && hello) fail();
      if(this.runtime.epoch && this.runtime.now()-this.lastReport>=10000) {
        this.lastReport=this.runtime.now();
        try {this.report({anchors:this.runtime.anchors.size,queued:this.runtime.signals.length,...this.runtime.counters,capabilities:this.runtime.capabilities,damageCallbacks:this.runtime.diagnostics?.damageCallbacks??{ped_damage:0,player_damage:0,vehicle_damage:0}});}catch{}
      }
    },500).unref();
    socket.once('close',()=>clearInterval(this.watch));
    this.helloDeadline=setTimeout(()=>{if(!hello) fail();},3000).unref();socket.once('close',()=>clearTimeout(this.helloDeadline));
  }
  stop() {this.closed=true;clearTimeout(this.retry);clearInterval(this.watch);clearTimeout(this.helloDeadline);if(this.work) clearImmediate(this.work);this.socket?.destroy();this.runtime.reset();}
}
