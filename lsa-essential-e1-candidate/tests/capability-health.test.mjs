import {loadCapabilityRegistry} from '../src/activities/capabilityRegistry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {projectCapabilityHealth,readCapabilityValidation,loadCapabilityValidation} from '../src/observability/capabilityHealth.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
const payloadHash='a'.repeat(64);
const receipt=(capability,patch={})=>({capability,payloadHash,sourceCommit:'b'.repeat(40),sessionId:randomUUID(),result:'passed',evidenceSha256:'c'.repeat(64),...patch});
async function fixture(){
 const registry=loadCapabilityRegistry(),probes=[...new Set(['hold_position','follow_person','resume_ambient','sit_on_ground'].flatMap(key=>registry.get(key).probes))];
 const hostContext={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
 return {config:{provider:'openai',intelligence:{mode:'shadow'},dialogueKnowledge:{mode:'active'},activities:{mode:'on',passedProbes:probes}},manifest:{perceptionContract:await verifyPerceptionContract(),dialogueKnowledgeContract:{available:true,frameVersion:1,hostContextVersion:1,observerIndexVersion:1,observerSituationVersion:1},dialogueKnowledgeNativePayload:{manifestSha256:'d'.repeat(64)}},payloadHash,perception:{hostContext,epoch:randomUUID(),capabilities:{snapshot:true,playerSpeech:true},observerIndexVersion:1,observerSituationVersion:1},activities:{engine:{registry},runtime:{hostContext,ready:true,capabilities:{follow_person:true,hold_position:true,resume_ambient:true,sit_on_ground:true}}}};
}
test('C09 separates compiled/configured/runtime/validation and never treats passedProbes as validation',async()=>{
 const f=await fixture(),health=projectCapabilityHealth(f);assert.ok(Object.isFrozen(health));
 for(const key of ['ps.dialogue_knowledge','act.follow_person']){assert.equal(health[key].compiled,true);assert.equal(health[key].configured,'active');assert.equal(health[key].runtimeSupported,true);assert.deepEqual(health[key].validated,[]);assert.equal(health[key].active,false);}
 for(const key of ['ps.speech_heard','cge.gaze','radio.facts'])assert.equal(health[key].compiled,false);
 assert.equal(health['ps.perception'].configured,'shadow');assert.equal(health['ps.perception'].active,false);
 const records=[receipt('ps.dialogue_knowledge'),receipt('act.follow_person')];
 const accepted=projectCapabilityHealth({...f,validation:records});assert.equal(accepted['ps.dialogue_knowledge'].active,true);assert.equal(accepted['act.follow_person'].active,true);
 const suspended=projectCapabilityHealth({...f,config:{...f.config,activities:{mode:'on',passedProbes:[]}},validation:records});assert.equal(suspended['act.follow_person'].suspended,true);assert.equal(suspended['act.follow_person'].active,false);
 records[0].result='failed';assert.equal(accepted['ps.dialogue_knowledge'].active,true,'old immutable snapshot does not change');
 assert.equal(projectCapabilityHealth({...f,validation:records})['ps.dialogue_knowledge'].active,false);
 assert.equal(projectCapabilityHealth({...f,payloadHash:'e'.repeat(64),validation:[receipt('ps.dialogue_knowledge')]})['ps.dialogue_knowledge'].active,false);
 assert.equal(projectCapabilityHealth({...f,validation:[receipt('ps.dialogue_knowledge'),receipt('ps.dialogue_knowledge',{result:'failed'})]})['ps.dialogue_knowledge'].active,false);
});
test('C09 reset/disconnect/mixed-host/version/disabled build remain independent fail-closed status',async()=>{
 const f=await fixture();f.validation=[receipt('ps.dialogue_knowledge'),receipt('act.follow_person')];
 f.perception.epoch=null;assert.equal(projectCapabilityHealth(f)['ps.dialogue_knowledge'].runtimeSupported,false);
 f.perception.epoch=randomUUID();f.perception.observerIndexVersion=2;assert.equal(projectCapabilityHealth(f)['ps.dialogue_knowledge'].active,false);
 f.perception.observerIndexVersion=1;f.activities.runtime.hostContext={...f.perception.hostContext,worldEpoch:2};const mixed=projectCapabilityHealth(f);assert.equal(mixed['act.follow_person'].suspended,true);assert.equal(mixed['act.follow_person'].active,false);
 f.activities.runtime.ready=false;assert.equal(projectCapabilityHealth(f)['act.follow_person'].runtimeSupported,false);
 f.manifest.dialogueKnowledgeContract.available=false;assert.equal(projectCapabilityHealth(f)['ps.dialogue_knowledge'].compiled,false);
 f.config.dialogueKnowledge.mode='off';assert.equal(projectCapabilityHealth(f)['ps.dialogue_knowledge'].configured,'off');
});
test('validation file is bounded, closed, immutable and excludes config or malformed proof',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'lsa-capability-health-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'validation.v1.json');
 const record=receipt('ps.dialogue_knowledge');await writeFile(file,JSON.stringify({version:1,receipts:[record]}));const rows=await loadCapabilityValidation(file);assert.equal(rows.length,1);assert.ok(Object.isFrozen(rows[0]));
 for(const value of [{version:2,receipts:[record]},{version:1,receipts:[{...record,privateDialogue:'secret'}]},{version:1,receipts:[{...record,evidenceSha256:'bad'}]},{version:1,receipts:[{...record,capability:'act.walk_to'}]},{version:1,receipts:Array(65).fill(record)}])assert.deepEqual(readCapabilityValidation(value),[]);
 await writeFile(file,'x'.repeat(65537));assert.deepEqual(await loadCapabilityValidation(file),[]);assert.deepEqual(await loadCapabilityValidation(path.join(directory,'missing')),[]);
});

import {createRuntimeForBundle} from '../src/bootstrap.mjs';
test('bootstrap exposes a live read-only C09 view without connecting or executing disabled systems',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'lsa-health-bootstrap-'));t.after(()=>rm(directory,{recursive:true,force:true}));const configPath=path.join(directory,'config.json');
 await writeFile(configPath,JSON.stringify({provider:'openai',persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}));
 let calls=0;const forbidden=()=>{calls++;throw new Error('unexpected effect');};
 const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,capabilityValidationPath:path.join(directory,'missing.json'),fetchImpl:forbidden,intelligenceOptions:{connect:forbidden},activityOptions:{connect:forbidden}});
 const before=runtime.services.capabilityHealth();assert.equal(before['ps.dialogue_knowledge'].configured,'off');assert.equal(before['act.follow_person'].active,false);
 runtime.activities={runtime:{ready:true,hostContext:{hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1},capabilities:{follow_person:true}}};
 const after=runtime.services.capabilityHealth();assert.equal(after['act.follow_person'].runtimeSupported,true);assert.equal(before['act.follow_person'].runtimeSupported,false);assert.equal(after['act.follow_person'].active,false);assert.equal(calls,0);
});

test('SELF contributors require independent matching-payload acceptance and exact shared runtime support',async()=>{
 const f=await fixture();f.config.dialogueKnowledge.activityFacts='active';f.config.dialogueKnowledge.dialogueReceipts='active';f.activities.runtime.dialogueActionVersion=1;
 let health=projectCapabilityHealth(f);for(const key of ['ps.activity_facts','ps.dialogue_receipts']){assert.equal(health[key].runtimeSupported,true);assert.equal(health[key].active,false);}
 f.validation=[receipt('ps.activity_facts'),receipt('ps.dialogue_receipts',{payloadHash:'e'.repeat(64)})];health=projectCapabilityHealth(f);assert.equal(health['ps.activity_facts'].active,true);assert.equal(health['ps.dialogue_receipts'].active,false);
 f.validation.push(receipt('ps.dialogue_receipts'));assert.equal(projectCapabilityHealth(f)['ps.dialogue_receipts'].active,true);
 f.activities.runtime.dialogueActionVersion=null;assert.equal(projectCapabilityHealth(f)['ps.dialogue_receipts'].active,false);assert.equal(projectCapabilityHealth(f)['ps.activity_facts'].active,true);
 f.activities.runtime.hostContext={...f.perception.hostContext,worldEpoch:2};assert.equal(projectCapabilityHealth(f)['ps.activity_facts'].active,false);
});
