import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPersonalTestDefaults} from '../src/config/personalTestDefaults.mjs';
import {normalizeConfig} from '../src/config/e1Config.mjs';

test('personal test defaults enable admitted memory, M9, ACT, PS6 and reactions even with old explicit off entries',()=>{
  const input={intelligence:{mode:'off'},activities:{mode:'off',act5:false,dialogueReceipts:false,passedProbes:['Q1']},
    memoryK:{capabilities:{'memory.events':'off','memory.interpretation':'off'}},
    reactions:{mode:'off',enabled:[]}};
  const normalized=normalizeConfig(applyPersonalTestDefaults(input),{});
  assert.equal(normalized.intelligence.mode,'shadow');
  assert.equal(normalized.spontaneousSpeech.mode,'experimental');
  assert.equal(normalized.dialogueKnowledge.mode,'active');
  assert.equal(normalized.activities.mode,'on');
  assert.equal(normalized.activities.act5,true);
  assert.equal(normalized.activities.dialogueReceipts,true);
  assert.deepEqual(normalized.activities.passedProbes,['Q1']);
  assert.deepEqual(normalized.activities.act6Capabilities,['walk_to','drive_to']);
  assert.equal(normalized.memoryK.capabilities['memory.interpretation'],'on');
  assert.equal(normalized.memoryK.capabilities['memory.cloudCuration'],'on');
  assert.equal(normalized.memoryK.capabilities['memory.callbacks'],'on');
  assert.equal(normalized.memoryK.capabilities['events.wasted'],'on');
  assert.equal(normalized.memoryK.capabilities['ps7.social'],undefined);
  assert.equal(normalized.memoryK.capabilities['memory.promotionGrace'],undefined);
  assert.equal(normalized.reactions.mode,'on');
  assert.deepEqual(normalized.reactions.enabled,['nod','shrug']);
});
test('personal test mode has one reversible opt-out and does not fabricate ACT probes',()=>{
  const input={personalTestMode:false,intelligence:{mode:'off'},activities:{mode:'off',passedProbes:[]},memoryK:{capabilities:{}}};
  assert.strictEqual(applyPersonalTestDefaults(input),input);
  assert.equal(normalizeConfig(input,{}).activities.mode,'off');
  assert.deepEqual(applyPersonalTestDefaults({activities:{passedProbes:[]}}).activities.passedProbes,[]);
});
test('preserves custom identity, media and backend settings; does not invent cloud pricing or consent',()=>{
  const base={provider:'openai',reasoningModel:'gpt-6-luna',speechProvider:'elevenlabs',
    elevenLabs:{voices:{nathan:'YxCW9IzM2JMClfI9aoms'}},memoryK:{autoResumeSingleTimeline:true,capabilities:{'memory.commands':'on'}},
    activities:{passedProbes:['A1'],pipeName:'LSA.Activities.v1'}};
  const result=applyPersonalTestDefaults(base);
  assert.equal(result.reasoningModel,'gpt-6-luna');
  assert.deepEqual(result.elevenLabs,base.elevenLabs);
  assert.equal(result.memoryK.autoResumeSingleTimeline,true);
  assert.equal(result.memoryK.cloudCuration,undefined);
  assert.equal(result.activities.pipeName,'LSA.Activities.v1');
  assert.deepEqual(result.activities.passedProbes,['A1']);
  assert.equal(result.expressiveDelivery.mode,'experimental');
  assert.equal(normalizeConfig(result,{}).expressiveDelivery.mode,'experimental');
});
