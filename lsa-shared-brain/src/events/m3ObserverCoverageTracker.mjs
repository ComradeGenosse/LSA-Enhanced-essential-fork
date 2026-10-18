// K-13 write side: authenticated observer-coverage tracker.
//
// Turns the stream of AUTHENTICATED native owner frames (memory_authority,
// sampled every ~250 ms on the P2 owner fiber) into durable coverage windows per
// promoted NPC. These prove supported sampling, never a negative event or that
// the NPC saw every incident (which needs independent per-signal evidence):
//
//   covered   = a contiguous span in which the NPC was a native-verified owner
//               and the capture pipeline kept receiving samples;
//   uncovered = EVERYTHING else (pause, stall, reset, roster loss, disconnect,
//               timeline change, crash). Coverage is never inferred.
//
// The tracker is pure and host neutral. It never reads a game, never opens
// SQLite and never invents a frame: callers feed it only samples that already
// passed the authenticated pipe + native authority validation. Persistence is
// an injected async port (the P2 single-writer fence).
//
// Safety invariant (checked by tests): the PERSISTED end of a window never
// passes
//   * lastSample - settle      (an observation may still be in flight upstream),
//   * the oldest observation offered to the M3 intake but not yet committed,
//   * the oldest recorded loss that is not yet durable.
// So a reader can never see "complete coverage" over a moment whose event is
// still queued or whose loss is not yet recorded.
import {createHash,randomUUID} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
import {OBSERVER_COVERAGE_CLOSE_REASONS} from './m3CoverageSqlite.mjs';
const CLOSE_REASONS=new Set(OBSERVER_COVERAGE_CLOSE_REASONS);

export const COVERAGE_DEFAULTS=Object.freeze({
  // Native cadence is 250 ms. Four missed samples is a stall, not jitter.
  maxTickGapMs:1000,
  // Companion-side wall time without any owner frame.
  maxDeliveryGapMs:3000,
  settleMs:3000,
  checkpointMs:5000,
  historyLimit:4096,
  maxClosing:64,
  maxPendingGaps:4096,
  gapCoalesceMs:2000,
  retryMs:1000,
});
const RETRYABLE=/^(timeline_write_suspended|timeline_not_selected|profile_store_unavailable|m3_coverage_owner_or_epoch_unconfirmed|m3_coverage_stale)$/;
const retryableWriteError=(error,message)=>RETRYABLE.test(message)||
  /^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z0-9_]{1,32})?$/.test(error?.code??'');
// A raw database exception may include SQL or local paths: telemetry gets codes only.
const M3_CODES=new Set('timeline_write_suspended timeline_not_selected profile_store_unavailable m3_coverage_owner_or_epoch_unconfirmed m3_coverage_stale timeline_write_async_not_supported m3_coverage_commit_unconfirmed m3_observer_coverage_identity_conflict m3_observer_coverage_invalid m3_observer_coverage_invalid_window m3_observer_coverage_invalid_gap m3_observer_coverage_corrupt'.split(' '));
const diagnosticCode=(error,message)=>typeof error?.code==='string'&&
 /^SQLITE_(?:ERROR|BUSY|LOCKED|READONLY|FULL|IOERR|CONSTRAINT)(?:_[A-Z0-9_]{1,32})?$/.test(error.code)?
 error.code:M3_CODES.has(message)?message:'unclassified_write_error';
const diagnosticType=error=>['Error','TypeError','RangeError','SqliteError'].includes(error?.name)?error.name:'UnknownError';
const uuidFrom=(...parts)=>{
  const b=Buffer.from(createHash('sha256').update(parts.join('|')).digest('hex').slice(0,32),'hex');
  b[6]=b[6]&0x0f|0x40;b[8]=b[8]&0x3f|0x80;
  const h=b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const tickOk=x=>Number.isSafeInteger(x)&&x>=0&&x<=0xffffffff;

export function createM3ObserverCoverageTracker({
  worldProfileId,resolveCharacter,activeTimeline,persist,eventIntakeEnabled=true,durable=true,
  processId=randomUUID(),monotonicNow=()=>performance.now(),
  utcNow=()=>new Date().toISOString(),onEvent=()=>{},options={}
}={}){
  if(!isUuid(worldProfileId)||typeof resolveCharacter!=='function'||
     typeof activeTimeline!=='function'||typeof persist!=='function'||!isUuid(processId)||
     typeof monotonicNow!=='function'||typeof utcNow!=='function'||typeof onEvent!=='function')
    throw new TypeError('m3_coverage_tracker_ports_required');
  const cfg={...COVERAGE_DEFAULTS,...options};
  const stats={samples:0,windowsOpened:0,windowsClosed:0,closedBy:{},ownersSeen:0,
    ownersSkipped:0,gapsRecorded:0,gapsUnattributed:0,checkpoints:0,persistFailures:0,
    persistRejectedStale:0,pendingHighWater:0,degraded:false,sealed:false,historyThinned:0,
    suspensions:0,resumptions:0,windowsAbandoned:0,gapsAbandoned:0,pendingRetired:0};
  const emit=(kind,detail)=>{try{onEvent(kind,detail);}catch{/* diagnostics never disrupt capture */}};

  let stream=null;                    // last accepted frame's context
  let degradedReason=null;
  const open=new Map();               // characterId -> window
  const closing=new Set();            // closed windows still flushing their final end
  const pending=new Map();            // key -> {characterId,tick}
  const gaps=new Map();               // coverageId -> {record,characterId,tick}
  let inFlight=null,retryAt=0,sealRequired=true,closedFlag=false;
  let sourceSuspended=false,discardRetiredOnResume=false;

  const bump=(k,n=1)=>{stats[k]=Math.min(2147483647,stats[k]+n);};
  const minPending=w=>{
    let min=Infinity;
    for(const p of pending.values())if((p.windowId===w.coverageId||
      (p.windowId===null&&p.tick>=w.startTick&&p.tick<=w.last.tick+cfg.maxTickGapMs))&&p.tick<min)min=p.tick;
    return min;
  };
  const minGap=w=>{
    let min=Infinity;
    for(const g of gaps.values())if(g.windowId===w.coverageId&&g.tick<min)min=g.tick;
    return min;
  };

  function newWindow(owner,character,timelineId,s,utc,mono){
    const sample={tick:s.sampledGameTick,utc,sequence:s.sequence,frames:1};
    const w={
      coverageId:uuidFrom('M3-OBS-COVERAGE',processId,character.characterId,s.streamId,
        s.hostRunId,s.worldEpoch,s.sampledGameTick,s.sequence),
      characterId:character.characterId,timelineId,hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,
      adapterEpoch:s.adapterEpoch,streamId:s.streamId,
      ownerProof:Object.freeze({ownerAlias:owner.ownerAlias,incarnationId:owner.incarnationId,
        encounterId:owner.encounterId,hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,
        observerCaptureRef:owner.observerCaptureRef}),
      startTick:s.sampledGameTick,startUtc:utc,firstSequence:s.sequence,
      last:sample,history:[sample],frames:1,
      status:'open',closeReason:null,persisted:null,lastEmitMono:-Infinity,dirty:true,abandoned:false,
    };
    open.set(w.characterId,w);
    bump('windowsOpened');
    return w;
  }
  function extend(w,s,utc){
    w.frames++;
    w.last={tick:s.sampledGameTick,utc,sequence:s.sequence,frames:w.frames};
    w.history.push(w.last);
    if(w.history.length>cfg.historyLimit){
      // Thin the OLDER half: a coarser history can only lower the persisted
      // end (a later resolvable tick), never raise it.
      const half=Math.floor(w.history.length/2);
      const older=w.history.slice(0,half).filter((_,i)=>i%2===0);
      w.history=[...older,...w.history.slice(half)];
      bump('historyThinned');
    }
    w.dirty=true;
  }
  function close(w,reason){
    if(w.status==='closed')return;
    w.status='closed';w.closeReason=reason;w.dirty=true;
    open.delete(w.characterId);
    bump('windowsClosed');
    stats.closedBy[reason]=(stats.closedBy[reason]??0)+1;
    closing.add(w);
    while(closing.size>cfg.maxClosing){
      // Oldest closing windows give up their un-persisted tail. This only
      // shortens claimed coverage.
      const oldest=closing.values().next().value;closing.delete(oldest);
    }
    emit('window_closed',{reason,characterId:w.characterId,frames:w.frames});
  }
  const closeAll=reason=>{for(const w of [...open.values()])close(w,reason);};

  // An authenticated stream cut freezes each old window at its last safe
  // frontier. Pending/lost observations can no longer make the frontier grow.
  // Already committed SQLite rows are never altered or deleted.
  function suspend(reason){
    if(!sourceSuspended){bump('suspensions');emit('suspended',{reason});}
    sourceSuspended=true;
    for(const w of closing){
      if(!Object.hasOwn(w,'retiredEnd'))w.retiredEnd=desiredEnd(w);
    }
    // The frozen frontier already excludes every uncommitted observation.
    // Old queue keys must not hold a new window for the same NPC hostage.
    bump('pendingRetired',pending.size);
    pending.clear();
  }
  function abandon(w,reason){
    w.abandoned=true;closing.delete(w);bump('windowsAbandoned');
    emit('window_abandoned',{reason,hadCheckpoint:!!w.persisted});
  }
  function resume(timelineId,s){
    for(const w of [...closing]){
      if(discardRetiredOnResume||w.timelineId!==timelineId||
         w.hostRunId!==s.hostRunId||w.worldEpoch!==s.worldEpoch||
         (Object.hasOwn(w,'retiredEnd')&&!w.retiredEnd))
        abandon(w,'stale_source_or_unverified_frontier');
    }
    for(const [id,g] of gaps){
      if(discardRetiredOnResume||g.timelineId!==timelineId||
         g.record.hostRunId!==s.hostRunId||g.record.worldEpoch!==s.worldEpoch){
        gaps.delete(id);bump('gapsAbandoned');
      }
    }
    sourceSuspended=false;discardRetiredOnResume=false;retryAt=0;
    bump('resumptions');
    emit('resumed',{abandoned:stats.windowsAbandoned,gapsAbandoned:stats.gapsAbandoned});
  }

  // ------------------------------------------------------------------ frames
  function sample(s){
    if(closedFlag||degradedReason)return {accepted:false,reason:degradedReason??'closed'};
    if(!s||!isUuid(s.streamId)||!isUuid(s.adapterEpoch)||!isUuid(s.hostRunId)||
       !Number.isSafeInteger(s.worldEpoch)||s.worldEpoch<1||!Number.isSafeInteger(s.sequence)||
       s.sequence<0||!tickOk(s.sampledGameTick)||!Array.isArray(s.owners)||s.owners.length>16){
      closeAll('stream_retired');stream=null;return {accepted:false,reason:'invalid_sample'};
    }
    const mono=monotonicNow(),utc=utcNow();
    if(!Number.isFinite(mono)||typeof utc!=='string'){closeAll('delivery_gap');stream=null;return {accepted:false,reason:'invalid_clock'};}
    let timelineId=null;
    try{timelineId=activeTimeline();}catch{timelineId=null;}
    if(!isUuid(timelineId)){
      retire('timeline_unwritable');
      return {accepted:false,reason:'timeline_unwritable'};
    }
    if(sourceSuspended)resume(timelineId,s);
    bump('samples');
    if(stream){
      if(stream.hostRunId!==s.hostRunId||stream.worldEpoch!==s.worldEpoch)closeAll('epoch_boundary');
      else if(stream.streamId!==s.streamId||stream.adapterEpoch!==s.adapterEpoch)closeAll('stream_changed');
      else if(s.sequence<=stream.sequence)closeAll('sequence_gap');
      else if(s.sampledGameTick<stream.tick)closeAll('tick_regression');
      else if(utc<stream.utc||mono<stream.mono)closeAll('delivery_gap');
      else {
        const dTick=s.sampledGameTick-stream.tick,dMono=mono-stream.mono;
        if(dTick>cfg.maxTickGapMs)closeAll('tick_gap');
        else if(dMono>cfg.maxDeliveryGapMs)
          // Wall time passed with <=1 s of game time (a larger game-time jump
          // is already a tick_gap): the game was paused or suspended, or the
          // companion stalled. Either way the span is not claimed.
          closeAll('game_paused');
      }
    }
    stream={streamId:s.streamId,adapterEpoch:s.adapterEpoch,hostRunId:s.hostRunId,
      worldEpoch:s.worldEpoch,sequence:s.sequence,tick:s.sampledGameTick,utc,mono};

    const seen=new Set(),duplicated=new Set(),byCharacter=new Map();
    for(const o of s.owners){
      bump('ownersSeen');
      let character=null;
      try{character=resolveCharacter(o.ownerAlias);}catch{character=null;}
      if(!character||!isUuid(character.characterId)||
         character.promotion?.ownerAlias!==o.ownerAlias){bump('ownersSkipped');continue;}
      if(byCharacter.has(character.characterId))duplicated.add(character.characterId);
      byCharacter.set(character.characterId,{owner:o,character});
    }
    for(const id of duplicated){byCharacter.delete(id);bump('ownersSkipped');}
    for(const [characterId,{owner,character}] of byCharacter){
      seen.add(characterId);
      const w=open.get(characterId);
      if(!isUuid(timelineId)){if(w)close(w,'timeline_unwritable');continue;}
      if(w&&w.timelineId!==timelineId){close(w,'timeline_changed');}
      else if(w&&(w.ownerProof.observerCaptureRef!==owner.observerCaptureRef||
        w.ownerProof.incarnationId!==owner.incarnationId||
        w.ownerProof.encounterId!==owner.encounterId||w.ownerProof.ownerAlias!==owner.ownerAlias))
        close(w,'owner_changed');
      else if(w){extend(w,s,utc);continue;}
      newWindow(owner,character,timelineId,s,utc,mono);
    }
    for(const w of [...open.values()]){
      if(!seen.has(w.characterId))close(w,'owner_absent');
    }
    kick(false);
    return {accepted:true,open:open.size};
  }

  // Authenticated stream cut: disconnect, reset, world boundary, timeline
  // suspension or shutdown. Closes at the last real sample; claims nothing more.
  function retire(reason='stream_retired'){
    const qualified=CLOSE_REASONS.has(reason)?reason:'stream_retired';
    // Only reasons the durable ledger knows may be written.
    closeAll(qualified);stream=null;
    if(qualified==='shutdown'){
      if(!sourceSuspended)kick(true); // orderly teardown while still authorized
      return;
    }
    // Genuine save/epoch/source changes cannot replay even an old tail into
    // another authorization, including one that reuses the same timeline ID.
    if(['timeline_changed','epoch_boundary','stream_changed'].includes(qualified))
      discardRetiredOnResume=true;
    suspend(qualified);
  }

  // --------------------------------------------------- intake bookkeeping
  function noteQueued({key,characterId,tick}={}){
    if(typeof key!=='string'||!isUuid(characterId)||!tickOk(tick))return false;
    if(sourceSuspended)return false;
    pending.set(key,{characterId,tick,windowId:open.get(characterId)?.coverageId??null});
    stats.pendingHighWater=Math.max(stats.pendingHighWater,pending.size);
    return true;
  }
  function noteSettled(key){
    if(!pending.delete(key))return false;
    kick(false);
    return true;
  }
  // A known observation did not become a durable journal row. Record a point
  // gap so no range containing it is reported complete.
  function noteLoss({characterId=null,observerCaptureRef=null,observationId,tick,receivedUtc,reason}={}){
    // A loss only matters where a window could have claimed the moment: a tick
    // before the window began (a late redelivery of something older) is already
    // uncovered by definition and must not fabricate a loss inside this window.
    // (An open window's newest sample may trail the observation by up to a frame or two.)
    const inside=x=>tickOk(tick)&&tick>=x.startTick&&
      tick<=(Object.hasOwn(x,'retiredEnd')?(x.retiredEnd?.tick??-1):
        x.last.tick+(x.status==='open'?cfg.maxTickGapMs:0));
    let w=characterId?open.get(characterId):null;
    if(w&&!inside(w))w=null;
    if(!w&&observerCaptureRef)
      w=[...open.values()].find(x=>x.ownerProof.observerCaptureRef===observerCaptureRef&&inside(x))??null;
    if(!w&&observerCaptureRef)
      w=[...closing].reverse().find(x=>x.ownerProof.observerCaptureRef===observerCaptureRef&&inside(x))??null;
    if(!w||!isUuid(observationId)||!tickOk(tick)||typeof receivedUtc!=='string'){
      bump('gapsUnattributed');return false;
    }
    // Coalesce a burst of same-reason losses into ONE not-yet-durable gap so a
    // 10k-observation overload cannot flood the ledger. Already-durable gaps are
    // never rewritten; a later loss opens a new row.
    for(const g of gaps.values()){
      if(g.characterId===w.characterId&&g.timelineId===w.timelineId&&g.record.gapReason===reason&&
         tick>=g.record.startTick&&tick-g.record.endTick<=cfg.gapCoalesceMs){
        const r=g.record;
        gaps.set(r.coverageId,{...g,record:Object.freeze({...r,
          endTick:Math.max(r.endTick,tick),endUtc:receivedUtc>r.endUtc?receivedUtc:r.endUtc,
          frames:r.frames+1})});
        bump('gapsRecorded');kick(true);return true;
      }
    }
    if(gaps.size>=cfg.maxPendingGaps){
      // Cannot hold another loss durably: stop claiming anything further.
      degrade('gap_queue_overflow');return false;
    }
    const id=uuidFrom('M3-OBS-GAP',w.characterId,w.timelineId,observationId,reason);
    if(gaps.has(id))return true;
    gaps.set(id,{characterId:w.characterId,windowId:w.coverageId,timelineId:w.timelineId,tick,record:Object.freeze({
      coverageId:id,kind:'gap',characterId:w.characterId,worldProfileId,timelineId:w.timelineId,
      processId,hostRunId:w.hostRunId,worldEpoch:w.worldEpoch,adapterEpoch:w.adapterEpoch,
      streamId:w.streamId,ownerProof:w.ownerProof,startTick:tick,endTick:tick,
      startUtc:receivedUtc,endUtc:receivedUtc,status:'closed',closeReason:reason,
      frames:1,firstSequence:w.firstSequence,lastSequence:w.last.sequence,
      basis:'lost_observation',observationId,gapReason:reason})});
    bump('gapsRecorded');
    kick(true);
    return true;
  }
  function degrade(reason){
    if(degradedReason)return;
    degradedReason=reason;stats.degraded=true;
    closeAll('ledger_degraded');emit('degraded',{reason});
  }

  // ------------------------------------------------------------- persistence
  function desiredEnd(w){
    if(Object.hasOwn(w,'retiredEnd'))return w.retiredEnd;
    const hold=Math.min(minPending(w),minGap(w))-1;
    // An open window has not settled up to its last sample; a closed window
    // is final (no more upstream samples are expected for it).
    let limit=w.status==='open'?w.last.tick-cfg.settleMs:w.last.tick;
    limit=Math.min(limit,hold);
    if(limit<w.startTick)return null;
    let pick=null;
    for(const h of w.history){if(h.tick<=limit)pick=h;else break;}
    return pick;
  }
  function windowRecord(w,end){
    return {coverageId:w.coverageId,kind:'window',characterId:w.characterId,worldProfileId,
      timelineId:w.timelineId,processId,hostRunId:w.hostRunId,worldEpoch:w.worldEpoch,
      adapterEpoch:w.adapterEpoch,streamId:w.streamId,ownerProof:w.ownerProof,
      startTick:w.startTick,endTick:end.tick,startUtc:w.startUtc,endUtc:end.utc,
      status:w.status,closeReason:w.status==='closed'?w.closeReason:null,
      frames:end.frames,firstSequence:w.firstSequence,lastSequence:end.sequence,
      basis:'authenticated_owner_frames'};
  }
  function collect(force){
    const mono=monotonicNow(),ops=[],meta=[];
    for(const g of gaps.values()){
      if(ops.length>=127)break;
      ops.push({record:g.record});meta.push({gap:g.record.coverageId,sent:g.record});
    }
    for(const w of [...open.values(),...closing]){
      if(ops.length>=127)break;
      if(w.abandoned)continue;
      const end=desiredEnd(w);
      if(!end)continue;
      const endAdvanced=!w.persisted||end.tick>w.persisted.tick;
      const statusChange=w.status==='closed'&&w.persisted?.status!=='closed';
      if(!endAdvanced&&!statusChange)continue;
      const due=force||!w.persisted||w.status==='closed'||mono-w.lastEmitMono>=cfg.checkpointMs;
      if(!due)continue;
      const record=windowRecord(w,end);
      // Native owner samples remain useful with event intake disabled, but
      // cannot claim event-capture continuity. Persist an authenticated gap
      // spanning only those samples, without inventing an observation ID.
      ops.push({record:eventIntakeEnabled?record:{...record,kind:'gap',status:'closed',
        basis:'event_intake_disabled',gapReason:'event_intake_disabled',closeReason:'event_intake_disabled'}});
      meta.push({window:w,end});
    }
    // Seal earlier-process open windows as soon as this process has a sample to
    // stand behind, even before it has its own first coverage row to write.
    if(sealRequired&&(ops.length||stats.samples>0)){ops.unshift({seal:{worldProfileId,processId}});meta.unshift({seal:true});}
    return {ops,meta};
  }
  function kick(force){
    if(!durable||sourceSuspended||inFlight||closedFlag||monotonicNow()<retryAt)return;
    const {ops,meta}=collect(force);
    if(ops.length===0)return;
    const sentAt=monotonicNow();
    inFlight=(async()=>{
      try{
        const result=await persist(ops,{processId});
        const stale=new Set(result?.staleIndexes??[]);
        ops.forEach((op,index)=>{
          const m=meta[index];
          if(m.seal){if(!stale.has(index)){sealRequired=false;stats.sealed=true;}return;}
          if(stale.has(index)){
            // The store has moved on (epoch/timeline); this tail can never be
            // written. The persisted end simply stays where it was.
            bump('persistRejectedStale');
            if(m.gap&&gaps.get(m.gap)?.record===m.sent)gaps.delete(m.gap);
            if(m.window)m.window.abandoned=true;
            return;
          }
          // A loss coalesced into this gap AFTER it was sent stays queued (and
          // keeps holding the window back) until its extended row is written.
          if(m.gap){if(gaps.get(m.gap)?.record===m.sent)gaps.delete(m.gap);return;}
          const w=m.window;
          w.persisted={tick:m.end.tick,utc:m.end.utc,status:op.record.status};
          w.lastEmitMono=sentAt;
          w.history=w.history.filter(h=>h.tick>=w.persisted.tick);
          bump('checkpoints');
          if(w.persisted.status==='closed'&&
             (Object.hasOwn(w,'retiredEnd')||w.persisted.tick>=w.last.tick))closing.delete(w);
        });
      }catch(error){
        bump('persistFailures');
        const message=String(error?.message??error);
        retryAt=monotonicNow()+cfg.retryMs;
        // A durable-ledger invariant failure (identity conflict, corruption,
        // invalid record) is not transient: stop claiming coverage.
        const retryable=retryableWriteError(error,message);
        if(!retryable)degrade('ledger_write_rejected');
        emit('persist_failed',{code:diagnosticCode(error,message),errorType:diagnosticType(error),retryable});
      }finally{
        inFlight=null;
      }
    })();
  }
  async function idle(){
    for(let i=0;i<32;i++){
      if(inFlight){await inFlight;continue;}
      const failures=stats.persistFailures;
      retryAt=0;kick(true);
      if(!inFlight)break;
      await inFlight;
      if(stats.persistFailures>failures)break;
    }
    return snapshot();
  }
  function snapshot(){
    return Object.freeze({...stats,closedBy:{...stats.closedBy},sourceSuspended,
      open:open.size,closing:closing.size,
      pending:pending.size,unpersistedGaps:gaps.size,degradedReason,processId,
      basis:'authenticated_owner_frames',eventIntakeEnabled,durable,
      windows:[...open.values()].map(w=>({characterId:w.characterId,startTick:w.startTick,
        lastTick:w.last.tick,frames:w.frames,persistedEndTick:w.persisted?.tick??null}))});
  }
  return Object.freeze({sample,retire,noteQueued,noteSettled,noteLoss,degrade,idle,snapshot,
    async close(){retire('shutdown');await idle();closedFlag=true;}});
}
