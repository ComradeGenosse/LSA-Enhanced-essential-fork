import test from 'node:test';
import assert from 'node:assert/strict';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {CAPABILITIES,validateFrame} from '../src/perception/contracts.mjs';

const uuid='a1111111-1111-4111-8111-111111111111';
const stream='b1111111-1111-4111-8111-111111111111';
const host='c1111111-1111-4111-8111-111111111111';
const ticket='d1111111-1111-4111-8111-111111111111';
const hello={
 version:1,type:'hello',adapterEpoch:uuid,streamId:stream,
 hostContextVersion:1,hostRunId:host,worldEpoch:1,
 observerIndexVersion:1,observerSituationVersion:1,primaryBehaviorOwnerVersion:1,
 directorRequestVersion:1,
 capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,false])),
};
const response={version:1,type:'director_response',adapterEpoch:uuid,streamId:stream,
 sequence:1,payload:{directorRequestVersion:1,ticketId:ticket,status:'busy'}};
test('negotiated response is bounded inert preview not a salience grant',()=>{
 let now=1000;const ps=new ShadowRuntime({mode:'shadow',now:()=>now});
 assert.equal(validateFrame(hello),true);
 assert.equal(ps.ingest(hello,{authenticated:true}),true);
 assert.equal(ps.ingest(response,{authenticated:true}),true);
 assert.deepEqual(ps.directorReceipts,[{ticketId:ticket,status:'busy'}]);
 assert.equal(ps.salience.ledger.size,0);
 assert.equal(ps.directorRequestVersion,1);
 ps.reset('manual');assert.equal(ps.directorReceipts.length,0);
});
test('unnegotiated legacy channel cannot introduce director response',()=>{
 const ps=new ShadowRuntime({mode:'shadow',now:()=>1000});
 const legacy={...hello};delete legacy.directorRequestVersion;
 assert.equal(ps.ingest(legacy,{authenticated:true}),true);
 assert.equal(ps.directorRequestVersion,null);
 assert.equal(ps.ingest(response,{authenticated:true}),false);
 assert.deepEqual(ps.directorReceipts,[]);
});
test('fail closed for invalid response shape/version and untrusted delivery',()=>{
 const ps=new ShadowRuntime({mode:'shadow',now:()=>1000});
 assert.equal(ps.ingest(hello,{authenticated:true}),true);
 assert.equal(validateFrame({...response,payload:{...response.payload,status:'execute'}}),false);
 assert.equal(validateFrame({...response,payload:{...response.payload,command:'DO STOP'}}),false);
 assert.equal(validateFrame({...response,payload:{...response.payload,directorRequestVersion:2}}),false);
 assert.equal(ps.ingest(response,{authenticated:false}),false);
});
