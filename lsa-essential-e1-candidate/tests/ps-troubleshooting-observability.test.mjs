import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelemetryRecord} from '../src/observability/eventContract.mjs';
import {summarizeKnowledgeSelection} from '../src/context/knowledgeDiagnostics.mjs';

const record=(event,data)=>createTelemetryRecord({
  sequence:1,runId:'fixture',originMs:0,now:1,utc:'2026-10-10T00:00:00.000Z',
  event,identity:null,source:'internal',provider:'internal',data,
});
test('previously silent Director gate, candidate and PS protocol diagnostics are registered and redacted',()=>{
 const gate=record('director_gate',{reason:'no_ps3_response_candidate',
   configuredMode:'experimental',nativeExperimental:true,
   playerId:'private-player',speakerRef:'private-npc'});
 assert.deepEqual(gate.data,{
   reason:'no_ps3_response_candidate',configuredMode:'experimental',nativeExperimental:true,
 });
 const candidate=record('director_candidate',{status:'original_ps3_unavailable',
   configuredMode:'experimental',executionAvailable:true,secret:'private-secret'});
 assert.deepEqual(candidate.data,{
   status:'original_ps3_unavailable',configuredMode:'experimental',executionAvailable:true,
 });
 const bad=record('intelligence_frame_rejected',{frameType:'director_priority',
   reason:'invalid_contract',count:2,frameBytes:133,framePayload:'private payload'});
 assert.deepEqual(bad.data,{frameType:'director_priority',reason:'invalid_contract',
   count:2,frameBytes:133});
 assert.equal(record('director_gate',{reason:'private-npc-identity'}).data.reason,undefined);
});

test('frozen PS4 diagnostic counts identify absent gunfire versus policy omission without leaking claim content',()=>{
 const inputs={pairs:[
   {observation:{eventType:'firing_burst',claims:[{private:'never-log'}]},
    decision:{context:'candidate',response:'none'}},
   {observation:{eventType:'character_present',claims:[{private:'never-log'}]},
    decision:{context:'omit',response:'none'}},
   {observation:{eventType:'death_seen'},decision:{context:'must_include',response:'eligible'}},
 ]};
 const frame={diagnostics:{omissions:{unsupported_claim_detail:1,
   revision_mismatch:0,no_matching_salience:0,budget_excluded:2,safety_overflow:1}}};
 const projection=summarizeKnowledgeSelection(inputs,frame);
 assert.equal(projection.captureEventFiring,1);
 assert.equal(projection.captureEventDeath,1);
 assert.equal(projection.captureEventOther,1);
 assert.equal(projection.captureContextOmit,1);
 assert.equal(projection.captureContextCandidate,1);
 assert.equal(projection.captureContextMustInclude,1);
 assert.equal(projection.captureResponseEligible,1);
 assert.equal(projection.perceivedUnsupportedClaims,1);
 assert.equal(projection.perceivedBudgetExcluded,2);
 assert.equal(projection.perceivedSafetyOverflow,1);
 const telemetry=record('knowledge_frame_projected',projection);
 assert.deepEqual(telemetry.data,projection);
 assert.equal(JSON.stringify(telemetry).includes('never-log'),false);
 assert.deepEqual(summarizeKnowledgeSelection(null,null).captureEventFiring,0);
});

test('P0 actor admission diagnostics survive telemetry without any source identifiers',()=>{
 for(const status of ['verified_observer','contract_unavailable','missing','index_missing','lease_expired','not_observer','kind_mismatch']) {
   const projection=summarizeKnowledgeSelection({anchorStatus:status,pairs:[]},null);
   assert.equal(record('knowledge_frame_projected',projection).data.captureAnchorStatus,status);
 }
 const recordWithoutIdentity=record('knowledge_frame_projected',
   summarizeKnowledgeSelection({anchorStatus:'private-ref-do-not-leak',pairs:[]},null));
 assert.equal(recordWithoutIdentity.data.captureAnchorStatus,undefined);
});

test('Director handoff stages persist reason codes but never ticket, NPC or spoken contents',()=>{
 const privateData={
   ticketId:'private-ticket',speakerCaptureRef:'private-npc',
   playerCaptureRef:'private-player',content:'SECRET NPC RESPONSE',
   sourceText:'SECRET PLAYER TRANSCRIPT',prompt:'SECRET PROMPT',
 };
 for(const stage of ['stock_intake','preflight','post_hydration',
   'turn_allocate','turn_intake','session_open','binding_emit',
   'binding_ack','binding_wait']) {
   const row=record('director_handoff',{stage,status:'rejected',
     code:'backend_revision_mismatch',...privateData});
   assert.deepEqual(row.data,{stage,status:'rejected',code:'backend_revision_mismatch'});
   assert.equal(JSON.stringify(row).includes('SECRET'),false);
   assert.equal(JSON.stringify(row).includes('private-'),false);
 }
});
