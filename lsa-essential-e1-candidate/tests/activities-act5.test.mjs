import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityEngine } from '../src/activities/activityEngine.mjs';
import { Act5Dialogue, validateAct5Choice } from '../src/activities/act5Dialogue.mjs';
import { normalizeActivityConfig } from '../src/activities/contracts.mjs';
import { parseDecisionJson, buildRequest } from '../src/context/essentialDecision.mjs';
import { createSegmentDecoder } from '../src/openai/segmentDecoder.mjs';

const actor = '11111111-1111-4111-8111-111111111111';
const incarnation = '33333333-3333-4333-8333-333333333333';
const encounter = '22222222-2222-4222-8222-222222222222';
const host = { hostContextVersion: 1, hostRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', worldEpoch: 1 };
const nativeRun = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const adapterEpoch = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerAlias = 'promoted.' + actor;
const probes = ['Q1', 'FR1', 'F1', 'K1', 'R1'];
const intents = ['hold_position', 'accompany', 'resume_previous', 'sit_here'];
let serial = 0;
const id = () => 'dddddddd-dddd-4ddd-8ddd-' + String(++serial).padStart(12, '0');

const decision = activity => ({ dialogue: "Want me to wait here?", command: '', activity });
const choice = (intent, slots = {}) => ({ intent, slots });
const turn = () => ({
  identity: { pedId: '72', sessionNonce: 3, turnId: id(), generationId: 1 },
  characterProjection: { persistent: true, profile: { characterId: actor } },
  characterInputs: { profile: { characterId: actor, promotion: { ownerAlias } }, claim: { incarnationId: incarnation } },
  knowledgeInputs: { activityInputs: { binding: { encounterId: encounter, hostContext: host } } },
});

function harness({ enabled = true, act3Capabilities = [], act6Capabilities = [], extraProbes = [] } = {}) {
  serial = 0;
  let now = 10000;
  const commands = [];
  const config = normalizeActivityConfig({ mode: 'on', act5: enabled, act3Capabilities, act6Capabilities, passedProbes: [...probes,...extraProbes] });
  const engine = new ActivityEngine({ config, now: () => now, id, onCommand: v => commands.push(v) });
  const hello = {type:'hello', ...host, nativeRun, adapterEpoch, capabilities: {
    hold_position:true, follow_person:true, sit_on_ground:true, resume_ambient:true,
    stop_and_face:true, approach_person:true, walk_away_from:true, take_cover:true, begin_driving:true,
    walk_to:true, drive_to:true,
  }};
  engine.noteHello(hello);
  let currentEncounter = encounter;
  let currentToken = 'native-token';
  let currentIncarnation = incarnation;
  const native = {request: async operation => operation === 'capture'
    ? {ownerAlias, encounterId: currentEncounter}
    : {ownerAlias, encounterId: currentEncounter, ownershipToken:currentToken,
      claim: {incarnationId:currentIncarnation}} };
  const activities = { engine, client: {runtime: {ready:true, ...host, hostContext:host, nativeRun, adapterEpoch}},
    status: characterId => engine.status(characterId),
    cancel: characterId => engine.cancel(characterId) };
  const dialogue = new Act5Dialogue({ activities, characterService: {native}, now:()=>now, id });
  return {dialogue,engine,commands,advance: ms => {now += ms},retire:()=>{currentEncounter=id()},
    changeToken:()=>{currentToken='other-token'},changeIncarnation:()=>{currentIncarnation=id()}};
}

test('ACT5 is opt-in and never advertises contract-only ACT3 native verbs', async () => {
  assert.equal(normalizeActivityConfig().act5, false);
  assert.equal(await harness({enabled:false}).dialogue.prepare(turn(), 'player_text'), null);
  const ctx = await harness().dialogue.prepare(turn(), 'player_text');
  assert.deepEqual(ctx.intents, intents);
  assert.equal(ctx.intents.includes('stop_and_face'), false);
  assert.equal(ctx.intents.includes('vehicle_trip'), false);
  assert.equal(await harness().dialogue.prepare(turn(), 'special_event'), null);
});

test('ACT3 suggestions require every verified step and preserve native consent', async () => {
  const blocked = await harness({act3Capabilities:['approach_person','stop_and_face']}).dialogue.prepare(turn(), 'player_text');
  assert.equal(blocked.intents.includes('approach_and_face'),false); // A1 probe absent.
  const h = harness({act3Capabilities:['approach_person','stop_and_face','walk_away_from'],extraProbes:['A1']});
  const first = turn();
  const context = await h.dialogue.prepare(first,'player_text');
  assert.equal(context.intents.includes('approach_and_face'),true);
  assert.equal(context.intents.includes('leave_scene'),true);
  assert.equal(context.intents.includes('board_vehicle'),false); // No verified vehicle reference.
  assert.equal(validateAct5Choice(choice('approach_and_face',{person:{kind:'player'}}),context.intents),true);
  assert.equal(validateAct5Choice(choice('approach_and_face',{person:{kind:'capture',captureRef:'bogus'}}),context.intents),false);
  const next = buildRequest({model:'gpt-6-luna',effort:'low',systemInstruction:'NPC',input:'hello',activityContext:context});
  assert.equal(next.text.format.schema.properties.activity.anyOf.some(x=>x.properties?.intent?.enum?.[0]==='approach_and_face'),true);
  assert.equal(await h.dialogue.publish(first,decision(choice('approach_and_face',{person:{kind:'player'}})),context,()=>true),true);
  assert.equal(h.engine.goals.goals.length,0); // Proposal is never execution.
  const yes = turn(), ctx = await h.dialogue.prepare(yes,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(yes,'yes',ctx,()=>true)).kind,'approval_pending');
  assert.equal((await h.dialogue.commitApproved(yes,()=>true)).ok,true);
  assert.equal(h.engine.activities[0].steps.length,2);
  assert.equal(h.engine.activities[0].template,'approach_and_face');
  assert.equal(h.commands.filter(c=>c.type==='actor.acquire').length,1);
});

test('strict decision v2 rejects malformed fields, commands, targets and speculative mode', () => {
  assert.deepEqual(parseDecisionJson('{"dialogue":"Hi.","command":""}'),{dialogue:'Hi.',command:''});
  assert.throws(()=>parseDecisionJson(JSON.stringify(decision(null))),/only dialogue and command/);
  assert.deepEqual(parseDecisionJson(JSON.stringify(decision(null)),{act5Intents:intents}), decision(null));
  assert.deepEqual(parseDecisionJson(JSON.stringify(decision(choice('accompany',{person:{kind:'player'}}))),{act5Intents:intents}),
    decision(choice('accompany',{person:{kind:'player'}})));
  for (const invalid of [
    choice('vehicle_trip',{}),choice('approach_and_face',{person:{kind:'player'}}),
    choice('accompany',{person:{kind:'turn_alias',alias:'P001'}}),
    choice('hold_position',{until:{kind:'duration',bucket:'short'}}),
    choice('sit_here',{priority:'high'}),{intent:'hold_position',slots:{},actorId:'12'},
  ]) assert.equal(validateAct5Choice(invalid,intents),false);
  assert.throws(()=>parseDecisionJson(JSON.stringify({...decision(choice('sit_here')),command:'DO WaitHere'}),{act5Intents:intents}),/mutually exclusive/);
  const good = {mode:'buffered_action',segments:[{text:'Want me to wait here?'}],command:'',activity:choice('hold_position')};
  const decoder=createSegmentDecoder({act5Intents:intents});
  decoder.append(JSON.stringify(good));
  assert.deepEqual(decoder.finish().decision,decision(choice('hold_position')));
  for(const value of [{...good,mode:'dialogue_only'}, {...good,command:'DO WaitHere'}, {...good,activity:choice('vehicle_trip')}]) {
    const bad=createSegmentDecoder({act5Intents:intents});
    bad.append(JSON.stringify(value));
    assert.throws(()=>bad.finish(),/ACT5|buffered_action/);
  }
  const old=createSegmentDecoder();
  old.append(JSON.stringify({mode:'dialogue_only',segments:[{text:'No thanks.'}],command:''}));
  assert.deepEqual(old.finish().decision,{dialogue:'No thanks.',command:''});
});

test('strict request advertises only live closed intents; default request stays legacy', () => {
  const base={model:'gpt-6-luna',effort:'low',systemInstruction:'NPC',actor:null,input:'hello'};
  const old=buildRequest(base);
  assert.equal(old.text.format.name,'e1_decision');
  const act5=buildRequest({...base,activityContext:{intents:['hold_position'],activityStatus:'none',pendingIntent:null}});
  assert.equal(act5.text.format.name,'e1_act5_decision');
  assert.deepEqual(act5.text.format.schema.required,['dialogue','command','activity']);
  assert.equal(act5.text.format.schema.properties.activity.anyOf.length,2);
  assert.match(act5.input[0].content,/player has NOT approved/);
  const streamed=buildRequest({...base,structuredSegments:true,lunaDeliveryVersion:1,
    activityContext:{intents:['hold_position'],activityStatus:'none',pendingIntent:null}});
  assert.equal(streamed.text.format.name,'e1_act5_segmented_delivery_v1');
});

test('an audible proposal is pending only; explicit yes admits exactly one existing ACT goal', async () => {
  const h=harness(), first=turn(), ctx=await h.dialogue.prepare(first,'player_text');
  assert.equal(h.engine.goals.goals.length,0);
  assert.equal(await h.dialogue.publish(first,decision(choice('accompany',{person:{kind:'player'}})),ctx,()=>true),true);
  assert.equal(h.engine.goals.goals.length,0);
  assert.equal(h.commands.length,0);
  assert.equal(await h.dialogue.publish(first,decision(choice('accompany',{person:{kind:'player'}})),ctx,()=>true),false);
  const approval=turn();
  const following=await h.dialogue.prepare(approval,'player_text');
  assert.deepEqual(following.intents,[]);
  const accepted=await h.dialogue.onPlayerInput(approval,'Yeah!',following,()=>true);
  assert.equal(accepted.kind,'approval_pending');
  assert.equal(h.engine.goals.goals.length,0);
  assert.equal(h.commands.length,0);
  assert.equal((await h.dialogue.commitApproved(approval,()=>true)).ok,true);
  assert.equal(h.engine.goals.goals.length,1);
  assert.equal(h.engine.goals.goals[0].source,'player_dialogue');
  assert.equal(h.engine.activities[0].source,'player_dialogue');
  assert.equal(h.commands.filter(v=>v.type==='actor.acquire').length,1);
  assert.equal(await h.dialogue.onPlayerInput(approval,'Yeah!',following,()=>true),null);
  assert.equal((await h.dialogue.commitApproved(approval,()=>true)).ok,false);
  assert.equal(h.commands.filter(v=>v.type==='actor.acquire').length,1);
  assert.equal(h.engine.goals.goals.length,1);
});

test('decline, cooldown, stale native owner and actor interruption never execute', async () => {
  const declined=harness(), t1=turn(), context=await declined.dialogue.prepare(t1,'player_text');
  await declined.dialogue.publish(t1,decision(choice('sit_here')),context,()=>true);
  const reply=turn();
  assert.equal((await declined.dialogue.onPlayerInput(reply,'No, thanks.',await declined.dialogue.prepare(reply,'player_text'),()=>true)).kind,'declined');
  assert.equal(declined.commands.length,0);
  assert.deepEqual((await declined.dialogue.prepare(turn(),'player_text')).intents,[]);

  const stale=harness(), start=turn(), available=await stale.dialogue.prepare(start,'player_text');
  await stale.dialogue.publish(start,decision(choice('hold_position')),available,()=>true);
  const yes=turn(), yesContext=await stale.dialogue.prepare(yes,'player_text');
  stale.changeToken();
  const outcome=await stale.dialogue.onPlayerInput(yes,'Sure',yesContext,()=>true);
  assert.equal(outcome.kind,'unavailable');
  assert.equal(stale.commands.length,0);

  const dead=harness(), proposalTurn=turn(), initial=await dead.dialogue.prepare(proposalTurn,'player_text');
  dead.retire();
  assert.equal(await dead.dialogue.publish(proposalTurn,decision(choice('hold_position')),initial,()=>true),false);
  assert.equal(dead.commands.length,0);
});

test('no approval, stale playback, disabled ACT5 and replayed engine admission fail closed', async () => {
  const h=harness(), t=turn(), ctx=await h.dialogue.prepare(t,'player_text');
  assert.equal(await h.dialogue.publish(t,decision(choice('hold_position')),ctx,()=>false),false);
  assert.equal(h.commands.length,0);
  const p={proposalVersion:1,proposalId:id(),source:'player_dialogue',subject:{characterId:actor},
    intent:'hold_position',slots:{},priority:'player_direct',origin:{turn:{...t.identity}},proposedAtMs:10000};
  const owner={characterId:actor,ownerAlias,ownershipToken:'native-token',encounterId:encounter,incarnationId:incarnation};
  assert.equal(h.engine.assign(p,owner).reason,'policy_denied');
  const first=h.engine.assign(p,owner,{playerApproved:true});
  assert.equal(first.ok,true);
  assert.deepEqual(h.engine.assign(p,owner,{playerApproved:true}),first);
  assert.equal(h.commands.filter(v=>v.type==='actor.acquire').length,1);
});

test('ACT6 explicit player waypoint request stages one publication-bound ACT goal (not a freeform planner)', async () => {
  const h=harness({act6Capabilities:['walk_to'],extraProbes:['NV1','Q2','L1']});
  const t=turn();
  const ctx=await h.dialogue.prepare(t,'player_text');
  const stage=await h.dialogue.onPlayerInput(t,'go to the waypoint',ctx,()=>true);
  assert.deepEqual([stage?.kind,stage?.intent],['approval_pending','go_to_place']);
  assert.equal(h.commands.length,0,'no native dispatch before verified dialogue publication');
  const committed=await h.dialogue.commitApproved(t,()=>true);
  assert.equal(committed.ok,true);
  assert.equal(h.commands.filter(frame=>frame.type==='actor.acquire').length,1);
});
