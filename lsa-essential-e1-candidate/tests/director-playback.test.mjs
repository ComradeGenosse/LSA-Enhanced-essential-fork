import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectorPlaybackRegistry} from '../src/perception/directorPlayback.mjs';

const ticket={ticketId:'123e4567-e89b-42d3-a456-426614174000'};
const identity={pedId:'12',turnId:'actual-core-turn',generationId:7,sessionNonce:3};
const gates=()=>({hydrated:()=>true,publication:()=>true});

test('actual hydration, original tuple, publication and native started+complete bind one turn',async()=>{
 const reg=new DirectorPlaybackRegistry();
 const entry=reg.begin(ticket,gates());
 assert.ok(entry);
 assert.equal(reg.hydration(ticket),true);
 assert.equal(reg.identify(ticket,identity),true);
 assert.equal(reg.publication(ticket),true);
 const accepted=await entry.bound;
 assert.deepEqual(accepted.tuple,identity);
 assert.equal(reg.onNativeStatus(ticket.ticketId,'started'),true);
 assert.equal(reg.onNativeStatus(ticket.ticketId,'completed'),true);
 assert.deepEqual(await accepted.terminal,{type:'playback_ended',reason:'completed',
   wasInterrupted:false,hadAudio:true,playbackStarted:true});
 reg.clear(ticket.ticketId);
 assert.equal(reg.entries.size,0);
});
test('terminal without original started callback can never count as delivered',async()=>{
 const reg=new DirectorPlaybackRegistry();
 const entry=reg.begin(ticket,gates());
 assert.equal(reg.hydration(ticket),true);
 assert.equal(reg.identify(ticket,identity),true);
 assert.equal(reg.publication(ticket),true);
 const accepted=await entry.bound;
 assert.equal(reg.onNativeStatus(ticket.ticketId,'completed'),true);
 assert.notEqual((await accepted.terminal).reason,'completed');
 reg.clear(ticket.ticketId);
});
test('unauthorized publication and disconnect reject original turn with no audio acknowledgement',async()=>{
 const reg=new DirectorPlaybackRegistry();
 const entry=reg.begin(ticket,{hydrated:()=>true,publication:()=>false});
 assert.equal(reg.hydration(ticket),true);
 assert.equal(reg.identify(ticket,identity),true);
 assert.equal(reg.publication(ticket),false);
 assert.equal(await entry.bound,null);
 reg.reset();
 assert.equal(reg.entries.size,0);
});

test('independently reconstructed native-verified kb ticket hydrates and publishes the original reservation',async()=>{
 const original=Object.freeze({
   schemaVersion:1,ticketId:ticket.ticketId,dedupeKey:`ps:${ticket.ticketId}`,
   speakerCaptureRef:'speaker-capture-A',playerCaptureRef:'player-capture-A',
   decisionKey:'ps3:observation-A',priority:'director_routine',expiresAtMonotonicMs:10000,
 });
 const claimed=Object.freeze({
   schemaVersion:1,ticketId:original.ticketId,dedupeKey:original.dedupeKey,
   speakerCaptureRef:original.speakerCaptureRef,playerCaptureRef:original.playerCaptureRef,
   decisionKey:original.decisionKey,priority:original.priority,sourceRun:'original-backend-run',
   sourceRevision:9,ownerIncarnationId:'source-p2-owner',
 });
 assert.notEqual(claimed,original,'stock kb reconstructs the ticket from verified native records');
 const registry=new DirectorPlaybackRegistry();
 const pending=registry.begin(original,gates());
 assert.ok(pending);
 assert.equal(registry.hydration(claimed),false,'no alias before source verification');
 assert.equal(registry.registerVerifiedClaim(claimed),true,
   'the post-hydration source-verified alias can be registered exactly once');
 assert.equal(registry.hydration(claimed),true);
 assert.equal(registry.identify(claimed,identity),true);
 assert.equal(registry.publication(claimed),true);
 assert.deepEqual((await pending.bound).tuple,identity);
 assert.equal(registry.onNativeStatus(original.ticketId,'started'),true);
 assert.equal(registry.onNativeStatus(original.ticketId,'completed'),true);
 assert.equal((await (await pending.bound).terminal).reason,'completed');
 registry.clear(original.ticketId);
});

test('Director reconstructed ticket cannot be borrowed, replayed, mutated or substituted',async()=>{
 const original=Object.freeze({
   schemaVersion:1,ticketId:ticket.ticketId,dedupeKey:`ps:${ticket.ticketId}`,
   speakerCaptureRef:'speaker-A',playerCaptureRef:'player-A',
   decisionKey:'ps3:decision-A',priority:'director_urgent',expiresAtMonotonicMs:10000,
 });
 const valid=Object.freeze({
   schemaVersion:1,ticketId:original.ticketId,dedupeKey:original.dedupeKey,
   speakerCaptureRef:original.speakerCaptureRef,playerCaptureRef:original.playerCaptureRef,
   decisionKey:original.decisionKey,priority:original.priority,
 });
 const registry=new DirectorPlaybackRegistry();
 const pending=registry.begin(original,gates());
 assert.ok(pending);
 for(const patch of [
   {ticketId:'999e4567-e89b-42d3-a456-426614174000'},
   {dedupeKey:'ps:999e4567-e89b-42d3-a456-426614174000'},
   {speakerCaptureRef:'speaker-B'},
   {playerCaptureRef:'player-B'},
   {decisionKey:'ps3:decision-B'},
   {priority:'director_routine'},
   {schemaVersion:2},
 ])assert.equal(registry.registerVerifiedClaim(Object.freeze({...valid,...patch})),false,
   'no mismatched reservation authority may be registered');
 assert.equal(registry.registerVerifiedClaim(valid),true);
 const lookalike=Object.freeze({...valid});
 assert.equal(registry.registerVerifiedClaim(lookalike),false,'only one original kb claim');
 assert.equal(registry.hydration(lookalike),false,'cloned ticket is not owner');
 assert.equal(registry.identify(lookalike,identity),false,'cloned ticket cannot bind');
 assert.equal(registry.hydration(valid),true);
 assert.equal(registry.identify(lookalike,identity),false);
 assert.equal(registry.identify(valid,identity),true);
 assert.equal(registry.publication(lookalike),false,'cloned ticket cannot publish');
 assert.equal(registry.publication(valid),true);
 await pending.bound;
 registry.clear(original.ticketId);
 assert.equal(registry.registerVerifiedClaim(valid),false,'retired ticket cannot be revived');
});
