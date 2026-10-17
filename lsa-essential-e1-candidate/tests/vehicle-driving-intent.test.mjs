import test from 'node:test';
import assert from 'node:assert/strict';
import { drivingIntentKind, stockDrivingCommand, activeAct6Driving, drivingModelGuidance, reconcileDrivingDecision } from '../src/activities/vehicleDrivingIntent.mjs';

test('whole-utterance continuation is not mistaken for evasive driving or a new drive', () => {
  for (const text of ['Keep going','Okay, keep driving!','Nathan, carry on driving','Just keep driving'])
    assert.equal(drivingIntentKind(text),'continue');
  for (const text of ['I said keep going yesterday','Where are we going?','Drive to the waypoint','Please drive to the airport'])
    assert.equal(drivingIntentKind(text),null);
  const result=reconcileDrivingDecision({dialogue:'I will floor it!',command:'DO DriveEvasively'}, {kind:'continue'});
  assert.equal(result.blocked,'continuation_must_not_reset_task');
  assert.equal(result.decision.command,'');
  assert.doesNotMatch(result.decision.dialogue,/floor it/i);
  assert.equal(reconcileDrivingDecision({dialogue:'Sure.',command:'DO BeginDriving V001'}, {kind:'continue'}).decision.command,'');
});
test('speed changes never silently become aggressive mode; explicit evasive is distinct', () => {
  assert.equal(drivingIntentKind('Hey, drive faster!'),'speed');
  assert.equal(drivingIntentKind('Go faster'),'speed');
  assert.equal(drivingIntentKind('Drive evasively'),'evasive');
  assert.equal(drivingIntentKind('Stop driving evasively'),'normal');
  assert.match(drivingModelGuidance('speed'),/speed change/i);
  assert.equal(reconcileDrivingDecision({dialogue:'Sure',command:'DO DriveEvasively'}, {kind:'speed'}).decision.command,'');
  assert.equal(reconcileDrivingDecision({dialogue:'Sure',command:'DO DriveEvasively'}, {kind:'evasive'}).decision.command,'DO DriveEvasively');
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
  assert.equal(reconcileDrivingDecision({dialogue:'Cruising.',command:'DO BeginDriving V001'}, {kind:'start'}).decision.command,'DO BeginDriving V001');
  assert.equal(reconcileDrivingDecision({dialogue:'Okay',command:'DO BeginDriving V001'}, {kind:'stop'}).decision.command,'');
  assert.equal(reconcileDrivingDecision({dialogue:'Okay',command:'DO BeginDriving V001'}, {act6OwnsDrive:true}).blocked,'act6_owns_drive');
  assert.match(drivingModelGuidance(null,true),/ACT6 vehicle trip/);
});
