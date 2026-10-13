// End-to-end OFFLINE harness for D01 -> D03. What is REAL here:
//  - the pinned original server.bundle.mjs, patched by tools/buildCandidate.mjs,
//    executed in a VM (ib, lb/wd, Xi, Xn, AP/SK, Qi, hK, Zt, Ei hooks and the
//    patched bridge incl. originalTurnFacts) via tests/stock-harness.mjs;
//  - createRuntime, OpenAIConnection, runSequentialTurn, the provider executor
//    (retry), DialogueHistory, P1 IdentityResolver, CharacterService;
//  - the D01 OpenAI acceptance source, original-turn ledger, D03 join and the
//    production D02 port (createMemoryD02Port) behind a real IntelligenceClient
//    that ingests newline-delimited frames from a socket object;
//  - the P2 SQLite store (node:sqlite) in a temporary directory.
// What is FAKE (unavoidable offline): the GTA/RPH native process (frames are
// scripted onto an in-process socket at a compressed cadence), the P1 owner
// evidence pipe (TestOwnerEvidence), OpenAI STT/model/TTS (stubs), and native
// playback acknowledgements. Nothing here is a GTA receipt.
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stockHarness} from '../stock-harness.mjs';
import {fixture} from '../p2-fixtures.mjs';
import {actor,worldProfileId} from '../identity-fixtures.mjs';
import {createEssentialMemoryStorage} from '../../src/characters/memoryStorageAdapter.mjs';
import {IntelligenceClient} from '../../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../../src/perception/contracts.mjs';
import {createMemoryD02Port} from '../../src/memory/memoryD02Port.mjs';

export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function waitFor(predicate,label,timeoutMs=4000){
  const started=Date.now();
  while(!predicate()){
    if(Date.now()-started>timeoutMs)throw new Error('timed out waiting for '+label);
    await sleep(2);
  }
}

// Scripted authenticated native intelligence stream (IntelligenceIntegration
// cadence: owner sample + optional full roster refresh).
function nativeStream({client,owned,alias,roster={}}){
  const socket=new EventEmitter();
  socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;socket.emit('close');};
  socket.write=()=>true;
  const s={socket,hostRunId:randomUUID(),worldEpoch:1,adapterEpoch:randomUUID(),
    streamId:randomUUID(),npcRef:randomUUID(),playerRef:randomUUID(),
    avatar:'franklin',sequence:0,tick:100,nativePedId:'17',
    incarnationId:owned.claim.incarnationId,encounterId:owned.encounterId,ownerAlias:alias,
    includeOwner:true,...roster};
  const frame=(type,payload)=>({version:1,type,payload,adapterEpoch:s.adapterEpoch,
    streamId:s.streamId,sequence:++s.sequence});
  s.raw=value=>new Promise(resolve=>{
    socket.emit('data',Buffer.from(JSON.stringify(value)+'\n'));
    setImmediate(()=>setImmediate(resolve));
  });
  s.send=(type,payload)=>s.raw(frame(type,payload));
  s.hello=()=>s.raw({version:1,type:'hello',hostContextVersion:1,hostRunId:s.hostRunId,
    worldEpoch:s.worldEpoch,adapterEpoch:s.adapterEpoch,streamId:s.streamId,
    observerIndexVersion:1,memoryCurrentOwnerPlayerVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))});
  s.rosters=0;s.samples=0;
  s.roster=async()=>{
    s.rosters++;
    await s.send('anchors',[
      {captureRef:s.npcRef,kind:'ped',observer:true,owned:true},
      {captureRef:s.playerRef,kind:'player',observer:false}]);
    await s.send('observer_index',[{captureRef:s.npcRef,kind:'ped',owned:true,
      incarnationId:s.incarnationId,encounterId:s.encounterId}]);
  };
  s.owners=()=>s.includeOwner?[{observerCaptureRef:s.npcRef,incarnationId:s.incarnationId,
    encounterId:s.encounterId,ownerAlias:s.ownerAlias,hostRunId:s.hostRunId,
    worldEpoch:s.worldEpoch,nativeActorPedId:s.nativePedId,sampledGameTick:s.tick}]:[];
  s.sample=()=>{s.tick+=10;s.samples++;return s.send('memory_current_owner_player',{
    nativeOwnerPlayerProofVersion:1,source:'native_p2_owner_fiber_current_only',
    hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,sampledGameTick:s.tick,owners:s.owners(),
    protagonist:{source:'native_player_model',key:s.avatar,
      playerCaptureRef:s.playerRef,sampledGameTick:s.tick}});};
  let timer=null,beats=0,busy=false;
  // Compressed cadence: owner sample every ~25 ms, full roster every 4th beat.
  s.start=()=>{if(timer)return;timer=setInterval(async()=>{
    if(busy)return;busy=true;
    try{if(++beats%4===0)await s.roster();await s.sample();}finally{busy=false;}
  },25);timer.unref?.();};
  s.stop=()=>{clearInterval(timer);timer=null;};
  return s;
}

export async function d01Harness(t,{config={},corroboration=true,roster={}}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'d01-openai-acceptance-'));
  // One ordered teardown (node:test runs after-hooks FIFO): release sockets,
  // sessions and the SQLite writer before removing the directory (Windows).
  const cleanup=[];
  t.after(async()=>{
    for(const step of cleanup.reverse()){try{await step();}catch{}}
    await rm(dir,{recursive:true,force:true});
  });
  const sqlitePath=path.join(dir,'profiles.v2.sqlite');
  const store=createEssentialMemoryStorage({filePath:sqlitePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  cleanup.push(()=>store.close());
  const f=await fixture(t,{store,config:{actingEnabled:true,promotedCharacters:{enabled:true,
    storePath:path.join(dir,'profiles.v1.json'),storageMode:'sqlite',sqliteStorePath:sqlitePath}}});
  const profile=await f.service.promote();
  const owned=f.native.owned.get(profile.promotion.ownerAlias);
  const a=actor('17',owned.claim,{integrations:{sessionIdentity:owned.claim,
    characterProfile:{version:1,encounterId:owned.encounterId}}});
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.D01.Test'},{connect:()=>native.socket});
  const native=nativeStream({client,owned,alias:profile.promotion.ownerAlias,roster});
  // As in bootstrap: the D02 port subscribes before the stream starts.
  const d02=createMemoryD02Port({intelligence:client,memoryStore:store});
  cleanup.push(()=>{native.stop();d02.close();client.stop();});
  client.start();await native.hello();await native.roster();await native.sample();
  // C-13 verified host context + explicit timeline confirmation (user action).
  store.setVerifiedHostContext(client.runtime.hostContext);
  const timelineId=await store.createTimeline({label:'D01 offline acceptance'});
  await store.confirmTimeline(timelineId);
  const {trustedNamespaces,...persistentIdentity}=f.config.persistentIdentity;
  const h=await stockHarness('openai',{identityEvidence:f.evidence,profileStore:store,
    nativeOwner:f.native,config:{persistentIdentity,promotedCharacters:f.config.promotedCharacters,
      retry:{enabled:true,maxAttempts:2,baseDelayMs:1,maxDelayMs:2,jitter:'bounded'},...config},
    env:{OPENAI_API_KEY:'offline-test-key'}});
  cleanup.push(()=>h.runtime.identityService.close());
  await h.runtime.characterService.initialize();
  if(corroboration)h.runtime.memoryD02=d02.port;
  const replies=[];
  h.runtime.services.decide=async options=>{replies.push(options);return {dialogue:'Got it.',command:''};};
  h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
  const session=await h.openAIControllerSession({actorContext:a});
  cleanup.push(()=>session.connection.close());
  session.autoNativeAcks();
  native.start();
  await waitFor(()=>d02.port.status()?.settled===true,'live settled D02 owner sample');
  const identityOf=turn=>({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  const typed=async(text,{type='playerText'}={})=>{
    h.context.d01Typed={type,pedId:'17',speaker:a,target:{pedId:'player'},text};
    return h.evaluate('ib(d01Typed)');
  };
  // Real original mic path: lb (micStart) -> wd (hydration, inside lb) ->
  // t4 (chunk intake -> fb -> gd -> sendRealtimeAudio) -> ub (micStop:
  // draining) -> $y (drain completion: _d -> endRealtimeInput -> launch).
  // Only the device listener (By) and the timing tracer (Te) are stubbed; the
  // original timers that would call $y after quiet/max drain are not awaited.
  const mic=async({audio=[1,2,3,4]}={})=>{
    h.context.d01Mic={type:'micStart',pedId:'17',speaker:a,target:{pedId:'player'}};
    h.context.performance??=globalThis.performance; // Node global used by fb
    // OK is the pinned debug-print flag for realtime context (Ly console dump).
    h.evaluate('var Zr=16e3,ob=12e3,qy=900,ab=180,e4=240,OK=false;By=()=>{};Te=()=>{};'+
      'if(!A.mic)A.mic=ND();if(!A.playerTurnRecoveryByTurnId)A.playerTurnRecoveryByTurnId=new Map();'+
      'if(!A.sentToGeminiChunks)A.sentToGeminiChunks=[];');
    const turn=await h.evaluate('lb(d01Mic)');
    if(!turn)throw new Error('mic turn not created');
    h.context.d01Chunk=Buffer.from(audio);
    h.evaluate('t4(d01Chunk)');
    await h.evaluate('ub()');
    h.context.d01MicTurn=turn;
    await h.evaluate('$y(d01MicTurn,d01MicTurn.metadata.sessionRecord)');
    return turn;
  };
  // `rows` is EVERY journal row (player and NPC), so a negative test that expects
  // an empty journal also proves no NPC line leaked in. `players`/`npcs` are the
  // convenience splits; `npcSources` is the NPC delivery provenance sidecar.
  const journal=()=>store.withP2SqliteRead({characterId:profile.characterId,worldProfileId,timelineId},db=>{
    const rows=db.prepare("SELECT record_id,speaker,source,content,content_sha256,protagonist,session_id,delivery,receipt_id,turn_identity_hash,committed_at_utc,envelope_json FROM dialogue_journal ORDER BY rowid").all()
      .map(r=>({...r,replyTo:JSON.parse(r.envelope_json).replyTo??null}));
    const table=name=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return {
      rows,
      players:rows.filter(r=>r.speaker==='player'),
      npcs:rows.filter(r=>r.speaker==='npc'),
      sources:table('memory_d03_accepted_sources')
        ?db.prepare('SELECT record_id,source_json,source_sha256 FROM memory_d03_accepted_sources').all():[],
      npcSources:table('memory_d03_npc_delivery_sources')
        ?db.prepare('SELECT record_id,source_json,source_sha256 FROM memory_d03_npc_delivery_sources').all():[],
    };
  });
  return {h,f,store,profile,owned,a,client,native,d02,session,timelineId,replies,
    typed,mic,identityOf,journal,
    settled:turn=>session.connection.whenSettled(identityOf(turn))};
}
