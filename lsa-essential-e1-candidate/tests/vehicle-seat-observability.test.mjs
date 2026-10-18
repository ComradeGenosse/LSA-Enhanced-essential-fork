import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelemetryRecord} from '../src/observability/eventContract.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('seat events are registered, bounded and do not leak raw dialogue or reference tokens',()=>{
  for(const event of ['vehicle_seat_requested','vehicle_seat_reconciled','vehicle_seat_admission']) {
    const record=createTelemetryRecord({sequence:1,runId:'audit',originMs:0,event,
      data:{seat:'driver',accepted:true,stage:'classified',code:'seat_occupied',
        command:'DO EnterDriverSeat <vehicle>',transcript:'private player words',
        vehicleReference:'V001',unapprovedSeat:'roof'},now:1,utc:'2026-10-18T14:00:00.000Z'});
    assert.equal(record.event,event);
    assert.equal(record.data.seat,'driver');
    assert.equal(record.data.accepted,true);
    assert.equal(record.data.code,'seat_occupied');
    assert.equal('command' in record.data,false);
    assert.equal('transcript' in record.data,false);
    assert.equal('vehicleReference' in record.data,false);
    assert.equal('unapprovedSeat' in record.data,false);
  }
  const record=createTelemetryRecord({sequence:1,runId:'audit',originMs:0,event:'vehicle_seat_requested',
    data:{seat:'V001',code:'unbounded player text!'},now:1,utc:'2026-10-18T14:00:00.000Z'});
  assert.equal(record.data.seat,undefined);
  assert.equal(record.data.code,undefined);
});

test('native ACT3 seat trace distinguishes queued from same-anchor occupied and is transition-limited',()=>{
  const source=readFileSync(fileURLToPath(new URL('../../native/promoted-characters/ActivityDispatch.cs',import.meta.url)),'utf8');
  assert.match(source,/\[LSA ACT3 SEAT\]/);
  assert.match(source,/if\(state==item.LastState\)return/);
  assert.match(source,/sample\.VehicleIsAnchor && SeatMatches\(sample,item\.Seat\)/);
  assert.match(source,/physically_seated/);
  assert.match(source,/queued.*verified=false/);
  assert.match(source,/seatTraces\.Remove\(encounterId\)/);
});
