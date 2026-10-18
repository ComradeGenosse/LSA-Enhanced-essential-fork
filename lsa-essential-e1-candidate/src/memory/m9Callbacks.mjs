// M9 spontaneous memory callbacks.
//
// This module is a thin, fail-closed arming layer between three EXISTING
// authorities; it adds no scheduler, model, prompt writer, audio player or
// store:
//   * PS6: the SceneDirectorSpeech coordinator remains the only thing that can
//     reserve, submit and deliver a spontaneous turn (13a/13b admission, native
//     C-06/C-11, player priority, cooldowns, no interruption). A callback can
//     only ride a Director turn that PS3/PS6 already chose for the SAME NPC.
//   * P2: the single SQLite store is the only source of an eligible memory. A
//     candidate in RAM, a PS2 observation, or a "journal receipt" is never a
//     memory; every use re-reads the committed event + immutable sidecar.
//   * PS4: the recalled event reaches the model only as the RECALLED lane of
//     the one TurnKnowledgeFrame, through the same M4 recall engine, evidence
//     policy and send-time fences as every other recall.
// Callbacks are independent of M7 curation, M8 interpretation and H1 history.
import {randomUUID} from 'node:crypto';
import {M9MemoryCueCandidates} from '../../../lsa-shared-brain/src/events/m9MemoryCues.mjs';
import {M9CommittedWitnessAuthority} from '../../../lsa-shared-brain/src/events/m9CommittedWitnessAuthority.mjs';
import {M9DirectorCueAdmission} from '../perception/m9DirectorCueAdmission.mjs';
import {selectDirectorIntent} from '../perception/sceneDirector.mjs';
import {m9SignalId} from '../perception/episodeCorrelator.mjs';
import {recallMemory,toPs4RecallContribution} from '../../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {preparePs4Recall,verifyPs4RecallCurrent} from '../../../lsa-shared-brain/src/memory/ps4RecallContribution.mjs';
import {createP2IntegratedRecallAdapter} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createRecallEvidencePolicy} from '../../../lsa-shared-brain/src/memory/recallEvidencePolicy.mjs';
import {journalIdentityUuid,journalTurnIdentityHash} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {M9_EVENT_FAMILIES} from './m9Activation.mjs';

export const M9_CALLBACK_LIMITS = Object.freeze({
  // The existing M9 cue classifier only admits samples younger than this.
  freshWindowMs:30_000,
  // A memorable event stays eligible for a callback for this long (wall clock).
  retentionMs:30 * 60_000,
  perNpcCooldownMs:10 * 60_000,
  perFamilyCooldownMs:10 * 60_000,
  globalCooldownMs:2 * 60_000,
  maxPerNpcPerRun:3,
  maxUsedRecords:512,
  maxPending:64,
  pendingTtlMs:90_000,
  journalPage:64,
  evidenceReadsPerAttempt:3,
  preflightBudgetMs:1000,
  prepareDeadlineMs:200,
  maxContributionBytes:2048,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AVATARS = new Set(['franklin','michael','trevor']);
const TYPE_FAMILY = Object.freeze(Object.fromEntries(Object.entries(M9_EVENT_FAMILIES)
  .flatMap(([family,types]) => types.map(type => [type,family]))));
const DIRECT_CHANNELS = new Set(['self','visual','auditory']);
const bump = (target,key,by = 1) => {target[key] = Math.min(2147483647,(target[key] ?? 0) + by);};
const sameKeys = (a,b,keys) => !!a && !!b && keys.every(k => a[k] !== undefined && a[k] === b[k]);
const IDENTITY_KEYS = ['characterId','worldProfileId','timelineId','protagonistKey','turnIdentityHash',
  'hostRunId','worldEpoch','incarnationId','encounterId','observerCaptureRef','turnId'];
const priorityOk = p => p?.known === true && p.playerIdle === true && p.micIdle === true &&
  p.typedIdle === true && p.combatIdle === true && p.stockIdle === true &&
  p.interruptionFree === true && p.directorAvailable === true && p.ownerCurrent === true &&
  p.timelineWritable === true;

export function createM9Callbacks({activation,store,runtime,native,quiet,directorLive,m9Events = null,
    pause = null,now = () => runtime.now(),wallNow = () => Date.now(),limits = {},telemetry = null,
    onRetire = null} = {}) {
  const mode = activation?.callbacks?.mode ?? 'off';
  if (mode === 'off') return null;
  if (!runtime || typeof runtime.directorOwnerProofFor !== 'function' || !store ||
      typeof store.readJournalEvents !== 'function' || typeof native?.resolveNativeOwner !== 'function' ||
      typeof quiet !== 'function' || typeof directorLive !== 'function')
    throw new TypeError('m9_callbacks_ports_required');
  const L = Object.freeze({...M9_CALLBACK_LIMITS,...limits});
  const counters = {};
  const refusals = {};
  const refuse = (reason,counter = 'refused') => {bump(counters,counter);bump(refusals,reason);return reason;};
  // Strict aggregate budget for optional P2 lookup + visibility validation.
  // These are read-only operations: a late resolution has no callback side
  // effects. Never race the actual Director once reserve/submit may begin.
  const boundedPreflightRead = async (work,ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return {timedOut:true};
    let timer;
    try {return await Promise.race([
      Promise.resolve().then(work).then(value=>({value}),()=>({failed:true})),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),ms);})
    ]);} finally {clearTimeout(timer);}
  };
  const pending = new Map();           // signalId -> fresh candidate notification (RAM only)
  const used = new Map();              // recordId -> usedAtMs  (once-only per run)
  const npcUntil = new Map();          // characterId -> cooldown end (wall ms)
  const familyUntil = new Map();       // characterId:family -> cooldown end
  const perNpc = new Map();            // characterId -> callbacks this run
  const armed = new Map();             // speakerCaptureRef -> armed callback
  const live = new Set();              // prepared recalls that can still be revoked
  let globalUntil = 0;
  let disposed = false;
  let attempting = false;

  // ---- fresh candidate notifications (never a memory) --------------------
  const pruneFresh = () => {
    const t = now();
    for (const [key,event] of pending)
      if (t - event.candidate.observedAtMonotonicMs > L.pendingTtlMs) pending.delete(key);
    while (pending.size > L.maxPending) pending.delete(pending.keys().next().value);
  };
  const unsubscribe = m9Events?.subscribe?.(event => {
    if (disposed) return;
    bump(counters,'freshNotifications');
    pending.set(event.signalId,event);
    pruneFresh();
  }) ?? null;

  // ---- live scope reads ---------------------------------------------------
  const host = () => runtime.hostContext && runtime.epoch ? runtime.hostContext : null;
  function speakerFor(ref) {
    const h = host();
    if (!h || !runtime.current(ref)) return null;
    const index = runtime.observerIndex.get(ref);
    if (!index?.owned || index.kind !== 'ped' || !index.incarnationId) return null;
    let owner = null;
    try {
      owner = native.resolveNativeOwner({hostRunId:h.hostRunId,worldEpoch:h.worldEpoch,
        adapterEpoch:runtime.epoch,observerCaptureRef:ref,observerIndex:index});
    } catch {return null;}
    if (owner?.nativeVerified !== true || owner.current !== true || !UUID.test(owner.characterId ?? '') ||
        owner.ownerProof?.observerCaptureRef !== ref) return null;
    return Object.freeze({characterId:owner.characterId,ownerAlias:owner.ownerAlias,
      ownerProof:owner.ownerProof,observerCaptureRef:ref,hostRunId:h.hostRunId,worldEpoch:h.worldEpoch});
  }
  function protagonistFor(playerRef) {
    const h = host();
    if (!h || typeof native.resolveParticipants !== 'function') return 'unknown';
    try {
      const proofs = native.resolveParticipants({hostRunId:h.hostRunId,worldEpoch:h.worldEpoch,
        adapterEpoch:runtime.epoch,observation:{claims:[{source:{captureRef:playerRef}}]}});
      const proof = proofs?.find(p => p.captureRef === playerRef && p.subjectKind === 'protagonist' &&
        p.verified === true && p.nativeVerified === true);
      return AVATARS.has(proof?.subjectKey) ? proof.subjectKey : 'unknown';
    } catch {return 'unknown';}
  }
  const timelineReady = () => store.timelineWritable === true && !!store.verifiedHostContext &&
    UUID.test(store.activeTimelineId ?? '') && UUID.test(store.worldProfileId ?? '');
  const memoryActive = () => !disposed && !(pause?.paused);

  // PS6/C-06 priority inputs. "Quiet" is only a negative signal; the native
  // C-06 reserve/submit that follows remains the positive permission. Anything
  // that cannot be positively read is false.
  function readPriority({proposal,stamp}) {
    const h = host(), sample = m9Events?.latestSample?.() ?? null, t = now();
    let ok = {known:false};
    try {
      const owner = proposal ? runtime.directorOwnerProofFor(proposal.speakerCaptureRef) : null;
      const quietNow = quiet() === true;
      const live = directorLive() === true;
      const fresh = !!sample && !!h && sample.hostRunId === h.hostRunId && sample.worldEpoch === h.worldEpoch &&
        sample.nativeRun === runtime.epoch && t >= sample.atMs && t - sample.atMs <= 3000;
      // No other observer is under an urgent safety decision, and the native
      // sampler reports no wanted level: the only combat evidence available.
      let urgent = false;
      for (const [ref,index] of runtime.observerIndex)
        if (index?.owned && runtime.current(ref) &&
            runtime.directorCandidatesFor(ref).some(c => c?.decision?.response === 'urgent')) {urgent = true;break;}
      const ownerCurrent = !!owner && !!stamp && owner.hostRunId === stamp.hostRunId &&
        owner.worldEpoch === stamp.worldEpoch && owner.ownerIncarnationId === stamp.ownerIncarnationId &&
        owner.proofRevision === stamp.proofRevision && runtime.current(proposal.playerCaptureRef);
      ok = {known:true,playerIdle:quietNow,micIdle:quietNow,typedIdle:quietNow,stockIdle:quietNow,
        interruptionFree:quietNow,combatIdle:fresh && sample.wantedLevel === 0 && !urgent,
        directorAvailable:live,ownerCurrent,timelineWritable:timelineReady()};
    } catch {ok = {known:false};}
    return Object.freeze(ok);
  }

  // ---- eligibility: committed P2 events only ----------------------------
  const cooled = (characterId,family,wall) => (npcUntil.get(characterId) ?? 0) > wall ||
    (familyUntil.get(characterId + ':' + family) ?? 0) > wall;
  async function loadEligible(speaker) {
    const fence = store.memoryRequestFence;
    if (fence === null || fence === undefined || !timelineReady()) return {reason:'p2_unavailable'};
    const timelineId = store.activeTimelineId, wall = wallNow();
    if ((perNpc.get(speaker.characterId) ?? 0) >= L.maxPerNpcPerRun) return {reason:'npc_budget'};
    if ((npcUntil.get(speaker.characterId) ?? 0) > wall) return {reason:'npc_cooldown'};
    const rows = await store.readJournalEvents({characterId:speaker.characterId,timelineId,limit:L.journalPage});
    if (!Array.isArray(rows)) return {reason:'journal_unreadable'};
    const ordered = rows.filter(r => r?.kind === 'journal_event' && TYPE_FAMILY[r.eventType] &&
        r.receiptStatus === 'witnessed' && !used.has(r.recordId) &&
        r.characterId === speaker.characterId && r.timelineId === timelineId &&
        r.worldProfileId === store.worldProfileId &&
        r.ownerProof?.ownerAlias === speaker.ownerAlias &&
        r.ownerProof.observerCaptureRef !== undefined &&
        Array.isArray(r.claims) && r.claims.length > 0 &&
        r.claims.every(c => DIRECT_CHANNELS.has(c?.modality) && c.certainty === 'direct'))
      .map(r => ({row:r,ageMs:wall - Date.parse(r.receivedAtUtc)}))
      .filter(x => Number.isFinite(x.ageMs) && x.ageMs >= -60_000 && x.ageMs <= L.retentionMs)
      .sort((a,b) => a.ageMs - b.ageMs);
    if (!ordered.length) return {reason:'no_recent_event'};
    let reads = 0, sawCooldown = false;
    for (const {row,ageMs} of ordered) {
      const family = TYPE_FAMILY[row.eventType];
      if (cooled(speaker.characterId,family,wall)) {sawCooldown = true;continue;}
      if (++reads > L.evidenceReadsPerAttempt) break;
      const evidence = await store.readVerifiedEventEvidence({characterId:speaker.characterId,timelineId,recordId:row.recordId});
      const obs = evidence?.sourceEvidence?.observation, claim = obs?.claims?.[0];
      const signalId = claim?.details?.eventSignalId;
      if (!evidence?.event || evidence.event.recordId !== row.recordId || evidence.event.sourceHash !== row.sourceHash ||
          evidence.sourceEvidence?.format !== 'ps2-observation-v1' ||
          evidence.sourceEvidence.sourceHash !== row.sourceHash ||
          obs.observationId !== row.observationId || obs.eventType !== row.eventType ||
          obs.observer?.captureRef !== row.ownerProof.observerCaptureRef ||
          claim.details.reason !== 'm9_' + row.eventType || !UUID.test(signalId ?? '') ||
          claim.claimId !== row.claims[0].sourceEvidenceId ||
          !sameKeys(evidence.sourceEvidence.ownerProof,row.ownerProof,
            ['ownerAlias','hostRunId','worldEpoch','observerCaptureRef','incarnationId','encounterId'])) continue;
      if (store.memoryRequestFence !== fence) return {reason:'fence_changed'};
      return {entry:Object.freeze({row,evidence,signalId,ageMs,family,fence,characterId:speaker.characterId,
        timelineId,worldProfileId:store.worldProfileId})};
    }
    return {reason:sawCooldown ? 'family_cooldown' : 'no_verified_event'};
  }

  // ---- the existing M9 fresh-cue admission, fed only durable readback ----
  function freshCandidateFor(entry) {
    const event = pending.get(entry.signalId);
    const candidate = event?.candidate;
    if (!candidate) return null;
    const age = now() - candidate.observedAtMonotonicMs;
    if (age < 0 || age > L.freshWindowMs) return null;
    if (m9SignalId(candidate) !== entry.signalId) return null;
    return candidate;
  }
  function witnessFor(entry,candidate,speaker,protagonistKey) {
    const {row} = entry, claim = row.claims[0];
    return Object.freeze({status:'witnessed',modality:claim.modality,certainty:'direct',
      observationId:row.observationId,witnessReceiptId:claim.sourceEvidenceId,journalRecordId:row.recordId,
      characterId:speaker.characterId,worldProfileId:entry.worldProfileId,timelineId:entry.timelineId,
      observerCaptureRef:row.ownerProof.observerCaptureRef,playerCaptureRef:candidate.playerCaptureRef,
      protagonistKey,candidateEventId:candidate.eventId,nativeEvidenceId:candidate.nativeEvidenceId,
      ownerAlias:speaker.ownerAlias,nativeRun:candidate.nativeRun,
      hostRunId:candidate.hostRunId,worldEpoch:candidate.worldEpoch,
      incarnationId:row.ownerProof.incarnationId,encounterId:row.ownerProof.encounterId});
  }
  // Synchronous ports. They answer ONLY from the durable readback captured in
  // this attempt, and only while the P2 request fence is unchanged: after any
  // forget/correct/profile/authority change every port returns null and the
  // M9 authority refuses (fail closed, never a stale yes).
  function authorityFor(entry,candidate,speaker,protagonistKey) {
    const {row,evidence} = entry, obs = evidence.sourceEvidence.observation;
    const fenceHolds = () => store.memoryRequestFence === entry.fence && memoryActive();
    const liveScope = () => {
      const h = host(), current = speakerFor(speaker.observerCaptureRef), sample = m9Events?.latestSample?.() ?? null;
      if (!fenceHolds() || !h || !current || !sample || !timelineReady() ||
          h.hostRunId !== candidate.hostRunId || h.worldEpoch !== candidate.worldEpoch ||
          runtime.epoch !== candidate.nativeRun || sample.nativeRun !== runtime.epoch ||
          sample.hostRunId !== h.hostRunId || sample.worldEpoch !== h.worldEpoch ||
          current.characterId !== speaker.characterId ||
          !runtime.current(candidate.playerCaptureRef) || !sameKeys(current.ownerProof,row.ownerProof,
            ['ownerAlias','hostRunId','worldEpoch','observerCaptureRef','incarnationId','encounterId']))
        return null;
      return {h,sample};
    };
    const idMatches = q => q?.journalRecordId === row.recordId && q.observationId === row.observationId &&
      q.candidateEventId === candidate.eventId && q.characterId === speaker.characterId &&
      q.worldProfileId === entry.worldProfileId && q.timelineId === entry.timelineId;
    const bound = m9SignalId(candidate) === entry.signalId;
    return new M9CommittedWitnessAuthority({
      readCurrentNativeScope:({stage}) => {
        const scope = liveScope();
        if (!scope) return null;
        return {authenticated:true,current:true,characterId:speaker.characterId,nativeRun:runtime.epoch,hostRunId:scope.h.hostRunId,
          worldEpoch:scope.h.worldEpoch,playerCaptureRef:candidate.playerCaptureRef,
          worldProfileId:entry.worldProfileId,timelineId:entry.timelineId,protagonistKey,
          timelineWritable:timelineReady(),gameTick:scope.sample.gameTick,
          observerCaptureRef:row.ownerProof.observerCaptureRef,incarnationId:row.ownerProof.incarnationId,
          encounterId:row.ownerProof.encounterId,stage};
      },
      readSourceTimePs2Witness:({witness}) => {
        if (!liveScope() || !bound || !evidence.sourceEvidence.ownerProof ||
            evidence.sourceEvidence.attribution?.mode !== 'observation_time') return null;
        const o = row.ownerProof;
        return {status:'witnessed',nativeVerified:true,
          sourceAtObservation:{nativeVerified:true,gameTick:obs.observedAt.gameTick,observerCaptureRef:o.observerCaptureRef,
            incarnationId:o.incarnationId,encounterId:o.encounterId,
            nativeRun:evidence.sourceEvidence.nativeAdapterEpoch,hostRunId:o.hostRunId,worldEpoch:o.worldEpoch},
          candidateEventId:candidate.eventId,nativeEvidenceId:candidate.nativeEvidenceId,
          observerCaptureRef:o.observerCaptureRef,observationId:row.observationId,
          witnessReceiptId:witness.witnessReceiptId,hostRunId:o.hostRunId,worldEpoch:o.worldEpoch,
          nativeRun:evidence.sourceEvidence.nativeAdapterEpoch,observedGameTick:obs.observedAt.gameTick,
          eventType:row.eventType,incarnationId:o.incarnationId,encounterId:o.encounterId,
          modality:witness.modality,certainty:'direct',coverage:'witnessed'};
      },
      readCommittedP2Event:q => {
        if (!liveScope() || !bound || !idMatches(q)) return null;
        return {kind:'journal_event',receiptStatus:row.receiptStatus,recordId:row.recordId,
          observationId:row.observationId,eventType:row.eventType,characterId:row.characterId,
          worldProfileId:row.worldProfileId,timelineId:row.timelineId,ownerProof:row.ownerProof,
          sourceHash:row.sourceHash,claims:row.claims};
      },
      readCommittedP2Sidecar:q => {
        if (!liveScope() || !bound || !idMatches(q)) return null;
        const s = evidence.sourceEvidence;
        return {committed:true,deleted:false,candidateEventId:candidate.eventId,
          nativeEvidenceId:candidate.nativeEvidenceId,journalRecordId:row.recordId,
          observationId:row.observationId,witnessReceiptId:row.claims[0].sourceEvidenceId,
          sourceHash:s.sourceHash,characterId:row.characterId,worldProfileId:row.worldProfileId,
          timelineId:row.timelineId,nativeRun:s.nativeAdapterEpoch,hostRunId:s.ownerProof.hostRunId,
          worldEpoch:s.ownerProof.worldEpoch,playerCaptureRef:obs.claims[0].source.captureRef,
          eventType:row.eventType,gameTick:obs.observedAt.gameTick};
      },
    });
  }

  // ---- arming -------------------------------------------------------------
  function arm({speaker,entry,proposal,protagonistKey,via,cueId = null}) {
    const record = Object.freeze({id:randomUUID(),state:'armed',via,cueId,entry,speaker,protagonistKey,
      speakerCaptureRef:proposal.speakerCaptureRef,playerCaptureRef:proposal.playerCaptureRef,
      decisionKey:proposal.decisionKey,observationId:proposal.observationId,armedAtMs:now()});
    const box = {...record};
    armed.set(proposal.speakerCaptureRef,box);
    bump(counters,'armed');bump(counters,via === 'fresh_cue' ? 'armedFresh' : 'armedVerifiedRecall');
    return {box,unregister:() => {if (armed.get(proposal.speakerCaptureRef) === box) armed.delete(proposal.speakerCaptureRef);}};
  }
  const revokeBox = (box,reason) => {
    if (box.state === 'revoked') return;
    box.state = 'revoked';box.reason = reason;bump(counters,'revoked');
    try {onRetire?.(reason);} catch {}
  };
  function revokeAll(reason) {
    for (const box of armed.values()) revokeBox(box,reason);
    armed.clear();
    for (const prepared of live) prepared.revoke(reason);
    live.clear();
    if (reason !== 'turn_complete') pending.clear();
  }
  const unsubPause = pause?.subscribe?.(() => revokeAll('learned_memory_paused')) ?? null;

  // ---- Director wrapper ------------------------------------------------
  function wrapDirector(coordinator) {
    if (typeof coordinator?.attempt !== 'function' || typeof coordinator.originalGrantCurrent !== 'function')
      throw new TypeError('m9_director_coordinator_required');
    let admissionContext = null;
    let cues = null, freshAdmission = null;
    const fresh = () => freshAdmission ??= new M9DirectorCueAdmission({
      cueCandidates:cues ??= new M9MemoryCueCandidates({authorizeWitness:({candidate,witness}) =>
        admissionContext?.authority.check({candidate,witness}).authorized === true,now}),
      existingSceneDirector:{
        originalGrantCurrent:(...args)=>coordinator.originalGrantCurrent(...args),
        attempt:input=>{
          // Records the one-way boundary before the original Director can
          // reserve or submit. An exception after this point is never retried.
          admissionContext?.markDirector?.();
          return coordinator.attempt(input);
        },
      },
      readCurrentPriority:input => readPriority({proposal:input?.proposal ?? admissionContext?.proposal,
        stamp:input?.stamp ?? admissionContext?.stamp}),
      registerPs4MemoryCue:({cue,proposal}) => {
        const ctx = admissionContext;
        if (!ctx || cue.journalRecordId !== ctx.entry.row.recordId || cue.characterId !== ctx.speaker.characterId ||
            cue.observerCaptureRef !== proposal.speakerCaptureRef) return null;
        const armedBox = arm({speaker:ctx.speaker,entry:ctx.entry,proposal,protagonistKey:ctx.protagonistKey,
          via:'fresh_cue',cueId:cue.cueId});
        return {status:'registered',cueId:cue.cueId,unregister:armedBox.unregister};
      },
      committedWitnessAuthority:{check:input => admissionContext
        ? admissionContext.authority.check(input) : {authorized:false}},
    });
    const FRESH_ATTEMPTED = new Set(['director_submitted_audio_unverified','director_not_delivered',
      'director_returned_with_stale_memory','director_or_ps4_failed','busy']);
    return new Proxy(coordinator,{get(target,key) {
      if (key !== 'attempt') {const v = Reflect.get(target,key,target);return typeof v === 'function' ? v.bind(target) : v;}
      return async input => {
        if (disposed || attempting || !memoryActive()) return target.attempt(input);
        attempting = true;
        let directorStarted = false;
        const markDirector = () => {directorStarted = true;};
        const attemptDirector = request => {markDirector();return target.attempt(request);};
        try {return await callbackAttempt(input,attemptDirector,markDirector);}
        catch {
          bump(counters,'faults');
          // A partially executed native Director turn is non-replayable.
          // Before entry, optional memory failures may safely fall back once.
          return directorStarted ? Object.freeze({status:'failed'}) : attemptDirector(input);
        }
        finally {attempting = false;}
      };
    }});

    async function callbackAttempt(input,attemptDirector,markDirector) {
      bump(counters,'directorAttempts');
      const proposal = selectDirectorIntent(input?.candidates ?? [],input?.facts ?? {});
      if (!proposal || !input.stamp) return attemptDirector(input);
      if (wallNow() < globalUntil) {refuse('global_cooldown','skipped');return attemptDirector(input);}
      const speaker = speakerFor(proposal.speakerCaptureRef);
      if (!speaker) {refuse('speaker_unresolved','skipped');return attemptDirector(input);}
      const preflightDeadline=performance.now()+Math.max(1,Math.min(1500,L.preflightBudgetMs));
      const eligible=await boundedPreflightRead(()=>loadEligible(speaker),
        Math.max(0,preflightDeadline-performance.now()));
      if(eligible.timedOut||eligible.failed) {
        refuse(eligible.timedOut?'preflight_timeout':'preflight_failed','skipped');
        return attemptDirector(input);
      }
      const loaded=eligible.value;
      if (!loaded.entry) {refuse(loaded.reason,'skipped');return attemptDirector(input);}
      const entry = loaded.entry;
      const protagonistKey = protagonistFor(proposal.playerCaptureRef);
      if (mode === 'shadow') {
        bump(counters,'shadowWouldCallback');
        try {telemetry?.emit?.('m9_callback_shadow',null,'internal',{family:entry.family},'internal');} catch {}
        return attemptDirector(input);
      }
      const priority = readPriority({proposal,stamp:input.stamp});
      if (!priorityOk(priority)) {refuse('player_or_combat_priority','skipped');return attemptDirector(input);}
      const visibility=await boundedPreflightRead(()=>visible(speaker,entry,protagonistKey),
        Math.max(0,preflightDeadline-performance.now()));
      if (visibility.timedOut||visibility.failed || store.memoryRequestFence !== entry.fence ||
          visibility.value !== true) {
        refuse(visibility.timedOut?'preflight_timeout':'event_not_visible','skipped');
        return attemptDirector(input);
      }
      const candidate = freshCandidateFor(entry);
      if (candidate) {
        // Use the unchanged M9 admission: it re-reads the committed witness
        // before and after every step and unregisters in `finally`.
        const authority = authorityFor(entry,candidate,speaker,protagonistKey);
        admissionContext = {authority,entry,speaker,protagonistKey,proposal,stamp:input.stamp,markDirector};
        const outcome = await fresh().attempt({candidate,witness:witnessFor(entry,candidate,speaker,protagonistKey),
          ps3Candidates:input.candidates,facts:input.facts,stamp:input.stamp});
        admissionContext = null;
        bump(refusals,'fresh_' + outcome.status);
        if (FRESH_ATTEMPTED.has(outcome.status)) return outcome;
        // Refused before the Director was involved: ordinary speech continues.
        return attemptDirector(input);
      }
      // Older than the 30 s cue window: the memory is a durable P2 event and
      // reaches the model only through the verified recall path below.
      const registered = arm({speaker,entry,proposal,protagonistKey,via:'verified_recall'});
      try {
        if (!priorityOk(readPriority({proposal,stamp:input.stamp})) || store.memoryRequestFence !== entry.fence)
          {refuse('priority_or_fence_changed','skipped');return await attemptDirector(input);}
        return await attemptDirector(input);
      } finally {registered.unregister();}
    }
  }

  async function visible(speaker,entry,protagonistKey) {
    try {
      const policy = createRecallEvidencePolicy({store,isCurrent:() => memoryActive()});
      return await policy.verifyReferenceVisibility({
        scope:{characterId:entry.characterId,worldProfileId:entry.worldProfileId,timelineId:entry.timelineId,protagonistKey},
        source:liveSource(speaker),recordIds:[entry.row.recordId]});
    } catch {return false;}
  }
  const liveSource = speaker => ({hostRunId:speaker.ownerProof.hostRunId,worldEpoch:speaker.ownerProof.worldEpoch,
    ownerAlias:speaker.ownerAlias,incarnationId:speaker.ownerProof.incarnationId,
    encounterId:speaker.ownerProof.encounterId,observerCaptureRef:speaker.observerCaptureRef});

  // ---- per-turn preparation (PS4 RECALLED contribution) ------------------
  async function prepareForTurn({turn,source,isCurrent} = {}) {
    if (disposed || mode !== 'on' || !memoryActive() || source !== 'special_event') return null;
    const ticket = turn?.directorTicket;
    const box = ticket ? armed.get(ticket.speakerCaptureRef) : null;
    if (!box || box.state !== 'armed' || box.decisionKey !== ticket.decisionKey ||
        box.observationId !== ticket.observationId) {if (ticket) refuse('no_armed_callback','prepareSkipped');return null;}
    // Cross-NPC guard: the memory belongs to exactly the NPC that speaks.
    const profile = turn.characterProjection?.profile;
    if (turn.characterProjection?.persistent !== true || profile?.characterId !== box.entry.characterId ||
        profile.promotion?.ownerAlias !== box.speaker.ownerAlias) {
      revokeBox(box,'speaker_mismatch');armed.delete(ticket.speakerCaptureRef);
      refuse('speaker_mismatch','prepareSkipped');return null;
    }
    const entry = box.entry, speaker = box.speaker;
    const identity = turn.identity;
    if (typeof isCurrent !== 'function' || !identity) return null;
    let revoked = null;
    const stillArmed = () => box.state === 'armed' || box.state === 'consumed';
    const current = () => revoked === null && memoryActive() && stillArmed() && isCurrent() === true;
    const hostNow = host();
    if (!hostNow || !timelineReady() || store.memoryRequestFence !== entry.fence) {
      refuse('scope_changed','prepareSkipped');return null;
    }
    const sessionId = journalIdentityUuid(['session',hostNow.hostRunId,identity.sessionNonce,identity.pedId]);
    const turnIdentityHash = journalTurnIdentityHash({characterId:entry.characterId,timelineId:entry.timelineId,
      speaker:'npc',sessionId,hostRunId:hostNow.hostRunId,identity});
    const turnId = journalIdentityUuid(['m9-callback-turn',identity.pedId,identity.turnId,identity.generationId,identity.sessionNonce]);
    const snapshotNow = () => {
      if (!current()) return null;
      const s = speakerFor(box.speakerCaptureRef), h = host();
      if (!s || !h || s.characterId !== entry.characterId || !timelineReady() ||
          h.hostRunId !== hostNow.hostRunId || h.worldEpoch !== hostNow.worldEpoch ||
          store.activeTimelineId !== entry.timelineId) return null;
      return Object.freeze({characterId:entry.characterId,worldProfileId:entry.worldProfileId,
        timelineId:entry.timelineId,protagonistKey:box.protagonistKey,turnIdentityHash,
        hostRunId:h.hostRunId,worldEpoch:h.worldEpoch,incarnationId:s.ownerProof.incarnationId,
        encounterId:s.ownerProof.encounterId,observerCaptureRef:box.speakerCaptureRef,turnId});
    };
    const snapshot = snapshotNow();
    if (!snapshot) {refuse('scope_changed','prepareSkipped');return null;}
    const scope = {characterId:entry.characterId,worldProfileId:entry.worldProfileId,
      timelineId:entry.timelineId,protagonistKey:box.protagonistKey};
    const policy = createRecallEvidencePolicy({store,isCurrent:current});
    const base = createP2IntegratedRecallAdapter(store);
    // The recall page may surface ONLY the armed record: other memories of this
    // NPC, other NPCs' events and any record the evidence policy hides never pass.
    const readAdapter = Object.freeze({read:async args => {
      const result = await base.read(args);
      return {...result,rows:(result?.rows ?? []).filter(r => r.recordId === entry.row.recordId),coverageComplete:false};
    }});
    const query = Object.freeze({version:1,kind:'recall_query',queryId:randomUUID(),characterId:entry.characterId,
      worldProfileId:entry.worldProfileId,timelineId:entry.timelineId,turnIdentityHash,
      question:'incident happened',intent:'spontaneous',maxBytes:L.maxContributionBytes});
    // Consumption is conservative: once preparation starts this record is spent
    // for the run, whether or not speech is later delivered (no replay).
    box.state = 'consumed';
    used.set(entry.row.recordId,wallNow());
    while (used.size > L.maxUsedRecords) used.delete(used.keys().next().value);
    const wall = wallNow();
    npcUntil.set(entry.characterId,wall + L.perNpcCooldownMs);
    familyUntil.set(entry.characterId + ':' + entry.family,wall + L.perFamilyCooldownMs);
    globalUntil = wall + L.globalCooldownMs;
    perNpc.set(entry.characterId,(perNpc.get(entry.characterId) ?? 0) + 1);
    bump(counters,'consumed');
    const prepared = await preparePs4Recall({query,readAdapter,snapshot,currentIdentity:snapshotNow,
      protagonistKey:box.protagonistKey,source:'special_event',playerActive:false,directorAdmitted:true,
      deadlineMs:L.prepareDeadlineMs,maxContributionBytes:L.maxContributionBytes});
    if (prepared.status !== 'ready') {refuse(prepared.reason ?? 'prepare_dropped','prepareDropped');return null;}
    const ids = prepared.contribution.items.map(i => i.recordId);
    if (ids.length !== 1 || ids[0] !== entry.row.recordId || prepared.contribution.items[0].sourceKind !== 'journal_event' ||
        !(await policy.verifyReferenceVisibility({scope,source:liveSource(speaker),recordIds:ids}))) {
      refuse('recall_not_visible','prepareDropped');return null;
    }
    if (!current()) {refuse('revoked_during_prepare','prepareDropped');return null;}
    const baseSeal = JSON.stringify(prepared.contribution);
    const stamp = prepared.stamp;
    const preparedRecall = Object.freeze({status:'ready',stamp,contribution:prepared.contribution,answerEvidence:null});
    const recallCurrent = (_refs,seen) => !!seen && Object.keys(stamp).length === Object.keys(seen).length &&
      Object.keys(stamp).every(k => seen[k] === stamp[k]) && current();
    let verifiedFence = null, verifiedRequestFence = null, valid = true;
    async function verifyPrepared() {
      const fence = store.memoryReadFence;
      verifiedFence = null;
      if (!valid || fence === null || fence === undefined || !current()) {valid = false;return false;}
      try {
        const fresh = await recallMemory({query,readAdapter,protagonistKey:box.protagonistKey});
        const visibleNow = await policy.verifyReferenceVisibility({scope,source:liveSource(speaker),recordIds:ids});
        if (!current() || store.memoryReadFence !== fence || !visibleNow ||
            JSON.stringify(toPs4RecallContribution(fresh.bundle,{maxBytes:L.maxContributionBytes})) !== baseSeal) {
          valid = false;return false;
        }
        verifiedFence = fence;verifiedRequestFence = store.memoryRequestFence ?? fence;
        return true;
      } catch {valid = false;return false;}
    }
    const sendCurrent = () => valid && current() && verifiedFence !== null && store.memoryReadFence === verifiedFence &&
      verifyPs4RecallCurrent(preparedRecall,{currentIdentity:snapshotNow,playerActive:false,source:'special_event',
        directorAdmitted:true,validateEvidence:(recordIds) => verifiedFence !== null &&
          store.memoryReadFence === verifiedFence && recordIds.every(id => ids.includes(id))});
    const sendCurrentInFlight = () => valid && current() && verifiedFence !== null &&
      (store.memoryRequestFence ?? store.memoryReadFence) === verifiedRequestFence;
    const invalidationReason = () => !valid ? 'verification_failed' : !current() ? 'authority_revoked' :
      verifiedFence === null ? 'not_verified' :
      store.memoryRequestFenceFailure?.(verifiedRequestFence) ?? (sendCurrentInFlight() ? null : 'source_changed');
    const handle = {revoke:reason => {revoked ??= reason;valid = false;}};
    live.add(handle);
    bump(counters,'prepared');
    return Object.freeze({status:'ready',preparedRecall,preparedM8:null,conversationJournal:null,memoryAction:null,
      recallCurrent,verifyPrepared,sendCurrent,sendCurrentInFlight,invalidationReason,
      opinionCurrent:() => false});
  }

  function dispose() {
    if (disposed) return;
    revokeAll('shutdown');
    disposed = true;
    try {unsubscribe?.();} catch {}
    try {unsubPause?.();} catch {}
  }
  return Object.freeze({
    mode,wrapDirector,prepareForTurn,
    // World boundary, host change, disconnect and similar source loss.
    revoke:reason => revokeAll(typeof reason === 'string' ? reason : 'source_lost'),
    // After M5 changes privacy state the next use re-reads P2; this also drops
    // anything armed but not yet prepared so it cannot surface afterwards.
    privacyChanged:() => revokeAll('privacy_changed'),
    dispose,
    snapshot:() => Object.freeze({mode,counters:Object.freeze({...counters}),refusals:Object.freeze({...refusals}),
      armed:armed.size,used:used.size,pendingFresh:pending.size,
      // Honest limits: nothing here proves audible in-game delivery.
      audibleDeliveryProof:false}),
  });
}
