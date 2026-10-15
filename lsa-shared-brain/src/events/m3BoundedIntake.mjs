// Synchronous PS2 tap -> bounded asynchronous M3 worker. The tap NEVER
// awaits SQLite; commit status is counted only after the recorder confirms it.
// Native retire/reset invalidates queued work; the recorder's authorizer checks
// the same ownership again inside the M1 serialized timeline-write fence.
import {immutableSnapshot} from '../util/identity.mjs';

const DEFAULT_LIMIT=512,DEFAULT_BYTES=1024*1024;
const MAX=2147483647;
const safeCommitFailures=new Set(['memory_source_forgotten','journal_native_privacy_unresolved',
  'journal_native_receipt_integrity','journal_native_replay_unavailable','timeline_write_suspended']);
const bump=(object,key,n=1)=>object[key]=Math.min(MAX,object[key]+n);
// Stable identity of one offered PS2 observation revision, host neutral.
export const observationKey=observation=>[observation?.observedAt?.nativeRun,
  observation?.observer?.captureRef,observation?.observationId,observation?.revision].join(':');
const subject=(observation)=>({
  key:observationKey(observation),observationId:observation?.observationId,
  observerCaptureRef:observation?.observer?.captureRef,tick:observation?.observedAt?.gameTick,
  receivedUtc:observation?.observedAt?.receivedUtc});
export class M3BoundedIntake {
  #binder;#recorder;#queue=[];#bytes=0;#running=false;#closed=false;
  #limit;#byteLimit;#scheduler;#onFailure;#onOutcome;#generation=0;#entrySeq=0;#drainers=[];#scheduleFaults=0;
  #lastOutcome=null;
  constructor({binder,recorder,limit=DEFAULT_LIMIT,maxBytes=DEFAULT_BYTES,
    scheduler=fn=>queueMicrotask(fn),onFailure=()=>{},onOutcome=()=>{}}={}){
    if(typeof binder?.bindAcceptedReceipt!=='function'||
      typeof recorder?.capture!=='function'||typeof recorder?.bufferBeforePromotion!=='function'||
      !Number.isSafeInteger(limit)||limit<1||limit>10000||
      !Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>16*1024*1024||
      typeof scheduler!=='function'||typeof onFailure!=='function'||typeof onOutcome!=='function')
      throw new TypeError('m3_invalid_intake_ports');
    this.#binder=binder;this.#recorder=recorder;this.#limit=limit;
    this.#byteLimit=maxBytes;this.#scheduler=scheduler;this.#onFailure=onFailure;this.#onOutcome=onOutcome;
    // `unattributed` (D-023): receipts refused because the observer could not be
    // tied to exactly one live promoted profile. `stale`: an older revision
    // superseded by a newer durable one (neither a loss nor a fault).
    this.stats={offered:0,queued:0,committed:0,duplicate:0,stale:0,prepromotion:0,
      rejected:0,unattributed:0,overflow:0,tooLarge:0,failed:0,retired:0,highWater:0,
      qualified:0,lost:0,dropped:0};
  }
  #emit(stage,detail){try{this.#onFailure(stage,detail);}catch{/* diagnostics never disrupt PS2 */}}
  // Per-observation outcome for coverage accounting. `lost` means a known,
  // accepted PS2 observation did NOT become a durable journal row.
  #outcome(type,fields){
    if(type==='lost')bump(this.stats,'lost');
    if(type==='settled')this.#lastOutcome=Object.freeze({state:'durable',reason:null});
    if(type==='lost')this.#lastOutcome=Object.freeze({state:'blocked',reason:fields.failure??fields.reason});
    try{this.#onOutcome(Object.freeze({type,...fields}));}catch{/* never disrupts PS2 */}
  }
  #refused(reason,receipt){
    this.#outcome('refused',{reason,...subject(receipt?.observation)});
  }
  get pending(){return this.#queue.length+Number(this.#running);}
  snapshot(){return Object.freeze({...this.stats,waiting:this.#queue.length,bytes:this.#bytes,
    inFlight:this.#running,closed:this.#closed,scheduleFaults:this.#scheduleFaults,lastOutcome:this.#lastOutcome,
    // An in-memory callback dropped by a crash was never persisted. The
    // restart path must accept independently reauthenticated PS2 replay only.
    replayAuthority:'native_redelivery_required'});}
  offer(receipt,{prepromotion=false}={}){
    bump(this.stats,'offered');
    if(this.#closed){bump(this.stats,'rejected');this.#refused('intake_closed',receipt);
      return {accepted:false,reason:'m3_intake_closed'};}
    let entry;
    try{
      const result=this.#binder.bindAcceptedReceipt(receipt,{prepromotion});
      if(!result?.accepted){
        bump(this.stats,'rejected');
        if(result?.reason==='m3_native_owner_unverified'){
          bump(this.stats,'unattributed');this.#refused('owner_unverified',receipt);
        }else this.#refused('bind_failed',receipt);
        return result??{accepted:false,reason:'m3_owner_unverified'};
      }
      entry=immutableSnapshot({observation:result.observation,candidate:result.candidate,
        prepromotion:result.prepromotion===true,generation:this.#generation});
    }catch(error){bump(this.stats,'failed');this.#emit('bind',error);this.#refused('bind_failed',receipt);
      return {accepted:false,reason:'m3_bind_failed'};}
    bump(this.stats,'qualified');
    const size=Buffer.byteLength(JSON.stringify(entry));
    if(size>this.#byteLimit){bump(this.stats,'tooLarge');bump(this.stats,'dropped');
      this.#outcome('lost',{reason:'receipt_too_large',characterId:entry.candidate.characterId,...subject(entry.observation)});
      return {accepted:false,reason:'m3_receipt_too_large'};}
    if(this.#queue.length>=this.#limit||this.#bytes+size>this.#byteLimit){
      bump(this.stats,'overflow');bump(this.stats,'dropped');this.#emit('overflow',{pending:this.#queue.length,bytes:this.#bytes});
      this.#outcome('lost',{reason:'intake_overflow',characterId:entry.candidate.characterId,...subject(entry.observation)});
      return {accepted:false,reason:'m3_intake_overflow'};
    }
    const entryId=++this.#entrySeq;
    this.#queue.push({entry,size,entryId});this.#bytes+=size;
    bump(this.stats,'queued');this.stats.highWater=Math.max(this.stats.highWater,this.#queue.length);
    if(!entry.prepromotion)
      this.#outcome('queued',{entryId,characterId:entry.candidate.characterId,...subject(entry.observation)});
    this.#schedule();
    return {accepted:true,queued:true}; // NEVER a durability acknowledgement.
  }
  #schedule(){
    if(this.#running||this.#closed||!this.#queue.length)return;
    this.#running=true;
    try{this.#scheduler(()=>{void this.#drain();});}
    catch(error){this.#running=false;this.#scheduleFaults=Math.min(MAX,this.#scheduleFaults+1);this.#emit('scheduler',error);
      // Retain queued receipts for explicit retry; don't claim a durable write.
      bump(this.stats,'failed');}
  }
  async #drain(){
    try{
      // Bounded turn: yield between batches to avoid starving PS2/native I/O.
      for(let i=0;i<16&&this.#queue.length;i++){
        const {entry,size,entryId}=this.#queue.shift();this.#bytes-=size;
        const who={entryId,characterId:entry.candidate.characterId,...subject(entry.observation)};
        if(entry.generation!==this.#generation){
          bump(this.stats,'retired');
          if(!entry.prepromotion)this.#outcome('lost',{reason:'retired_before_commit',...who});
          continue;
        }
        try{
          const result=entry.prepromotion?
            this.#recorder.bufferBeforePromotion(entry):
            await this.#recorder.capture(entry);
          if(result?.accepted===true){
            if(entry.prepromotion)bump(this.stats,'prepromotion');
            else if(result.duplicate===true){bump(this.stats,'duplicate');this.#outcome('settled',{result:'duplicate',...who});}
            else if(result.inserted===true){bump(this.stats,'committed');this.#outcome('settled',{result:'committed',...who});}
            else if(result.stale===true){bump(this.stats,'stale');this.#outcome('settled',{result:'stale',...who});}
            else{bump(this.stats,'failed');this.#emit('unconfirmed',result);
              this.#outcome('lost',{reason:'commit_failed',...who});}
          }else{bump(this.stats,'rejected');this.#emit('rejected',result);
            if(!entry.prepromotion)this.#outcome('lost',{reason:'recorder_rejected',...who});}
        }catch(error){
          // A NEWER revision of this exact observation is already durable: the
          // late/replayed older revision is superseded, not lost and not a fault.
          if(error?.message==='journal_stale_event_revision'&&!entry.prepromotion){
            bump(this.stats,'stale');this.#outcome('settled',{result:'stale',...who});
          }else{
            bump(this.stats,'failed');this.#emit('commit',error);
            if(!entry.prepromotion)this.#outcome('lost',{reason:'commit_failed',
              failure:safeCommitFailures.has(error?.message)?error.message:'commit_failed',...who});
          }
        }
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
    for(const {entry,entryId} of this.#queue)if(!entry.prepromotion)
      this.#outcome('lost',{reason:'retired_before_commit',entryId,characterId:entry.candidate.characterId,
        ...subject(entry.observation)});
    this.#queue=[];this.#bytes=0;this.#recorder.reset();
    this.#lastOutcome=null;
    if(!this.#running)for(const f of this.#drainers.splice(0))f();
  }
  close(){this.#closed=true;this.retire();}
  // Testing/shutdown checkpoint; not a durability proof for failed receipts.
  async idle(){if(!this.#running)return this.snapshot();
    await new Promise(resolve=>this.#drainers.push(resolve));return this.snapshot();}
}
