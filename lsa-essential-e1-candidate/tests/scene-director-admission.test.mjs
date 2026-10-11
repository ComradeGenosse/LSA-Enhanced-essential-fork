import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectorSpeechReservations} from '../src/perception/sceneDirectorAdmission.mjs';
import {directorSpeechLimitsForPreset} from '../src/perception/sceneDirector.mjs';
const speaker='d34713cd-ff8e-4ab3-9f83-241a8cf812c7';
const player='24846870-fdcc-444f-9aca-7487d4c01048';
const p={kind:'speech',speakerCaptureRef:speaker,playerCaptureRef:player,
 observationId:'c9f50874-c003-4437-a944-9200cf6e30e5',observationRevision:1,
 decisionKey:'decision-1',policyVersion:1,urgency:'routine',expiresAtMonotonicMs:120000};
const stamp={hostRunId:'native-run',worldEpoch:1,speakerCaptureRef:speaker,
 playerCaptureRef:player,ownerIncarnationId:'owned-instance',proofRevision:1,
 playerTurnVersion:0,policyVersion:1};
const tuple={pedId:'58',sessionNonce:1,turnId:'a',generationId:2};
let now, allowed, acks, stages, ctr;
function harness(opts={}){
 now=100000;allowed=true;acks=[];stages=[];let counter=0;
 ctr=new DirectorSpeechReservations({
  now:()=>now, enabled:true,uuid:()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,
  checkCurrent:({stage})=>{stages.push(stage);return allowed;},
  acknowledge:(...args)=>{acks.push(args.slice(0,3));return true;},...opts,
 });
 return ctr;
}
test('default off and required independent validator',()=>{
 assert.throws(()=>new DirectorSpeechReservations({now:()=>0,acknowledge:()=>true}),/director_dependencies/);
 const c=harness({enabled:false});assert.equal(c.reserve(p,stamp),null);
});
test('strict one-use ticket and exact matching successful native playback',()=>{
 const c=harness();const t=c.reserve(p,stamp);assert.equal(t.priority,'director_routine');
 assert.equal(t.dedupeKey,`ps:${t.ticketId}`);
 assert.equal(c.consume(t.ticketId,stamp),true);assert.equal(c.consume(t.ticketId,stamp),false);
 assert.equal(c.afterHydration(t.ticketId,stamp),true);
 assert.equal(c.beforePublication(t.ticketId,stamp),true);
 assert.equal(c.bindNativeTuple(t.ticketId,stamp,tuple),true);
 assert.equal(c.finish(t.ticketId,{...tuple,generationId:3},{type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),false);
 assert.equal(acks.length,0);
 assert.equal(c.finish(t.ticketId,tuple,{type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),true);
 assert.deepEqual(acks,[['decision-1','ps6_ticket','delivered']]);
 assert.equal(c.finish(t.ticketId,tuple,{type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),false);
});
test('noncompleted and partial playback never acknowledge and never retry same grant',()=>{
 const c=harness();const t=c.reserve(p,stamp);c.consume(t.ticketId,stamp);c.bindNativeTuple(t.ticketId,stamp,tuple);
 assert.equal(c.finish(t.ticketId,tuple,{type:'playback_ended',reason:'completed',wasInterrupted:true,hadAudio:true,playbackStarted:true}),false);
 assert.deepEqual(acks,[]);now+=24000;assert.equal(c.reserve(p,stamp),null);
});
test('exact world/host/owner/proof/player turn version fences each async boundary',()=>{
 for(const field of ['hostRunId','worldEpoch','ownerIncarnationId','proofRevision','playerTurnVersion','policyVersion']){
  const c=harness(),t=c.reserve(p,stamp);
  const changed={...stamp,[field]:typeof stamp[field]==='string'?'changed':stamp[field]+1};
  assert.equal(c.consume(t.ticketId,changed),false,field);
  assert.deepEqual(acks,[]);
 }
 for(const stage of ['afterHydration','beforePublication','bindNativeTuple']){
  const c=harness(),t=c.reserve(p,stamp);c.consume(t.ticketId,stamp);allowed=false;
  assert.equal(stage==='bindNativeTuple'?c.bindNativeTuple(t.ticketId,stamp,tuple):c[stage](t.ticketId,stamp),false,stage);
  assert.equal(c.active,null);
 }
});
test('refuses unsupported/unknown admission and catches validator exceptions',()=>{
 const c=harness();allowed=false;assert.equal(c.reserve(p,stamp),null);
 const c2=harness({checkCurrent:()=>{throw new Error('offline')}});
 assert.equal(c2.reserve(p,stamp),null);
 const c3=harness();assert.equal(c3.reserve({...p,command:'DO FOLLOW'},stamp),null);
});
test('ticket expiry, scene/speaker bounds, failed attempts and reset',()=>{
 const c=harness();const t=c.reserve(p,stamp);
 now=102000;assert.equal(c.consume(t.ticketId,stamp),false);
 now+=20000;assert.equal(c.reserve({...p,decisionKey:'decision-2',expiresAtMonotonicMs:130000},stamp)?.priority,'director_routine');
 assert.equal(c.reserve({...p,decisionKey:'decision-3',expiresAtMonotonicMs:130000},stamp),null);
 c.reset();assert.equal(c.active,null);assert.equal(c.reserve(p,stamp),null); // original evidence has expired
});
test('at most four failed starts per minute and no callback on aborted proposal',()=>{
 const c=harness();
 for(let i=0;i<4;i++){allowed=false;assert.equal(c.reserve({...p,decisionKey:'d'+i},stamp),null);}
 allowed=true;assert.equal(c.reserve({...p,decisionKey:'d4'},stamp),null);
 now+=61000;assert.equal(c.reserve({...p,decisionKey:'d4',expiresAtMonotonicMs:170000},stamp)?.priority,'director_routine');
 assert.deepEqual(acks,[]);
});
test('disabled transition cancels pending; later playback does nothing',()=>{
 const c=harness(),t=c.reserve(p,stamp);
 c.consume(t.ticketId,stamp);c.bindNativeTuple(t.ticketId,stamp,tuple);
 c.setEnabled(false);
 assert.equal(c.finish(t.ticketId,tuple,{type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),false);
 assert.deepEqual(acks,[]);
});

test('pre-admission evidence expiry does not retroactively cancel a long successful TTS playback',()=>{
 const c=harness();
 const t=c.reserve(p,stamp);
 assert.equal(c.consume(t.ticketId,stamp),true);
 assert.equal(c.afterHydration(t.ticketId,stamp),true);
 assert.equal(c.beforePublication(t.ticketId,stamp),true);
 assert.equal(c.bindNativeTuple(t.ticketId,stamp,tuple),true);
 now=140000; // playback completed after original candidate TTL, with exact live host/owner retained
 assert.equal(c.finish(t.ticketId,tuple,{type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),true);
 assert.deepEqual(acks,[['decision-1','ps6_ticket','delivered']]);
});


test('testing preset lowers routine/urgent/scene cooldowns, preserving source gates and native rate ceiling',()=>{
 const limits=directorSpeechLimitsForPreset('testing');
 assert.equal(limits.routineSpeakerCooldownMs,5000);
 assert.equal(limits.urgentSpeakerCooldownMs,2000);
 assert.equal(limits.sceneGapMs,2000);
 assert.equal(limits.attemptsPerMinute,12);
 const c=harness({limits});
 const first=c.reserve(p,stamp);
 assert.ok(first);assert.equal(c.cancel(first.ticketId),true);
 now+=2000;
 assert.equal(c.reserve({...p,decisionKey:'next-2'},stamp),null,'routine cooldown still applies');
 now+=3000;
 const second=c.reserve({...p,decisionKey:'next-3'},stamp);
 assert.ok(second,'routine speech can occur after five seconds');
 assert.equal(c.active?.id,second.ticketId);
 // Do not permit more than one outstanding reservation even in testing.
 assert.equal(c.reserve({...p,decisionKey:'other'},stamp),null);
 const normal=harness({limits:directorSpeechLimitsForPreset('normal')});
 const a=normal.reserve(p,stamp);normal.cancel(a.ticketId);
 now+=5000;assert.equal(normal.reserve({...p,decisionKey:'other'},stamp),null);
});



test('testing preset allows up to twelve rejected attempts per minute and rejects the thirteenth',()=>{
 const c=harness({limits:directorSpeechLimitsForPreset('testing')});
 allowed=false;
 for(let i=0;i<12;i++)
  assert.equal(c.reserve({...p,decisionKey:'test-unique-'+i},stamp),null);
 assert.equal(c.reserve({...p,decisionKey:'test-unique-12'},stamp),null);
 assert.equal(c.lastReserveFailure,'rate_limited');
 now+=60001;allowed=true;
 const retry=c.reserve({...p,decisionKey:'new-window',expiresAtMonotonicMs:180000},stamp);
 assert.ok(retry,'quota resets only after elapsed window');
});
