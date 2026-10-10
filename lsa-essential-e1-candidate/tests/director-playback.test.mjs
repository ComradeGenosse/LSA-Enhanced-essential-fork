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
