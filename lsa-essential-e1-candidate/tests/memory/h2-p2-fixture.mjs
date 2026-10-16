// H2 lightweight fixture: the REAL production P2 SQLite store, the REAL
// conversation recorder, REAL M3 events with immutable PS2 source sidecars, and
// the REAL M4 engine / evidence policy. The only test doubles are the turn's
// M2 authority callbacks and the D02 source identity, which here are derived
// from live store state (host run/epoch, current owner alias) so retiring the
// source, changing the host/epoch, owner or timeline revokes them exactly like
// production. Full D01/D03/D02 authority is covered separately through
// h2-fixture.mjs. Nothing here is a GTA receipt.
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createP2MemoryStorage} from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {normalizeWitnessedObservation} from '../../../lsa-shared-brain/src/events/journalEventNormalizer.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {profile} from '../p2-fixtures.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';
import {prepareFactualRecall} from '../../src/memory/h2FactualRecall.mjs';

export const id=()=>randomUUID();
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const ago=(seconds,base=Date.now())=>new Date(base-seconds*1000).toISOString();
export {worldProfileId};

export async function p2Fixture(t,{characters=2,profiles=[]}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'h2-p2-'));
  const filePath=path.join(dir,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  t.after(async()=>{try{await store.close();}catch{}await rm(dir,{recursive:true,force:true});});
  const chars=[];
  for(let i=0;i<characters;i++)chars.push(await store.create(profile(profiles[i]??{})));
  const timelineId=await store.createTimeline({label:'H2 isolated source simulation'});
  let host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId);
  const recorder=createConversationJournalRecorder(store);
  const f={store,chars,filePath,recorder,live:true,calls:0,
    get host(){return host;},timelineId,
    // Stable per-character native owner identity.
    owner:chars.map(()=>({incarnationId:id(),encounterId:id(),observerCaptureRef:id()})),
    scope:(i=0,protagonistKey='franklin')=>({worldProfileId,characterId:chars[i].characterId,
      timelineId:store.activeTimelineId,protagonistKey}),
    newHost:(worldEpoch=host.worldEpoch)=>{
      host={hostContextVersion:1,hostRunId:id(),worldEpoch};
      store.setVerifiedHostContext(host);return host;
    }};
  let turnCounter=0;
  const identityFor=(i,pedId=100+i)=>({pedId,turnId:'h2-'+(++turnCounter),
    generationId:'g'+turnCounter,sessionNonce:'h2-session'});
  /** Record a historical accepted player line (or completed NPC line). */
  f.say=async(text,{character=0,avatar='franklin',at=new Date().toISOString(),
    speaker='player',sessionNonce='h2-session'}={})=>{
    const identity={...identityFor(character),sessionNonce};
    if(speaker==='player')return recorder.recordPlayerAccepted({
      characterId:chars[character].characterId,identity,text,source:'typed',
      attribution:{protagonist:avatar},committedAtUtc:at});
    return recorder.recordNpcCompleted({characterId:chars[character].characterId,identity,
      text,receipt:{...identity,type:'playback_ended',reason:'completed',playbackStarted:true,
        hadAudio:true,wasInterrupted:false,ok:true},attribution:{protagonist:avatar},committedAtUtc:at});
  };
  /** A turn whose authority callbacks track live store state. */
  f.turnFor=(i=0)=>{
    const alias=chars[i].promotion.ownerAlias;
    return {characterProjection:{persistent:true,profile:chars[i]},
      characterInputs:{profile:{characterId:chars[i].characterId}},
      m2Capture:{
        openMemoryCurrent:async()=>f.live,
        verifyMemoryCurrent:()=>f.live,
        memoryIdentity:()=>f.live&&store.verifiedHostContext?{
          hostRunId:store.verifiedHostContext.hostRunId,worldEpoch:store.verifiedHostContext.worldEpoch,
          ownerAlias:alias,...f.owner[i]}:null}};
  };
  /** Accept `text` as the current turn, then prepare H2 for it. */
  f.ask=async(text,{character=0,avatar='franklin',source='player_text',nowUtc,args={},
    storeOverride=null,isCurrent=()=>f.live}={})=>{
    const at=nowUtc??new Date().toISOString();
    const receipt=await f.say(text,{character,avatar,at});
    const turn=f.turnFor(character);
    f.lastTurn=turn;f.lastReceipt={status:'stored',durable:true,
      recordId:receipt.recordId,protagonistKey:avatar};
    f.calls++;
    const h2=await prepareFactualRecall({store:storeOverride??store,turn,
      acceptedReceipt:f.lastReceipt,input:text,source,isCurrent,nowUtc:at,...args});
    return {h2,receipt,turn};
  };
  /** A real M3 witnessed event + immutable PS2 source sidecar for a character. */
  f.event=async(n,{character=0,at=new Date().toISOString(),claimKind='firing'}={})=>{
    const p=chars[character],adapterEpoch='b2bcfd60-904a-40a2-8a50-0c3ea397a43c';
    const ownerProof={ownerAlias:p.promotion.ownerAlias,hostRunId:host.hostRunId,
      worldEpoch:host.worldEpoch,...f.owner[character]};
    const identity={promoted:true,current:true,characterId:p.characterId,worldProfileId,
      timelineId:store.activeTimelineId,adapterEpoch,ownerProof};
    const observation={version:1,observationId:id(),episodeId:id(),revision:1,
      observer:{kind:'ped',captureRef:ownerProof.observerCaptureRef},
      observedAt:{nativeRun:adapterEpoch,gameTick:n+1,receivedUtc:at},
      eventType:'firing_burst',severity:'routine',recognizedCharacterIds:[],
      claims:[{claimId:id(),kind:claimKind,certainty:'supported',
        evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:n+1},
        source:{kind:'player',captureRef:id()}}]};
    const normalized=normalizeWitnessedObservation({observation,identity});
    if(!normalized.accepted)throw new Error('fixture_event_rejected:'+normalized.reason);
    const {event,sourceEvidence}=normalized;
    await store.withTimelineWrite(store.activeTimelineId,foundation=>
      foundation.appendJournalEvent(event,{hostContext:store.verifiedHostContext,sourceEvidence}));
    return {event,sourceEvidence};
  };
  /** Production M5 privacy services (forget / correct), not a test shortcut. */
  f.forget=(recordId,character=0,avatar='franklin')=>createM5SqliteServices({store,filePath,
    authorize:()=>true}).trash({scope:f.scope(character,avatar),targetId:recordId,operationId:id()});
  f.correct=async(target,newText,{character=0,avatar='franklin'}={})=>{
    const request=await f.say(newText,{character,avatar});
    const sc=f.scope(character,avatar);
    const requested=(await store.readDialogueLines({characterId:sc.characterId,
      timelineId:sc.timelineId,limit:200})).find(r=>r.recordId===request.recordId);
    return store.commitCommand({scope:sc,commandId:id(),operation:'correct',
      correctionMode:'transcript',requestedByLineId:requested.recordId,targetRecordId:target,
      evidenceRecordIds:[requested.recordId,target],content:newText,
      contentHash:sha(newText),requestedAtUtc:requested.committedAtUtc});
  };
  return f;
}

