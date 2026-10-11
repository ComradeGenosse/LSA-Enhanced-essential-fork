import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createM6SelectionCoordinator} from '../src/memory/m6Coordinator.mjs';
import {M6_CURSOR_CONTRACT_VERSION} from '../src/memory/m6CursorConsumer.mjs';

const uuid=()=>randomUUID();
const W=uuid(),T=uuid(),A=uuid(),B=uuid();
const a={characterId:A,worldProfileId:W,timelineId:T};
const b={characterId:B,worldProfileId:W,timelineId:T};
const start=Date.parse('2026-10-11T12:00:00Z');
const at=s=>new Date(start+s*1000).toISOString();
function line(scope,seconds,text='That was hilarious!',protagonist='franklin'){
  return {version:1,kind:'dialogue_line',...scope,recordId:uuid(),
    speaker:'player',source:'typed',delivery:'accepted',content:text,
    committedAtUtc:at(seconds),attribution:{protagonist,hostRunId:uuid(),
      worldEpoch:3,sessionId:uuid()}};
}
function event(scope,seconds,status='witnessed',type='bizarre_crash'){
  const sourceHash='a'.repeat(64);
  return {version:1,kind:'journal_event',...scope,recordId:uuid(),
    observationId:uuid(),receiptStatus:status,eventType:type,
    receivedAtUtc:at(seconds),sourceHash,
    ownerProof:{ownerAlias:'promoted.'+scope.characterId,
      hostRunId:uuid(),worldEpoch:3,incarnationId:uuid(),encounterId:uuid(),
      observerCaptureRef:uuid()},
    claims:[{kind:'crash',certainty:'direct',modality:'visual',
      durableSubject:'vehicle',sourceEvidenceId:uuid()}]};
}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function mockP2(evidence,{missingSidecar=false}={}){
  let seq=0;
  const rows=evidence.map(e=>({scope:e.characterId,seq:++seq,cursor:String(seq),
    evidence:e,sourceHash:hash(e)}));
  const checkpoints=new Map(),memory=new Map(),jobs=new Map(),suppressed=new Set(),
    corrections=new Set(),audit=[];
  let failStage=null,readPageHook=null;
  const cpFor=s=>{
    if(!checkpoints.has(s.characterId))checkpoints.set(s.characterId,
      {version:M6_CURSOR_CONTRACT_VERSION,cursor:null,activeHourCount:0,hourBucket:null});
    return checkpoints.get(s.characterId);
  };
  const fail=(stage,after=false)=>{
    if(failStage===stage+(after?':after':'')){
      failStage=null;throw Error('injected_'+stage+(after?'_after':''));
    }
  };
  const p2={
    worldProfileId:W,activeTimelineId:T,timelineWritable:true,
    get:id=>id===A||id===B?{promoted:true}:null,
    readM6Checkpoint:async({scope})=>({...cpFor(scope)}),
    readM6JournalPage:async({scope,afterCursor,limit})=>{
      fail('page');
      const items=rows.filter(r=>r.scope===scope.characterId&&
        (afterCursor===null||r.seq>Number(afterCursor)));
      const page=items.slice(0,limit);
      if(readPageHook)readPageHook();
      return {rows:page.map(({cursor,sourceHash,evidence})=>
        ({cursor,sourceHash,evidence})),hasMore:items.length>page.length};
    },
    listSuppressedMemoryIds:async()=>[...suppressed],
    readCorrectionOverlays:async()=>[...corrections].map(targetId=>({targetId})),
    readVerifiedEventEvidence:async({recordId})=>{
      if(missingSidecar)return null;
      const e=rows.find(r=>r.evidence.recordId===recordId)?.evidence;
      return e?{event:e,sourceEvidence:{sourceHash:e.sourceHash}}:null;
    },
    saveDeterministicMemory:async p=>{
      fail('save');
      if(!p.evidenceRecordIds.every(id=>rows.some(r=>r.evidence.recordId===id&&
        r.scope===p.characterId)))throw Error('unverified_save');
      if(p.evidenceRecordIds.some(id=>suppressed.has(id)||corrections.has(id)))
        throw Error('source_suppressed_at_db');
      const prev=memory.get(p.proposalId);
      if(prev&&JSON.stringify(prev)!==JSON.stringify(p))throw Error('proposal_conflict');
      memory.set(p.proposalId,p);
      fail('save',true);
      return {recordId:p.proposalId,inserted:!prev};
    },
    enqueueCurationJob:async({job})=>{
      fail('queue');
      if(!memory.has(job.jobId))throw Error('queue_without_memory');
      const was=jobs.has(job.jobId);
      jobs.set(job.jobId,job);
      fail('queue',true);
      return {jobId:job.jobId,inserted:!was};
    },
    ackM6Checkpoint:async({scope,expectedCursor,nextCursor,sourceHashes,
      savedProposalIds,rejected,cloudQueueEnabled,hourBucket})=>{
      fail('ack');
      const cp=cpFor(scope);
      if(cp.cursor!==expectedCursor)throw Error('cursor_cas_rejected');
      const sourceInWindow=rows.filter(r=>r.scope===scope.characterId&&
        (expectedCursor===null||r.seq>Number(expectedCursor))&&r.seq<=Number(nextCursor));
      if(JSON.stringify(sourceHashes.map(s=>[s.cursor,s.sourceHash]))!==
         JSON.stringify(sourceInWindow.map(s=>[s.cursor,s.sourceHash])))
        throw Error('source_hashes_did_not_cover_cursor');
      for(const id of savedProposalIds){
        if(!memory.has(id)||(cloudQueueEnabled&&!jobs.has(id)))
          throw Error('uncommitted_result_before_ack');
      }
      audit.push({scope:scope.characterId,expectedCursor,nextCursor,
        rejected:[...rejected],savedProposalIds:[...savedProposalIds]});
      const admitted=cp.activeHourCount+savedProposalIds.length;
      checkpoints.set(scope.characterId,{version:1,cursor:nextCursor,hourBucket,activeHourCount:admitted});
      fail('ack',true);
      return {committed:true,cursor:nextCursor};
    },
    failNext:stage=>{failStage=stage;},
    onNextPage:fn=>{readPageHook=fn;},
    memory,jobs,checkpoints,audit,suppressed,corrections
  };
  return p2;
}
const make=(store,extra={})=>createM6SelectionCoordinator({
  store,quietMs:0,pageSize:128,maxRows:8192,maxPages:64,...extra});

test('production refuses missing P2 cursor methods, even for an apparently small journal',()=>{
  assert.throws(()=>make({worldProfileId:W,activeTimelineId:T,timelineWritable:true}),
    /m6_store_missing_/);
  assert.throws(()=>make({...mockP2([]),ackM6Checkpoint:undefined}),
    /m6_durable_cursor_required_ackM6Checkpoint/);
});

test('2,500 committed source rows paginate beyond latest 1,000; restart uses checkpoint',async()=>{
  const records=Array.from({length:2500},(_,i)=>line(a,i*2,
    i%64===0?'That was hilarious!':'Just driving.'));
  const store=mockP2(records),coordinator=make(store);
  const result=await coordinator.recover({scope:a,atUtc:at(6000)});
  assert.equal(result.readCount,2500);
  assert.equal(result.archiveComplete,true);
  assert.equal(result.acknowledged,true);
  assert.equal(result.toCursor,'2500');
  assert.ok(result.saved.length>6,'funny 2,500-line hour must survive soft budget');
  assert.equal(new Set(result.saved.map(s=>s.proposalId)).size,result.saved.length);
  const count=store.memory.size;
  const afterRestart=await make(store).recover({scope:a,atUtc:at(6001)});
  assert.equal(afterRestart.readCount,0);
  assert.equal(afterRestart.saved.length,0);
  assert.equal(store.memory.size,count);
  assert.equal(store.checkpoints.get(A).cursor,'2500');
});

test('failures at read/save/queue/ack before and after commit never advance early',async()=>{
  for(const stage of ['page','save','save:after','queue','queue:after','ack','ack:after']){
    const e=line(a,0),store=mockP2([e]),runner=make(store,{cloudQueueEnabled:true});
    store.failNext(stage);
    await assert.rejects(runner.onSceneClose({scope:a,atUtc:at(30)}),/injected_/);
    if(stage!=='ack:after')
      assert.equal(store.checkpoints.get(A)?.cursor??null,null,stage);
    const retry=await make(store,{cloudQueueEnabled:true})
      .recover({scope:a,atUtc:at(31)});
    assert.equal(store.memory.size,1,stage);
    assert.equal(store.jobs.size,1,stage);
    assert.equal(store.checkpoints.get(A).cursor,'1',stage);
    assert.equal(retry.saved.length,stage==='ack:after'?0:1,stage);
    assert.equal((await runner.onIdle({scope:a,atUtc:at(32)})).saved.length,0);
  }
});

test('queue insertion outage preserves saved deterministic fact and retries without Luna',async()=>{
  const store=mockP2([line(a,0)]),withQueue=make(store,{cloudQueueEnabled:true});
  store.failNext('queue');
  await assert.rejects(withQueue.onSceneClose({scope:a,atUtc:at(10)}),/injected_queue/);
  assert.equal(store.memory.size,1);
  assert.equal(store.jobs.size,0);
  assert.equal(store.checkpoints.get(A)?.cursor??null,null);
  await make(store,{cloudQueueEnabled:true}).recover({scope:a,atUtc:at(11)});
  assert.equal(store.memory.size,1);
  assert.equal(store.jobs.size,1);
  const offlineStore=mockP2([line(a,0)]);
  const receipt=await make(offlineStore).onSceneClose({scope:a,atUtc:at(10)});
  assert.equal(receipt.saved.length,1);
  assert.equal(offlineStore.jobs.size,0);
});

test('distinct promoted NPCs and proven protagonists never merge evidence',async()=>{
  const inputs=[line(a,0,'That was hilarious!','franklin'),
    line(a,10,'That was hilarious!','trevor'),
    line(b,15,'That was hilarious!','franklin')];
  const store=mockP2(inputs);
  const c=make(store);
  await c.onSceneClose({scope:a,atUtc:at(60)});
  await c.onSceneClose({scope:b,atUtc:at(60)});
  assert.equal(store.memory.size,3);
  assert.equal(store.checkpoints.get(A).cursor,'2');
  assert.equal(store.checkpoints.get(B).cursor,'3');
  assert.equal(new Set([...store.memory.values()].map(p=>p.characterId)).size,2);
});

test('reported PS2 receipts cannot become witnessed facts; missing sidecar blocks checkpoint',async()=>{
  const reported=event(a,0,'reported'),store=mockP2([reported]);
  const result=await make(store).onSceneClose({scope:a,atUtc:at(60)});
  assert.equal(result.candidateCount,0);
  assert.equal(store.memory.size,0);
  assert.equal(store.audit[0].rejected[0].recordId,reported.recordId);
  const real=event(a,0),broken=mockP2([real],{missingSidecar:true});
  await assert.rejects(make(broken).onSceneClose({scope:a,atUtc:at(60)}),
    /m6_verified_event_sidecar_missing/);
  assert.equal(broken.checkpoints.get(A)?.cursor??null,null);
  assert.equal(broken.memory.size,0);
});

test('forget and correction suppress sources; no accidental privacy resurrection',async()=>{
  const x=line(a,0,'That was hilarious!'),y=line(a,200,'I promise I will help you.');
  const store=mockP2([x,y]);
  store.suppressed.add(x.recordId);
  store.corrections.add(y.recordId);
  const r=await make(store).onSceneClose({scope:a,atUtc:at(500)});
  assert.equal(r.candidateCount,0);
  assert.equal(store.memory.size,0);
  assert.equal(r.rejected.length,2);
  assert.equal(store.checkpoints.get(A).cursor,'2');
});

test('250 extraordinary jokes exceed target softly; routine utterances alone stay archived',async()=>{
  const rows=Array.from({length:250},(_,i)=>line(a,i*120,
    i%2===0?'That was hilarious!':'A bizarre, ridiculous prank!'));
  const store=mockP2(rows);
  const r=await make(store).onSceneClose({scope:a,atUtc:at(31000)});
  assert.ok(r.saved.length>6);
  assert.equal(store.memory.size,r.saved.length);
  const boring=mockP2([line(a,0,'Hi there')]);
  await make(boring).onSceneClose({scope:a,atUtc:at(10)});
  assert.equal(boring.memory.size,0);
});

test('scope suspension, page tampering, and quiet cutoff never claim unprocessed proof',async()=>{
  const old=line(a,0),future=line(a,1000),store=mockP2([old,future]);
  const r=await make(store,{quietMs:90_000,pageSize:1}).onIdle({scope:a,atUtc:at(200)});
  assert.equal(r.readCount,1);
  assert.equal(r.toCursor,'1');
  assert.equal(r.archiveComplete,false);
  assert.equal(store.checkpoints.get(A).cursor,'1');
  store.activeTimelineId=uuid();
  await assert.rejects(make(store).recover({scope:a,atUtc:at(5000)}),
    /m6_timeline_not_writable/);
  store.activeTimelineId=T;
  const next=await make(store).recover({scope:a,atUtc:at(5000)});
  assert.equal(next.toCursor,'2');
  const tampered=mockP2([line(a,0)]);
  const page=tampered.readM6JournalPage;
  tampered.readM6JournalPage=async opts=>{
    const res=await page(opts);
    return {...res,rows:res.rows.map(e=>({...e,sourceHash:'a'.repeat(64)}))};
  };
  await assert.rejects(make(tampered).onSceneClose({scope:a,atUtc:at(10)}),
    /m6_cursor_source_hash_mismatch/);
  assert.equal(tampered.checkpoints.get(A)?.cursor??null,null);
});

test('timeline changes after paginated read also stop save and cursor CAS',async()=>{
  const store=mockP2([line(a,0)]);
  store.onNextPage(()=>{store.timelineWritable=false;});
  await assert.rejects(make(store).onSceneClose({scope:a,atUtc:at(10)}),
    /m6_timeline_not_writable/);
  assert.equal(store.memory.size,0);
  assert.equal(store.checkpoints.get(A)?.cursor??null,null);
});
