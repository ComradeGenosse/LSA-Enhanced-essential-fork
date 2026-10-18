import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityEngine } from '../src/activities/activityEngine.mjs';
import { Act5Dialogue, validateAct5Choice, parseAct6PlayerRequest, parseVehicleSeatPlayerRequest, reconcileVehicleSeatDecision, vehicleSeatModelCommandKind, act5WorldAvailable, reconcileAct6Decision } from '../src/activities/act5Dialogue.mjs';
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

function harness({ enabled = true, act3Capabilities = [], act6Capabilities = [], extraProbes = [], baseProbes = probes } = {}) {
  serial = 0;
  let now = 10000;
  const commands = [];
  const config = normalizeActivityConfig({ mode: 'on', act5: enabled, act3Capabilities, act6Capabilities, passedProbes: [...baseProbes,...extraProbes] });
  const engine = new ActivityEngine({ config, now: () => now, id, onCommand: v => commands.push(v) });
  const hello = {type:'hello', ...host, nativeRun, adapterEpoch, capabilities: {
    hold_position:true, follow_person:true, sit_on_ground:true, resume_ambient:true,
    stop_and_face:true, approach_person:true, walk_away_from:true, take_cover:true, begin_driving:true,
    scenario_here:true, enter_vehicle_seat:true, exit_vehicle:true, walk_to:true, drive_to:true,
  }};
  engine.noteHello(hello);
  let currentEncounter = encounter;
  let currentToken = 'native-token';
  let currentIncarnation = incarnation;
  let activityOffer = {version:1,safe:true,actorInVehicle:false,actorOnFoot:true,actorIsDriver:false,
    playerNearby:true,vehicleAvailable:true,vehicleStopped:true,
    passengerFree:true,driverFree:true,frontFree:true,rearFree:true,actorSeatIndex:-2,scenarioReady:true};
  const native = {request: async operation => operation === 'capture'
    ? {ownerAlias, encounterId: currentEncounter}
    : {ownerAlias, encounterId: currentEncounter, ownershipToken:currentToken,
      activityOffer:{...activityOffer},claim: {incarnationId:currentIncarnation}} };
  const activities = { engine, client: {clientRun:id(),runtime: {ready:true, ...host, hostContext:host, nativeRun, adapterEpoch}},
    status: characterId => engine.status(characterId),
    cancel: characterId => engine.cancel(characterId) };
  const dialogue = new Act5Dialogue({ activities, characterService: {native}, now:()=>now, id });
  return {dialogue,engine,activities,commands,advance: ms => {now += ms},retire:()=>{currentEncounter=id()},
    changeToken:()=>{currentToken='other-token'},changeIncarnation:()=>{currentIncarnation=id()},
    setOffer:update=>{activityOffer={...activityOffer,...update}},
    restart:()=>{const nextEpoch=id();activities.client.runtime.adapterEpoch=nextEpoch;
      engine.noteHello({...hello,adapterEpoch:nextEpoch});},
    reconnect:()=>{activities.client.clientRun=id();engine.noteHello({...hello,clientRestart:true});
      engine.noteHello(hello);},
    sessionChange:()=>{activities.client.clientRun=id();}};

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

const extendedNative = ['approach_person','stop_and_face','walk_away_from','take_cover',
  'scenario_here','enter_vehicle_seat','exit_vehicle'];
const extendedProbes = ['A1','C2','S1','V1','V2','V3','V4','SVE1'];
// Config intentionally caps passedProbes at twelve. Drop ACT2 ground-sit
// probe in this ACT3 matrix; original ACT2-only tests retain full coverage.
const nativeHarness = () => harness({act3Capabilities:extendedNative,extraProbes:extendedProbes,
  baseProbes:probes.filter(p=>p!=='K1')});

test('ACT5 advertises the full enabled ACT3 set but does not expose ACT6 or unprobed native paths', async () => {
  const gated = harness({act3Capabilities:extendedNative,extraProbes:['A1','C2','S1']});
  const withoutVehicle = await gated.dialogue.prepare(turn(),'player_text');
  assert.equal(withoutVehicle.intents.includes('board_vehicle'),false);
  assert.equal(withoutVehicle.intents.includes('ride_along'),false);
  assert.equal(withoutVehicle.intents.includes('exit_vehicle_and_hold'),false); // actor is on foot
  const h = nativeHarness();
  const context = await h.dialogue.prepare(turn(),'player_text');
  assert.deepEqual(context.intents,[
    'hold_position','accompany','resume_previous','approach_and_face',
    'leave_scene','take_cover_and_hold','scenario_here','board_vehicle','ride_along',
      ]);
  assert.equal(context.intents.includes('vehicle_trip'),false);
  assert.equal(context.intents.includes('go_to_place'),false);
  assert.equal(context.intents.includes('exit_vehicle_and_hold'),false);
  assert.equal(context.availableChoices.scenario_here.length,7);
  assert.deepEqual(context.availableChoices.board_vehicle.map(slot=>slot.seat),
    ['any_passenger','passenger','rear']);
  for (const [intent, options] of Object.entries(context.availableChoices)) {
    for (const slots of options) assert.equal(validateAct5Choice(choice(intent,slots),context.intents),true,
      intent+JSON.stringify(slots));
  }
  for (const invalid of [
    choice('scenario_here',{scenario:'sit_bench'}),
    choice('scenario_here',{scenario:'unknown'}),
    choice('ride_along',{seat:'driver'}),
    choice('board_vehicle',{vehicle:{kind:'turn_alias',alias:'V001'},seat:'passenger'}),
    choice('board_vehicle',{vehicle:{kind:'player_vehicle'},seat:'driver'}),
    choice('board_vehicle',{vehicle:{kind:'player_vehicle'},seat:1}),
    choice('exit_vehicle_and_hold',{seat:'passenger'}),
  ]) assert.equal(validateAct5Choice(invalid,context.intents),false);
});

test('the strict Luna JSON schema enumerates exactly verified scenarios and seat choices', async () => {
  const h=nativeHarness(), t=turn(), ctx=await h.dialogue.prepare(t,'player_text');
  const request=buildRequest({model:'gpt-6-luna',effort:'low',systemInstruction:'NPC',
    input:'hello',activityContext:ctx});
  const all=request.text.format.schema.properties.activity.anyOf;
  assert.equal(all[0].type,'null');
  assert.equal(all.length,1+3+3+7+3+3);
  const byIntent=intent=>all.filter(node=>node.properties?.intent?.enum?.[0]===intent);
  assert.deepEqual(byIntent('scenario_here').map(node=>node.properties.slots.properties.scenario.enum[0]),
    ['drink_coffee','smoke','phone','lean','stand_idle','clipboard','binoculars']);
  assert.deepEqual(byIntent('board_vehicle').map(node=>node.properties.slots.properties.seat.enum[0]),
    ['any_passenger','passenger','rear']);
  assert.equal(all.every(node=>node.type==='null' ||
    (node.additionalProperties===false && node.required.join(',')==='intent,slots' &&
     node.properties.slots.additionalProperties===false &&
     node.properties.slots.required.every(k=>Object.hasOwn(node.properties.slots.properties,k)))),true);
  assert.match(request.input[0].content,/availableChoices/);
  const segment=buildRequest({model:'gpt-6-luna',effort:'low',systemInstruction:'NPC',input:'hello',
    activityContext:ctx,structuredSegments:true,lunaDeliveryVersion:1});
  assert.deepEqual(segment.text.format.schema.properties.activity,request.text.format.schema.properties.activity);
  const approved=choice('scenario_here',{scenario:'drink_coffee'});
  assert.deepEqual(parseDecisionJson(JSON.stringify(decision(approved)),{act5Intents:ctx.intents}),decision(approved));
  const decoder=createSegmentDecoder({act5Intents:ctx.intents,lunaDeliveryVersion:1});
  decoder.append(JSON.stringify({mode:'buffered_action',
    segments:[{delivery:'neutral',text:'Mind if I grab a coffee?'}],command:'',activity:approved}));
  assert.deepEqual(decoder.finish().decision,
    {dialogue:'Mind if I grab a coffee?',command:'',activity:approved});
});

test('all supported ACT3 options admit the existing native plan only after a spoken proposal and direct consent', async () => {
  for (const [intent,slots,utterance] of [
    ['scenario_here',{scenario:'drink_coffee'},'Sure, go ahead.'],
    ['scenario_here',{scenario:'phone'},'Sounds good.'],
    ['board_vehicle',{vehicle:{kind:'player_vehicle'},seat:'any_passenger'},'Okay, get in.'],
    ['board_vehicle',{vehicle:{kind:'player_vehicle'},seat:'rear'},'Sure, hop in.'],
    ['ride_along',{seat:'passenger'},'Yeah, let’s go.'],
    ['ride_along',{seat:'rear'},'Ride with me.'],
    ['exit_vehicle_and_hold',{},'Go ahead, get out.'],
    ['approach_and_face',{person:{kind:'player'}},'Yeah, let’s do that.'],
    ['leave_scene',{},'Go for it.'],
    ['take_cover_and_hold',{},'Okay take cover.'],
  ]) {
    const h=nativeHarness();
    if(intent==='exit_vehicle_and_hold')h.setOffer({actorInVehicle:true,actorOnFoot:false});
    const t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
    const proposed=await h.dialogue.publish(t,decision(choice(intent,slots)),ctx,()=>true);
    assert.equal(proposed,true,intent);
    assert.equal(h.engine.goals.goals.length,0,intent);
    assert.equal(h.commands.length,0,intent);
    const approving=turn(),replyContext=await h.dialogue.prepare(approving,'player_text');
    const reply=await h.dialogue.onPlayerInput(approving,utterance,replyContext,()=>true);
    assert.equal(reply?.kind,'approval_pending',intent);
    assert.equal(h.engine.goals.goals.length,0,intent);
    const admitted=await h.dialogue.commitApproved(approving,()=>true);
    assert.equal(admitted.ok,true,intent+':'+admitted.reason);
    assert.equal(h.engine.activities.length,1,intent);
    assert.equal(h.engine.activities[0].template,intent);
    assert.equal(h.engine.activities[0].steps.length,
      ['approach_and_face','leave_scene','exit_vehicle_and_hold'].includes(intent)?2:1);
    assert.equal(h.commands.filter(frame=>frame.type==='actor.acquire').length,1);
    assert.equal((await h.dialogue.commitApproved(approving,()=>true)).ok,false);
  }
});

test('natural refusals, ambiguous speech and changed minds do not produce ghost activity', async () => {
  for (const utterance of ['Actually, never mind.','No, stay here instead.','Please don’t.']) {
    const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_mic');
    await h.dialogue.publish(t,decision(choice('board_vehicle',{vehicle:{kind:'player_vehicle'},seat:'any_passenger'})),ctx,()=>true);
    const next=turn(),snapshot=await h.dialogue.prepare(next,'player_mic');
    assert.equal((await h.dialogue.onPlayerInput(next,utterance,snapshot,()=>true))?.kind,'declined');
    assert.equal(h.commands.length,0);
  }
  for (const utterance of ['I said yes yesterday','sure but not right now',
    'Yes, what was that song?', 'I guess we could think about it','no, wait, yes',
    'okay, do you know the weather?']) {
    const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
    await h.dialogue.publish(t,decision(choice('scenario_here',{scenario:'drink_coffee'})),ctx,()=>true);
    const next=turn(),snapshot=await h.dialogue.prepare(next,'player_text');
    assert.equal(await h.dialogue.onPlayerInput(next,utterance,snapshot,()=>true),null,utterance);
    assert.equal(h.commands.length,0);
  }
});

test('stop cancels only the ACT5-owned currently active activity, never a later player activity', async () => {
  const h=nativeHarness(),initial=turn(),available=await h.dialogue.prepare(initial,'player_text');
  await h.dialogue.publish(initial,decision(choice('hold_position')),available,()=>true);
  const approval=turn(),snapshot=await h.dialogue.prepare(approval,'player_text');
  await h.dialogue.onPlayerInput(approval,'Sure',snapshot,()=>true);
  assert.equal((await h.dialogue.commitApproved(approval,()=>true)).ok,true);
  const stop=turn(),stopSnapshot=await h.dialogue.prepare(stop,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(stop,'Stop doing that',stopSnapshot,()=>true))?.kind,'cancelled');
  assert.equal(h.engine.activities[0].status,'cancelled');
  const next=turn(),nextSnapshot=await h.dialogue.prepare(next,'player_text');
  assert.equal(await h.dialogue.onPlayerInput(next,'Stop doing that',nextSnapshot,()=>true),null);
});

test('expired proposals, rekeyed tokens and changed native adapter epochs never admit ACT5', async () => {
  const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  await h.dialogue.publish(t,decision(choice('ride_along',{seat:'rear'})),ctx,()=>true);
  h.advance(90001);
  const next=turn(),nextCtx=await h.dialogue.prepare(next,'player_text');
  assert.equal(await h.dialogue.onPlayerInput(next,'yeah',nextCtx,()=>true),null);
  assert.equal(h.commands.length,0);
  const k=nativeHarness(),u=turn(),uc=await k.dialogue.prepare(u,'player_text');
  await k.dialogue.publish(u,decision(choice('scenario_here',{scenario:'phone'})),uc,()=>true);
  const approve=turn(),apCtx=await k.dialogue.prepare(approve,'player_text');
  assert.equal((await k.dialogue.onPlayerInput(approve,'yes',apCtx,()=>true))?.kind,'approval_pending');
  k.changeToken();
  assert.equal((await k.dialogue.commitApproved(approve,()=>true)).ok,false);
  assert.equal(k.commands.length,0);
});

test('native availability is mandatory for ACT3 and restricts real offered seats', async () => {
  const h=nativeHarness();
  h.setOffer({vehicleAvailable:false,scenarioReady:false,playerNearby:false});
  let ctx=await h.dialogue.prepare(turn(),'player_text');
  assert.equal(ctx.intents.includes('board_vehicle'),false);
  assert.equal(ctx.intents.includes('ride_along'),false);
  assert.equal(ctx.intents.includes('scenario_here'),false);
  assert.equal(ctx.intents.includes('approach_and_face'),false);
  assert.equal(ctx.intents.includes('leave_scene'),false);
  assert.equal(ctx.intents.includes('take_cover_and_hold'),true);
  h.setOffer({vehicleAvailable:true,scenarioReady:true,playerNearby:true,
    frontFree:false,rearFree:true,passengerFree:true});
  ctx=await h.dialogue.prepare(turn(),'player_text');
  assert.deepEqual(ctx.availableChoices.board_vehicle.map(x=>x.seat),['any_passenger','rear']);
  const schema=buildRequest({model:'gpt-6-luna',effort:'low',systemInstruction:'NPC',
    input:'test',activityContext:ctx}).text.format.schema.properties.activity.anyOf;
  const offered=schema.filter(x=>x.properties?.intent?.enum?.[0]==='board_vehicle');
  assert.deepEqual(offered.map(x=>x.properties.slots.properties.seat.enum[0]),
    ['any_passenger','rear']);
  assert.equal(validateAct5Choice(choice('board_vehicle',
    {vehicle:{kind:'player_vehicle'},seat:'passenger'}),ctx.intents,ctx.availableChoices),false);
  h.setOffer({actorInVehicle:true,actorOnFoot:false});
  ctx=await h.dialogue.prepare(turn(),'player_text');
  assert.equal(ctx.intents.includes('exit_vehicle_and_hold'),true);
  for (const intent of ['board_vehicle','ride_along','scenario_here','approach_and_face','leave_scene','take_cover_and_hold'])
    assert.equal(ctx.intents.includes(intent),false);
  // Old/native stub builds without snapshot retain ACT2, never fake ACT3 proof.
  h.setOffer({version:0});
  ctx=await h.dialogue.prepare(turn(),'player_text');
  assert.deepEqual(ctx.intents,['hold_position','accompany','resume_previous']);
});

test('world conditions are rechecked after the offer and again after consent', async () => {
  const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  h.setOffer({vehicleStopped:false});
  assert.equal(await h.dialogue.publish(t,decision(choice('board_vehicle',
    {vehicle:{kind:'player_vehicle'},seat:'rear'})),ctx,()=>true),false);
  assert.equal(h.commands.length,0);
  h.setOffer({vehicleStopped:true});
  const t2=turn(),c2=await h.dialogue.prepare(t2,'player_text');
  assert.equal(await h.dialogue.publish(t2,decision(choice('board_vehicle',
    {vehicle:{kind:'player_vehicle'},seat:'rear'})),c2,()=>true),true);
  const yes=turn(),c3=await h.dialogue.prepare(yes,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(yes,'sure',c3,()=>true)).kind,'approval_pending');
  h.setOffer({rearFree:false,passengerFree:false});
  assert.equal((await h.dialogue.commitApproved(yes,()=>true)).ok,false);
  assert.equal(h.commands.length,0);
});

test('native on-foot ACT3 proposals never appear without an inspected owner snapshot', async () => {
  const h=nativeHarness();
  h.setOffer({safe:false});
  const ctx=await h.dialogue.prepare(turn(),'player_text');
  assert.deepEqual(ctx.intents,[]);
  assert.equal(validateAct5Choice(choice('hold_position'),['hold_position'],{}),false);
});

test('native seated actor never offers to sit down or follow on foot', async () => {
  const h=harness();
  h.setOffer({actorInVehicle:true,actorOnFoot:false});
  const ctx=await h.dialogue.prepare(turn(),'player_text');
  assert.equal(ctx.intents.includes('sit_here'),false);
  assert.equal(ctx.intents.includes('accompany'),false);
  assert.equal(ctx.intents.includes('hold_position'),true);
  h.setOffer({actorInVehicle:false,actorOnFoot:true});
  const standing=await h.dialogue.prepare(turn(),'player_text');
  assert.equal(standing.intents.includes('sit_here'),true);
  assert.equal(standing.intents.includes('accompany'),true);
});

test('one native-published invitation cannot be repeated immediately after global cooldown', async () => {
  const h=harness(),first=turn(),c1=await h.dialogue.prepare(first,'player_text');
  assert.equal(await h.dialogue.publish(first,decision(choice('hold_position')),c1,()=>true),true);
  const no=turn(),c2=await h.dialogue.prepare(no,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(no,'no',c2,()=>true)).kind,'declined');
  h.advance(90_001);
  let after=await h.dialogue.prepare(turn(),'player_text');
  assert.equal(after.intents.includes('hold_position'),false);
  assert.equal(after.intents.includes('accompany'),true);
  h.advance(210_000);
  after=await h.dialogue.prepare(turn(),'player_text');
  assert.equal(after.intents.includes('hold_position'),true);
});

// Integrated from main ACT5 native epoch/receipt hardening; keep both safety contracts.
test('native adapter replacement retires pending offers and previously admitted replay IDs', async () => {
  const h = harness(), p=turn(), ctx=await h.dialogue.prepare(p,'player_text');
  await h.dialogue.publish(p,decision(choice('hold_position')),ctx,()=>true);
  const yes = turn(), before=await h.dialogue.prepare(yes,'player_text');
  h.restart();
  assert.equal((await h.dialogue.onPlayerInput(yes,'sure',before,()=>true))?.kind,'unavailable',
    'stale adapter consent is explicitly rejected');
  assert.equal(h.engine.goals.goals.length,0);
  const owner={characterId:actor,ownerAlias,ownershipToken:'native-token',encounterId:encounter,incarnationId:incarnation};
  const proposal={proposalVersion:1,proposalId:id(),source:'player_dialogue',subject:{characterId:actor},
    intent:'hold_position',slots:{},priority:'player_direct',origin:{turn:{...turn().identity}},proposedAtMs:10000};
  assert.equal(h.engine.assign(proposal,owner,{playerApproved:true}).ok,true);
  assert.equal(h.engine.assign(proposal,owner,{playerApproved:true}).ok,true,'same-epoch replay is idempotent');
  h.reconnect();
  assert.equal(h.engine.assign(proposal,owner,{playerApproved:true}).reason,'epoch_changed');
  assert.equal(h.engine.goals.goals.length,1);
  assert.equal(h.commands.filter(item=>item.type==='actor.acquire').length,1);
});

test('receipt correlation rejects a mismatched activity, step, actor, capability or attempt', () => {
  const h=harness(), t=turn();
  const owner={characterId:actor,ownerAlias,ownershipToken:'native-token',encounterId:encounter,incarnationId:incarnation};
  const proposal={proposalVersion:1,proposalId:id(),source:'player_dialogue',subject:{characterId:actor},
    intent:'resume_previous',slots:{},priority:'player_direct',origin:{turn:{...t.identity}},proposedAtMs:10000};
  assert.equal(h.engine.assign(proposal,owner,{playerApproved:true}).ok,true);
  const acquire = h.commands.find(item=>item.type==='actor.acquire');
  h.engine.ingest({type:'actor.acquired',requestId:acquire.requestId,encounterId:encounter,incarnationId:incarnation,leaseEpoch:1});
  const preflight = h.commands.find(item=>item.type==='step.preflight');
  h.engine.ingest({type:'step.preflighted',requestId:preflight.requestId});
  const begin=h.commands.find(item=>item.type==='step.begin');
  const activity=h.engine.activities[0], step=activity.steps[0], blank=JSON.stringify(activity.status);
  const frame={executionId:begin.executionId,activityId:activity.activityId,stepId:step.stepId,
    actorEncounterId:encounter,capability:step.capability,attempt:step.attempts,state:'HANDLER_ACCEPTED',
    sequence:1,epochs:{nativeRun,adapterEpoch,leaseEpoch:1}};
  for(const patch of [{activityId:id()},{stepId:id()},{actorEncounterId:id()},{capability:'follow_person'},{attempt:8}]) {
    h.engine.ingest({type:'receipt',receipt:{...frame,...patch}});
    assert.equal(JSON.stringify(activity.status),blank,'rejected before state mutation');
  }
  assert.equal(h.engine.staleReceipts,5);
  h.engine.ingest({type:'receipt',receipt:frame});
  assert.equal(activity.status,'running');
  h.engine.ingest({type:'receipt',receipt:frame});
  assert.equal(h.engine.staleReceipts,6,'duplicated sequence rejected');
  assert.equal(h.engine.cancel(actor).ok,true);
  h.engine.ingest({type:'receipt',receipt:{...frame,sequence:2}});
  assert.equal(activity.status,'cancelled','terminal goal never resurrected');
});

test('client-session replacement without native epoch rotation invalidates prior consent', async () => {
  const h=harness(), proposed=turn(), context=await h.dialogue.prepare(proposed,'player_text');
  await h.dialogue.publish(proposed,decision(choice('sit_here')),context,()=>true);
  const yes=turn(), previous=await h.dialogue.prepare(yes,'player_text');
  h.sessionChange(); // Same nativeRun and adapterEpoch; only the authenticated pipe session changed.
  assert.equal((await h.dialogue.onPlayerInput(yes,'yes',previous,()=>true))?.kind,'unavailable');
  assert.equal(h.engine.goals.goals.length,0);
});

test('ACT5 cancel never cancels a newer non-ACT5 activity', async () => {
  const h=harness(), t=turn(), context=await h.dialogue.prepare(t,'player_text');
  await h.dialogue.publish(t,decision(choice('hold_position')),context,()=>true);
  const yes=turn(), ctx=await h.dialogue.prepare(yes,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(yes,'sure',ctx,()=>true)).kind,'approval_pending');
  assert.equal((await h.dialogue.commitApproved(yes,()=>true)).ok,true);
  const old=h.engine.activities.at(-1);
  h.engine.cancel(actor);
  const newOwner={characterId:actor,ownerAlias,ownershipToken:'native-token',encounterId:encounter,incarnationId:incarnation};
  const fresh={proposalVersion:1,proposalId:id(),source:'player_ux',subject:{characterId:actor},
    intent:'sit_here',slots:{},priority:'player_direct',origin:{},proposedAtMs:10000};
  assert.equal(h.engine.assign(fresh,newOwner).ok,true);
  const stop=turn(), prepared=await h.dialogue.prepare(stop,'player_text');
  assert.equal(await h.dialogue.onPlayerInput(stop,'stop',prepared,()=>true),null);
  assert.equal(old.status,'cancelled');
  assert.notEqual(h.engine.activities.at(-1).status,'cancelled');
});

test('contextual approval retains mainline speakable coffee and boarding affirmations', async () => {
  for (const [intent,slots,phrase] of [
    ['board_vehicle',{vehicle:{kind:'player_vehicle'},seat:'any_passenger'},'You can hop in'],
    ['ride_along',{seat:'rear'},'Sure, ride along'],
    ['scenario_here',{scenario:'drink_coffee'},'Sure grab a coffee'],
  ]) {
    const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
    assert.equal(await h.dialogue.publish(t,decision(choice(intent,slots)),ctx,()=>true),true);
    const reply=turn(),next=await h.dialogue.prepare(reply,'player_text');
    assert.equal((await h.dialogue.onPlayerInput(reply,phrase,next,()=>true))?.kind,'approval_pending',intent);
  }
});


test('ACT6 navigation suggestions remain explicitly gated and reflect real native travel eligibility',async()=>{
  const walk=harness({act6Capabilities:['walk_to'],extraProbes:['NV1','Q2','L1']});
  const w=await walk.dialogue.prepare(turn(),'player_mic');
  assert.ok(w.intents.includes('go_to_place'));
  assert.equal(w.intents.includes('vehicle_trip'),false);
  walk.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:false});
  assert.equal((await walk.dialogue.prepare(turn(),'player_mic')).intents.includes('go_to_place'),false);
  const drive=harness({act6Capabilities:['drive_to'],extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  assert.equal((await drive.dialogue.prepare(turn(),'player_mic')).intents.includes('vehicle_trip'),false);
  drive.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:true});
  assert.equal((await drive.dialogue.prepare(turn(),'player_mic')).intents.includes('vehicle_trip'),true);
});

test('ACT6 closed player requests stage exactly one approved goal under current main ACT5 epochs',async()=>{
  const h=harness({act6Capabilities:['walk_to'],extraProbes:['NV1','Q2','L1']});
  const t=turn(),context=await h.dialogue.prepare(t,'player_mic');
  assert.deepEqual(parseAct6PlayerRequest('Head over to my map marker'),{intent:'go_to_place',slots:{place:{kind:'waypoint'}}});
  assert.equal(parseAct6PlayerRequest('Go to 123 -54 9'),null);
  assert.equal((await h.dialogue.onPlayerInput(t,'Go to the waypoint',context,()=>true))?.kind,'approval_pending');
  assert.equal(h.commands.filter(x=>x.type==='actor.acquire').length,0);
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,true);
  assert.equal(h.commands.filter(x=>x.type==='actor.acquire').length,1);
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,false);
});

test('ACT6 explicit stop can cancel owner-matched UX navigation without reopening generic ACT5 cancellation',async()=>{
  const h=harness({act6Capabilities:['drive_to'],extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  h.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:true});
  const t=turn(),context=await h.dialogue.prepare(t,'player_mic');
  const result=h.engine.assign({
    proposalVersion:1,proposalId:id(),source:'player_ux',subject:{characterId:actor},
    intent:'vehicle_trip',slots:{place:{kind:'waypoint'}},priority:'player_direct',origin:{},proposedAtMs:10000
  },context.owner.binding);
  assert.equal(result.ok,true);
  assert.equal((await h.dialogue.onPlayerInput(t,'Stop walking',context,()=>true)),null);
  assert.equal((await h.dialogue.onPlayerInput(t,'Stop driving',context,()=>true))?.kind,'cancelled');
  assert.equal(h.engine.activities[0].status,'cancelled');
});

test('ACT6 takes ownership of direct navigation even if Luna proposes stock free drive',()=>{
  const input={dialogue:'We are already on the road.',command:'DO BeginDriving V001',
    activity:{intent:'hold_position',slots:{}}};
  const reply={kind:'approval_pending',intent:'vehicle_trip'};
  const fixed=reconcileAct6Decision(input,reply);
  assert.equal(fixed.suppressed,true);
  assert.deepEqual(fixed.decision,{dialogue:"Okay, I'll try to navigate there.",command:'',activity:null});
  assert.equal(input.command,'DO BeginDriving V001','input stays unchanged');
  assert.throws(()=>reconcileAct6Decision(input,reply,{nativeHandoffStarted:true}),/audio handoff/);
  assert.equal(reconcileAct6Decision({dialogue:'fine',command:'',activity:null},reply).suppressed,false);
  assert.equal(reconcileAct6Decision(input,{kind:'unavailable',intent:'board_vehicle'}).suppressed,false);
  assert.equal(reconcileAct6Decision(input,{kind:'unavailable',intent:'vehicle_trip',reason:'place_unresolved'})
    .decision.dialogue,"I can't verify that destination right now.");
});

// October 18 regression: ACT6 is a player command, NOT an optional ACT5 offer.
test('ACT6 direct player navigation admits with ACT5 suggestions disabled and a live native owner',async()=>{
  const h=harness({enabled:false,act6Capabilities:['drive_to'],
    extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  h.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:true,waypointAvailable:true});
  const t=turn(),ctx=await h.dialogue.prepare(t,'player_mic');
  assert.ok(ctx,'direct navigation must acquire owner without ACT5');
  assert.deepEqual(ctx.intents,[],'ACT5 suggestion menu must remain disabled');
  assert.deepEqual(ctx.availableChoices,{});
  const staged=await h.dialogue.onPlayerInput(t,'All right, drive to the waypoint',ctx,()=>true);
  assert.deepEqual(staged,{kind:'approval_pending',intent:'vehicle_trip'});
  assert.equal(h.commands.length,0,'native work is not issued until validated transcript publication');
  const result=await h.dialogue.commitApproved(t,()=>true);
  assert.equal(result.ok,true,result.reason);
  assert.equal(h.engine.activities.at(-1).template,'vehicle_trip');
  assert.equal(h.engine.activities.at(-1).steps[0].capability,'drive_to');
  assert.deepEqual(h.commands.map(x=>x.type),['actor.acquire']);
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,false,'one turn never dispatches twice');
  assert.equal(await h.dialogue.publish(t,{activity:{intent:'hold_position',slots:{}}},ctx,()=>true),false,
    'ACT5 offers stay disabled even though direct ACT6 navigation is enabled');
});

test('ACT6 independent path reports exact gates and does not impersonate stock driving',async()=>{
  const opts={enabled:false,act6Capabilities:['drive_to']};
  const testRequest=async(h,phrase='Drive to the waypoint',offer={})=>{
    h.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:true,waypointAvailable:true,...offer});
    const t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
    assert.ok(ctx);
    const outcome=await h.dialogue.onPlayerInput(t,phrase,ctx,()=>true);
    assert.deepEqual(h.commands,[]);
    return outcome;
  };
  const missingProbe=harness({...opts,extraProbes:[]});
  assert.equal((await testRequest(missingProbe)).reason,'native_probes_missing');
  const failedHello=harness({...opts,extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  failedHello.engine.noteHello({type:'hello',...host,nativeRun,adapterEpoch,capabilities:{drive_to:false}});
  assert.equal((await testRequest(failedHello)).reason,'native_capability_missing');
  const wrongDriver=harness({...opts,extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  assert.equal((await testRequest(wrongDriver,'Drive to the waypoint',{actorIsDriver:false})).reason,'driver_required');
  const missingWaypoint=harness({...opts,extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  assert.equal((await testRequest(missingWaypoint,'Drive to the waypoint',{waypointAvailable:false})).reason,'place_unresolved');
  const stale=harness({...opts,extraProbes:['NV2','Q2','L1','D1','D2','D3','SVE1']});
  stale.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:true});
  const t=turn(),ctx=await stale.dialogue.prepare(t,'player_text');
  assert.equal((await stale.dialogue.onPlayerInput(t,'Take us to my marker',ctx,()=>true)).kind,'approval_pending');
  stale.retire();
  assert.equal((await stale.dialogue.commitApproved(t,()=>true)).ok,false);
  assert.deepEqual(stale.commands,[],'stale native owner must not dispatch');
});

test('ACT6 disabled does not enable unrelated ACT3 or ACT5 dialogue authority',async()=>{
  const noAct6=harness({enabled:false});
  assert.equal(await noAct6.dialogue.prepare(turn(),'player_mic'),null);
  const wrongPhase=harness({enabled:false,act6Capabilities:['walk_to'],
    act3Capabilities:['enter_vehicle_seat'],extraProbes:['NV1','Q2','L1','SVE1']});
  const t=turn(),ctx=await wrongPhase.dialogue.prepare(t,'player_mic');
  assert.ok(ctx);
  assert.deepEqual(ctx.intents,[]);
  const attempted=wrongPhase.engine.assign({
    proposalVersion:1,proposalId:id(),source:'player_dialogue',subject:{characterId:actor},
    intent:'board_vehicle',slots:{vehicle:{kind:'player_vehicle'},seat:'driver'},
    priority:'player_direct',origin:{},proposedAtMs:10000
  },ctx.owner.binding,{playerApproved:true});
  assert.equal(attempted.ok,false,'ACT3 still requires the original ACT5 dialogue opt-in');
  assert.equal(attempted.reason,'policy_denied');
  assert.equal(wrongPhase.commands.length,0);
});

// Registry includes FR1 in the baseline. Keep all D3/SVE1 driver proofs inside
// normalizeActivityConfig's twelve-probe limit, as the existing ACT6 tests do.
const act6Probes=['NV2','Q2','L1','D1','D2','D3','SVE1'];
const drivingHarness=({enabled=true,act6Capabilities=['drive_to'],baseProbes=probes}={})=>{
  const h=harness({enabled,act6Capabilities,extraProbes:act6Probes,baseProbes});
  h.setOffer({actorOnFoot:false,actorInVehicle:true,actorIsDriver:true,waypointAvailable:true});
  return h;
};
test('ACT6 direct player driving orders become one real vehicle_trip via ACT5 publication',async()=>{
  for(const utterance of ['All right, drive to the waypoint','Take us to my marker',
      'Head to the airport','Drive us over there','Drive us to the airport']) {
    const h=drivingHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_mic');
    const reply=await h.dialogue.onPlayerInput(t,utterance,ctx,()=>true);
    assert.equal(reply?.kind,'approval_pending',utterance);
    assert.equal(reply?.intent,'vehicle_trip',utterance);
    assert.equal(h.commands.length,0,'pre-publication must remain inert');
    const admitted=await h.dialogue.commitApproved(t,()=>true);
    assert.equal(admitted.ok,true,utterance+':'+admitted.reason);
    assert.equal(h.engine.activities.at(-1).template,'vehicle_trip');
    assert.equal(h.engine.activities.at(-1).steps[0].capability,'drive_to');
    assert.equal(h.commands.filter(frame=>frame.type==='actor.acquire').length,1);
    assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,false,'no replay');
  }
});
test('ACT6 rejects disabled capabilities, missing markers and unavailable drivers without free driving',async()=>{
  const disabled=drivingHarness({act6Capabilities:[]}),t=turn();
  const d=await disabled.dialogue.onPlayerInput(t,'All right, drive to the waypoint',
    await disabled.dialogue.prepare(t,'player_text'),()=>true);
  assert.deepEqual(d,{kind:'unavailable',intent:'vehicle_trip',reason:'capability_disabled'});
  assert.equal(disabled.commands.length,0);
  const noMarker=drivingHarness(),m=turn();
  noMarker.setOffer({waypointAvailable:false});
  const u=await noMarker.dialogue.onPlayerInput(m,'Drive us over there',
    await noMarker.dialogue.prepare(m,'player_text'),()=>true);
  assert.deepEqual(u,{kind:'unavailable',intent:'vehicle_trip',reason:'destination_unresolved'});
  assert.equal(noMarker.commands.length,0);
  const notDriver=drivingHarness(),n=turn();
  notDriver.setOffer({actorIsDriver:false});
  const refused=await notDriver.dialogue.onPlayerInput(n,'Drive to the waypoint',
    await notDriver.dialogue.prepare(n,'player_text'),()=>true);
  assert.deepEqual(refused,{kind:'unavailable',intent:'vehicle_trip',reason:'driver_required'});
  assert.equal(notDriver.commands.length,0);
  const unknown=drivingHarness(),a=turn();
  assert.deepEqual(await unknown.dialogue.onPlayerInput(a,'Drive to that building',
    await unknown.dialogue.prepare(a,'player_text'),()=>true),
    {kind:'unavailable',intent:'vehicle_trip',reason:'destination_unresolved'});
  assert.equal(unknown.commands.length,0);
});
test('ACT6 checks the native owner again before commit and cannot issue a ghost drive',async()=>{
  const h=drivingHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(t,'Drive to the waypoint',ctx,()=>true)).kind,'approval_pending');
  h.changeToken();
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,false);
  assert.equal(h.commands.length,0);
});


test('October 18 direct vehicle-seat utterances have exact closed native player-vehicle intent', () => {
  const kinds=[
    ['Nathan, get in the driver\'s seat','driver'],['Get into the driver seat','driver'],
    ['Hop in and drive','driver'],['Get behind the wheel','driver'],
    ['Take the driver\'s seat','driver'],['You drive','driver'],['You drive this time','driver'],
    ['Get into my car','any_passenger'],['Hop in','any_passenger'],
    ['Hop in the passenger seat','passenger'],['Ride shotgun','passenger'],
    ['Get into the back seat','rear'],
  ];
  for (const [utterance,seat] of kinds)
    assert.deepEqual(parseVehicleSeatPlayerRequest(utterance),
      {intent:'board_vehicle',slots:{vehicle:{kind:'player_vehicle'},seat}},utterance);
  for(const remark of ['I told Nathan to get in the car yesterday','Why don\'t we drive faster?',
    'Get in another car','Get in that car','Don\'t get in the driver\'s seat',
    'Are you in the driver\'s seat?','Drive to the waypoint','You drive to the airport'])
    assert.equal(parseVehicleSeatPlayerRequest(remark),null,remark);
});

test('model vehicle token diagnostics separate placeholder, shaped aliases and other commands', () => {
  for(const [command,kind] of [
    ['','none'],['DO EnterDriverSeat <vehicle>','placeholder'],
    ['DO EnterDriverSeat {vehicle}','placeholder'],['DO EnterDriverSeat VXXX','placeholder'],
    ['DO EnterDriverSeat V001','reference_shaped'],['DO EnterDriverSeat V999','reference_shaped'],
    ['DO WaitHere','other']])
    assert.equal(vehicleSeatModelCommandKind(command),kind,command);
});

test('October 18 placeholder DO is replaced by deterministic ACT3 intent before stock validation', () => {
  const driver=parseVehicleSeatPlayerRequest('Get in the driver\'s seat');
  for(const command of ['DO EnterDriverSeat <vehicle>','DO EnterDriverSeat {vehicle}',
      'DO EnterDriverSeat VXXX','DO EnterDriverSeat V999','DO BeginDriving']) {
    const result=reconcileVehicleSeatDecision({dialogue:'I got in.',command,activity:{intent:'board_vehicle',slots:{}}},
      driver,{kind:'approval_pending',intent:'board_vehicle'});
    assert.equal(result.decision.command,'');
    assert.equal(result.decision.activity,null);
    assert.match(result.decision.dialogue,/try/i);
    assert.equal(result.reason,'native_admission_pending');
    assert.equal(result.accepted,true);
  }
  assert.throws(()=>reconcileVehicleSeatDecision({dialogue:'Yes',command:'DO EnterDriverSeat <vehicle>'},
    driver,{kind:'approval_pending',intent:'board_vehicle'}, {nativeHandoffStarted:true}),/audio handoff/);
  const refuse=reconcileVehicleSeatDecision({dialogue:"I'm driving!",command:'DO EnterDriverSeat V001'},
    driver,{kind:'unavailable',intent:'board_vehicle',reason:'seat_occupied'});
  assert.equal(refuse.decision.command,'');
  assert.match(refuse.decision.dialogue,/taken/i);
  assert.equal(refuse.accepted,false);
  assert.equal(reconcileVehicleSeatDecision({dialogue:'Okay',command:'DO WaitHere'},
    null,{kind:'approval_pending',intent:'board_vehicle'}).decision.command,'DO WaitHere');
});

test('direct driver/passenger orders stage one ACT3 owner-controlled step, never a V### stock DO',async()=>{
  for(const [utterance,seat] of [['Get behind the wheel','driver'],
    ['Hop in the passenger seat','passenger'],['Get into the back seat','rear'],
    ['Get into my car','any_passenger']]) {
    const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_mic');
    const staged=await h.dialogue.onPlayerInput(t,utterance,ctx,()=>true);
    assert.deepEqual(staged,{kind:'approval_pending',intent:'board_vehicle',seat},utterance);
    assert.equal(h.commands.length,0,'no native task before transcript acceptance');
    assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,true);
    const activity=h.engine.activities.at(-1);
    assert.equal(activity.template,'board_vehicle');
    assert.equal(activity.steps[0].capability,'enter_vehicle_seat');
    assert.equal(activity.steps[0].args.seat,seat);
    assert.equal(h.commands.filter(x=>x.type==='actor.acquire').length,1);
    assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,false,'no replay');
  }
});

test('direct seat entry rejects unavailable, moving, occupied vehicles and respects ACT3 gates',async()=>{
  for(const [offer,reason] of [
    [{vehicleAvailable:false},'vehicle_unavailable'],
    [{vehicleStopped:false},'vehicle_moving'],
    [{driverFree:false},'seat_occupied'],
    [{safe:false},'native_unavailable'],
  ]) {
    const h=nativeHarness();h.setOffer(offer);
    const t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
    const result=await h.dialogue.onPlayerInput(t,'You drive',ctx,()=>true);
    assert.deepEqual(result,{kind:'unavailable',intent:'board_vehicle',reason,seat:'driver'});
    assert.equal(h.commands.length,0);
  }
  const disabled=harness(),t=turn();
  assert.deepEqual(await disabled.dialogue.onPlayerInput(t,'You drive',
    await disabled.dialogue.prepare(t,'player_text'),()=>true),
    {kind:'unavailable',intent:'board_vehicle',reason:'capability_disabled',seat:'driver'});
  assert.equal(disabled.commands.length,0);
  const h=nativeHarness(),x=turn(),ctx=await h.dialogue.prepare(x,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(x,'You drive',ctx,()=>true)).kind,'approval_pending');
  h.setOffer({driverFree:false});
  assert.equal((await h.dialogue.commitApproved(x,()=>true)).ok,false,'seat lost between staging and commit');
  assert.equal(h.commands.length,0);
});

test('owner revocation, interruption and retry cannot leave a replayed seat order',async()=>{
  for(const invalidate of ['changeToken','retire','changeIncarnation','restart','sessionChange']) {
    const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
    assert.equal((await h.dialogue.onPlayerInput(t,'You drive',ctx,()=>true)).kind,'approval_pending');
    h[invalidate]();
    assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,false,invalidate);
    assert.equal(h.commands.length,0,invalidate);
  }
  const h=nativeHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(t,'You drive',ctx,()=>true)).kind,'approval_pending');
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,true);
  assert.equal(h.engine.cancel(actor).ok,true,'interrupted seat task is cancelled by existing engine');
  const again=turn(),next=await h.dialogue.prepare(again,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(again,'You drive',next,()=>true)).kind,'approval_pending');
  assert.equal((await h.dialogue.commitApproved(again,()=>true)).ok,true,'retry is a fresh owner-scoped request');
});

test('ACT6-owned navigation is not superseded by driver-seat orders',async()=>{
  const h=drivingHarness(),t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  const result=h.engine.assign({
    proposalVersion:1,proposalId:id(),source:'player_ux',subject:{characterId:actor},
    intent:'vehicle_trip',slots:{place:{kind:'waypoint'}},priority:'player_direct',
    origin:{},proposedAtMs:10000
  },ctx.owner.binding);
  assert.equal(result.ok,true);
  const before=h.engine.activities.length;
  const request=await h.dialogue.onPlayerInput(t,'You drive',ctx,()=>true);
  assert.deepEqual(request,{kind:'unavailable',intent:'board_vehicle',reason:'actor_busy',seat:'driver'});
  assert.equal(h.engine.activities.length,before);
  assert.notEqual(h.engine.activities.at(-1).status,'cancelled');
});

test('already-seated advisory never becomes an unverified completion claim',async()=>{
  const offer={version:1,safe:true,actorInVehicle:true,actorOnFoot:false,
    vehicleAvailable:true,vehicleStopped:false,actorSeatIndex:-1,actorIsDriver:true,driverFree:false,
    actorVehicleIsPlayerVehicle:true};
  assert.equal(act5WorldAvailable('board_vehicle',
    {vehicle:{kind:'player_vehicle'},seat:'driver'},offer),true,
    'native ACT3 preflight must still verify the exact anchored vehicle');
  assert.equal(act5WorldAvailable('board_vehicle',
    {vehicle:{kind:'player_vehicle'},seat:'passenger'},offer),false);
  const h=nativeHarness();h.setOffer({...offer});
  const t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(t,'You drive',ctx,()=>true)).kind,'approval_pending');
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,true);
  assert.equal(h.engine.activities.at(-1).steps[0].capability,'enter_vehicle_seat');
});


test('issue 275: same-car front passenger can request driver seat, never a different car or occupied seat',async()=>{
  const slots={vehicle:{kind:'player_vehicle'},seat:'driver'};
  const offer={version:1,safe:true,actorInVehicle:true,actorOnFoot:false,
    actorVehicleIsPlayerVehicle:true,actorSeatIndex:0,actorIsDriver:false,
    vehicleAvailable:true,vehicleStopped:true,driverFree:true,frontFree:false};
  assert.equal(act5WorldAvailable('board_vehicle',slots,offer),true);
  for(const bad of [
    {...offer,actorVehicleIsPlayerVehicle:false},
    {...offer,actorSeatIndex:1},
    {...offer,vehicleStopped:false},
    {...offer,driverFree:false},
  ])assert.equal(act5WorldAvailable('board_vehicle',slots,bad),false);
  const h=nativeHarness();h.setOffer({...offer});
  const t=turn(),ctx=await h.dialogue.prepare(t,'player_text');
  assert.equal((await h.dialogue.onPlayerInput(t,'Get in the driver seat',ctx,()=>true)).kind,'approval_pending');
  assert.equal((await h.dialogue.commitApproved(t,()=>true)).ok,true);
  assert.equal(h.engine.activities.at(-1).steps[0].args.seat,'driver');
  const mismatch=nativeHarness();mismatch.setOffer({...offer,actorVehicleIsPlayerVehicle:false});
  const tt=turn(),cc=await mismatch.dialogue.prepare(tt,'player_text');
  const refused=await mismatch.dialogue.onPlayerInput(tt,'You drive',cc,()=>true);
  assert.equal(refused.reason,'vehicle_mismatch');
  assert.equal(mismatch.engine.activities.length,0);
});
