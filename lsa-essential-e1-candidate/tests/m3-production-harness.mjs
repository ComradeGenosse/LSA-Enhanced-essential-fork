// WS-5b production harness: the REAL authenticated pipe parser (IntelligenceClient
// over a fake socket), the REAL PS2 runtime/correlator, the REAL native memory
// authority, the REAL M3 intake/binder/recorder and the REAL P2 SQLite store.
// Only the named-pipe transport (the native/game side) is simulated, which is
// the protocol boundary the audit allows fixtures at.
//
// One simulated clock drives the client, the authority and the coverage ledger,
// so a 2,500-event run needs no real sleeping and stays deterministic. Game
// ticks equal the clock (milliseconds), exactly the unit the native side sends.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createP2MemoryStorage} from '../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
import {memoryKM3Activation} from '../src/memory/m3Activation.mjs';
import {memoryKSourceActivation} from '../src/memory/sourceActivation.mjs';
import {createM3ProductionMemory} from '../src/memory/m3ProductionMemory.mjs';
import {profile} from './p2-fixtures.mjs';
import {worldProfileId} from './identity-fixtures.mjs';

export {worldProfileId};
const hop=()=>new Promise(resolve=>setImmediate(resolve));
export const iso=ms=>new Date(Date.UTC(2026,9,13,12,0,0)+ms).toISOString();

export async function createHarness(t,{npcCount=2,limit,scheduler,coverage=true,
    coverageOptions={},authorityOptions={},adapterOptions={},startMs=1_000_000,
    protagonist='franklin',injectedAuthority=null,telemetry=null,config=null}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ws5b-'));
  const filePath=path.join(dir,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const profiles=[];
  for(let i=0;i<npcCount;i++)profiles.push(await store.create(profile({name:'Npc '+i,modelHash:100+i})));
  const timelineId=await store.createTimeline({label:'ws5b'});
  const host={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId);

  const clock={ms:startMs};
  const adapterEpoch=randomUUID(),streamId=randomUUID(),playerRef=randomUUID();
  const npcs=profiles.map(p=>({
    characterId:p.characterId,ownerAlias:p.promotion.ownerAlias,
    ref:randomUUID(),incarnationId:randomUUID(),encounterId:randomUUID()}));
  const socket=new EventEmitter();
  socket.destroy=()=>{if(socket.closed)return;socket.closed=true;socket.emit('close');};
  socket.write=()=>true;
  let m3=null;
  const activation=config?memoryKM3Activation(config):null;
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.WS5B'},{
    connect:()=>socket,now:()=>clock.ms,
    ...(config?{consumers:memoryKSourceActivation(config)}:{}),
    acceptedObservationTap:activation?.events.mode==='off'?null:
      receipt=>m3?m3.tap(receipt):{accepted:false,reason:'not_ready'},
  });
  m3=createM3ProductionMemory({intelligence:client,memoryStore:store,telemetry,
    nativeAuthority:injectedAuthority,
    ...(activation?{eventMode:activation.events.mode,coverageMode:activation.coverage.mode}:{}),
    authorityOptions:{now:()=>clock.ms,...authorityOptions},
    coverage:coverage?{monotonicNow:()=>clock.ms,utcNow:()=>iso(clock.ms),options:coverageOptions}:null,
    adapterOptions:{...(limit?{limit}:{}),...(scheduler?{scheduler}:{}),...adapterOptions},
  });
  // Test seam: the PS2 correlator stamps receivedUtc from this clock; production
  // uses wall time, which is what the coverage ledger's utcNow also uses.
  if(client.runtime.correlator)client.runtime.correlator.utc=()=>iso(clock.ms);
  const taps=[];
  const originalTap=client.runtime.acceptedObservationTap;
  if(originalTap)client.runtime.acceptedObservationTap=receipt=>{taps.push(receipt);return originalTap(receipt);};

  let sequence=0,signalSerial=0,producerSerial=0;
  const queued=[];
  const frame=(type,payload)=>JSON.stringify({version:1,type,adapterEpoch,streamId,sequence:++sequence,payload});
  const send=(type,payload)=>queued.push(frame(type,payload));
  async function flush() {
    if(!queued.length)return;
    const batches=[];
    // The client queues at most 256 frames per socket chunk; stay far below it.
    while(queued.length)batches.push(queued.splice(0,120));
    for(const batch of batches){
      socket.emit('data',Buffer.from(batch.join('\n')+'\n'));
      for(let i=0;i<Math.ceil(batch.length/32)+2;i++)await hop();
    }
  }
  const ownerRow=(n,tick)=>({ownerAlias:n.ownerAlias,observerCaptureRef:n.ref,hostRunId:host.hostRunId,
    worldEpoch:host.worldEpoch,incarnationId:n.incarnationId,encounterId:n.encounterId,sampledGameTick:tick});
  const anchors=(list=npcs)=>list.map(n=>({captureRef:n.ref,kind:'ped',observer:true,owned:true}))
    .concat([{captureRef:playerRef,kind:'player',observer:false}]);
  const indexRows=(list=npcs)=>list.map(n=>({captureRef:n.ref,kind:'ped',owned:true,
    incarnationId:n.incarnationId,encounterId:n.encounterId}));
  // state.authorityPatch lets a test make the simulated native side lie about
  // the host run / world epoch (frame-level and per owner).
  const state={owners:npcs.slice(),connected:false,authorityPatch:null};
  const authorityPayload=(tick,list=npcs)=>({memoryProofVersion:1,hostRunId:host.hostRunId,
    worldEpoch:host.worldEpoch,sampledGameTick:tick,owners:list.map(n=>({...ownerRow(n,tick),...state.authorityPatch})),
    ...state.authorityPatch,
    protagonist:protagonist?{key:protagonist,source:'native_player_model',playerCaptureRef:playerRef,
      sampledGameTick:tick}:null,acceptedTurns:[]});

  async function connect() {
    client.start();
    socket.emit('data',Buffer.from(JSON.stringify({version:1,type:'hello',hostContextVersion:1,
      hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,adapterEpoch,streamId,observerIndexVersion:1,
      capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,key!=='playerSpeech']))})+'\n'));
    await hop();await hop();
    send('anchors',anchors());send('observer_index',indexRows());
    send('memory_authority',authorityPayload(clock.ms,state.owners));
    await flush();
    state.connected=true;
  }
  // Advance simulated native time, emitting the owner-fiber frame at the real
  // 250 ms cadence and refreshing anchor leases (3 s) every second.
  async function advance(ms,{owners=state.owners,authority=true,stepMs=250}={}) {
    for(let elapsed=0;elapsed<ms;elapsed+=stepMs){
      clock.ms+=Math.min(stepMs,ms-elapsed);
      if(authority)send('memory_authority',authorityPayload(clock.ms,owners));
      if(Math.floor(clock.ms/1000)!==Math.floor((clock.ms-stepMs)/1000)){
        send('anchors',anchors());
        // Deliver at least once per simulated second: the runtime's receipt
        // watchdog compares the (shared) clock with the last delivery.
        await flush();
      }
    }
    await flush();
  }
  const receipt=(observer,tick,{reason='visual_clear',channel='visual',basis='sampled_state'}={})=>({
    observer:{captureRef:observer.ref,kind:'ped'},status:'witnessed',sampledGameTick:tick,reason,
    knowsSource:true,knowsTarget:false,evidence:{channel,basis,sampledGameTick:tick}});
  // One firing signal at the CURRENT tick witnessed by `witnesses` (NPC objects).
  async function fire(witnesses,{tick=clock.ms,ageMs=0,extra={}}={}) {
    send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:++producerSerial,
      kind:'firing',source:playerRef,target:null,gameTick:tick,ageMs,facts:{},
      witnessReceipts:witnesses.map(w=>receipt(w,tick)),...extra});
    signalSerial++;
    await flush();
  }
  const journal=async(npc,limit=1000)=>store.readJournalEvents({characterId:npc.characterId,timelineId,limit});
  const evidence=async(npc,recordId)=>store.readVerifiedEventEvidence({characterId:npc.characterId,timelineId,recordId});
  const coverageOf=(npc,fromMs,toMs)=>store.readObserverCoverage({characterId:npc.characterId,worldProfileId,
    timelineId,fromUtc:iso(fromMs),toUtc:iso(toMs)});
  const drain=async()=>{await m3.adapter.idle();await m3.adapter.coverageIdle();};
  return {dir,filePath,store,profiles,npcs,timelineId,host,clock,client,m3,socket,playerRef,adapterEpoch,streamId,
    taps,coverageOf,send,flush,connect,advance,fire,journal,evidence,drain,state,authorityPayload,anchors,indexRows,
    frameCount:()=>sequence,signals:()=>signalSerial,
    async close() {
      try{await m3.close();}catch{}
      try{socket.destroy();}catch{}
      try{client.stop();}catch{}
      try{await store.close();}catch{}
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
    }};
}
