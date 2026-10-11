// M2 production integration boundary. This is an adapter for verified host hooks,
// not a second dialogue recorder, SQLite store, or native playback observer.
import {createConversationJournalRecorder} from './conversationRecorder.mjs';
import {isUuid} from '../util/identity.mjs';

const fail = code => { throw new Error(code); };
const protagonists = new Set(['franklin','michael','trevor','unknown']);
const identityKeys = ['pedId','turnId','generationId','sessionNonce'];
const validIdentity = identity => !!identity && identityKeys.every(k =>
  identity[k] !== null && identity[k] !== undefined &&
  String(identity[k]).length > 0 && String(identity[k]).length <= 128);
const safeReason = error => {
  const code = String(error?.message || '');
  return /^(m2_|journal_|timeline_|profile_store_)[a-z0-9_]{1,80}$/.test(code)
    ? code : 'm2_storage_failed';
};
const capture = async operation => {
  try {
    const receipt = await operation();
    if (!receipt || typeof receipt.inserted !== 'boolean' || !isUuid(receipt.recordId))
      fail('m2_commit_not_verified');
    return Object.freeze({status:receipt.inserted?'stored':'duplicate',
      inserted:receipt.inserted,recordId:receipt.recordId});
  } catch(error) {
    // No raw dialogue or underlying SQLite exception is exposed to telemetry.
    return Object.freeze({status:'not_stored',reason:safeReason(error)});
  }
};

/**
 * Bind once to the accepted live native turn, BEFORE awaiting STT/TTS/SQLite.
 * Caller must implement isCurrent using authoritative turn/ped incarnation and
 * owner lifetime, and currentProtagonist from verified C-01/host evidence.
 *
 * Neither the callback nor a source snapshot is authority on its own:
 * both are rechecked inside M1's serialized withTimelineWrite callback.
 * This prevents a queued/delayed receipt from acquiring a new host epoch,
 * protagonist, owner, or save lineage by accident.
 */
export function createM2TurnCapture({
  store, characterId, identity, ownerAlias, protagonist='unknown',
  isCurrent, currentProtagonist, sessionId=null,
}={}) {
  if (!store || typeof store.withTimelineWrite !== 'function' ||
      typeof store.get !== 'function' || typeof store.appendDialogueLine !== 'function')
    throw new TypeError('m2_shared_store_required');
  if (!isUuid(characterId) || !validIdentity(identity) ||
      typeof isCurrent !== 'function' || typeof currentProtagonist !== 'function' ||
      !protagonists.has(protagonist) || (sessionId !== null && !isUuid(sessionId)))
    throw new TypeError('m2_verified_turn_required');
  const frozenIdentity = Object.freeze(Object.fromEntries(identityKeys.map(k => [k, identity[k]])));
  const timelineId = store.activeTimelineId;
  const worldProfileId = store.worldProfileId;
  const host = store.verifiedHostContext;
  const profile = store.get(characterId);
  const boundAlias = ownerAlias ?? profile?.promotion?.ownerAlias;
  if (!isUuid(timelineId) || !isUuid(worldProfileId) || !host ||
      !isUuid(host.hostRunId) || !Number.isSafeInteger(host.worldEpoch) ||
      host.worldEpoch < 0 || typeof boundAlias !== 'string' || !boundAlias ||
      profile?.promotion?.ownerAlias !== boundAlias)
    throw new Error('m2_source_unconfirmed');
  const origin = Object.freeze({hostRunId:host.hostRunId,worldEpoch:host.worldEpoch});
  let retired = false;

  function assertBoundTurn() {
    if (retired || !isCurrent()) fail('m2_turn_retired');
    if (currentProtagonist() !== protagonist) fail('m2_protagonist_changed');
    if (store.worldProfileId !== worldProfileId ||
        store.activeTimelineId !== timelineId ||
        store.timelineWritable !== true) fail('timeline_write_suspended');
    const currentHost = store.verifiedHostContext;
    if (!currentHost || currentHost.hostRunId !== origin.hostRunId ||
        currentHost.worldEpoch !== origin.worldEpoch) fail('m2_host_epoch_changed');
    if (store.get(characterId)?.promotion?.ownerAlias !== boundAlias)
      fail('m2_owner_retired');
  }

  // The wrapper is intentionally limited to the recorder's existing interface.
  // It calls the same shared foundation writer under M1's *one* queue/transaction,
  // with an additional native-turn lifetime check at the real commit boundary.
  const boundStore = {
    worldProfileId, activeTimelineId:timelineId,
    verifiedHostContext:origin,
    get: id => id === characterId ? profile : null,
    appendDialogueLine(line, attribution) {
      assertBoundTurn();
      if (line?.characterId !== characterId ||
          line.worldProfileId !== worldProfileId ||
          line.timelineId !== timelineId ||
          attribution?.hostRunId !== origin.hostRunId ||
          attribution?.worldEpoch !== origin.worldEpoch ||
          attribution?.protagonist !== protagonist) fail('m2_binding_mismatch');
      return store.withTimelineWrite(timelineId, foundation => {
        assertBoundTurn();
        if (typeof foundation.appendDialogueLine !== 'function')
          fail('m2_journal_writer_missing');
        return foundation.appendDialogueLine(line,attribution);
      });
    },
  };
  const recorder = createConversationJournalRecorder(boundStore);
  const attribution = Object.freeze({
    protagonist,hostRunId:origin.hostRunId,worldEpoch:origin.worldEpoch,
    ...(sessionId === null ? {} : {sessionId}),
  });

  return Object.freeze({
    recordPlayerAccepted({accepted=false,text,source,utteranceId=null,
      transcription=null,committedAtUtc}={}) {
      // H must call this only after accepted typed/STT intake, not interim STT
      // or speculative text. Preserve the original string, including whitespace.
      return capture(() => {
        if (accepted !== true) fail('m2_player_not_accepted');
        assertBoundTurn();
        return recorder.recordPlayerAccepted({characterId,identity:frozenIdentity,
          text,source,utteranceId,transcription:transcription===null ? null :
            {...transcription},committedAtUtc,attribution});
      });
    },
    recordNpcCompleted({historyAccepted=false,text,receipt,mode='buffered',
      spokenSegments=null,committedAtUtc}={}) {
      // For early streamed audio, H must pass the exact ordered text actually
      // submitted to TTS. Final Luna output is not independently playback proof.
      return capture(() => {
        if (historyAccepted !== true) fail('m2_history_not_accepted');
        if (mode !== 'buffered' && mode !== 'early_streamed')
          fail('m2_unknown_audio_mode');
        if (mode === 'early_streamed' &&
            (!Array.isArray(spokenSegments) || spokenSegments.length < 1 ||
             !spokenSegments.every(s=>typeof s==='string') ||
             spokenSegments.join('') !== text)) fail('m2_stream_text_mismatch');
        assertBoundTurn();
        return recorder.recordNpcCompleted({characterId,identity:frozenIdentity,
          text,receipt,attribution,committedAtUtc});
      });
    },
    // H must retire on owner loss, supersession, abort, protagonist change,
    // connection replacement or native session close. Never retro-authorize.
    retire() { retired = true; },
  });
}
