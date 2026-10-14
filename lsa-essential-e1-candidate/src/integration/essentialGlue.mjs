import {captureDialogueActionKnowledge,assertDialogueActionKnowledgeCurrent} from '../activities/dialogueActionKnowledge.mjs';
import {projectOriginalTurnPriority,OriginalEssentialTurnTimeline} from '../perception/essentialTurnPriority.mjs';
import {captureActivityKnowledge,assertActivityKnowledgeCurrent} from '../activities/activityKnowledge.mjs';
import {prepareDialogueActionPublication} from '../activities/dialogueActionPublication.mjs';
import {createKnowledgeDelivery} from '../context/knowledgeDelivery.mjs';
import {createHash} from 'node:crypto';
import {releaseOwnedKnowledge,assertOwnedKnowledgeCurrent,assertKnowledgeItemsCurrent} from '../context/knowledgeInputs.mjs';
import {separateKnowledgeInstruction} from '../context/knowledgeInstructions.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../context/knowledgeRenderer.mjs';
import {summarizeKnowledgeSelection} from '../context/knowledgeDiagnostics.mjs';
import {ActorPresenceStore} from '../context/actorPresence.mjs';
import { sameHostContext } from '../context/hostContext.mjs';
import { selectedDialogueMemories } from '../characters/sessionProfiles.mjs';
import { observeNative } from './nativeDelivery.mjs';
import { decide } from '../openai/decide.mjs';
import { transcribePcm } from '../openai/transcribe.mjs';
import { speak } from '../openai/speak.mjs';
import { DialogueHistory } from '../memory/dialogueHistory.mjs';
import {createD03OriginalDialogueJoin} from '../memory/d03OriginalDialogueJoin.mjs';
import {createOriginalBackendAcceptedInput} from '../memory/originalBackendAcceptedInput.mjs';
import {createOpenAIRuntimeAcceptedInputSource} from '../memory/openaiRuntimeAcceptedInput.mjs';
import {createOriginalTurnActorLedger} from '../memory/originalTurnActorLedger.mjs';
import {createNpcSpeechDeliverySource} from '../memory/npcSpeechDeliveryLedger.mjs';
import {prepareLiveTurnMemory} from '../memory/liveTurnMemory.mjs';
import { validateDecisionShape } from '../context/essentialDecision.mjs';
import { validateStockDecision } from '../context/decisionValidator.mjs';
import { createProviderStack } from '../providers/providerStack.mjs';
import { VoiceResolver } from '../voice/voiceResolver.mjs';
import { executeProviderOperation } from '../reliability/providerExecutor.mjs';
import { captureReferenceMap } from '../context/turnSnapshot.mjs';
import { IdentityResolver } from '../identity/identityResolver.mjs';
import { CharacterService,withoutCharacterTransport } from '../characters/characterService.mjs';
import { createNoopDialogueTrace } from '../observability/dialogueTrace.mjs';
import {memoryKConsumersAllowed} from '../memory/runtimeComposition.mjs';

// Fail-closed startup contract for E1's separately reviewed storage-only preset.
export const MEMORY_K_COMPOSITION_VERSION=1;

export function createRuntime(config, { fetchImpl = globalThis.fetch, telemetry = null, dialogueTrace = null, providers = {}, identityEvidence, identityStore, profileStore, nativeOwner, memoryNativeAuthority = null, deferCharacterInitialization = false } = {}) {
  const actorPresence=new ActorPresenceStore();
  const originalTurnTimeline=new OriginalEssentialTurnTimeline();
  dialogueTrace ||= createNoopDialogueTrace();
  const history = new DialogueHistory({ maxMessages: config.maxHistoryMessages, onMetric: (event, data) => telemetry?.emit(event, null, null, data) });
  const connections = new Set();
  let bridge = null;
  // Construct provider implementations only for the existing E1 OpenAI route.
  // Stock Gemini keeps its native transport and does not enter this stack.
  const providerStack = config.provider === 'openai' ? createProviderStack(config, { fetchImpl, providers }) : null;
  const voiceResolver = config.provider === 'openai' ? new VoiceResolver(config) : null;
  const identityService = config.provider === 'openai' && config.persistentIdentity?.enabled
    ? new IdentityResolver(config.persistentIdentity, { evidence: identityEvidence, store: identityStore, telemetry,
      retireSession: (session, reason) => {
        for (const connection of connections) if (connection.sessionIdentity.pedId === session.pedId && connection.sessionIdentity.sessionNonce === session.sessionNonce) {
          try { connection.retireIdentity(); } catch {}
        }
        return bridge?.retireMatchingSession(session, reason);
      } }) : null;
  const characterService = config.provider === 'openai' && config.promotedCharacters?.enabled
    ? new CharacterService(config,{identityService,voiceResolver,store:profileStore,nativeOwner,telemetry}) : null;
  if(!deferCharacterInitialization) characterService?.initialize().catch(() => {});
  // Optional SQLite path only. The existing JSON backend stays unchanged.
  const journalStore=characterService?.store;
  const optionalMemoryEnabled=memoryKConsumersAllowed(config);
  // Original-turn actor ledger: populated when the patched original Xn binds a
  // generation (OpenAIConnection.beginTurn), from facts the patched bridge reads
  // out of the original turn registry for the registered session connection.
  const originalTurnFacts=(identity,connection)=>
    typeof bridge?.originalTurnFacts==='function'?bridge.originalTurnFacts(identity,connection):null;
  const originalActorLedger=createOriginalTurnActorLedger({readOriginalTurn:originalTurnFacts});
  // D01. Stock Gemini: the pinned original has no final accepted-input event,
  // so its source stays denial-only. OpenAI: the runtime's own commit decision
  // in runSequentialTurn mints receipts through a capability that only the
  // OpenAI connections hold (passed privately to the transport below).
  const openaiAcceptance=config.provider==='openai'?createOpenAIRuntimeAcceptedInputSource({
    originalTurnFacts,available:()=>typeof bridge?.originalTurnFacts==='function',
    identityCurrent:identityService?identity=>identityService.current(identity):null,
    ledger:originalActorLedger,
  }):null;
  const originalAcceptedInput=openaiAcceptance?.verifier??createOriginalBackendAcceptedInput();
  // WS-5a: runtime-owned NPC speech-delivery ledger. The recorder half is held
  // privately by the OpenAI connections (like the D01 issuer); D03 receives only
  // the read-only evaluator, scoped to its own turn tuple.
  const speechDelivery=openaiAcceptance&&optionalMemoryEnabled?createNpcSpeechDeliverySource():null;
  const memorySources=openaiAcceptance?Object.freeze({
    acceptance:openaiAcceptance.issuer,
    speech:speechDelivery?.recorder??null,
    recordTurn:(identity,connection)=>{
      const entry=originalActorLedger.recordAtTurnCreation(identity,connection);
      // A newer original generation fences issuance for older ones.
      if(entry)openaiAcceptance.verifier.supersede(identity);
      return !!entry;
    },
  }):null;
  const journalCharacter=turn=>turn.characterProjection?.persistent===true
    && turn.characterProjection.profile?.characterId===turn.characterInputs?.profile?.characterId
    ? turn.characterProjection.profile.characterId:null;
  // This is an optional verified-native authority, NOT a hint from a model,
  // ped handle, room proximity, or a UI-generated 'trusted' flag. Missing
  // current host + exact owner/turn/protagonist proof disables M2 writes.
  const services = {
    bindM2Turn({turn,isCurrent}={}) {
      if(!optionalMemoryEnabled||runtime.closed) return null;
      const characterId=journalCharacter(turn);
      const ownerAlias=turn?.characterProjection?.profile?.promotion?.ownerAlias;
      if(!characterId||!ownerAlias||typeof isCurrent!=='function'||
         config.promotedCharacters?.storageMode!=='sqlite'||
         typeof journalStore?.withP2SqliteTransaction!=='function')
        return null;
      // D01 is a pinned original BACKEND final-acceptance source. D02 is
      // independently authenticated native current player/NPC ownership.
      // The original actor lease is acquired here AFTER original turn
      // hydration and BEFORE STT/provider intake; no post-hoc ped inference.
      const join=createD03OriginalDialogueJoin({
        store:journalStore,backend:originalAcceptedInput,
        d02:runtime.memoryD02??null,
        originalActor:originalActorLedger
      });
      // P1's live runtime binding for this exact session: verified native
      // owner claim of this ped at turn preparation; retired on revoke/close.
      const p1Binding=identityService?()=>identityService.bindings.get(turn.identity):null;
      return join.begin({identity:turn.identity,characterId,ownerAlias,
        isCurrent,p1Binding,
        speech:speechDelivery?{evaluate:()=>speechDelivery.verifier.evaluate(turn.identity)}:null});
    },
    async recordM2Player({turn,text,source}) {
      if(!optionalMemoryEnabled||runtime.closed) return null;
      if(!turn?.m2Capture||!['player_text','player_mic'].includes(source))
        return null;
      return turn.m2Capture.acceptPlayer({
        text,source:source==='player_mic'?'stt':'typed',
        transcription:source==='player_mic'
          ?{provider:providerStack?.transcription?.id??'unknown',
            // Recorded as configured; a provider that cannot name its model
            // stays 'unknown' rather than being guessed.
            model:config.transcriptionModel||'unknown',confidence:null}:null
      });
    },
    // PS4 is the only model-facing assembler. This preflight returns evidence
    // and source-fenced read receipts, never prompt text or model instructions.
    prepareLiveTurnMemory:args=>optionalMemoryEnabled&&!runtime.closed?prepareLiveTurnMemory({store:journalStore,...args}):null,
    // The NPC side of the exchange. Takes NO text, status, receipt or byte
    // count: D03 reads the runtime's own speech-delivery ledger for this turn
    // tuple and classifies completed / interrupted / failed from that evidence
    // alone (WS-5a). A `not_stored` result means "no durable receipt".
    async recordM2Npc({turn}) {
      if(!optionalMemoryEnabled||runtime.closed) return null;
      return turn?.m2Capture?.recordNpcOutcome?.()??null;
    },
    recordDialogueActionPublication({turn,validated,publishedAtMs}){
      if(config.provider!=='openai' || config.activities?.dialogueReceipts!==true || !runtime.dialogueKnowledgeBuildSupported)return null;
      const publication=prepareDialogueActionPublication({turn,validated,publishedAtMs,perception:runtime.intelligence?.runtime,identityService,activities:runtime.activities});
      return publication?runtime.activities?.recordDialogueActionPublication(publication):null;
    },
    config,
    dialogueTrace,
    finalizeKnowledgeFrame(turn,{input,history,source}) {
      const character=turn.characterProjection;
      // A persistent promoted NPC using the P2 SQLite history must never
      // substitute unverified RAM history if D03/native proof temporarily
      // disappears. Such RAM can contain already forgotten/corrected speech.
      // Only the source-fenced P2 journal may supply prior dialogue here.
      const p2HistoryRequired=character?.persistent===true &&
        config.promotedCharacters?.storageMode==='sqlite';
      const args={turn:turn.identity,frozenAt:turn.knowledgeInputs?.frozenAt??0,
        profile:character?.profile,persistent:character?.persistent===true,knowledgeInputs:turn.knowledgeInputs,
        actor:turn.context.actor,listener:turn.context.listener,world:turn.context.world,referenceMap:turn.context.referenceMap,
        presence:turn.sourcePresence,history:p2HistoryRequired?[]:history,input,source,
        directorEventContext:turn.directorTicket && source==='special_event'
          ? turn.context.internalEvent:null};
      const memory=turn.memoryPrepared;
      // Even a missing D03 receipt must not reintroduce a previously
      // forgotten/corrected durable line from the original RAM conversation.
      const base=renderKnowledge({...args,history:memory?[]:args.history,includePerceived:false});
      const memoryReady=memory?.status==='ready'&&
        memory.recallCurrent?.([],memory.preparedRecall?.stamp)===true;
      const memoryArgs=memoryReady?{
        preparedRecall:memory.preparedRecall,
        preparedM8:memory.preparedM8,
        m8Authorization:prepared=>prepared===memory.preparedM8&&memoryReady,
        recallAuthorization:prepared=>prepared===memory.preparedRecall&&
          memory.recallCurrent([],prepared?.stamp)===true,
        conversationJournal:memory.conversationJournal,
        memoryAction:memory.memoryAction,
        memoryStamp:memory.preparedRecall.stamp
      }:{};
      const memoryBase=memoryReady
        ?renderKnowledge({...args,...memoryArgs,includePerceived:false}):base;
      const mode=config.dialogueKnowledge?.mode??'off',ps=runtime.intelligence?.runtime;
      let reason=mode==='off'?'disabled':'unsupported_contract',preview=null;
      if(mode!=='off' && config.provider==='openai' && runtime.dialogueKnowledgeBuildSupported && ps?.observerIndexVersion===1 && ps?.observerSituationVersion===1 && ps?.hostContext?.hostContextVersion===1) {
        reason=runtime.intelligence.assertKnowledgeCurrent(turn.knowledgeInputs);
        if(!reason && !turn.knowledgeInputs?.ownerPendingProof) {
          try {preview=renderKnowledge({...args,...memoryArgs,includePerceived:true});}
          catch {reason='projection_failed';}
        }else reason ||= 'owner_unverified';
      }
      // Only explicit active mode with the matching build/live contracts may
      // select the candidate. Off/shadow always send the same hardened base.
      let selected=mode==='active' && !reason && preview?preview:memoryBase;
      // SELF contributors require independent payload acceptance; baseline PS4
      // mode alone never grants activation. Optional failures preserve selection.
      let health=null;try{health=services.capabilityHealth?.();}catch{}
      const selfCurrent=!reason && !turn.knowledgeInputs?.ownerPendingProof;
      const activityReady=selfCurrent && !!turn.knowledgeInputs?.activityInputs && !assertActivityKnowledgeCurrent(turn.knowledgeInputs.activityInputs,runtime.activities);
      const dialogueReady=selfCurrent && !!turn.knowledgeInputs?.dialogueInputs && !assertDialogueActionKnowledgeCurrent(turn.knowledgeInputs.dialogueInputs,runtime.activities);
      const includeActivityFacts=activityReady && config.dialogueKnowledge?.activityFacts==='active' && health?.['ps.activity_facts']?.active===true;
      const includeDialogueReceipts=dialogueReady && config.dialogueKnowledge?.dialogueReceipts==='active' && health?.['ps.dialogue_receipts']?.active===true;
      if(mode==='active' && preview && (includeActivityFacts || includeDialogueReceipts))try{selected=renderKnowledge({...args,...memoryArgs,includePerceived:true,activityInputs:turn.knowledgeInputs.activityInputs,dialogueInputs:turn.knowledgeInputs.dialogueInputs,includeActivityFacts,includeDialogueReceipts});}catch{}
      if(preview && (activityReady && ['shadow','active'].includes(config.dialogueKnowledge?.activityFacts) || dialogueReady && ['shadow','active'].includes(config.dialogueKnowledge?.dialogueReceipts)))try{preview=renderKnowledge({...args,...memoryArgs,includePerceived:true,activityInputs:turn.knowledgeInputs.activityInputs,dialogueInputs:turn.knowledgeInputs.dialogueInputs,includeActivityFacts:activityReady && ['shadow','active'].includes(config.dialogueKnowledge?.activityFacts),includeDialogueReceipts:dialogueReady && ['shadow','active'].includes(config.dialogueKnowledge?.dialogueReceipts)});}catch{}
      turn.knowledgeMode=mode;
      turn.knowledgePreview=preview?Object.freeze({selectedObservations:preview.delivery.length,frameBytes:preview.diagnostics.bytes,frameHash:createHash('sha256').update(JSON.stringify(preview.modelAllocation)).digest('hex')}):null;
      turn.knowledgeFallbackReason=reason;
      const capture=turn.knowledgeInputs?.captureDiagnostics;
      try {telemetry?.emit('knowledge_frame_projected',turn.identity,source,{knowledgeMode:mode,preview:!!preview,captureObservationCount:capture?.observations??0,capturePairCount:capture?.retainedPairs??0,capturePoolBytes:capture?.poolBytes??0,captureMissingSalience:capture?.noMatchingSalience??0,captureRevisionMismatch:capture?.revisionMismatch??0,captureRetiredRefs:capture?.participantRetired??0,captureBudgetExcluded:capture?.budgetExcluded??0,...summarizeKnowledgeSelection(turn.knowledgeInputs,preview),selectedObservations:preview?.delivery.length??0,frameBytes:preview?.diagnostics.bytes??base.diagnostics.bytes,frameHash:turn.knowledgePreview?.frameHash??createHash('sha256').update(JSON.stringify(base.modelAllocation)).digest('hex'),reason:turn.knowledgeFallbackReason});}catch{}
      const validateKnowledge=frame=>(
        (frame.delivery?.length??0)+(frame.activityReferences?.length??0)+
        (frame.dialogueReferences?.length??0)===0?null:
        assertOwnedKnowledgeCurrent(turn.knowledgeInputs,{identity:turn.identity,snapshot:turn.characterSnapshot,identityService,perception:runtime.intelligence?.runtime}) || assertKnowledgeItemsCurrent(turn.knowledgeInputs,frame,runtime.intelligence?.runtime)
      ) || ((frame.activityReferences?.length??0)>0?assertActivityKnowledgeCurrent(turn.knowledgeInputs.activityInputs,runtime.activities,frame.activityReferences):null) || ((frame.dialogueReferences?.length??0)>0?assertDialogueActionKnowledgeCurrent(turn.knowledgeInputs.dialogueInputs,runtime.activities,frame.dialogueReferences):null);
      turn.knowledgeDelivery=createKnowledgeDelivery({frame:selected,baseFrame:base,
        verifyPrepared:()=>memory.verifyPrepared(),
        recallCurrent:(refs,stamp)=>memoryReady&&memory.sendCurrent()&&memory.recallCurrent(refs,stamp),
        memoryCurrent:stamp=>memoryReady&&memory.sendCurrent()&&memory.recallCurrent([],stamp),
        opinionCurrent:(refs,stamp)=>memoryReady&&memory.opinionCurrent(refs,stamp),
        pruneOpinion:frame=>pruneKnowledgeFrame(frame,()=>true,()=>true,()=>true,()=>true,()=>false),
        pruneRecall:frame=>pruneKnowledgeFrame(frame,()=>true,()=>true,()=>true,()=>false),
        isCurrent:()=>runtime.host.isCurrent(turn.identity) && (!identityService || identityService.current(turn.identity)),
        prune:frame=>(frame.memoryStamp &&
          !(memoryReady&&memory.sendCurrent()&&memory.recallCurrent([],frame.memoryStamp)))?base:pruneKnowledgeFrame(frame,
          item=>!validateKnowledge({delivery:[item]}),
          item=>!validateKnowledge({delivery:[],activityReferences:[item]}),
          item=>!validateKnowledge({delivery:[],dialogueReferences:[item]}),
          ()=>memoryReady&&memory.sendCurrent()&&memory.recallCurrent([],memory.preparedRecall?.stamp)===true,
          (refs)=>memoryReady&&memory.opinionCurrent([refs],memory.preparedM8?.stamp)),
        validate:validateKnowledge,
        acknowledge:(key,consumer,outcome)=>{
          const salience=runtime.intelligence?.runtime.salience;
          if(consumer==='ps4_context' && outcome==='delivered'){
            const frozen=turn.knowledgeInputs?.pairs.find(pair=>pair.decision.decisionKey===key);
            return salience?.acknowledgeFrozenContext(key,frozen,outcome)===true;
          }
          return salience?.acknowledge(key,consumer,outcome)===true;
        },
        onOutcome:result=>{turn.knowledgeOutcome=result;try{telemetry?.emit('knowledge_delivery',turn.identity,source,{outcome:result.outcome,selectedObservations:result.selectedObservations,acknowledgedObservations:result.acknowledged,retiredAcknowledgements:result.retired,knowledgeRequestHash:result.requestHash,projectionHash:result.projectionHash,reason:result.retired?'ack_key_retired':null});}catch{}}});
      return selected;
    },
    subscribeKnowledgeInvalidation:listener=>runtime.intelligence?.subscribeKnowledgeInvalidation(listener),
    providerStack,
    decide: providerStack ? options => providerStack.decide(options) : options => decide({ ...options, config, fetchImpl }),
    transcribe: providerStack ? options => providerStack.transcribe(options) : options => transcribePcm({ ...options, config, fetchImpl }),
    speak: providerStack ? options => providerStack.speak(options) : options => speak({ ...options, config, fetchImpl }),
    executeProvider: providerStack ? args => executeProviderOperation({ ...args, retryConfig: config.retry, telemetry: args.telemetry }) : null,
  };
  const runtime = {
    config, history, services, telemetry, dialogueTrace, providerStack, voiceResolver, identityService,characterService,
    separateKnowledgeInstruction,
    captureNormalizedActor: (actor,raw,shape)=>actorPresence.capture(actor,raw,shape),
    actorSourcePresence: actor=>actorPresence.read(actor),
    copyActorPresence: (source,target)=>actorPresence.copy(source,target),
    modelActor: actor => actorPresence.copy(actor,withoutCharacterTransport(actor)),
    situationFor(observerRef) {
      const ps=runtime.intelligence?.runtime,index=ps?.observerIndex.get(observerRef);
      if(!index?.owned || !ps.current(observerRef) || !sameHostContext(ps.hostContext,identityService?.evidence?.hostContext) || !characterService?.store.loaded) return {};
      const bindings=identityService.bindings.values().filter(binding=>binding.claim.incarnationId===index.incarnationId && identityService.evidence.isCurrent(binding.claim));
      if(bindings.length!==1) return {};
      const profile=characterService.store.get(bindings[0].characterId);if(!profile) return {};
      const memories=selectedDialogueMemories(profile.memories).slice(0,16).map(selected=>{
        const memory=profile.memories.find(item=>item.memoryId===selected.memoryId);
        return {memoryId:memory.memoryId,importance:memory.importance,relatedCharacterIds:memory.relatedCharacterIds};
      });
      const playerCurrent=[...ps.anchors.values()].some(anchor=>anchor.kind==='player' && ps.current(anchor.captureRef));
      return {profile:{...profile,relationship:playerCurrent?profile.relationship:null},memories,bindings:[]}; // Backend identity is never recognition.
    },
    releaseOwnedKnowledge(inputs,identity,snapshot) {
      return releaseOwnedKnowledge(inputs,{identity,snapshot,identityService,perception:runtime.intelligence?.runtime});
    },
    captureCharacterInputs(identity,actor) {
      if(!characterService) return null;
      try {return characterService.captureTurnInputs(identity,actor);}
      catch {return Object.freeze({version:1,identity:Object.freeze({...identity}),claim:null,profile:null,session:null});}
    },
    captureKnowledgeInputs(input) {
      try {
        const inputs=runtime.intelligence?.captureKnowledgeInputs({...input,identityConfig:config.persistentIdentity,ownerEvidence:identityService?.evidence}) ?? null;
        let activityInputs=null;try{activityInputs=captureActivityKnowledge({knowledgeInputs:inputs,characterInputs:input.characterInputs,activities:runtime.activities});}catch{}
        let dialogueInputs=null;try{dialogueInputs=captureDialogueActionKnowledge({knowledgeInputs:inputs,activities:runtime.activities});}catch{}
        return activityInputs || dialogueInputs?Object.freeze({...inputs,...(activityInputs?{activityInputs}:{}),...(dialogueInputs?{dialogueInputs}:{})}):inputs;
      }
      catch {return null;} // Optional knowledge failure cannot prevent an Essential turn.
    },
    // Source projection is diagnostics-only until a source-versioned
    // native delivery/ack fence exists. Never use quiet as C-06 authority.
    projectOriginalTurnPriority,
    // These callbacks execute on the original backend's single JS event loop,
    // at source-pinned turn intake/terminal/session entrypoints. No actor
    // effect, turn creation, artificial terminal or stock scheduling.
    originalTurnTransition:(event,ticketId)=>originalTurnTimeline.transition(event,ticketId),
    awaitDirectorNativeBinding:ticket=>runtime.intelligence?.awaitDirectorNativeBinding?.(ticket) ?? Promise.resolve(false),
    beginDirectorOriginalTurn:(ticketId,snapshot)=>originalTurnTimeline.beginDirector(ticketId,snapshot),
    directorOriginalPhase:ticketId=>originalTurnTimeline.directorPhase(ticketId),
    inspectOriginalTurnPriority:raw=>originalTurnTimeline.sample(raw),
    acquireOriginalTurn:(ticketId,snapshot)=>originalTurnTimeline.acquire(ticketId,snapshot),
    checkOriginalTurn:(ticketId,snapshot)=>originalTurnTimeline.check(ticketId,snapshot),
    releaseOriginalTurn:ticketId=>originalTurnTimeline.release(ticketId),
    // Only fixed, non-sensitive stage codes; never ticket IDs, speech text,
    // capture references, player context, or arbitrary exception messages.
    directorHandoff(stage,status,code) {
      const stages=['preflight','post_hydration','turn_allocate','turn_intake',
        'session_open','binding_emit','binding_ack','binding_wait','stock_intake'];
      if(!stages.includes(stage) || !['started','accepted','rejected','timeout','failed'].includes(status) ||
         typeof code!=='string' || !/^[a-z][a-z0-9_]{0,63}$/.test(code))return false;
      try{telemetry?.emit('director_handoff',null,'internal',{stage,status,code});}catch{}
      return true;
    },
    directorPreflight(input) {
      if(input?.directorTicket!==undefined || input?.interruptExisting===true ||
         input?.faceListener===true || input?.reason!=='ps6_observer' ||
         typeof input?.dedupeKey!=='string' ||
         !/^ps:[0-9a-f-]{36}$/.test(input.dedupeKey)) {
        runtime.directorHandoff('preflight','rejected','input_contract');
        return false;
      }
      try {
        // Never treat the stock DTO as authority. Check the original backend
        // lease and native-submitted one-shot ticket independently.
        const id=input.dedupeKey.slice(3);
        if(runtime.host.directorCheckOriginalTurn(id)?.quiet!==true) {
          runtime.directorHandoff('preflight','rejected','backend_not_quiet');return false;
        }
        const ticket=runtime.intelligence?.claimDirectorStockTicket?.(input);
        if(!ticket || ticket.ticketId!==id || ticket.dedupeKey!==input.dedupeKey) {
          runtime.directorHandoff('preflight','rejected','stock_ticket_unclaimed');return false;
        }
        if(runtime.host.directorBeginOriginalTurn(id)!==true) {
          runtime.directorHandoff('preflight','rejected','source_transition_denied');return false;
        }
        input.directorTicket=ticket;
        runtime.directorHandoff('preflight','accepted','stock_ticket_claimed');
        return true;
      }catch{
        runtime.directorHandoff('preflight','failed','preflight_exception');return false;
      }
    },
    requireDirectorTicket(input,hydrated) {
      // Check only the actual pinned post-M4 hydration path; preserve all
      // original native/owner checks and throw the same stock veto on failure.
      const reject=code=>{
        runtime.directorHandoff('post_hydration','rejected',code);
        throw new TypeError('director_ticket_unverified');
      };
      if(input?.interruptExisting===true || input?.faceListener===true ||
         !input?.directorTicket || !hydrated?.actorContext)
        return reject('hydration_contract');
      if(runtime.host.directorCheckOriginalTurn(input.directorTicket.ticketId)?.quiet!==true)
        return reject('backend_lease_invalid');
      if(runtime.intelligence?.verifyDirectorTicket?.(input.directorTicket,input,hydrated)!==true)
        return reject('hydrated_ticket_invalid');
      if(runtime.intelligence?.confirmDirectorHydration?.(input.directorTicket)!==true)
        return reject('hydration_gate_denied');
      runtime.directorHandoff('post_hydration','accepted','ticket_verified');
      return input.directorTicket;
    },
    validateDecisionShape,
    validateStockDecision,
    captureReferenceMap,
    createTransport(geminiFactory) {
      if (config.provider === 'openai') {
        // The OpenAI route avoids constructing the Gemini transport and its client.
        return new OpenAITransport(runtime, memorySources);
      }
      const gemini = geminiFactory();
      if (!gemini.provider) Object.defineProperty(gemini, 'provider', { value: 'gemini', configurable: true });
      return gemini;
    },
    attach(connection) {
      if(runtime.closed){connection.close();throw new Error('runtime_stopped');}
      connections.add(connection); telemetry?.emit('bridge_ready', null, null, { provider: 'openai' });
    },
    closeConnections() {
      runtime.closed=true;
      runtime.retireOriginalAcceptanceSourceRun();
      for(const connection of [...connections]) connection.close();
    },
    detach(connection) {
      connections.delete(connection);
        // Session close/identity retirement/disconnect revokes every pending
        // acceptance receipt and ledger entry of this native session.
        try { openaiAcceptance?.verifier.retireSession(connection.sessionIdentity ?? {}); } catch {}
        try { speechDelivery?.recorder.retireSession(connection.sessionIdentity ?? {}); } catch {}
        try { originalActorLedger.retireSession(connection.sessionIdentity ?? {}); } catch {}
        identityService?.detach(connection.sessionIdentity);
        characterService?.sessions.detach(connection.sessionIdentity);
        history.clearSession(connection.sessionIdentity?.pedId, connection.sessionIdentity?.sessionNonce);
        telemetry?.emit('bridge_disconnected', null, null, { provider: 'openai', reason: 'session_closed' });
    },
    attachBridge(value) {
      for (const name of ['isCurrent', 'routePinnedEvent', 'authorize', 'onNativeEvent', 'assertCapabilities', 'validateDecision', 'failMatchingTurn']) {
        if (typeof value?.[name] !== 'function') throw new Error(`Missing Essential lifecycle capability: ${name}`);
      }
      if (identityService && typeof value?.retireMatchingSession !== 'function') throw new Error('Identity requires exact Essential session retirement.');
      // A different original backend bridge is a new source run.
      if (bridge && bridge !== value) {
        try { openaiAcceptance?.verifier.retireSourceRun(); } catch {}
        originalActorLedger.clear();
        try { speechDelivery?.recorder.clear(); } catch {}
      }
      bridge = value;
    },
    abortTurn(identity, reason) {
      // Cancellation/interrupt/failure: no further acceptance for this turn.
      // An already-issued receipt is not revoked (memory plan §5.5).
      try { openaiAcceptance?.verifier.fenceTurn(identity); } catch {}
      try { originalActorLedger.retire(identity); } catch {}
      for (const connection of connections) connection.abortTurn(identity, reason);
    },
    // Revocation only (cannot mint): host/world epoch change or shutdown.
    retireOriginalAcceptanceSourceRun() {
      try { openaiAcceptance?.verifier.retireSourceRun(); } catch {}
      originalActorLedger.clear();
      try { speechDelivery?.recorder.clear(); } catch {}
    },
    originalAcceptanceStatus() {
      return Object.freeze({provider: config.provider,
        receiptSource: originalAcceptedInput.source?.receiptSource ?? null,
        acceptedSourceHookAvailable: originalAcceptedInput.source?.acceptedSourceHookAvailable === true,
        hasAuthenticatedSource: originalAcceptedInput.hasAuthenticatedSource() === true});
    },
    get host() {
      if (!bridge) throw new Error('Essential E1 bridge has not been attached.');
      return bridge;
    },
    hostFor(connection) {
      if (!bridge) throw new Error('Essential E1 bridge has not been attached.');
      return {
        assertCapabilities: () => bridge.assertCapabilities(),
        isCurrent: identity => bridge.isCurrent(identity) && !connection.closed && (!identityService || identityService.current(identity)),
        prepareTurn: (turn, signal, deadlineAt) => connection.prepareIdentity(turn, signal, deadlineAt),
        validateDecision: async (decision, context, identity) => {
          const result = await bridge.validateDecision(decision, context, identity);
          if (result?.identityValid && result.actionCount) telemetry?.beginTurn(identity, context?.source || 'player_text')?.actionValidated(result.actionNames?.[0]);
          return result;
        },
        emit: event => connection.emitProviderEvent(event),
        observe: (identity, signal, onTerminal, onObserved) => observeNative(bridge, identity, signal, onTerminal, onObserved),
        authorize: identity => bridge.authorize(identity),
        failTurn: (identity, error, details) => bridge.failMatchingTurn(identity, error, details),
        failDirectorTurn: (ticket,identity) => runtime.intelligence?.failDirectorOriginalTurn?.(ticket,identity) === true,
        log: (identity, event, details) => bridge.log?.(identity, event, details),
        telemetry,
      };
    },
  };
  return runtime;
}

import { OpenAITransport } from '../openai/openaiTransport.mjs';
