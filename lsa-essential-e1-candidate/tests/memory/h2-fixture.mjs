// H2 test fixture: the REAL D01/D03/P2 harness (production SQLite store, native
// D02 source, original-runner turn ownership). Turns are driven through the
// real runner; H2 is invoked with the exact arguments the combined path gets,
// so authority (M2 receipt + D02 identity) is never fabricated.
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness,waitFor} from './d01-harness.mjs';
import {validateDialogueLine} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {prepareFactualRecall} from '../../src/memory/h2FactualRecall.mjs';

export const sha=x=>createHash('sha256').update(x).digest('hex');
export const AVATARS=['franklin','michael','trevor'];

export async function h2Harness(t,opts){
  const x=await d01Harness(t,opts);
  const worldProfileId=x.store.worldProfileId;
  const scope={worldProfileId,characterId:x.profile.characterId,timelineId:x.timelineId};
  const captured=[];
  const original=x.h.runtime.services.prepareLiveTurnMemory;
  let sessionCounter=0;
  /** Seed schema-validated historical dialogue straight into the P2 journal. */
  const seed=async(rows)=>{
    const sessionId=randomUUID();sessionCounter++;
    await x.store.withP2SqliteTransaction(scope,db=>{
      const insert=db.prepare('INSERT INTO dialogue_journal (record_id,world_profile_id,timeline_id,character_id,session_id,protagonist,host_run_id,world_epoch,speaker,source,delivery,turn_identity_hash,committed_at_utc,content,content_sha256,receipt_id,envelope_json,envelope_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const out=[];
      for(const r of rows){
        const speaker=r.speaker??'player';
        const e=validateDialogueLine({version:1,kind:'dialogue_line',
          worldProfileId,timelineId:scope.timelineId,characterId:r.characterId??scope.characterId,
          recordId:randomUUID(),speaker,
          source:speaker==='player'?'typed':'npc_generated',
          delivery:speaker==='player'?'accepted':'completed',content:r.content,
          committedAtUtc:r.at,turnIdentityHash:sha('h2-'+r.content+r.at),utteranceId:null,
          transcription:null,deliveryReceiptId:speaker==='npc'?randomUUID():null},worldProfileId);
        const raw=JSON.stringify(e);
        insert.run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,r.sessionId??sessionId,
          r.avatar??'franklin',x.native.hostRunId,1,e.speaker,e.source,e.delivery,
          e.turnIdentityHash,e.committedAtUtc,e.content,sha(e.content),
          e.deliveryReceiptId,raw,sha(raw));
        out.push(e);
      }
      return out;
    }).then(v=>{seed.last=v;});
    return seed.last;
  };
  const fresh=async()=>{
    await x.native.roster();await x.native.sample();
    await waitFor(()=>x.d02.port.status()?.settled===true,'current native sample');
  };
  /** Drive one real typed turn; run H2 on its real accepted-turn arguments. */
  const ask=async(text,{during=null,...h2Args}={})=>{
    await fresh();
    let h2=null,args=null,combined=null;
    // The combined path still runs unchanged; H2 is called with the same
    // real arguments (store, turn, durable receipt, authentic accepted input).
    x.h.runtime.services.prepareLiveTurnMemory=async a=>{
      args=a;captured.push(a);
      combined=await original(a).catch(()=>null);
      h2=await prepareFactualRecall({store:x.h.runtime.characterService.store,...a,...h2Args});
      return combined;
    };
    // `during` runs while the original turn still owns the memory source, i.e.
    // at the point where the runner verifies before every model attempt.
    const decide=x.h.runtime.services.decide;
    let duringResult;
    if(during)x.h.runtime.services.decide=async options=>{
      duringResult=await during({h2,args,combined});
      return decide(options);
    };
    try{
      const turn=await x.typed(text);
      await x.settled(turn);
    }finally{
      x.h.runtime.services.prepareLiveTurnMemory=original;
      x.h.runtime.services.decide=decide;
    }
    return {h2,args,combined,duringResult};
  };
  return {...x,scope,seed,ask,fresh,captured,waitFor};
}

