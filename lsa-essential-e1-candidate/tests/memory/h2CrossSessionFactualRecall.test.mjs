// Production P2 SQLite -> M4/H2 -> evidence labels -> PS4 RECALLED lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import {p2Fixture,ago} from './h2-p2-fixture.mjs';
import {projectPreparedRecall} from '../../src/context/knowledgeSelector.mjs';

function delivered(h2){
  assert.equal(h2.status,'ready',h2.reason);
  assert.equal(h2.preparedRecall.contribution.lane,'RECALLED');
  const ps4=projectPreparedRecall(h2.preparedRecall);
  return [...ps4.earlierArchivedConversation,...ps4.evidence];
}
async function dogHistory(f){
  const prana=await f.say('Prana is our dog.',{at:ago(72000),sessionNonce:'prana-introduction'});
  const vet=await f.say('Prana had bladder stones removed at the veterinary hospital.',{at:ago(66000),sessionNonce:'vet-trip'});
  const corgis=await f.say('Koba and Nora are my two corgis.',{at:ago(52000),sessionNonce:'corgi-names'});
  const vladimir=await f.say('Vladimir is our Pomsky.',{at:ago(40000),sessionNonce:'pomsky-names'});
  await f.say('We have four dogs in all.',{at:ago(36000),sessionNonce:'dogs-total'});
  return {prana,vet,corgis,vladimir};
}

test('H2 sends across-session dog names, breeds and veterinary facts to PS4 without inferred claims',async t=>{
  for(const [question,expected] of [
    ["What are all my dogs' names?",['Prana','Koba','Nora','Vladimir']],
    ['Do you remember my dogs?',['Prana','Koba','Nora','Vladimir']],
    ['Which dogs are corgis?',['Koba','Nora']],
    ['What happened to Prana?',['bladder stones','Prana']],
    ['What do you remember about my pets?',['Prana','Koba','Nora','Vladimir']]
  ]){
    await t.test(question,async st=>{
      const f=await p2Fixture(st);
      const facts=await dogHistory(f);
      const {h2,receipt}=await f.ask(question);
      const visible=delivered(h2);
      const text=visible.map(x=>x.content).join(' | ');
      for(const needle of expected)assert(text.includes(needle),
        'missing '+needle+' from ACTUAL PS4 evidence for '+question+': '+text);
      assert(!visible.some(x=>x.recordId===receipt.recordId),'current question is not evidence');
      for(const row of visible){
        assert.equal(row.speaker,'player');
        assert.equal(row.sourceKind,'dialogue_line');
        assert.equal(row.category,'exact_quote');
      }
      assert.equal(await h2.verifyPrepared(),true);
      assert.equal(h2.sendCurrent(),true);
      if(question.includes('all my dogs')){
        assert(visible.some(x=>x.recordId===facts.corgis.recordId));
        assert(visible.some(x=>x.recordId===facts.vladimir.recordId));
      }
    });
  }
});

test('H2 links a verified same-session name list to a separate-session named fact',async t=>{
  const f=await p2Fixture(t);
  await f.say('We have four dogs.',{at:ago(82000),sessionNonce:'original-dogs'});
  const list=await f.say('Prana, Koba, Nora, and Vladimir.',{at:ago(81990),sessionNonce:'original-dogs'});
  const vet=await f.say('Prana needed veterinary surgery for bladder stones.',{at:ago(72000),sessionNonce:'different-vet-session'});
  const {h2}=await f.ask('What are all my dogs names?');
  const ids=new Set(delivered(h2).map(x=>x.recordId));
  assert(ids.has(list.recordId),'same-session name-list evidence survives PS4 projection');
  assert(ids.has(vet.recordId),'name-linked evidence from a separate session survives PS4 projection');
  assert.equal(await h2.verifyPrepared(),true);
});

test('H2 does not invent a name association from an unrelated conversation',async t=>{
  const f=await p2Fixture(t);
  await f.say('Prana is my dog.',{at:ago(54000),sessionNonce:'dogs'});
  const unrelated=await f.say('Nora is the name of a colleague at work.',{at:ago(52000),sessionNonce:'office'});
  const otherNpc=await f.say('Lupo is our corgi.',{character:1,at:ago(50000),sessionNonce:'different-npc'});
  const {h2}=await f.ask("What are all my dogs' names?");
  const ids=new Set(delivered(h2).map(x=>x.recordId));
  assert(!ids.has(unrelated.recordId),'person sharing pet-like name is not dog evidence');
  assert(!ids.has(otherNpc.recordId),'other NPC evidence never crosses the character boundary');
});

test('H2 name links obey forgetting and correction visibility in PS4',async t=>{
  const f=await p2Fixture(t);
  const old=await f.say('My corgis are Koba and Nora.',{at:ago(10000),sessionNonce:'dogs'});
  await f.forget(old.recordId);
  const later=await f.say('My other dog is Prana.',{at:ago(8000),sessionNonce:'prana'});
  const {h2}=await f.ask('Which dogs are corgis?');
  const visible=delivered(h2);
  assert(!visible.some(x=>x.recordId===old.recordId),'forgotten source never enters PS4');
  assert(!visible.some(x=>x.content.includes('Koba')||x.content.includes('Nora')),
    'no linked hints may resurrect a forgotten source');
  assert(visible.some(x=>x.recordId===later.recordId),'unrevoked dog evidence remains available');
  assert.equal(await h2.verifyPrepared(),true);
});

test('H2 never treats a bounded list page as an exact quantity',async t=>{
  const f=await p2Fixture(t);
  await dogHistory(f);
  const {h2}=await f.ask('How many dogs do I have?');
  assert.equal(h2.status,'abstained','the unsupported exact count remains unavailable');
  assert.equal(projectPreparedRecall(h2.preparedRecall).evidence.length,0);
  assert.equal(projectPreparedRecall(h2.preparedRecall).earlierArchivedConversation.length,0);
});

test('H2 corrects an earlier dog relationship without resurrecting the old name',async t=>{
  const f=await p2Fixture(t);
  const old=await f.say('My corgis are Koba and Nora.',{at:ago(18000),sessionNonce:'former-names'});
  await f.correct(old.recordId,'My corgis are Koba and Mina.');
  const {h2}=await f.ask('Which dogs are corgis?');
  const visible=delivered(h2);
  const text=visible.map(x=>x.content).join(' | ');
  assert(!visible.some(x=>x.recordId===old.recordId),'superseded line excluded');
  assert(!text.includes('Nora'),'old identity is not presented as current evidence');
  assert(text.includes('Mina'),'correction evidence reaches PS4');
  assert.equal(await h2.verifyPrepared(),true);
});
