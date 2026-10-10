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
 let serial=0;
 const sample=()=>({schemaVersion:1,source:'original_essential_backend_lifecycle',sourceRun:uuid,
   revision:2,observationSerial:++serial,quiet:true,grantsNativeAdmission:false,
   evidence:{source:'original_essential_server_turn_stores',quiet:true}});
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},{now:()=>1000,report:()=>{},originalTurnPriority:sample,originalTurnReserve:()=>sample(),originalTurnCurrent:()=>sample(),originalTurnRelease:()=>true});
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
 assert.equal(writes.length,3);
 assert.equal(writes[0].type,'director.original_owner_receipt');
 assert.equal(writes[0].revision,2);
 assert.equal(writes[1].type,'director.ps3_receipt');
 assert.equal(writes[2].type,'director.request');
 assert.equal((await client.requestDirector(original)),null);
 assert.equal(client.acceptDirectorResponse({ticketId:'00000000-0000-4000-8000-000000000000',status:'reserved'}),false);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.deepEqual(await waiting,{ticketId:ticket,status:'reserved'});
 assert.equal(client.directorPending.size,0);
 const submitted=client.requestDirector({...original,operation:'submit'});
 assert.equal(writes.length,5);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.equal(await submitted,null); // a late reserve is never a submit
 assert.equal(client.directorPending.size,0);
 const late=client.requestDirector({...original,operation:'submit'});
 assert.equal(writes.length,7);
 client.cancelDirectorRequests();
 assert.equal(await late,null);
 assert.equal(client.directorPending.size,0);
 client.stop();
});

test('native transport refuses reserve/submit without live original PS3 ledger; cancellation survives revocation',async()=>{
 let serial=0;
 const sample=()=>({schemaVersion:1,source:'original_essential_backend_lifecycle',sourceRun:uuid,
   revision:2,observationSerial:++serial,quiet:true,grantsNativeAdmission:false,
   evidence:{source:'original_essential_server_turn_stores',quiet:true}});
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
  {now:()=>1000,report:()=>{},originalTurnPriority:sample,originalTurnReserve:()=>sample(),originalTurnCurrent:()=>sample(),originalTurnRelease:()=>true});
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
 assert.equal(writes,3);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.deepEqual(await first,{ticketId:ticket,status:'reserved'});
 present=false;
 assert.equal(await client.requestDirector({...original,operation:'submit'}),null);
 assert.equal(writes,3,'revocation after reserve vetoes native submit');
 const cancellation=client.requestDirector({...original,operation:'cancel'});
 assert.equal(writes,4,'native cancel remains possible after the original PS3 grant disappears');
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'cancelled'}),true);
 assert.deepEqual(await cancellation,{ticketId:ticket,status:'cancelled'});
 client.runtime.reset('disconnect');
 present=true;
 assert.equal(await client.requestDirector(original),null);
 assert.equal(writes,4,'disconnect invalidates any forged future companion source read');
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
 client.originalTurnPriority=()=>({schemaVersion:1,source:'original_essential_backend_lifecycle',revision:2,
   quiet,grantsNativeAdmission:false,evidence:{source:'original_essential_server_turn_stores',quiet}});
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


test('3A stock intake queues once only after genuine matching native submitted receipt and current original owner',async()=>{
 let serial=0,revision=2,releaseCount=0;
 const sample=()=>({schemaVersion:1,source:'original_essential_backend_lifecycle',
   sourceRun:uuid,revision,observationSerial:++serial,quiet:true,
   grantsNativeAdmission:false,evidence:{source:'original_essential_server_turn_stores',quiet:true}});
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
   {now:()=>1000,originalTurnPriority:sample,originalTurnReserve:()=>sample(),
    originalTurnCurrent:()=>sample(),originalTurnRelease:()=>{releaseCount++;return true;}});
 const writes=[];
 client.socket={destroyed:false,writable:true,writableLength:0,
   write:line=>{writes.push(JSON.parse(line));return true;},destroy:()=>{}};
 assert.equal(client.runtime.ingest(hello,{authenticated:true}),true);
 client.runtime.directorOriginalEntitlementFor=originalProof;
 const args={operation:'reserve',ticket:{ticketId:ticket,dedupeKey:'ps:'+ticket},
   proposal:{kind:'speech',speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
     playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
     observationId:'81111111-1111-4111-8111-111111111111',
     observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1},
   stamp:{hostRunId:host,worldEpoch:1,
     ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
     proofRevision:1,playerTurnVersion:0},ageMs:100};
 assert.equal(client.sendDirectorStockIntake(args.ticket,'No native submit yet.'),false);
 const reserving=client.requestDirector(args);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'reserved'}),true);
 assert.equal((await reserving)?.status,'reserved');
 assert.equal(client.sendDirectorStockIntake(args.ticket,'Still not submitted.'),false);
 const submitting=client.requestDirector({...args,operation:'submit'});
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'submitted'}),true);
 assert.equal((await submitting)?.status,'submitted');
 const prior=writes.length;
 assert.equal(client.sendDirectorStockIntake(args.ticket,'A nearby event occurred.'),true);
 assert.equal(writes.length,prior+2);
 assert.equal(writes[prior].type,'director.original_owner_receipt');
 assert.equal(writes[prior+1].type,'director.stock_intake');
 assert.equal(writes[prior+1].context,'A nearby event occurred.');
 assert.equal(client.sendDirectorStockIntake(args.ticket,'No second intake.'),false);
 assert.equal(writes.length,prior+2,'one-shot dispatch despite repeated callers');
 const cancelling=client.requestDirector({...args,operation:'cancel'});
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'cancelled'}),true);
 assert.equal((await cancelling)?.status,'cancelled');
 assert.equal(releaseCount>0,true);
 client.stop();
});

test('3A source revision change prevents native-submitted stock intake after player takeover',async()=>{
 let serial=0,revision=8;
 const sample=()=>({schemaVersion:1,source:'original_essential_backend_lifecycle',
   sourceRun:uuid,revision,observationSerial:++serial,quiet:true,
   grantsNativeAdmission:false,evidence:{source:'original_essential_server_turn_stores',quiet:true}});
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
   {now:()=>1000,originalTurnReserve:()=>sample(),
    originalTurnCurrent:()=>sample(),originalTurnRelease:()=>true});
 let writes=0;
 client.socket={destroyed:false,writable:true,writableLength:0,
   write:()=>{writes++;return true;},destroy:()=>{}};
 client.runtime.ingest(hello,{authenticated:true});
 client.runtime.directorOriginalEntitlementFor=originalProof;
 const args={operation:'reserve',ticket:{ticketId:ticket,dedupeKey:'ps:'+ticket},
   proposal:{speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
     playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
     observationId:'81111111-1111-4111-8111-111111111111',
     observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1},
   stamp:{hostRunId:host,worldEpoch:1,
     ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
     proofRevision:1,playerTurnVersion:0},ageMs:100};
 const reserve=client.requestDirector(args);
 client.acceptDirectorResponse({ticketId:ticket,status:'reserved'});await reserve;
 const submit=client.requestDirector({...args,operation:'submit'});
 client.acceptDirectorResponse({ticketId:ticket,status:'submitted'});await submit;
 const before=writes;revision++;
 assert.equal(client.sendDirectorStockIntake(args.ticket,'Player already took over.'),false);
 assert.equal(writes,before,'no ownership receipt or scheduler message after takeover');
 client.stop();
});

test('native binding ACK cannot be forged, borrowed, repeated or used after disconnect',async()=>{
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
   {now:()=>1000,report:()=>{},originalTurnPhase:()=> 'generation'});
 const frames=[];
 client.socket={destroyed:false,writable:true,writableLength:0,
   write:line=>{frames.push(JSON.parse(line));return true;},destroy:()=>{}};
 assert.equal(client.runtime.ingest(hello,{authenticated:true}),true);
 client.runtime.directorOriginalEntitlementFor=originalProof;
 const ticketObject=Object.freeze({ticketId:ticket,dedupeKey:'ps:'+ticket});
 const proposal={speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
   playerCaptureRef:'f1111111-1111-4111-8111-111111111111'};
 const stamp={hostRunId:host,worldEpoch:1,ownerIncarnationId:
   '91111111-1111-4111-8111-111111111111',proofRevision:1};
 client.directorOwnerReservations.set(ticket,{proposal,stamp,run:uuid,revision:2});
 client.directorStockClaims.set(ticket,{ticket:ticketObject});
 const identity={pedId:'17',turnId:'original-turn-A',
   generationId:2147483648,sessionNonce:1};
 assert.equal(client.sendDirectorOriginalTurnBinding(ticketObject,identity),true);
 assert.equal(frames.length,1);
 assert.equal(frames[0].type,'director.original_turn_bound');
 assert.equal(client.sendDirectorOriginalTurnBinding(ticketObject,identity),false,
   'already consumed claim cannot rebind');
 assert.equal(client.acceptDirectorResponse({ticketId:'00000000-0000-4000-8000-000000000000',status:'bound'}),false);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'submitted'}),false,
   'native submit is not a binding ACK');
 const bound={...response,payload:{directorRequestVersion:1,ticketId:ticket,status:'bound'}};
 assert.equal(validateFrame(bound),true,'one new typed response is accepted');
 assert.equal(validateFrame({...bound,payload:{...bound.payload,status:'authorized'}}),false);
 assert.equal(client.acceptDirectorResponse(bound.payload),true);
 assert.equal(await client.awaitDirectorNativeBinding(ticketObject),true);
 assert.equal(await client.awaitDirectorNativeBinding(ticketObject),false,
   'already consumed native ACK cannot be reused');
 client.directorStockClaims.set(ticket,{ticket:ticketObject});
 assert.equal(client.sendDirectorOriginalTurnBinding(ticketObject,{...identity,turnId:'original-turn-B'}),true);
 assert.equal(client.acceptDirectorResponse({ticketId:ticket,status:'unsafe'}),true);
 assert.equal(await client.awaitDirectorNativeBinding(ticketObject),false);
 client.directorStockClaims.set(ticket,{ticket:ticketObject});
 assert.equal(client.sendDirectorOriginalTurnBinding(ticketObject,{...identity,turnId:'original-turn-C'}),true);
 const waiter=client.awaitDirectorNativeBinding(ticketObject);
 client.cancelDirectorRequests();
 assert.equal(await waiter,false,'disconnect cancels waiting native binding');
 assert.equal(client.acceptDirectorResponse(bound.payload),false,
   'late ACK cannot revive a cancelled claim');
 client.stop();
});
