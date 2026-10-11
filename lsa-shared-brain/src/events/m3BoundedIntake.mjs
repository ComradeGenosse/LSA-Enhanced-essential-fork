// Synchronous PS2 tap -> bounded asynchronous M3 worker. The tap NEVER
// awaits SQLite; commit status is counted only after the recorder confirms it.
// Native retire/reset invalidates queued work; the recorder's authorizer checks
// the same ownership again inside the M1 serialized timeline-write fence.
import {immutableSnapshot} from '../util/identity.mjs';

const DEFAULT_LIMIT=512,DEFAULT_BYTES=1024*1024;
const MAX=2147483647;
const bump=(object,key,n=1)=>object[key]=Math.min(MAX,object[key]+n);
export class M3BoundedIntake {
  #binder;#recorder;#queue=[];#bytes=0;#running=false;#closed=false;
  #limit;#byteLimit;#scheduler;#onFailure;#generation=0;#drainers=[];#scheduleFaults=0;
  constructor({binder,recorder,limit=DEFAULT_LIMIT,maxBytes=DEFAULT_BYTES,
    scheduler=fn=>queueMicrotask(fn),onFailure=()=>{}}={}){
    if(typeof binder?.bindAcceptedReceipt!=='function'||
      typeof recorder?.capture!=='function'||typeof recorder?.bufferBeforePromotion!=='function'||
      !Number.isSafeInteger(limit)||limit<1||limit>10000||
      !Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>16*1024*1024||
      typeof scheduler!=='function'||typeof onFailure!=='function')
      throw new TypeError('m3_invalid_intake_ports');
    this.#binder=binder;this.#recorder=recorder;this.#limit=limit;
    this.#byteLimit=maxBytes;this.#scheduler=scheduler;this.#onFailure=onFailure;
    this.stats={offered:0,queued:0,committed:0,duplicate:0,prepromotion:0,
      rejected:0,overflow:0,tooLarge:0,failed:0,retired:0,highWater:0};
  }
  #emit(stage,detail){try{this.#onFailure(stage,detail);}catch{/* diagnostics never disrupt PS2 */}}
  get pending(){return this.#queue.length+Number(this.#running);}
  snapshot(){return Object.freeze({...this.stats,waiting:this.#queue.length,bytes:this.#bytes,
    inFlight:this.#running,closed:this.#closed,scheduleFaults:this.#scheduleFaults,
    // An in-memory callback dropped by a crash was never persisted. The
    // restart path must accept independently reauthenticated PS2 replay only.
    replayAuthority:'native_redelivery_required'});}
  offer(receipt,{prepromotion=false}={}){
    bump(this.stats,'offered');
    if(this.#closed){bump(this.stats,'rejected');return {accepted:false,reason:'m3_intake_closed'};}
    let entry;
    try{
      const result=this.#binder.bindAcceptedReceipt(receipt,{prepromotion});
      if(!result?.accepted){bump(this.stats,'rejected');return result??{accepted:false,reason:'m3_owner_unverified'};}
      entry=immutableSnapshot({observation:result.observation,candidate:result.candidate,
        prepromotion:result.prepromotion===true,generation:this.#generation});
    }catch(error){bump(this.stats,'failed');this.#emit('bind',error);
      return {accepted:false,reason:'m3_bind_failed'};}
    const size=Buffer.byteLength(JSON.stringify(entry));
    if(size>this.#byteLimit){bump(this.stats,'tooLarge');return {accepted:false,reason:'m3_receipt_too_large'};}
    if(this.#queue.length>=this.#limit||this.#bytes+size>this.#byteLimit){
      bump(this.stats,'overflow');this.#emit('overflow',{pending:this.#queue.length,bytes:this.#bytes});
      return {accepted:false,reason:'m3_intake_overflow'};
    }
    this.#queue.push({entry,size});this.#bytes+=size;
    bump(this.stats,'queued');this.stats.highWater=Math.max(this.stats.highWater,this.#queue.length);
    this.#schedule();
    return {accepted:true,queued:true}; // NEVER a durability acknowledgement.
  }
  #schedule(){
    if(this.#running||this.#closed||!this.#queue.length)return;
    this.#running=true;
    try{this.#scheduler(()=>{void this.#drain();});}
    catch(error){this.#running=false;this.#scheduleFaults++;this.#emit('scheduler',error);
      // Retain queued receipts for explicit retry; don't claim a durable write.
      bump(this.stats,'failed');}
  }
  async #drain(){
    try{
      // Bounded turn: yield between batches to avoid starving PS2/native I/O.
      for(let i=0;i<16&&this.#queue.length;i++){
        const {entry,size}=this.#queue.shift();this.#bytes-=size;
        if(entry.generation!==this.#generation){bump(this.stats,'retired');continue;}
        try{
          const result=entry.prepromotion?
            this.#recorder.bufferBeforePromotion(entry):
            await this.#recorder.capture(entry);
          if(result?.accepted===true){
            if(entry.prepromotion)bump(this.stats,'prepromotion');
            else if(result.duplicate===true)bump(this.stats,'duplicate');
            else if(result.inserted===true)bump(this.stats,'committed');
            else{bump(this.stats,'failed');this.#emit('unconfirmed',result);}
          }else{bump(this.stats,'rejected');this.#emit('rejected',result);}
        }catch(error){bump(this.stats,'failed');this.#emit('commit',error);}
      }
    }finally{
      this.#running=false;
      if(this.#queue.length&&!this.#closed)this.#schedule();
      else if(!this.#queue.length)for(const f of this.#drainers.splice(0))f();
    }
  }
  // Recover from an injected scheduler failure; this is NOT crash replay.
  retry(){if(this.#closed)return false;this.#schedule();return this.#running;}
  // Call when PS2 native run, world epoch or identity ownership changes.
  // In-flight work is still fenced independently by recorder.authorize().
  retire(){
    this.#generation++;
    this.stats.retired=Math.min(MAX,this.stats.retired+this.#queue.length);
    this.#queue=[];this.#bytes=0;this.#recorder.reset();
    if(!this.#running)for(const f of this.#drainers.splice(0))f();
  }
  close(){this.#closed=true;this.retire();}
  // Testing/shutdown checkpoint; not a durability proof for failed receipts.
  async idle(){if(!this.#running)return this.snapshot();
    await new Promise(resolve=>this.#drainers.push(resolve));return this.snapshot();}
}
