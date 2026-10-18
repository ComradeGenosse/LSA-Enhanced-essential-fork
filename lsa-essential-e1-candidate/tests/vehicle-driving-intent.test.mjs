import test from 'node:test';
import assert from 'node:assert/strict';
import { drivingIntentKind, stockDrivingCommand, activeAct6Driving, liveAct6Driving, drivingModelGuidance, reconcileDrivingDecision } from '../src/activities/vehicleDrivingIntent.mjs';

test('whole-utterance continuation is not mistaken for evasive driving or a new drive', () => {
  for (const text of ['Keep going','Okay, keep driving!','Nathan, carry on driving','Just keep driving','Come on, keep going','Hey man, please keep going','Don\'t stop driving','All right dude, keep it going'])
    assert.equal(drivingIntentKind(text),'continue');
  for (const text of ['I said keep going yesterday','Where are we going?','Drive to the waypoint','Please drive to the airport','We should keep going tomorrow','Don\'t drive faster','Drive faster to the waypoint'])
    assert.equal(drivingIntentKind(text),null);
  const result=reconcileDrivingDecision({dialogue:'I will floor it!',command:'DO DriveEvasively'}, {kind:'continue'});
  assert.equal(result.blocked,'continuation_must_not_reset_task');
  assert.equal(result.decision.command,'');
  assert.doesNotMatch(result.decision.dialogue,/floor it/i);
  assert.equal(reconcileDrivingDecision({dialogue:'Sure.',command:'DO BeginDriving V001'}, {kind:'continue'}).decision.command,'');
});
test('Essential faster-driving aliases remain executable, never silently refused', () => {
  for (const phrase of ['Hey, drive faster!','Go faster','Floor it','Speed up','Step on it','Can you pick up speed?','Just go faster man','Come on bro, speed it up','Hey Nathan, can you drive a little faster?'])
    assert.equal(drivingIntentKind(phrase),'speed_up');
  assert.equal(drivingIntentKind('Slow down'),'slow_down');
  assert.equal(drivingIntentKind('Drive slower'),'slow_down');
  assert.equal(drivingIntentKind('Please slow it down, dude'),'slow_down');
  assert.equal(drivingIntentKind('Drive evasively'),'evasive');
  assert.equal(drivingIntentKind('Stop driving evasively'),'normal');
  assert.match(drivingModelGuidance('speed_up'),/supported faster-driving behavior: DriveEvasively/);
  assert.match(drivingModelGuidance('speed_up'),/rather than setting an exact numeric speed/);
  const faster={dialogue:"I'll pick it up.",command:'DO DriveEvasively'};
  assert.equal(reconcileDrivingDecision(faster,{kind:'speed_up'}).blocked,null);
  assert.equal(reconcileDrivingDecision(faster,{kind:'speed_up'}).decision.command,'DO DriveEvasively');
  assert.equal(reconcileDrivingDecision({dialogue:'Sure',command:'DO BeginDriving V001'},{kind:'speed_up'}).blocked,'speed_up_requires_essential_faster_mode');
  assert.equal(reconcileDrivingDecision({dialogue:'Sure',command:'DO DriveEvasively'}, {kind:'slow_down'}).decision.command,'');
  assert.equal(reconcileDrivingDecision({dialogue:'Sure',command:'DO DriveNormally'}, {kind:'slow_down'}).decision.command,'DO DriveNormally');
  assert.equal(reconcileDrivingDecision({dialogue:'Sure',command:'DO DriveEvasively'}, {kind:'evasive'}).decision.command,'DO DriveEvasively');
  // Neither speed command may preempt an ACT6-owned navigation task.
  assert.equal(reconcileDrivingDecision(faster,{kind:'speed_up',act6OwnsDrive:true}).blocked,'act6_owns_drive');
});
test('start, stop, and ACT6 owner are independent, with no disguised stock takeover', () => {
  assert.equal(drivingIntentKind('Start driving'),'start');
  assert.equal(drivingIntentKind('Stop the car'),'stop');
  assert.equal(stockDrivingCommand('DO BeginDriving V001'),'begindriving');
  assert.equal(stockDrivingCommand('DO DriveEvasively'),'driveevasively');
  assert.equal(stockDrivingCommand('DO WaitHere'),null);
  assert.equal(activeAct6Driving({stateVersion:1,intent:'vehicle_trip',status:'running'}),true);
  assert.equal(activeAct6Driving({stateVersion:1,intent:'go_to_place',status:'running'}),false);
  assert.equal(activeAct6Driving({stateVersion:1,intent:'vehicle_trip',status:'completed'}),false);
  const owner={characterId:'c',encounterId:'e',incarnationId:'i'};
  assert.equal(activeAct6Driving({stateVersion:1,intent:'vehicle_trip',status:'running',...owner},owner),true);
  assert.equal(activeAct6Driving({stateVersion:1,intent:'vehicle_trip',status:'running',...owner,incarnationId:'old'},owner),false);
  assert.equal(reconcileDrivingDecision({dialogue:'Cruising.',command:'DO BeginDriving V001'}, {kind:'start'}).decision.command,'DO BeginDriving V001');
  assert.equal(reconcileDrivingDecision({dialogue:'Okay',command:'DO BeginDriving V001'}, {kind:'stop'}).decision.command,'');
  assert.equal(reconcileDrivingDecision({dialogue:'Okay',command:'DO DriveNormally'}, {kind:'stop'}).decision.command,'');
  assert.equal(reconcileDrivingDecision({dialogue:'Okay',command:'DO BeginDriving V001'}, {act6OwnsDrive:true}).blocked,'act6_owns_drive');
  assert.match(drivingModelGuidance(null,true),/ACT6 vehicle trip/);
});

test('live ACT6 owner lookup restores exact native host scope, fences actor and fails closed', () => {
  const hostContext={hostContextVersion:1,hostRunId:'runtime-A',worldEpoch:'epoch-A'};
  const owner={binding:{characterId:'c',encounterId:'e',incarnationId:'i',ownershipToken:'token'},hostContext};
  const observed=[];
  const activities={
    stateForCharacter(binding){
      observed.push(binding);
      if(binding.hostContext?.hostRunId!==hostContext.hostRunId ||
         binding.hostContext?.worldEpoch!==hostContext.worldEpoch)return null;
      return {stateVersion:1,intent:'vehicle_trip',status:'running',
        characterId:binding.characterId,encounterId:binding.encounterId,
        incarnationId:binding.incarnationId,hostContext:{...hostContext}};
    }
  };
  assert.equal(liveAct6Driving(activities,owner),true);
  assert.deepEqual(observed[0],{...owner.binding,hostContext},
    'ActivityRuntime.stateForCharacter requires a real hostContext absent in owner.binding');
  assert.equal(liveAct6Driving(activities,{binding:owner.binding}),false,
    'no inferred host context');
  assert.equal(liveAct6Driving(activities,{...owner,hostContext:{...hostContext,worldEpoch:'epoch-B'}}),false,
    'previous native epoch cannot authorize a current trip');
  assert.equal(liveAct6Driving({stateForCharacter:()=>({...activities.stateForCharacter({...owner.binding,hostContext}),characterId:'different'})},owner),false);
  assert.equal(liveAct6Driving({stateForCharacter:()=>({...activities.stateForCharacter({...owner.binding,hostContext}),status:'completed'})},owner),false);
  assert.equal(liveAct6Driving({stateForCharacter:()=>{throw Error('native detached')}},owner),false);
  assert.equal(liveAct6Driving(null,owner),false);
});
