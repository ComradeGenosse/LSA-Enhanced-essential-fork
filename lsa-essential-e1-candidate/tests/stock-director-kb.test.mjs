import test from 'node:test';
import assert from 'node:assert/strict';
import {stockHarness} from './stock-harness.mjs';
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
 h.runtime.services.decide=async()=>({dialogue:'I see trouble.',command:'DO FOLLOW'});
 const turn=await h.evaluate('kb(directorArgs)');
 assert.ok(turn);
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.notEqual(result.status,'completed');
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
