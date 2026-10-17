// M9 activation harness: the REAL pipe parser, PS2 runtime, M3 intake/binder and
// P2 SQLite store (m3-production-harness) plus the REAL M9 runtime events.
// Only the native producer (the game side) is simulated: it emits m9_sample
// frames with native witness receipts computed at the sampled tick.
import {randomUUID} from 'node:crypto';
import {createHarness} from './m3-production-harness.mjs';
import {memoryKM9Activation} from '../src/memory/m9Activation.mjs';
import {createM9RuntimeEvents} from '../src/memory/m9RuntimeEvents.mjs';

export const ALL_ON = Object.freeze({'events.crash':'on','events.rollover':'on','events.airborne':'on',
  'events.water':'on','events.wanted':'on','events.wasted':'on','events.busted':'on'});

export async function createM9Harness(t,{families=ALL_ON,negotiate=true,npcCount=2,...rest}={}) {
  const activation = memoryKM9Activation({memoryK:{capabilities:families}});
  let h = null;
  const m9Events = createM9RuntimeEvents({activation,now:()=>h?.clock.ms ?? 1_000_000});
  h = await createHarness(t,{npcCount,clientOptions:{m9Events},
    helloExtras:negotiate?{hostContextVersion:1,m9SampleVersion:1}:{},...rest});
  const vehicleRef = randomUUID();
  const vehicleState = (o={}) => ({airborne:false,inWater:false,submerged:false,grounded:true,
    rollDegrees:0,speedKph:60,collision:null,...o});
  const seeVehicle = () => h.send('anchors',[{captureRef:vehicleRef,kind:'vehicle',observer:false}]);
  const payload = (tick,o={}) => ({m9SampleVersion:1,hostRunId:h.host.hostRunId,worldEpoch:h.host.worldEpoch,
    sampledGameTick:tick,ageMs:0,playerCaptureRef:h.playerRef,vehicleCaptureRef:vehicleRef,wantedLevel:0,
    vehicle:vehicleState(),outcome:null,witnessReceipts:[],...o});
  const witness = (npc,tick,extra={}) => ({observer:{captureRef:npc.ref,kind:'ped'},status:'witnessed',
    sampledGameTick:tick,reason:'visual_clear',knowsSource:false,knowsTarget:false,
    evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:tick},...extra});
  // Advance the simulated clock and emit one sample at the new tick.
  async function sample(stepMs=100,o={},{refreshAnchors=true}={}) {
    h.clock.ms += stepMs;
    if (refreshAnchors) {h.send('anchors',h.anchors());seeVehicle();}
    const tick = h.clock.ms;
    // The native owner fiber keeps emitting its proof at its own cadence.
    h.send('memory_authority',h.authorityPayload(tick,h.state.owners));
    const body = typeof o === 'function' ? o(tick) : o;
    h.send('m9_sample',payload(tick,body));
    await h.flush();
    return tick;
  }
  async function settle() {await h.flush();await h.drain();}
  const rows = async npc => (await h.journal(npc)).filter(e => e.eventType !== undefined);
  return {...h,m9Events,activation,vehicleRef,vehicleState,payload,witness,sample,settle,rows,seeVehicle};
}
