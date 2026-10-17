import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ActivityEngine} from '../src/activities/activityEngine.mjs';
import {loadCapabilityRegistry} from '../src/activities/capabilityRegistry.mjs';
import {normalizeActivityConfig} from '../src/activities/contracts.mjs';
import {projectActivityKnowledge,assertActivityKnowledgeCurrent,captureActivityKnowledge,releaseActivityKnowledge} from '../src/activities/activityKnowledge.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../src/context/knowledgeRenderer.mjs';

function fixture() {
 let now=1000;
 const registry=loadCapabilityRegistry();
 const binding={characterId:randomUUID(),encounterId:randomUUID(),incarnationId:randomUUID(),
  hostContext:{hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1}};
 const nativeRun=randomUUID(),adapterEpoch=randomUUID();
 const engine=new ActivityEngine({registry,
  config:normalizeActivityConfig({mode:'on',passedProbes:registry.get('hold_position').probes}),
  id:randomUUID,now:()=>now,onCommand:()=>{}});
 engine.noteHello({type:'hello',nativeRun,adapterEpoch,capabilities:{hold_position:true},...binding.hostContext});
 const proposal={proposalVersion:1,proposalId:randomUUID(),source:'player_ux',
  subject:{characterId:binding.characterId},intent:'hold_position',slots:{},
  priority:'ambient',origin:{},proposedAtMs:now};
 assert.equal(engine.assign(proposal,{...binding,ownerAlias:'promoted.'+binding.characterId,ownershipToken:randomUUID()}).ok,true);
 const activities={client:{runtime:{ready:true,nativeRun,adapterEpoch,hostContext:binding.hostContext}},
  factsForCharacter:b=>engine.factsForCharacter(b),stateForCharacter:b=>engine.stateForCharacter(b)};
 const captured=()=>({version:1,binding,facts:engine.factsForCharacter(binding),
  state:engine.stateForCharacter(binding),nativeRun,adapterEpoch,ownerPendingProof:false,reason:null});
 return {engine,activities,binding,captured,setNow:value=>{now=value;}};
}

test('ACT4 reports admitted requests without claiming physical completion or exposing identity',()=>{
 const f=fixture(),input=f.captured(),projected=projectActivityKnowledge(input);
 assert.equal(input.state.status,'admitting');
 assert.equal(input.state.physicallyCompleted,false);
 assert.match(projected.facts[0].text,/Physical execution has not been verified/);
 assert.equal(projected.references[0].kind,'activity_state');
 const frame=renderKnowledge({activityInputs:input,includeActivityFacts:true,
  input:'What are you doing?',source:'player_text'});
 const model=JSON.stringify(frame.modelAllocation);
 assert.match(model,/activity_state/);
 for(const secret of [f.binding.characterId,f.binding.encounterId,f.binding.incarnationId,
  input.state.activityId,input.state.leaseId,input.nativeRun,input.adapterEpoch])
  assert.ok(!model.includes(secret));
 assert.equal(assertActivityKnowledgeCurrent(input,f.activities,frame.activityReferences),null);
 const onlyState=pruneKnowledgeFrame(frame,()=>true,ref=>ref.kind==='activity_state');
 assert.equal(onlyState.activityReferences.length,1);
 assert.equal(JSON.parse(onlyState.modelAllocation.scene).lanes.SELF.selfFacts.length,1);
});

test('ACT4 paused, cancellation and native retirement are truthful and cannot replay stale state',()=>{
 const f=fixture(),initial=f.captured(),oldRef=projectActivityKnowledge(initial).references[0];
 assert.equal(f.engine.pause(f.binding.characterId).ok,true);
 const paused=f.captured(),text=projectActivityKnowledge(paused).facts[0].text;
 assert.match(text,/paused, not completed/);
 assert.match(text,/Conversation alone does not resume/);
 assert.equal(paused.state.modeObserved,false);
 assert.equal(assertActivityKnowledgeCurrent(initial,f.activities,[oldRef]),'participant_retired');
 assert.equal(f.engine.cancel(f.binding.characterId).ok,true);
 const cancelled=f.captured();
 assert.equal(cancelled.state.status,'cancelled');
 assert.equal(cancelled.state.physicallyCompleted,false);
 assert.match(projectActivityKnowledge(cancelled).facts[0].text,/ended as cancelled/);
 assert.equal(assertActivityKnowledgeCurrent(paused,f.activities,[projectActivityKnowledge(paused).references[0]]),'participant_retired');
 f.setNow(61_002);
 assert.equal(f.engine.stateForCharacter(f.binding),null);
 f.engine.ingest({type:'lease.changed',encounterId:f.binding.encounterId,reason:'retired',leaseEpoch:2});
 assert.equal(f.engine.stateForCharacter(f.binding),null);
});

test('ACT4 mode evidence and physical completion require distinct verified facts',()=>{
 const f=fixture(),activity=f.engine.activities.at(-1);
 activity.status='running';activity.leaseEpoch=1;
 assert.equal(f.engine.stateForCharacter(f.binding).modeObserved,false);
 f.engine.facts.record({characterId:f.binding.characterId,activityId:activity.activityId,
  goalId:activity.goalId,intent:activity.template,kind:'mode_established',evidence:'mode_flag'},
  {...f.binding.hostContext,encounterId:f.binding.encounterId,incarnationId:f.binding.incarnationId});
 activity.act4ModeStepId=activity.steps[activity.cursor].stepId;
 assert.equal(f.engine.stateForCharacter(f.binding).modeObserved,true);
 assert.match(projectActivityKnowledge(f.captured()).facts[0].text,/does not establish arrival/);
 activity.status='completed';activity.terminal={status:'completed',reason:'already_satisfied',atMs:1000};
 assert.equal(f.engine.stateForCharacter(f.binding).physicallyCompleted,false);
 assert.match(projectActivityKnowledge(f.captured()).facts[0].text,/physical completion was not verified/);
 f.engine.facts.record({characterId:f.binding.characterId,activityId:activity.activityId,
  goalId:activity.goalId,intent:activity.template,kind:'completed',evidence:'world_strong'},
  {...f.binding.hostContext,encounterId:f.binding.encounterId,incarnationId:f.binding.incarnationId});
 activity.act4CompletedStepId=activity.steps[activity.cursor].stepId;
 assert.equal(f.engine.stateForCharacter(f.binding).physicallyCompleted,true);
 assert.match(projectActivityKnowledge(f.captured()).facts[0].text,/physically completed with supporting native evidence/);
});

test('ACT4 rejects incorrect host, body, lease replacement and unfamiliar state content',()=>{
 const f=fixture(),initial=f.captured(),ref=projectActivityKnowledge(initial).references[0];
 assert.equal(f.engine.stateForCharacter({...f.binding,incarnationId:randomUUID()}),null);
 assert.equal(f.engine.stateForCharacter({...f.binding,hostContext:{...f.binding.hostContext,worldEpoch:2}}),null);
 assert.equal(assertActivityKnowledgeCurrent(initial,f.activities,[{...ref,snapshot:{...ref.snapshot,status:'completed'}}]),'revision_mismatch');
 const activity=f.engine.activities.at(-1);activity.leaseEpoch=123;
 assert.equal(assertActivityKnowledgeCurrent(initial,f.activities,[ref]),'participant_retired');
 const malicious={...initial,state:{...initial.state,intent:'invent_a_task'}};
 assert.equal(projectActivityKnowledge(malicious).facts.some(x=>x.kind==='activity_state'),false);
 f.engine.noteHello({clientRestart:true});
 assert.equal(f.engine.stateForCharacter(f.binding),null);
});

test('ACT4 P0 capture preserves the original owner state and rejects a later native lifecycle change',()=>{
 const f=fixture();
 const turn={pedId:'17',turnId:'request',generationId:1,sessionNonce:1};
 const claim={incarnationId:f.binding.incarnationId,worldProfileId:randomUUID(),
  sourceNamespace:'lsa.promoted-characters',sourceKey:'promoted.'+f.binding.characterId,
  adapterEpoch:randomUUID(),claimRevision:1};
 const knowledgeInputs={turn,association:{owned:true,captureRef:randomUUID(),
   encounterId:f.binding.encounterId,incarnationId:f.binding.incarnationId},
  ownerClaim:claim,hostRunId:f.binding.hostContext.hostRunId,worldEpoch:1,reason:null};
 const characterInputs={identity:turn,profile:{characterId:f.binding.characterId},claim};
 const captured=captureActivityKnowledge({knowledgeInputs,characterInputs,activities:f.activities});
 assert.equal(captured.ownerPendingProof,true);
 assert.equal(projectActivityKnowledge(captured).facts.length,0);
 const released=releaseActivityKnowledge(captured,f.binding.characterId);
 assert.equal(released.state.status,'admitting');
 assert.equal(projectActivityKnowledge(released).facts[0].kind,'activity_state');
 assert.equal(assertActivityKnowledgeCurrent(released,f.activities),null);
 f.engine.pause(f.binding.characterId);
 assert.equal(released.state.status,'admitting'); // No post-P0 mutation/refill.
 assert.equal(assertActivityKnowledgeCurrent(released,f.activities),'participant_retired');
});

test('ACT4 honors ACT3 step evidence boundaries and narrates supported intent names',()=>{
 const f=fixture(),activity=f.engine.activities.at(-1);
 const previous=activity.steps[0];
 const next={...previous,stepId:randomUUID(),capability:'stop_and_face',status:'pending'};
 activity.steps=[previous,next];activity.template='approach_and_face';activity.leaseEpoch=2;
 activity.cursor=1;activity.status='running';
 activity.act4ModeStepId=previous.stepId; // Previous step's mode must not leak.
 activity.act4CompletedStepId=previous.stepId; // Previous physical completion is not the whole plan.
 const active=f.engine.stateForCharacter(f.binding);
 assert.equal(active.intent,'approach_and_face');
 assert.equal(active.capability,'stop_and_face');
 assert.equal(active.modeObserved,false);
 assert.match(projectActivityKnowledge(f.captured()).facts[0].text,/come over and face the player/);
 activity.act4ModeStepId=next.stepId;
 assert.equal(f.engine.stateForCharacter(f.binding).modeObserved,true);
 activity.status='completed';
 activity.terminal={status:'completed',reason:'already_satisfied',atMs:1000};
 assert.equal(f.engine.stateForCharacter(f.binding).physicallyCompleted,false);
 activity.act4CompletedStepId=next.stepId; // Only matching final-step strong receipt qualifies.
 assert.equal(f.engine.stateForCharacter(f.binding).physicallyCompleted,true);
});

test('ACT4 never infers whole-plan completion from an earlier ACT3 step receipt',()=>{
 const f=fixture(),activity=f.engine.activities.at(-1);
 const first=activity.steps[0];
 activity.steps=[first,{...first,stepId:randomUUID(),capability:'hold_position',status:'pending'}];
 activity.template='exit_vehicle_and_hold';activity.cursor=0;
 activity.act4CompletedStepId=first.stepId;
 activity.cursor=1;
 activity.status='completed';
 activity.terminal={status:'completed',reason:'already_satisfied',atMs:1000};
 assert.equal(f.engine.stateForCharacter(f.binding).physicallyCompleted,false);
});

test('ACT3 multi-step native receipts never advertise intermediate completion as whole-plan success',()=>{
 const f=fixture(),activity=f.engine.activities.at(-1);
 const first=activity.steps[0],second={...first,stepId:randomUUID(),capability:'stop_and_face',status:'pending'};
 activity.steps=[first,second];activity.template='approach_and_face';activity.status='running';
 const executionId=randomUUID();activity.currentExecutionId=executionId;
 f.engine.byExecution.set(executionId,activity);
 f.engine.ingest({type:'receipt',receipt:{executionId,state:'PHYSICALLY_COMPLETED',capability:'approach_person'}});
 assert.equal(activity.cursor,1);
 const completed=f.engine.factsForCharacter(f.binding).filter(x=>x.kind==='step_completed');
 assert.equal(completed.length,1);
 assert.equal(completed[0].evidence,'world_strong');
 assert.equal(f.engine.factsForCharacter(f.binding).some(x=>x.kind==='completed'),false);
 assert.equal(f.engine.stateForCharacter(f.binding).physicallyCompleted,false);
 const narration=projectActivityKnowledge(f.captured()).facts.map(x=>x.text).join(' ');
 assert.match(narration,/activity step/);
 assert.doesNotMatch(narration,/(?:^|\. )The request to .* was completed with physical evidence/);
});
