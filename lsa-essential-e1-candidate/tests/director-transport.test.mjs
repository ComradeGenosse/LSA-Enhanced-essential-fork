import test from 'node:test';
import assert from 'node:assert/strict';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
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
// The fixture is a substitute only for *the companion ledger read*. Native
// tests independently verify issued challenge + sent signal + source identity.
const originalProof=(proposal,stamp)=>Object.freeze({
 source:'original_companion_ps2_ps3',
 challenge:'51111111-1111-4111-8111-111111111111',
 signalId:'61111111-1111-4111-8111-111111111111',
 situationRevision:2,ageMs:100,
 hostRunId:stamp.hostRunId,worldEpoch:stamp.worldEpoch,
 speakerCaptureRef:proposal.speakerCaptureRef,
 playerCaptureRef:proposal.playerCaptureRef,
 ownerIncarnationId:stamp.ownerIncarnationId,proofRevision:stamp.proofRevision,
 observationId:proposal.observationId,observationRevision:proposal.observationRevision,
 decisionKey:proposal.decisionKey,policyVersion:proposal.policyVersion,
});
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

test('capability-gated companion preview queues exactly one closed native packet',()=>{
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},{now:()=>1000,report:()=>{}});
 const writes=[];client.socket={destroyed:false,writable:true,writableLength:0,
  write:line=>{writes.push(line);return false;}};
 const args={operation:'reserve',ticket:{ticketId:ticket,dedupeKey:'ps:'+ticket},
  proposal:{speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
   playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
   observationId:'81111111-1111-4111-8111-111111111111',
   observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1},
  stamp:{hostRunId:host,worldEpoch:1,
   ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
   proofRevision:1,playerTurnVersion:0},ageMs:100};
 assert.equal(client.sendDirectorPreview(args),false);
 assert.equal(writes.length,0);
 client.runtime.ingest(hello,{authenticated:true});
 assert.equal(client.sendDirectorPreview(args),true);
 assert.equal(writes.length,1);
 assert.equal(JSON.parse(writes[0]).type,'director.request');
 assert.equal(writes[0].endsWith('\n'),true);
 client.socket.writableLength=8193;
 assert.equal(client.sendDirectorPreview(args),false);
 assert.equal(writes.length,1);
});

test('exact native PS6 request response binds once with independent status and disconnect cleanup',async()=>{
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},{now:()=>1000,report:()=>{},originalTurnPriority:()=>({source:'original_essential_server_turn_stores',quiet:true,grantsNativeAdmission:false})});
 const writes=[];
 client.socket={destroyed:false,writable:true,writableLength:0,write:line=>{writes.push(JSON.parse(line));return true;},destroy:()=>{}};
 assert.equal(client.runtime.ingest(hello,{authenticated:true}),true);
 // The transport protocol test isolates native status matching. Production
 // source truth remains the original PS3 ledger; this stub grants *only*
 // transport exercise and cannot turn on native admission.
 const originalGrant=originalProof;
 client.runtime.directorOriginalEntitlementFor=originalGrant;
 const original={operation:'reserve',ticket:{ticketId:ticket,dedupeKey:'ps:'+ticket},
  proposal:{speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
   playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
   observationId:'81111111-1111-4111-8111-111111111111',
   observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1},
  stamp:{hostRunId:host,worldEpoch:1,
   ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
   proofRevision:1,playerTurnVersion:0},ageMs:100};
 const waiting=client.requestDirector(original);
 assert.equal(writes.length,2);
 assert.equal(writes[0].type,'director.ps3_receipt');
 assert.equal(writes[1].type,'director.request');
 assert.equal((await client.requestDirector(original)),null);
 assert.equal(client.acceptDirectorResponse({ticketId:'00000000-0000-4000-8000-000000000000',status:'reserved'}),false);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.deepEqual(await waiting,{ticketId:ticket,status:'reserved'});
 assert.equal(client.directorPending.size,0);
 const submitted=client.requestDirector({...original,operation:'submit'});
 assert.equal(writes.length,3);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.equal(await submitted,null); // a late reserve is never a submit
 assert.equal(client.directorPending.size,0);
 const late=client.requestDirector({...original,operation:'submit'});
 assert.equal(writes.length,4);
 client.cancelDirectorRequests();
 assert.equal(await late,null);
 assert.equal(client.directorPending.size,0);
 client.stop();
});

test('native transport refuses reserve/submit without live original PS3 ledger; cancellation survives revocation',async()=>{
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
  {now:()=>1000,report:()=>{},originalTurnPriority:()=>({source:'original_essential_server_turn_stores',quiet:true,grantsNativeAdmission:false})});
 let writes=0;client.socket={destroyed:false,writable:true,writableLength:0,
  write:()=>{writes++;return true;},destroy:()=>{}};
 assert.equal(client.runtime.ingest(hello,{authenticated:true}),true);
 const original={operation:'reserve',ticket:{ticketId:ticket,dedupeKey:'ps:'+ticket},
  proposal:{kind:'speech',speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
   playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
   observationId:'81111111-1111-4111-8111-111111111111',
   observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1},
  stamp:{hostRunId:host,worldEpoch:1,
   ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
   proofRevision:1,playerTurnVersion:0,policyVersion:1},ageMs:100};
 assert.equal(client.directorOriginalEntitlement(original.proposal,original.stamp),null);
 assert.equal(await client.requestDirector(original),null);
 assert.equal(await client.requestDirector({...original,operation:'submit'}),null);
 assert.equal(writes,0,'no outbound native reserve or submit without original PS3');
 let present=true;
 client.runtime.directorOriginalEntitlementFor=(proposal,stamp)=>present?
   originalProof(proposal,stamp):null;
 const first=client.requestDirector(original);
 assert.equal(writes,2);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.deepEqual(await first,{ticketId:ticket,status:'reserved'});
 present=false;
 assert.equal(await client.requestDirector({...original,operation:'submit'}),null);
 assert.equal(writes,2,'revocation after reserve vetoes native submit');
 const cancellation=client.requestDirector({...original,operation:'cancel'});
 assert.equal(writes,3,'native cancel remains possible after the original PS3 grant disappears');
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'cancelled'}),true);
 assert.deepEqual(await cancellation,{ticketId:ticket,status:'cancelled'});
 client.runtime.reset('disconnect');
 present=true;
 assert.equal(await client.requestDirector(original),null);
 assert.equal(writes,3,'disconnect invalidates any forged future companion source read');
 client.stop();
});


test('source-verified original backend priority blocks mic, text, pending speech and unknown turns before native reserve/submit',async()=>{
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
   {now:()=>1000,report:()=>{}});
 let writes=0;
 client.socket={destroyed:false,writable:true,writableLength:0,
   write:()=>{writes++;return true;},destroy:()=>{}};
 client.runtime.ingest(hello,{authenticated:true});
 client.runtime.directorOriginalEntitlementFor=originalProof;
 const request={operation:'reserve',ticket:{ticketId:ticket,dedupeKey:'ps:'+ticket},
   proposal:{speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
     playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
     observationId:'81111111-1111-4111-8111-111111111111',
     observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1},
   stamp:{hostRunId:host,worldEpoch:1,
     ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
     proofRevision:1,playerTurnVersion:0},ageMs:100};
 assert.equal(await client.requestDirector(request),null,'unavailable stock state vetoes');
 assert.equal(writes,0);
 let quiet=false;
 client.originalTurnPriority=()=>({source:'original_essential_server_turn_stores',
   quiet,grantsNativeAdmission:false});
 assert.equal(await client.requestDirector(request),null,'stock busy vetoes');
 assert.equal(await client.requestDirector({...request,operation:'submit'}),null,
   'stock busy vetoes submit even when original PS3 grant exists');
 assert.equal(writes,0);
 quiet=true;
 client.originalTurnPriority=()=>{throw new Error('Core source unavailable')};
 assert.equal(await client.requestDirector(request),null,'throwing Core reader vetoes');
 assert.equal(writes,0);
 // Cancel is still transportable after a player takeover or loss of source.
 const cancel=client.requestDirector({...request,operation:'cancel'});
 assert.equal(writes,1);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'cancelled'}),true);
 assert.deepEqual(await cancel,{ticketId:ticket,status:'cancelled'});
 client.stop();
});
