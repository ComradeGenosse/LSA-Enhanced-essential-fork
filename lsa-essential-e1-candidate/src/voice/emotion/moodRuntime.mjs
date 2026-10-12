import { MoodStore } from './moodStore.mjs';
import { isUuid } from '../../identity/identityContract.mjs';
import { sameHostContext } from '../../context/hostContext.mjs';
import { projectActingEvidence } from './sceneOwnerProjection.mjs';
import { wasElevenTagApplied } from '../../providers/elevenlabs/speechProvider.mjs';

// No game actor JSON, LLM content, PedId, or profile name can establish these
// authorities. The trusted bootstrap must provide an actual native-protagonist
// source whose revision changes on EVERY protagonist transition, including ABA.
// Missing M1 and native authorities disable EA4 without disabling ordinary TTS.
const PROTAGONISTS = new Set(['franklin', 'michael', 'trevor']);
const receiptKeys = ['pedId','sessionNonce','turnId','generationId'];

export function createMoodRuntime({ getRuntime, protagonistAuthority = null,
  clock = () => Math.floor(performance.now()), store = new MoodStore() } = {}) {
  if (typeof getRuntime !== 'function') throw new TypeError('mood_runtime_required');
  let lastLineage = null;
  // A native model revision is bound to each speaking turn, but never used
  // as a mood/relationship partition. This blocks delayed Franklin receipts
  // after a Michael/Franklin ABA without erasing earlier valid soft mood.
  const turnSource = new WeakMap();
  const deny = () => {store.clear();lastLineage=null;return null;};
  // An ordinary cutscene/switch may temporarily revoke model evidence. No
  // source-dependent action is permitted then, but a bounded soft mood may
  // survive until independent revalidation of the SAME save/host/NPC owner.
  const suspend = () => null;
  const current = ({identity,turn} = {}, { forRetirement = false } = {}) => {
    // A stale turn's finally/cancellation must not wipe mood legitimately
    // recorded by a newer native turn. Reads/commits still fail closed and
    // flush state if the live authority cannot be established.
    const reject = () => forRetirement ? null : deny();
    let runtime;
    try { runtime = getRuntime(); }
    catch { return reject(); } // disconnected/unavailable trusted runtime: neutral
    const identityService = runtime?.identityService;
    const characterStore = runtime?.characterService?.store;
    const perception = runtime?.intelligence?.runtime;
    // These M1 fields only exist on the approved, native-source-gated SQLite
    // store. The original P2 JSON store cannot authorize save-specific mood.
    if (!identity || !turn?.characterSnapshot ||
        characterStore?.timelineSourceStatus !== 'verified' ||
        characterStore?.timelineWritable !== true ||
        !isUuid(characterStore?.activeTimelineId) ||
        typeof protagonistAuthority?.readVerified !== 'function' ||
        typeof protagonistAuthority?.isCurrent !== 'function' ||
        !perception || !identityService) return reject();
    const host = identityService.evidence?.hostContext;
    if (!sameHostContext(host,perception.hostContext)) return reject();
    const ownerEvidence = projectActingEvidence({
      identity,turn,perception,identityService,
    });
    if (!ownerEvidence || ownerEvidence.identity.characterId !==
        turn.characterSnapshot.resolution?.characterId) return reject();
    let verified;
    try { verified = protagonistAuthority.readVerified(); } catch { return suspend(); }
    if (!verified) return suspend();
    if (!Object.isFrozen(verified) || verified.version !== 1 ||
        verified.source !== 'native_player_model' ||
        !PROTAGONISTS.has(verified.protagonist) ||
        !isUuid(verified.hostRunId) || verified.hostRunId !== host.hostRunId ||
        verified.worldEpoch !== host.worldEpoch ||
        !Number.isSafeInteger(verified.revision) || verified.revision < 1 ||
        (()=>{try{return protagonistAuthority.isCurrent(verified)===true;}catch{return false;}})() !== true) return reject();
    const lineage = JSON.stringify([characterStore.activeTimelineId,host.hostRunId,
      host.worldEpoch]);
    // Only a genuinely different save/host/world invalidates this lineage.
    // Avatar model/revision changes authenticate source but never partition mood.
    if (lastLineage !== null && lastLineage !== lineage) store.clear();
    lastLineage = lineage;
    const binding = identityService.bindings.get(identity);
    const owner = ownerEvidence.identity;
    const context = {
      identity,characterSnapshot:turn.characterSnapshot,binding,
      hostContext:host,timelineId:characterStore.activeTimelineId,
      protagonist:verified.protagonist, nativeSourceProof:verified,
      isCurrent: () => {
        try {
          const now = getRuntime();
          const db = now?.characterService?.store;
          const ps = now?.intelligence?.runtime;
          const ident = now?.identityService;
          const currentBinding = ident?.bindings.get(identity);
          const proof = projectActingEvidence({
            identity,turn,perception:ps,identityService:ident,
          });
          return now?.host?.isCurrent(identity) === true &&
            ident?.current(identity) === true &&
            db?.timelineSourceStatus === 'verified' &&
            db?.timelineWritable === true &&
            db?.activeTimelineId === context.timelineId &&
            sameHostContext(context.hostContext,ident.evidence?.hostContext) &&
            sameHostContext(context.hostContext,ps?.hostContext) &&
            currentBinding?.bindingId === binding?.bindingId &&
            currentBinding?.bindingRevision === binding?.bindingRevision &&
            proof?.identity.characterId === owner.characterId &&
            proof.identity.observerCaptureRef === owner.observerCaptureRef &&
            proof.identity.incarnationId === owner.incarnationId &&
            proof.identity.ownerProofRevision === owner.ownerProofRevision &&
            protagonistAuthority.isCurrent(verified) === true;
        } catch { return false; }
      },
    };
    if (context.isCurrent()) return Object.freeze(context);
    // Evidence can be revoked between readVerified() and the final check.
    // Reject the action without erasing still-bounded same-owner state.
    try { if (protagonistAuthority.isCurrent(verified) !== true) return suspend(); }
    catch { return suspend(); }
    return reject();
  };
  return Object.freeze({
    readMood({identity,turn}) {
      const context=current({identity,turn});
      if (!context) return null;
      if (!turn || typeof turn !== 'object') return null;
      const recorded=turnSource.get(turn);
      if (recorded && recorded !== context.nativeSourceProof) return null;
      if (!recorded) turnSource.set(turn,context.nativeSourceProof);
      return store.take({context,nowMs:clock()});
    },
    onSpeechCompleted({identity,turn,delivery,receipt,providerResult,historyAccepted=false}) {
      const context=current({identity,turn});
      if (!context || !turn || typeof turn !== 'object' ||
          turnSource.get(turn) !== context.nativeSourceProof ||
          !receipt || receipt.type !== 'playback_ended' ||
          receipt.ok !== true || receipt.reason !== 'completed' ||
          historyAccepted !== true ||
          !wasElevenTagApplied(providerResult,{delivery,identity}) ||
          receipt.wasInterrupted !== false ||
          receipt.hadAudio !== true || receipt.playbackStarted !== true ||
          !receiptKeys.every(key=>receipt[key] === identity[key])) return false;
      // Called only AFTER the stock native observation and history receipt
      // have been independently accepted by runSequentialTurn.
      return store.commitPlayed({
        context,nowMs:clock(),delivery,
        receipt:{
          verified:true,historyAccepted:true,playbackSucceeded:true,playbackStarted:true,
          hadAudio:true,wasInterrupted:false,
          pedId:identity.pedId,sessionNonce:identity.sessionNonce,
          turnId:identity.turnId,generationId:identity.generationId,
        },
      });
    },
    retireTurn({identity,turn,completed=false}) {
      // Completion retains its just-played soft tendency for one subsequent
      // turn. Failed/cancelled turns revoke any tendency consumed by this turn.
      if (completed === true) return;
      const context=current({identity,turn},{forRetirement:true});
      // Missing/retired proof for this OLD turn is not evidence to clear a
      // NEWER turn. Actual global host/save/source revocations call clear(),
      // and any later read/commit also flushes on missing authority.
      if (!context) return;
      store.invalidate({context,scope:'turn'});
    },
    clear() { lastLineage=null;store.clear(); },
    get size() {return store.size;},
  });
}
