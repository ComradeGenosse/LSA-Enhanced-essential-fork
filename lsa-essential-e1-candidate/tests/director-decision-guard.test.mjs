import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDirectorSpeechDecision} from '../src/perception/directorDecisionGuard.mjs';

const id='bc99f18e-51a1-4991-8108-91d706b279ef';
const ticket={schemaVersion:1,ticketId:id,dedupeKey:`ps:${id}`,priority:'director_routine'};
const passive={dialogue:'Watch out!',command:''};

test('Director speech accepts only exact empty-effect commands in both provider modes',()=>{
  assert.equal(assertDirectorSpeechDecision(passive,{source:'scene_director',directorTicket:ticket}),true);
  assert.equal(assertDirectorSpeechDecision(passive,{source:'special_event',directorTicket:ticket,streamMode:'dialogue_only'}),true);
  for(const command of ['DO FOLLOW',' ','DO STOP']){
    assert.throws(()=>assertDirectorSpeechDecision({...passive,command},{directorTicket:ticket}),/director_speech_effect_forbidden/);
  }
  assert.throws(()=>assertDirectorSpeechDecision({...passive,activityProposal:{}},{directorTicket:ticket}),/director_speech_effect_forbidden/);
  assert.throws(()=>assertDirectorSpeechDecision(passive,{directorTicket:ticket,streamMode:'buffered_action'}),/director_speech_effect_forbidden/);
});
test('Director speech fails closed if ticket version, UUID, dedupe or source proof is missing',()=>{
  for(const directorTicket of [undefined,{}, {...ticket,ticketId:'fake'}, {...ticket,dedupeKey:'ps:other'}, {...ticket,priority:'player_ux'}, {...ticket,schemaVersion:2}]){
    assert.throws(()=>assertDirectorSpeechDecision(passive,{source:'scene_director',directorTicket}),/director_ticket_unverified/);
  }
});
test('Stock existing special/player events remain unaffected',()=>{
  for(const source of ['special_event','player_text','player_mic','internal_event']){
    assert.equal(assertDirectorSpeechDecision({dialogue:'Hello',command:'DO FOLLOW'},{source}),true);
  }
});
