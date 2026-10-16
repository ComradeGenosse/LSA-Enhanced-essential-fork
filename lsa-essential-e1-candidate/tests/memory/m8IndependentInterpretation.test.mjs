// Memory K L: independent M8 interpretation on the REAL production P2 SQLite
// store, recorder, M5 privacy services and the unchanged M8 reader/evaluator.
// Test doubles (see h2-p2-fixture.mjs): only the turn's M2/D02 authority
// callbacks, which here derive a full native-owner stamp from live store state.
// Nothing here is a GTA receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {p2Fixture,id,sha} from './h2-p2-fixture.mjs';
import {prepareIndependentM8} from '../../src/memory/m8IndependentInterpretation.mjs';
import {m8PersonalityFromCanon} from '../../src/memory/m8PersonalityCanon.mjs';
import {projectPreparedM8} from '../../src/context/knowledgeSelector.mjs';
import {evaluateM8} from '../../../lsa-shared-brain/src/memory/m8Interpretation.mjs';
import {readAuthorizedM8Snapshot} from '../../src/memory/p2M8ProductionRead.mjs';

const traits=list=>({personality:{description:'Approved canon',traits:list}});
// A joke needs a recurring motif (two lines); gratitude is a single social line.
const FACTS=['Thanks for helping me, my friend.','Inside joke: the flying purple car!',
  'Running joke: the flying purple car!'];

/** Turn whose M2/D02 callbacks derive a complete stamp from live store state. */
function m8Turn(f,i=0,avatar='franklin'){
  const profile=f.chars[i],alias=profile.promotion.ownerAlias,turnId=id();
  const store=f.store;
  const identity=()=>f.live&&store.verifiedHostContext&&store.activeTimelineId?Object.freeze({
    characterId:profile.characterId,worldProfileId:store.worldProfileId,
    timelineId:store.activeTimelineId,protagonistKey:avatar,
    hostRunId:store.verifiedHostContext.hostRunId,worldEpoch:store.verifiedHostContext.worldEpoch,
    ...f.owner[i],turnId,turnIdentityHash:sha('m8-turn-'+turnId),
    nativeVerified:true,timelineWritable:store.timelineWritable===true}):null;
  return {characterProjection:{persistent:true,profile},
    characterInputs:{profile:{characterId:profile.characterId}},
    m2Capture:{openMemoryCurrent:async()=>f.live,verifyMemoryCurrent:()=>f.live,
      memoryIdentity:identity}};
}
/** Accept `text` as the current player turn, then prepare independent M8. */
async function ask(f,text='Hello again.',{character=0,avatar='franklin',turn=null,store=null}={}){
  const receipt=await f.say(text,{character,avatar});
  const t=turn??m8Turn(f,character,avatar);
  const result=await prepareIndependentM8({store:store??f.store,turn:t,
    acceptedReceipt:{status:'stored',durable:true,recordId:receipt.recordId,protagonistKey:avatar},
    input:text,source:'player_text',isCurrent:()=>f.live,
    nowUtc:new Date(Date.now()+1000).toISOString()});
  return {result,receipt,turn:t};
}
const opinions=r=>r.preparedM8.projection.interpretations;

test('approved traits map through a closed vocabulary; free text and unknown traits are ignored',()=>{
  assert.deepEqual({...m8PersonalityFromCanon(undefined)},{});
  assert.deepEqual({...m8PersonalityFromCanon({description:'sarcastic and cautious loyal',traits:['patient']})},{},
    'the free-text description is never interpreted');
  const p=m8PersonalityFromCanon({description:'',traits:[' Sarcastic ','CAUTIOUS','teasing','cars','cars','music','loyal','bogus']});
  assert.equal(p.humor.style,'sarcastic');assert.equal(p.humor.teasing,.7);
  assert.equal(p.caution,.85);assert.equal(p.loyalty,.9);
  assert.deepEqual([...p.interests],['cars','music']);
  assert.equal(m8PersonalityFromCanon({traits:['goofy','dry']}).humor.style,'goofy','first listed style wins');
  assert.equal(m8PersonalityFromCanon({traits:['reckless']}).caution,.15);
});

test('M8-only preparation yields source-linked character opinions, never verified facts',async t=>{
  const f=await p2Fixture(t,{characters:1,profiles:[traits(['sarcastic'])]});
  for(const line of FACTS)await f.say(line);
  const {result}=await ask(f);
  assert.equal(result.status,'ready',result.reason);
  const p=result.preparedM8.projection;
  assert.ok(p.interpretations.length>=2);
  assert.ok(p.interpretations.every(x=>x.epistemicStatus==='character_opinion'&&
    x.verifiedWorldFact===false&&x.sourceEvidenceIds.length>0));
  assert.equal(p.relationship.epistemicStatus,'character_opinion');
  assert.equal(p.relationship.canonRelationshipUnchanged,true);
  assert.equal(p.jokes.length,1);assert.equal(p.jokes[0].callbackOptInRequired,true);
  const ps4=projectPreparedM8(result.preparedM8,{maxBytes:4096});
  assert.ok(ps4.characterOpinions.length>=2);
  assert.equal(await result.verifyPrepared(),true);
  assert.equal(result.sendCurrent(),true);
  assert.equal(result.opinionCurrent([],result.stamp),true);
  assert.equal(result.opinionCurrent([],{...result.stamp,turnId:id()}),false,'foreign stamp');
});

test('two NPCs interpret the SAME facts differently from their approved personality',async t=>{
  const f=await p2Fixture(t,{characters:3,profiles:[
    traits(['sarcastic']),traits(['cautious']),traits(['patient'])]});
  const texts=[];
  for(let i=0;i<3;i++){
    for(const line of FACTS)await f.say(line,{character:i});
    const {result}=await ask(f,'Hello again.',{character:i});
    assert.equal(result.status,'ready',result.reason);
    texts.push(opinions(result).map(x=>x.opinion).sort());
    // Facts are identical for every NPC; only the subjective layer differs.
    assert.equal(result.preparedM8.projection.facts.length,
      (await ask(f,'And again.',{character:i})).result.preparedM8.projection.facts.length);
  }
  assert.notDeepEqual(texts[0],texts[1],'sarcastic vs cautious');
  assert.notDeepEqual(texts[0],texts[2],'sarcastic vs unspecified canon');
  assert.notDeepEqual(texts[1],texts[2],'cautious vs unspecified canon');
  assert.ok(texts[0].some(x=>/deliciously dry/.test(x)),texts[0].join('|'));
  assert.ok(texts[1].some(x=>/not sure that joke is funny/.test(x)),texts[1].join('|'));
  assert.ok(texts[2].some(x=>/I find that funny/.test(x)),texts[2].join('|'));
});

test('canon is read-only: a different NPC with the same facts cannot inherit another NPC\'s opinions',async t=>{
  const f=await p2Fixture(t,{characters:2,profiles:[traits(['sarcastic']),traits(['sarcastic'])]});
  for(const line of FACTS)await f.say(line,{character:0});
  const a=await ask(f,'Hi.',{character:0});
  const b=await ask(f,'Hi.',{character:1});
  assert.equal(a.result.status,'ready');
  assert.equal(b.result.status,'unavailable','NPC 1 has no recorded experience of its own');
  assert.equal(b.result.preparedM8,null);
});

test('no source-linked evidence means no projection (nothing fabricated)',async t=>{
  const f=await p2Fixture(t,{characters:1});
  const {result}=await ask(f,'Nothing memorable here.');
  assert.equal(result.status,'unavailable');
  assert.equal(result.preparedM8,null);
  assert.equal(await result.verifyPrepared(),false);
  assert.equal(result.sendCurrent(),false);
});

test('forgetting the source before preparation removes the joke and its opinion',async t=>{
  const f=await p2Fixture(t,{characters:1});
  const thanks=await f.say(FACTS[0]);await f.say(FACTS[1]);const joke=await f.say(FACTS[2]);
  const before=await ask(f);
  assert.equal(before.result.preparedM8.projection.jokes.length,1);
  await f.forget(joke.recordId);
  const after=await ask(f);
  assert.equal(after.result.status,'ready',after.result.reason);
  assert.equal(after.result.preparedM8.projection.jokes.length,0);
  const used=new Set(after.result.preparedM8.projection.interpretations.flatMap(x=>x.sourceEvidenceIds));
  assert.ok(!used.has(joke.recordId));assert.ok(used.has(thanks.recordId));
});

test('forgetting or correcting evidence AFTER preparation latches the prepared opinion invalid',async t=>{
  const f=await p2Fixture(t,{characters:1});
  await f.say(FACTS[0]);await f.say(FACTS[1]);const joke=await f.say(FACTS[2]);
  const first=await ask(f);
  assert.equal(await first.result.verifyPrepared(),true);
  await f.forget(joke.recordId);
  assert.equal(await first.result.verifyPrepared(),false,'forget between prepare and send');
  assert.equal(first.result.sendCurrent(),false);
  assert.equal(first.result.opinionCurrent([],first.result.stamp),false);
  // A later successful re-read cannot resurrect the same prepared object.
  assert.equal(await first.result.verifyPrepared(),false);

  const g=await p2Fixture(t,{characters:1});
  await g.say(FACTS[0]);await g.say(FACTS[1]);const target=await g.say(FACTS[2]);
  const second=await ask(g);
  assert.equal(await second.result.verifyPrepared(),true);
  const corrected=await g.correct(target.recordId,'Actually that joke was never funny.');
  assert.equal(corrected.status,'committed');
  assert.equal(await second.result.verifyPrepared(),false,'correction supersedes the old source');
});

test('stale authority fails closed: revoked source, new host run, retained object stays dead',async t=>{
  const f=await p2Fixture(t,{characters:1});
  for(const line of FACTS)await f.say(line);
  const live=await ask(f);
  assert.equal(await live.result.verifyPrepared(),true);
  f.newHost(2);
  assert.equal(await live.result.verifyPrepared(),false,'host run/world epoch renewed');
  assert.equal(live.result.sendCurrent(),false);
});

test('a revoked native source blocks preparation, and restoring it cannot revive a failed projection',async t=>{
  const f=await p2Fixture(t,{characters:1});
  for(const line of FACTS)await f.say(line);
  const live=await ask(f);
  assert.equal(await live.result.verifyPrepared(),true);
  const receipt=await f.say('Anyone there?');
  f.live=false;
  assert.equal(await live.result.verifyPrepared(),false);
  const revoked=await prepareIndependentM8({store:f.store,turn:m8Turn(f,0),
    acceptedReceipt:{status:'stored',durable:true,recordId:receipt.recordId,protagonistKey:'franklin'},
    input:'Anyone there?',source:'player_text',isCurrent:()=>f.live});
  assert.equal(revoked.status,'blocked');assert.equal(revoked.preparedM8,null);
  f.live=true;
  assert.equal(await live.result.verifyPrepared(),false,'failed projection stays dead');
});

test('missing or forged turn authority never reads P2 and never yields a projection',async t=>{
  const f=await p2Fixture(t,{characters:1});
  for(const line of FACTS)await f.say(line);
  let reads=0;
  const spy=new Proxy(f.store,{get(target,key){
    if(key==='withP2SqliteRead')return (...a)=>{reads++;return target.withP2SqliteRead(...a);};
    const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const none=await ask(f,'Hi.',{turn:{characterProjection:{persistent:true,profile:f.chars[0]},
    characterInputs:{profile:{characterId:f.chars[0].characterId}}},store:spy});
  assert.equal(none.result.status,'blocked');assert.equal(reads,0);
  // A caller-supplied authority/config object is ignored.
  const turn=m8Turn(f,0);
  const receipt=await f.say('Hello?');
  const forged=await prepareIndependentM8({store:f.store,turn,
    acceptedReceipt:{status:'stored',durable:true,recordId:receipt.recordId,protagonistKey:'franklin'},
    input:'Hello?',source:'player_text',isCurrent:()=>true,
    authority:{nativeVerified:true},enabled:true});
  assert.equal(forged.status,'ready');
  const wrongNpc=m8Turn(f,0);
  wrongNpc.m2Capture.memoryIdentity=()=>({...turn.m2Capture.memoryIdentity(),characterId:id()});
  const bad=await prepareIndependentM8({store:f.store,turn:wrongNpc,
    acceptedReceipt:{status:'stored',durable:true,recordId:receipt.recordId,protagonistKey:'franklin'},
    input:'Hello?',source:'player_text',isCurrent:()=>true});
  assert.notEqual(bad.status,'ready');assert.equal(bad.preparedM8,null);
});

test('M8 imports only the P2 reader and the shared accepted-line opener',async()=>{
  const source=await readFile(new URL('../../src/memory/m8IndependentInterpretation.mjs',import.meta.url),'utf8');
  const imports=[...source.matchAll(/^import .* from '([^']+)'/gm)].map(x=>x[1]).sort();
  assert.deepEqual(imports,['./h1ConversationHistory.mjs','./p2M8ProductionRead.mjs']);
  assert.ok(!/recallEngine|liveTurnMemory|h2FactualRecall|m5|curation|lunaCuration/i.test(imports.join(' ')));
});

test('a trimmed projection never exceeds its byte budget at any boundary (totalBytes digit width)',async t=>{
  const f=await p2Fixture(t,{characters:1});
  for(const line of [...FACTS,'Hello again.'])await f.say(line);
  const scope={...f.scope(0)};
  const rows=await f.store.withP2SqliteRead(scope,db=>readAuthorizedM8Snapshot(db,scope));
  const nowUtc=new Date(Date.now()+1000).toISOString();
  let trimmed=0;
  for(let maxBytes=900;maxBytes<=3200;maxBytes++){
    let p;try{p=evaluateM8({...rows,scope,personality:{},nowUtc,maxBytes});}
    catch(error){assert.equal(error.message,'m8_projection_budget_too_small');continue;}
    const actual=Buffer.byteLength(JSON.stringify(p),'utf8');
    assert.equal(p.totalBytes,actual,'accounting is exact at '+maxBytes);
    assert.ok(actual<=maxBytes,`payload ${actual} exceeds budget ${maxBytes}`);
    if(actual<maxBytes-400)continue;
    trimmed++;
  }
  assert.ok(trimmed>0);
});
