import test from 'node:test';
import assert from 'node:assert/strict';
import {stockHarness} from './stock-harness.mjs';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
const ticket={schemaVersion:1,
 ticketId:'d1111111-1111-4111-8111-111111111111',
 dedupeKey:'ps:d1111111-1111-4111-8111-111111111111',priority:'director_routine'};
const args={speakerPedId:'17',listenerPedId:'player',content:'Nearby danger.',reason:'scene_event',
 dedupeKey:ticket.dedupeKey,faceListener:false,interruptExisting:false,directorTicket:ticket};

test('actual source-pinned stock kb vetoes arbitrary Director input without native proof',async()=>{
 const h=await stockHarness('openai');
 const session=await h.openAIControllerSession({actorContext:{pedId:'17'}});
 h.context.directorArgs=args;
 let decisions=0;h.runtime.services.decide=async()=>{decisions++;return {dialogue:'Hi',command:''};};
 const turn=await h.evaluate('kb(directorArgs)');
 assert.equal(turn,false);
 assert.equal(decisions,0);
 assert.equal(h.actions.length,0);
 assert.equal(h.runtime.history.readForSession('17',1).length,0);
 session.connection.close();
});

test('verified-ticket test double enforces no DO before stock action events',async()=>{
 const h=await stockHarness('openai');
 const session=await h.openAIControllerSession({actorContext:{pedId:'17'}});
 session.autoNativeAcks();
 h.context.directorArgs=args;
 // ONLY a fake acceptance here; production native preview cannot do this.
 h.runtime.directorPreflight=()=>true;
 h.runtime.requireDirectorTicket=()=>ticket;
 h.runtime.intelligence={sendDirectorOriginalTurnBinding:()=>true}; // native Xn test relay
 h.runtime.services.decide=async()=>({dialogue:'I see trouble.',command:'DO FOLLOW'});
 const turn=await h.evaluate('kb(directorArgs)');
 // With the new native-ACK-before-vi await, the source kb can now return
 // false when the model's DO instruction is rejected synchronously. The
 // original generated Essential tuple must still exist and remain terminal.
 const generated=turn || h.evaluate('[...A.turnsById.values()].find(t=>t?.metadata?.directorTicket)');
 assert.ok(generated,'the exact ticket reached original Xn generation');
 const result=await session.connection.whenSettled({pedId:generated.pedId,turnId:generated.id,generationId:generated.generationId,sessionNonce:1});
 assert.notEqual(result?.status,'completed','rejected DO must never complete an allowed speech turn');
 assert.equal(h.actions.length,0);
 assert.equal(h.runtime.history.readForSession('17',1).some(v=>v.role==='assistant'),false);
 session.connection.close();
});


test('even an injected native-positive Director preflight cannot bypass missing original backend owner lease',async()=>{
 const h=await stockHarness('openai');
 const session=await h.openAIControllerSession({actorContext:{pedId:'17'}});
 h.context.directorArgs=args;
 // The original source authority is read from the real patched stock A maps.
 // An all-positive NATIVE stub cannot turn missing source ownership into true.
 h.runtime.intelligence={preflightDirectorTicket:()=>true};
 let requests=0;
 h.runtime.services.decide=async()=>{requests++;return {dialogue:'Unsafe.',command:''};};
 assert.equal(h.runtime.directorPreflight(args),false);
 const result=await h.evaluate('kb(directorArgs)');
 assert.equal(result,false);
 assert.equal(requests,0);
 assert.equal(h.actions.length,0);
 session.connection.close();
});


test('3A Core scheduler DTO cannot bypass backend ticket hydration while 3B remains disabled',async()=>{
 const h=await stockHarness('openai');
 const session=await h.openAIControllerSession({actorContext:{pedId:'17'}});
 h.context.directorArgs={
   speakerPedId:'17',listenerPedId:'player',
   content:'A nearby event occurred.',reason:'ps6_observer',
   dedupeKey:ticket.dedupeKey,faceListener:false,interruptExisting:false,
 };
 let decisions=0;
 h.runtime.services.decide=async()=>{decisions++;return {dialogue:'Not allowed.',command:''};};
 const result=await h.evaluate('kb(directorArgs)');
 assert.equal(result,false);
 assert.equal(decisions,0);
 assert.equal(h.actions.length,0);
 session.connection.close();
});

test('source-pinned Xn cannot start Director model speech without exact binding relay',async()=>{
 const h=await stockHarness('openai');
 const session=await h.openAIControllerSession({actorContext:{pedId:'17'}});
 h.context.directorArgs={...args,reason:'ps6_observer'};
 h.runtime.directorPreflight=()=>true;
 h.runtime.requireDirectorTicket=()=>ticket;
 let decisions=0;
 h.runtime.services.decide=async()=>{decisions++;return {dialogue:'Denied.',command:''};};
 const result=await h.evaluate('kb(directorArgs)');
 assert.equal(result,false,'native binding failure kills the original stock turn');
 assert.equal(decisions,0,'no unbound model request');
 assert.equal(h.actions.length,0);
 session.connection.close();
});

test('original kb hydrates one native-submitted source-backed Director tuple through pinned Xi/Zi/Xn',async()=>{
 const h=await stockHarness('openai');
 const session=await h.openAIControllerSession({actorContext:{pedId:'17'}});
 h.evaluate('A.mic={status:"idle",activeTurnId:"",releasedBeforeContextReady:false,pendingChunks:[]}; A.pendingConversationContextByPedId=new Map(); A.playerTurnRecoveryByTurnId=new Map();');
 const reservation=h.runtime.host.directorReserveOriginalTurn(ticket.ticketId);
 assert.ok(reservation?.quiet,'source stock A maps issued exclusive original lease');
 const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},
   {now:()=>1000,report:()=>{},directorProductionRequired:true,
    originalTurnCurrent:id=>h.runtime.host.directorCheckOriginalTurn(id),
    originalTurnPhase:id=>h.runtime.host.directorOriginalPhase(id)});
 const frames=[];
 client.socket={destroyed:false,writable:true,writableLength:0,
   write:line=>{
     const frame=JSON.parse(line);frames.push(frame);
     if(frame.type==='director.original_turn_bound')queueMicrotask(()=>
       client.acceptDirectorResponse({ticketId:frame.ticketId,status:'bound'}));
     return true;
   },destroy:()=>{}};
 const hello={version:1,type:'hello',
   adapterEpoch:'a1111111-1111-4111-8111-111111111111',
   streamId:'b1111111-1111-4111-8111-111111111111',
   hostContextVersion:1,hostRunId:'c1111111-1111-4111-8111-111111111111',worldEpoch:1,
   observerIndexVersion:1,observerSituationVersion:1,
   primaryBehaviorOwnerVersion:1,directorRequestVersion:1,
   capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,false]))};
 assert.equal(client.runtime.ingest(hello,{authenticated:true}),true);
 const proposal={
   speakerCaptureRef:'e1111111-1111-4111-8111-111111111111',
   playerCaptureRef:'f1111111-1111-4111-8111-111111111111',
   observationId:'81111111-1111-4111-8111-111111111111',
   observationRevision:1,decisionKey:'ps3:qualified',policyVersion:1};
 const stamp={hostRunId:hello.hostRunId,worldEpoch:1,
   ownerIncarnationId:'91111111-1111-4111-8111-111111111111',
   proofRevision:1,playerTurnVersion:0};
 // The fake source ledger and submitted ticket are intentionally confined
 // to this stock KB integration harness. Native C-06, PS3 and ticket admission
 // are independently tested from the production C# sources.
 client.runtime.current=()=>true;
 client.runtime.directorOriginalEntitlementFor=()=>({source:'test_ps3'});
 // The Director reservation and original Core hydrated ticket are two
 // independent objects with overlapping immutable source identities.
 const directorTicket=Object.freeze({
   schemaVersion:1,ticketId:ticket.ticketId,dedupeKey:ticket.dedupeKey,
   speakerCaptureRef:proposal.speakerCaptureRef,
   playerCaptureRef:proposal.playerCaptureRef,
   decisionKey:proposal.decisionKey,priority:'director_routine',
   expiresAtMonotonicMs:10000,
 });
 const playback=client.directorPlaybacks.begin(directorTicket,{
   hydrated:()=>true,publication:()=>true,
 });
 assert.ok(playback,'production registry has the original Director reservation');
 client.directorOwnerReservations.set(ticket.ticketId,{
   run:reservation.sourceRun,revision:reservation.revision,proposal,stamp,
   priority:directorTicket.priority});
 client.directorStockDispatched.add(ticket.ticketId);
 client.directorStockContexts.set(ticket.ticketId,'Nearby danger.');
 h.runtime.intelligence=client;
 const dto={speakerPedId:'17',listenerPedId:'player',
   reason:'ps6_observer',dedupeKey:ticket.dedupeKey,
   content:'Nearby danger.',faceListener:false,interruptExisting:false};
 h.context.directorArgs=dto;
 // The production stock Zi can enter WP to create a new actor session BEFORE
 // Xi allocates the special turn. This harness stubs Zi, so emit that exact
 // source-owned lifecycle entry here instead of bypassing the first-contact
 // path as earlier tests did.
 h.evaluate('var __lsaStockZi=Zi; Zi=async o=>{ __LSA_E1_RUNTIME.originalTurnTransition("session_open",o.directorTicket?.ticketId); return __lsaStockZi(o); };');
 h.runtime.services.decide=async()=>({dialogue:'Stay back from the danger.',command:''});
 const turn=await h.evaluate('kb(directorArgs)');
 assert.ok(turn,'actual source-pinned stock Xi and Xn allocated turn');
 assert.equal(dto.directorTicket?.ticketId,ticket.ticketId);
 assert.notEqual(dto.directorTicket,directorTicket,
   'actual source kb claim reconstructs a different ticket object');
 assert.equal(client.directorPlaybacks.entry(dto.directorTicket)?.published,true,
   'source-verified kb hydrated, bound, and published the original reservation');
 assert.equal((await playback.bound)?.tuple?.turnId,turn.id);
 assert.equal(h.runtime.host.directorOriginalPhase(ticket.ticketId),'generation');
 const bound=frames.filter(f=>f.type==='director.original_turn_bound');
 assert.equal(bound.length,1);
 assert.equal(bound[0].ticketId,ticket.ticketId);
 assert.equal(bound[0].turnId,turn.id);
 assert.equal(bound[0].generationId,turn.generationId);
 assert.equal(bound[0].sessionNonce,1);
 assert.equal(bound[0].pedId,'17');
 assert.equal(client.sendDirectorOriginalTurnBinding(dto.directorTicket,{
   pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1}),false,
   'native tuple emission cannot be repeated');
 assert.equal(h.actions.length,0);
 session.connection.close();
 client.stop();
});
