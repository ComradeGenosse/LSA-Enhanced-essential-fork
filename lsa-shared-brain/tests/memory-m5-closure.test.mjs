import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {detectExplicitMemoryCommand} from '../src/memory/explicitCommands.mjs';
import {createM5RuntimeCoordinator,stableM5CommandId} from '../src/memory/m5RuntimeCoordinator.mjs';
import {createM5ScopedPrivacyFacade} from '../src/memory/m5ScopedPrivacyFacade.mjs';

const id=()=>randomUUID();
const at='2026-10-11T19:12:00.000Z';
const scope=()=>({characterId:id(),worldProfileId:id(),timelineId:id(),protagonistKey:'franklin'});
const line=(s,text,source='typed')=>({version:1,kind:'dialogue_line',recordId:id(),
 characterId:s.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,
 speaker:'player',source,delivery:'accepted',content:text,committedAtUtc:at,
 attribution:{protagonist:s.protagonistKey}});
const evidence=(s,text)=>({...line(s,text),occurredAtUtc:'2026-10-11T19:11:55.000Z',
 label:text,protagonistKey:s.protagonistKey});
const same=(a,b)=>a.characterId===b.characterId&&a.timelineId===b.timelineId&&
 a.worldProfileId===b.worldProfileId&&a.protagonistKey===b.protagonistKey;
function rig(s){
 const accepted=new Map(),candidates=[],commits=new Map(),pending=new Map(),revoked=new Set();
 let alive=true,throwCommit=false,verifyMissing=false,commitCount=0;
 const key=x=>[x.worldProfileId,x.timelineId,x.characterId,x.protagonistKey].join(':');
 const store={
  async verifyAcceptedLine({scope:owner,line:x}){
    const original=accepted.get(x.recordId);
    return !!original&&same(owner,s)&&JSON.stringify(original)===JSON.stringify(x);
  },
  async findCandidates({scope:owner,excludeRecordId}){
    return same(owner,s)?candidates.filter(x=>x.recordId!==excludeRecordId&&!revoked.has(x.recordId)):[];
  },
  async commitCommand(op){
    commitCount++;
    if(throwCommit || !same(op.scope,s))throw Error('private DB exception 4111111111111111');
    if(!accepted.has(op.requestedByLineId))throw Error('not accepted');
    if(op.targetRecordId&&revoked.has(op.targetRecordId))throw Error('deleted');
    const old=commits.get(op.commandId);if(old)return old;
    const receipt={commandId:op.commandId,requestedByLineId:op.requestedByLineId,
      operation:op.operation,status:'committed',durableCommit:true,
      memoryId:id(),evidenceRecordIds:op.evidenceRecordIds};
    commits.set(op.commandId,receipt);return receipt;
  },
  async verifyCommand({scope:owner,commandId}){
    return same(owner,s)&&!verifyMissing?commits.get(commandId)||null:null;
  },
  async saveClarification(item){
    if(!same(item.scope,s))throw Error('scope');
    if(pending.has(item.commandId))throw Error('replay mismatch');
    pending.set(item.commandId,{...structuredClone(item),expiresAtMs:Date.parse(at)+300000});
  },
  async getClarification({scope:owner,commandId,atUtc}){
    const found=pending.get(commandId);
    if(!found||!same(owner,found.scope)||found.closed ||
      Date.parse(atUtc||at)>found.expiresAtMs ||
      found.alternatives.some(x=>revoked.has(x.recordId)))return null;
    return structuredClone(found);
  },
  async completeClarification({commandId}){const p=pending.get(commandId);if(p)p.closed=true;}
 };
 const authority={assertCurrent:()=>alive};
 const pendingClarifications={async findPendingClarification({scope:owner}){
   return [...pending.values()].find(x=>same(owner,x.scope)&&!x.closed)?.commandId ?
     {commandId:[...pending.values()].find(x=>same(owner,x.scope)&&!x.closed).commandId}:null;
 }};
 const sourceProof={nativeVerified:true};
 const accept=x=>accepted.set(x.recordId,structuredClone(x));
 const make=(extra={})=>createM5RuntimeCoordinator({
   commandStore:store,authority,pendingClarifications,...extra});
 return {s,store,authority,pendingClarifications,sourceProof,accept,make,candidates,
  commits,pending,revoked,get commitsAttempted(){return commitCount;},
  retire(){alive=false},throwOnCommit(){throwCommit=true},hideReadback(){verifyMissing=true}};
}

test('Casual remember, questions, and Luna interpretation cannot authorize a write',async()=>{
 assert.equal(detectExplicitMemoryCommand('Remember when we jumped off the pier?'),null);
 assert.equal(detectExplicitMemoryCommand('remember how silly that was'),null);
 assert.equal(detectExplicitMemoryCommand('remember to do laundry'),null);
 assert.equal(detectExplicitMemoryCommand('I remember that time.'),null);
 assert.equal(detectExplicitMemoryCommand('Remember?',{intent:'remember',content:'secret',targetType:'statement'}),null);
 const s=scope(),r=rig(s),x=line(s,'Remember when we crashed?');
 r.accept(x);
 assert.equal((await r.make().acceptAcceptedPlayerLine({line:x,scope:s,sourceProof:r.sourceProof})).handled,false);
 assert.equal(r.commitsAttempted,0);
});

test('Exact accepted bytes, stable IDs, idempotent replay and confidential telemetry',async()=>{
 const s=scope(),r=rig(s),text='Remember that my secret is 💜 café 4111111111111111';
 const x=line(s,text);r.accept(x);const events=[];
 const service=r.make({onTelemetry:x=>events.push(x)});
 const opts={line:x,scope:s,sourceProof:r.sourceProof};
 assert.equal(stableM5CommandId(opts),stableM5CommandId(opts));
 const first=await service.acceptAcceptedPlayerLine(opts);
 assert.deepEqual(first.actions.map(x=>x.outcome),['saved']);
 assert.equal(first.acknowledgements[0].text,'I saved that memory.');
 assert.equal(first.actions[0].durableCommit,true);
 const again=await service.acceptAcceptedPlayerLine(opts);
 assert.equal(again.actions[0].memoryId,first.actions[0].memoryId);
 assert.equal(r.commitsAttempted,1);
 assert.ok(!JSON.stringify([...events,first]).includes('4111111111111111'));
 assert.ok(!JSON.stringify([...events,first]).includes('café'));
 const forged={...x,content:text+'!'};const result=await service.acceptAcceptedPlayerLine({...opts,line:forged});
 assert.equal(result.status,'unverified_accepted_line');
});

test('Two character/protagonist and timeline gates reject forged and replayed sources',async()=>{
 const s=scope(),r=rig(s),x=line(s,'Remember that I love olives');r.accept(x);
 const wrong={...s,characterId:id()},altered={...s,protagonistKey:'trevor'};
 const service=r.make();
 assert.equal((await service.acceptAcceptedPlayerLine({line:x,scope:wrong})).status,'invalid_source');
 assert.equal((await service.acceptAcceptedPlayerLine({line:x,scope:altered})).status,'invalid_source');
 assert.equal((await service.acceptAcceptedPlayerLine({line:x,scope:{...s,timelineId:id()}})).status,'invalid_source');
 assert.equal(r.commitsAttempted,0);
 r.retire();
 assert.equal((await service.acceptAcceptedPlayerLine({line:x,scope:s})).status,'source_unavailable');
 assert.equal(r.commitsAttempted,0);
});

test('Frozen two-choice clarification survives coordinator recreation; no changed target',async()=>{
 const s=scope(),r=rig(s);
 const a=evidence(s,'The blue scooter'),b=evidence(s,'The red scooter');
 for(const x of [a,b]){r.candidates.push(x);r.accept(x);}
 const cmd=line(s,'Remember the scooter');r.accept(cmd);
 const initial=await r.make().acceptAcceptedPlayerLine({line:cmd,scope:s,sourceProof:r.sourceProof});
 assert.equal(initial.actions[0].outcome,'clarify');
 assert.deepEqual(initial.clarification.choices,[1,2]);
 assert.ok(!JSON.stringify(initial).includes('scooter'));
 const reply=line(s,'first');r.accept(reply);
 const resumed=await r.make().acceptAcceptedPlayerLine({line:reply,scope:s,sourceProof:r.sourceProof});
 assert.equal(resumed.actions[0].outcome,'saved');
 assert.ok(resumed.actions[0].evidenceRecordIds.includes(a.recordId)||
   resumed.actions[0].evidenceRecordIds.includes(b.recordId));
 assert.equal(resumed.acknowledgements[0].durableCommit,true);
 const unexpected=line(s,'second');r.accept(unexpected);
 assert.equal((await r.make().acceptAcceptedPlayerLine({line:unexpected,scope:s})).handled,false);
});

test('Expired or deleted offered clarification never resolves into a different candidate',async()=>{
 const s=scope(),r=rig(s);
 const a=evidence(s,'The blue scooter'),b=evidence(s,'The red scooter');
 for(const x of [a,b]){r.candidates.push(x);r.accept(x);}
 const cmd=line(s,'Remember the scooter');r.accept(cmd);
 await r.make().acceptAcceptedPlayerLine({line:cmd,scope:s});
 const reply=line(s,'first');r.accept(reply);r.revoked.add(a.recordId);
 const denied=await r.make().acceptAcceptedPlayerLine({line:reply,scope:s});
 assert.equal(denied.status,'expired_or_revoked');
 assert.equal(r.commitsAttempted,0);
 r.revoked.clear();
 for(const saved of r.pending.values())saved.expiresAtMs=0;
 assert.equal((await r.make().acceptAcceptedPlayerLine({line:reply,scope:s})).status,'expired_or_revoked');
});

test('Database exception, lost commit readback and compound mixed success cannot lie',async()=>{
 const s=scope(),r=rig(s),x=line(s,'Remember that I like beans');
 r.accept(x);r.throwOnCommit();
 const failed=await r.make().acceptAcceptedPlayerLine({line:x,scope:s});
 assert.equal(failed.actions[0].outcome,'failed');
 assert.equal(failed.acknowledgements[0].durableCommit,false);
 const t=rig(s),source=line(s,'Remember that I like beans');t.accept(source);
 t.hideReadback();
 const uncertain=await t.make().acceptAcceptedPlayerLine({line:source,scope:s});
 assert.equal(uncertain.actions[0].outcome,'failed');
 const u=rig(s),mixed=line(s,'Remember that I like beans; forget that');u.accept(mixed);
 // Second command ambiguously targets prior evidence and must not become success.
 const partial=await u.make().acceptAcceptedPlayerLine({line:mixed,scope:s});
 assert.deepEqual(partial.actions.map(a=>a.outcome),['saved','clarify']);
 assert.deepEqual(partial.acknowledgements.map(a=>a.durableCommit),[true,false]);
});

test('STT correction links source and correction without claiming direct GTA observation',async()=>{
 const s=scope(),r=rig(s),misheard={...evidence(s,'You said light'),'source':'stt'};
 r.candidates.push(misheard);r.accept(misheard);
 const correction=line(s,'No, I actually said night','stt');r.accept(correction);
 const result=await r.make().acceptAcceptedPlayerLine({line:correction,scope:s});
 assert.equal(result.actions[0].outcome,'corrected');
 assert.deepEqual(result.actions[0].evidenceRecordIds,[misheard.recordId,correction.recordId]);
 assert.equal(r.candidates[0].content,'You said light');
});

test('Spoken inspect/export redirects to private editor; no raw archive in turn',async()=>{
 const s=scope(),r=rig(s),x=line(s,'Export my memories');r.accept(x);
 const result=await r.make().acceptAcceptedPlayerLine({line:x,scope:s});
 assert.equal(result.route,'private_editor');
 assert.equal(result.status,'authorization_required');
 assert.equal(result.actions.length,0);
});

test('Private editor gates scoped access, readback receipts, secret confidentiality and purge verification',async()=>{
 const s=scope(),other={...s,protagonistKey:'trevor'},id1=id(),id2=id();
 const secret='password payment-user confidential';
 const ops=new Map(),spy=[];
 const privacyPort={
  async inspect({scope:owner}){spy.push('inspect');return {scope:owner,records:[{content:secret}]};},
  async exportArchive(){spy.push('export');return {json:secret};},
  async trash({operationId}){spy.push('trash');const rec={operationId,operation:'trash',targetIds:[id1],durableCommit:true};ops.set(operationId,rec);return rec;},
  async trashScope({operationId}){const rec={operationId,operation:'trash_scope',targetIds:[id1],durableCommit:true};ops.set(operationId,rec);return rec;},
  async restore({operationId}){const rec={operationId,operation:'restore',targetIds:[id1],durableCommit:true};ops.set(operationId,rec);return rec;},
  async purgeExpired(){spy.push('purge');return {kind:'m5_purge_result',purgedIds:[id1]};},
  async verifyPrivacy({operationId}){return ops.get(operationId)||null;}
 };
 const events=[];
 const make=()=>createM5ScopedPrivacyFacade({
  privacyPort,authorize:({scope:x,access})=>access==='owner'&&same(x,s),
  assertScopeCurrent:()=>true,onTelemetry:e=>events.push(e)
 });
 const facade=make();
 assert.equal((await facade.execute({operation:'export',scope:other,access:'owner'})).status,'denied');
 assert.equal((await facade.execute({operation:'inspect',scope:s,access:'stranger'})).status,'denied');
 assert.equal(spy.length,0);
 const ok=await facade.execute({operation:'inspect',scope:s,access:'owner'});
 assert.equal(ok.data.records[0].content,secret);
 assert.ok(!JSON.stringify(events).includes(secret));
 assert.equal((await facade.execute({operation:'trash',scope:s,access:'owner',recordId:id1})).status,'denied');
 const trashed=await facade.execute({operation:'trash',scope:s,access:'owner',recordId:id1,operationId:id2});
 assert.equal(trashed.status,'ok');
 assert.equal((await facade.execute({operation:'purge',scope:s,access:'owner'})).status,'verification_required');
 privacyPort.verifyPurge=async()=>({confirmed:true});
 assert.equal((await facade.execute({operation:'purge',scope:s,access:'owner'})).status,'ok');
 assert.ok(!JSON.stringify(events).includes(secret));
});

test('Privacy verifies AFTER read and rejects lost principal or forged SQL receipt',async()=>{
 const s=scope(),op=id(),record=id();let access=true;
 const privacyPort={
  inspect:async()=>({content:'private'}),exportArchive:async()=>({json:'private'}),
  trash:async()=>({operationId:op,operation:'trash',targetIds:[record],durableCommit:true}),
  trashScope:async()=>null,restore:async()=>null,purgeExpired:async()=>null,
  verifyPrivacy:async()=>null
 };
 const facade=createM5ScopedPrivacyFacade({privacyPort,
  authorize:()=>access,assertScopeCurrent:()=>true});
 assert.equal((await facade.execute({operation:'trash',scope:s,access:'owner',
  operationId:op,recordId:record})).status,'unavailable');
 privacyPort.inspect=async()=>{access=false;return {content:'private'};};
 assert.equal((await facade.execute({operation:'inspect',scope:s,access:'owner'})).status,'denied');
});

test('Correction clarification preserves original STT evidence and accepts exact typed replacement',async()=>{
 const s=scope(),r=rig(s),wrong={...evidence(s,'The sign said light'),source:'stt'};
 r.candidates.push(wrong);r.accept(wrong);
 const cmd=line(s,'Correct that');r.accept(cmd);
 const question=await r.make().acceptAcceptedPlayerLine({line:cmd,scope:s});
 assert.equal(question.actions[0].outcome,'clarify');
 assert.deepEqual(question.clarification.choices,[1]);
 const answer=line(s,'I actually said night');r.accept(answer);
 const correction=await r.make().acceptAcceptedPlayerLine({line:answer,scope:s});
 assert.equal(correction.actions[0].outcome,'corrected');
 assert.deepEqual(correction.actions[0].evidenceRecordIds,
   [wrong.recordId,cmd.recordId,answer.recordId]);
 assert.equal(wrong.content,'The sign said light');
});

test('Pending correction never substitutes a newly surfaced candidate for a frozen source',async()=>{
 const s=scope(),r=rig(s),first=evidence(s,'That sign was blue');
 const second=evidence(s,'That sign was red');
 r.candidates.push(first,second);r.accept(first);r.accept(second);
 const cmd=line(s,'Correct that');r.accept(cmd);
 assert.equal((await r.make().acceptAcceptedPlayerLine({line:cmd,scope:s})).actions[0].outcome,'clarify');
 const reply=line(s,'first: it was green');r.accept(reply);
 const frozenId=[...r.pending.values()][0].frozen[0].recordId;
 const slot=r.candidates.findIndex(candidate=>candidate.recordId===frozenId);
 assert.ok(slot>=0);
 r.candidates[slot]={...r.candidates[slot],content:'Changed behind your back'};
 const blocked=await r.make().acceptAcceptedPlayerLine({line:reply,scope:s});
 assert.equal(blocked.actions[0].outcome,'failed');
 assert.equal(r.commitsAttempted,0);
});
