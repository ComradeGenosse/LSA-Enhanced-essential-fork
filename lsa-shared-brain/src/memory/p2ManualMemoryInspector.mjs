// M5 bridge to existing P2 player-authored manual notes.
// P2 manual notes are GLOBAL profile metadata, not claimed as verified
// timeline events. Spoken M5 writes MUST use the journal adapter instead.
import { createHash } from 'node:crypto';
import { isUuid } from '../util/identity.mjs';

const fail = code => { throw new Error(code); };
const profileOf=(store,characterId)=>{
  if (!isUuid(characterId) || typeof store?.get!=='function')fail('invalid_p2_memory_request');
  const profile=store.get(characterId);
  if (!profile || profile.characterId!==characterId)fail('character_missing');
  return profile;
};

export function inspectP2ManualMemories({profileStore,characterId}) {
  const profile=profileOf(profileStore,characterId);
  return Object.freeze({
    scope:'global_profile_metadata',characterId,profileRevision:profile.revision,
    memories:profile.memories.filter(item=>item.playerCreated || item.source==='player')
      .map(item=>Object.freeze({
        memoryId:item.memoryId,text:item.text,category:item.category,editable:item.editable,
        selectedForContext:item.selectedForContext,createdAtUtc:item.createdAtUtc,
        updatedAtUtc:item.updatedAtUtc
      }))
  });
}

/** Existing M1 CRUD writes + CAS; read back only, never signal a memoryAction.
 * Timeline-scoped spoken commands must NOT be routed through this method.
 */
export async function changeP2ManualMemory({
  profileStore,characterId,operation,memoryId=null,patch={},expectedRevision
}) {
  const before=profileOf(profileStore,characterId);
  if (typeof profileStore.memory!=='function' ||
      !['create','edit','delete'].includes(operation) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision!==before.revision)
    fail('profile_revision_conflict');
  if (operation!=='create') {
    const target=before.memories.find(m=>m.memoryId===memoryId);
    if (!target)fail('memory_missing');
    if (!target.playerCreated || target.source!=='player' || !target.editable)
      fail('memory_not_editable');
  }
  const receipt=await profileStore.memory(characterId,operation,{
    memoryId,patch,expectedRevision
  });
  const after=profileOf(profileStore,characterId);
  if (after.revision!==before.revision+1 || receipt.profile?.revision!==after.revision)
    fail('profile_write_unverified');
  const changedId=operation==='create'?receipt.memoryId:memoryId;
  const still=after.memories.some(m=>m.memoryId===changedId);
  if (!isUuid(changedId) || (operation==='delete' && still) ||
      (operation!=='delete' && !still))fail('profile_write_unverified');
  return Object.freeze({
    scope:'global_profile_metadata',characterId,memoryId:changedId,
    operation,profileRevision:after.revision,verifiedReadback:true
  });
}

/** Non-destructive portable data, intentionally labeled profile-only. */
export function exportP2ManualMemories({profileStore,characterId}) {
  const inspected=inspectP2ManualMemories({profileStore,characterId});
  const json=JSON.stringify({format:'p2-manual-memory-only-v1',...inspected})+'\n';
  return Object.freeze({
    json,sha256:createHash('sha256').update(json).digest('hex'),
    characterId,includesJournal:false,includesTimelineEvidence:false
  });
}
