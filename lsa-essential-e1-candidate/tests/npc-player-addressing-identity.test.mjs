import test from 'node:test';
import assert from 'node:assert/strict';
import {renderKnowledge} from '../src/context/knowledgeRenderer.mjs';
import {buildRequest} from '../src/context/essentialDecision.mjs';
import {renderDirectorSocialContext} from '../src/perception/directorSocialContext.mjs';

const nathan={
  name:'Nathan JustNate',nicknames:['Nate'],gender:'male',ageBand:'adult',
  personality:{description:'Casual, loyal and sarcastic',traits:['easygoing','curious']},
  relationship:{state:'friend',description:'Friendly with the player'},
  biography:'A trusted companion',memories:[],
};
const request=(frame,structuredSegments=false)=>buildRequest({
  model:'test',effort:'low',
  systemInstruction:'You are Nathan. Keep your own voice and personality.',
  knowledgeProjection:frame,structuredSegments,
  lunaDeliveryVersion:structuredSegments?1:0,
});
const sceneOf=body=>JSON.parse(body.input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,'))).lanes;
const assertRoles=body=>{
  const lanes=sceneOf(body);
  assert.equal(lanes.SELF.canon.name,'Nathan JustNate');
  assert.deepEqual(lanes.SELF.canon.nicknames,['Nate']);
  assert.equal(lanes.COMPAT.actor.participantRole,'npc');
  assert.equal(lanes.COMPAT.listener.participantRole,'player');
  assert.equal(lanes.COMPAT.listener.address,'A');
  assert.match(body.input[0].content,/SELF\.canon.*belong to this NPC alone/);
  assert.match(body.input[0].content,/Only call player by a personal name|Use the player's personal name only/);
  assert.match(body.input[0].content,/without a name or with a character-appropriate generic term/);
  assert.match(body.input[0].content,/You are Nathan\. Keep your own voice and personality/);
};

test('ordinary greeting names the NPC, never misprojects Nate as an identified player',()=>{
  const frame=renderKnowledge({profile:nathan,persistent:true,actor:{},
    listener:{pedId:'player',name:'UNVERIFIED_PLAYER_NAME'},
    input:'Hey, good to see you',source:'player_text'});
  for(const streaming of [false,true]){
    const body=request(frame,streaming);
    assertRoles(body);
    assert.equal(body.input.at(-1).content,'Hey, good to see you');
    assert.ok(!JSON.stringify(body).includes('UNVERIFIED_PLAYER_NAME'));
    assert.ok(!Object.hasOwn(sceneOf(body).COMPAT.listener,'name'));
    assert.ok(!Object.hasOwn(sceneOf(body).COMPAT.listener,'nicknames'));
  }
});

test('every native social-scene greeting and vehicle/idle spontaneous turn gets the same role boundary',()=>{
  for(const sceneType of ['reunion','shared_vehicle_entry','shared_idle','travel',
    'activity_transition','manual','personal_curiosity']){
    const invitation=renderDirectorSocialContext({
      source:'native_director_social',sceneType,role:'passenger'});
    assert.ok(invitation,sceneType);
    const frame=renderKnowledge({profile:nathan,persistent:true,actor:{},
      listener:{pedId:'player',name:'UNVERIFIED_PLAYER_NAME'},
      source:'special_event',directorEventContext:invitation});
    for(const streaming of [false,true]){
      const body=request(frame,streaming);
      assertRoles(body);
      assert.match(body.input.at(-1).content,/No player utterance was received/);
      assert.match(body.input[0].content,/synthetic special-event user message is not a player utterance/);
      assert.ok(!JSON.stringify(body).includes('UNVERIFIED_PLAYER_NAME'));
    }
  }
});

test('authenticated player self-identification and prior player-name evidence remain available',()=>{
  const history=[
    {role:'user',content:'My name is Chris. You can call me Chris.'},
    {role:'assistant',content:'Good to meet you, man.'},
  ];
  const frame=renderKnowledge({profile:{...nathan,
    memories:[{memoryId:'private-1',selectedForContext:true,category:'biography',
      importance:90,text:'The player introduced himself as Chris.'}]},
    persistent:true,actor:{},listener:{pedId:'player'},source:'player_mic',
    history,input:'Do you remember my name?'});
  const body=request(frame,true),lanes=sceneOf(body);
  assertRoles(body);
  assert.ok(body.input.some(entry=>entry.role==='user'&&entry.content===history[0].content));
  assert.equal(lanes.RECALLED.memories[0].text,'The player introduced himself as Chris.');
  assert.match(body.input[0].content,/non-revoked player-name context/);
  assert.equal(body.input.at(-1).content,'Do you remember my name?');
});

test('third-party names and NPC self-name cannot become player identity; do not force canned speech',()=>{
  const frame=renderKnowledge({profile:nathan,persistent:true,actor:{},
    listener:{pedId:'someone-else',name:'Chris'},source:'player_text',
    input:'My friend is named Chris. What should we do next?'});
  const body=request(frame),lanes=sceneOf(body);
  assert.equal(lanes.COMPAT.actor.participantRole,'npc');
  assert.equal(lanes.COMPAT.listener.participantRole,'other');
  assert.equal(lanes.COMPAT.listener.address,undefined);
  assert.ok(!JSON.stringify(body).includes('"name":"Chris"'));
  assert.match(body.input[0].content,/third-party reference/);
  assert.match(body.input[0].content,/not the NPC's player-authored personality/);
  assert.equal(body.input.at(-1).content,'My friend is named Chris. What should we do next?');
  assert.doesNotMatch(body.input[0].content,/Nate! Been too long/);
});
