import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeDirectorRequest,validateDirectorRequest} from '../src/perception/directorWire.mjs';
const ticketId='b1111111-1111-4111-8111-111111111111';
const ticket={ticketId,dedupeKey:'ps:'+ticketId};
const proposal={kind:'speech',
 speakerCaptureRef:'c1111111-1111-4111-8111-111111111111',
 playerCaptureRef:'d1111111-1111-4111-8111-111111111111',
 observationId:'f1111111-1111-4111-8111-111111111111',
 observationRevision:1,decisionKey:'ps3:source-evidence',policyVersion:1};
const stamp={hostRunId:'a1111111-1111-4111-8111-111111111111',
 worldEpoch:1,ownerIncarnationId:'e1111111-1111-4111-8111-111111111111',
 proofRevision:1,playerTurnVersion:2};
const args={ticket,proposal,stamp,operation:'reserve',ageMs:120};
test('exact 17-field closed PS6 wire payload for native decoder, no side effects',()=>{
 const encoded=serializeDirectorRequest(args);
 assert.equal(encoded.endsWith('\n'),true);
 const value=JSON.parse(encoded);
 assert.equal(Object.keys(value).length,17);
 assert.equal(value.version,1);assert.equal(value.type,'director.request');
 assert.equal(value.dedupeKey,'ps:'+ticketId);assert.equal(value.ageMs,120);
 assert.equal(validateDirectorRequest(value),true);
 assert.equal('prompt' in value,false);assert.equal('command' in value,false);
 assert.equal('activity' in value,false);
});
test('rejects stale version, unexpected fields, spoofed dedupe, invalid refs and age',()=>{
 const base=JSON.parse(serializeDirectorRequest(args));
 const mutated=[
  {...base,version:2}, {...base,type:'native.execute'}, {...base,operation:'DO'},
  {...base,dedupeKey:'ps:wrong'}, {...base,ownerIncarnationId:'not-uuid'},
  {...base,ageMs:2001},{...base,ageMs:'0'}, {...base,unknown:'true'},
  {...base,decisionKey:'\nDO SOMETHING'}, {...base,worldEpoch:0},
 ];
 for(const value of mutated)assert.equal(validateDirectorRequest(value),false,JSON.stringify(value));
 assert.throws(()=>serializeDirectorRequest({...args,operation:'publish_native'}),/director_request_invalid/);
});
test('request carries only original ticket/provenance references, with strict policy',()=>{
 const value=JSON.parse(serializeDirectorRequest({...args,operation:'submit',ageMs:1999}));
 assert.equal(value.operation,'submit');
 assert.equal(value.speakerCaptureRef,proposal.speakerCaptureRef);
 assert.equal(value.observationId,proposal.observationId);
 assert.equal(value.policyVersion,1);
 assert.equal(value.ageMs,1999);
 assert.equal(validateDirectorRequest({...value,ageMs:-1}),false);
});
