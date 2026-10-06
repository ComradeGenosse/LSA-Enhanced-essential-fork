import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SalienceCache } from '../src/perception/salienceEngine.mjs';
import { radioTurnRelevant, currentConversationObserver, latestRadioObservation, renderRadioContext, selectRadioContext } from '../src/perception/radioContextProjector.mjs';

const NOW=1000;
function observation({observer,vehicle,title='Track A',artist='Artist A',stationName='Test Radio',known=true,contentKind='music',revision=1,gameTick=10}={}) {
  const details={eventSignalId:randomUUID(),reason:'same_vehicle_radio',soundType:'radio',station:'RADIO_TEST_A',trackKnown:known};
  if(stationName) details.stationName=stationName;
  if(known) {details.artist=artist;details.title=title;details.contentKind=contentKind;}
  return Object.freeze({
    version:1,observationId:randomUUID(),episodeId:randomUUID(),revision,
    observer:{captureRef:observer,kind:'ped'},
    observedAt:{nativeRun:randomUUID(),gameTick,receivedUtc:'2026-10-06T20:00:00.000Z'},
    expiresAtMonotonicMs:NOW+60000,eventType:'radio_heard',severity:'routine',
    claims:[{claimId:randomUUID(),kind:'sound',certainty:'supported',evidence:{channel:'auditory',basis:'audibility_model',sampledGameTick:gameTick},target:{captureRef:vehicle,kind:'vehicle'},details}],
    recognizedCharacterIds:[],
  });
}
function runtimeFixture({known=true,conversation=true}={}) {
  const ped=randomUUID(),other=randomUUID(),player=randomUUID(),vehicle=randomUUID();
  const anchors=new Map([
    [ped,{captureRef:ped,kind:'ped',observer:true,conversation}],
    [other,{captureRef:other,kind:'ped',observer:true,conversation:false}],
    [player,{captureRef:player,kind:'player',observer:false}],
    [vehicle,{captureRef:vehicle,kind:'vehicle',observer:false}],
  ]);
  const current=ref=>anchors.has(ref);
  const heard=observation({observer:ped,vehicle,known});
  const outsider=observation({observer:other,vehicle,title:'Wrong Passenger Track',gameTick:20});
  const entries=new Map([
    [ped+':'+heard.episodeId,{value:heard}],
    [other+':'+outsider.episodeId,{value:outsider}],
  ]);
  return {runtime:{anchors,current,observations:{entries},salience:new SalienceCache({now:()=>NOW}),now:()=>NOW,epoch:randomUUID()},ped,other,vehicle,heard,outsider};
}

test('radio selector recognizes direct music questions but not incidental radio words',()=>{
  for(const input of ["what song is this?","what's playing?","what station is this?","who sings this song?","what's on the radio?","can you identify this track?"]) assert.equal(radioTurnRelevant(input),true,input);
  for(const input of ["I bought a radio yesterday.","Turn left at the station.","Music is important to me.","How are you?","Drive faster."]) assert.equal(radioTurnRelevant(input),false,input);
});

test('R5 selects only the current conversation observer and renders one bounded fact',()=>{
  const f=runtimeFixture();
  assert.equal(currentConversationObserver(f.runtime),f.ped);
  assert.equal(latestRadioObservation(f.runtime,f.ped).observationId,f.heard.observationId);
  const selected=selectRadioContext(f.runtime,'what song is this?');
  assert.equal(selected.kind,'radio');
  assert.equal(selected.observationId,f.heard.observationId);
  assert.match(selected.text,/Track A/);assert.match(selected.text,/Artist A/);assert.match(selected.text,/Test Radio/);
  assert.doesNotMatch(selected.text,/Wrong Passenger Track|captureRef|RADIO_TEST_A|same_vehicle_radio/);
  assert.equal(selectRadioContext(f.runtime,'How are you?'),null);
});

test('R5 omits when actor hearing is ambiguous or missing',()=>{
  const none=runtimeFixture({conversation:false});
  assert.equal(selectRadioContext(none.runtime,'what song is this?'),null);
  const ambiguous=runtimeFixture();
  ambiguous.runtime.anchors.get(ambiguous.other).conversation=true;
  assert.equal(selectRadioContext(ambiguous.runtime,'what song is this?'),null);
  ambiguous.runtime.anchors.get(ambiguous.other).conversation=false;
  ambiguous.runtime.observations.entries.delete(ambiguous.ped+':'+ambiguous.heard.episodeId);
  assert.equal(selectRadioContext(ambiguous.runtime,'what song is this?'),null);
});

test('R5 describes unknown tracks without exposing internal station/hash metadata',()=>{
  const f=runtimeFixture({known:false});
  const selected=selectRadioContext(f.runtime,'what is playing?');
  assert.equal(selected.text,'Audible environment: Test Radio is playing; the current radio content is not identified.');
  const noDisplay=observation({observer:f.ped,vehicle:f.vehicle,known:false,stationName:''});
  assert.equal(renderRadioContext(noDisplay),'Audible environment: the vehicle radio is playing; the current radio content is not identified.');
  assert.doesNotMatch(renderRadioContext(noDisplay),/RADIO_TEST_A|soundHash|trackTextId|captureRef/);
});

test('R5 distinguishes a cataloged commercial from a song without inventing music identity',()=>{
  const f=runtimeFixture();
  const commercial=observation({observer:f.ped,vehicle:f.vehicle,title:'Commercial Break',artist:'Commercial',contentKind:'commercial'});
  f.runtime.observations.entries.clear();f.runtime.observations.entries.set(f.ped+':'+commercial.episodeId,{value:commercial});
  const selected=selectRadioContext(f.runtime,'what is playing?');
  assert.equal(selected.text,'Audible environment: a commercial titled "Commercial Break" is playing on Test Radio.');
  assert.doesNotMatch(selected.text,/by Commercial/);
});

test('explicit repeated radio questions remain eligible while R5 records PS4 delivery',()=>{
  const f=runtimeFixture();
  const first=selectRadioContext(f.runtime,'what song is this?');
  assert.ok(first);assert.equal(f.runtime.salience.acknowledge(first.decisionKey,'ps4_context','delivered'),true);
  const repeated=selectRadioContext(f.runtime,'what song is this?');
  assert.ok(repeated);assert.equal(repeated.observationId,first.observationId);
  assert.equal(repeated.text,first.text);
});


test('R5 selection is immutable for the in-flight turn while the next turn can see a new track',()=>{
  const f=runtimeFixture();
  const frozen=selectRadioContext(f.runtime,'what song is this?');
  assert.match(frozen.text,/Track A/);
  const newer=observation({observer:f.ped,vehicle:f.vehicle,title:'Track B',artist:'Artist B',gameTick:30,revision:2});
  f.runtime.observations.entries.clear();
  f.runtime.observations.entries.set(f.ped+':'+newer.episodeId,{value:newer});
  assert.match(frozen.text,/Track A/);assert.doesNotMatch(frozen.text,/Track B/);
  const next=selectRadioContext(f.runtime,'what song is this?');
  assert.match(next.text,/Track B/);assert.doesNotMatch(next.text,/Track A/);
});
