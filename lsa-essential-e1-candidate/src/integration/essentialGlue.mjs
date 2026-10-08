import {createKnowledgeDelivery} from '../context/knowledgeDelivery.mjs';
import {createHash} from 'node:crypto';
import {releaseOwnedKnowledge,assertOwnedKnowledgeCurrent,assertKnowledgeItemsCurrent} from '../context/knowledgeInputs.mjs';
import {separateKnowledgeInstruction} from '../context/knowledgeInstructions.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../context/knowledgeRenderer.mjs';
import {ActorPresenceStore} from '../context/actorPresence.mjs';
import { sameHostContext } from '../context/hostContext.mjs';
import { selectedDialogueMemories } from '../characters/sessionProfiles.mjs';
import { observeNative } from './nativeDelivery.mjs';
import { decide } from '../openai/decide.mjs';
import { transcribePcm } from '../openai/transcribe.mjs';
import { speak } from '../openai/speak.mjs';
import { DialogueHistory } from '../memory/dialogueHistory.mjs';
import { validateDecisionShape } from '../context/essentialDecision.mjs';
import { validateStockDecision } from '../context/decisionValidator.mjs';
import { createProviderStack } from '../providers/providerStack.mjs';
import { VoiceResolver } from '../voice/voiceResolver.mjs';
import { executeProviderOperation } from '../reliability/providerExecutor.mjs';
import { captureReferenceMap } from '../context/turnSnapshot.mjs';
import { IdentityResolver } from '../identity/identityResolver.mjs';
import { CharacterService,withoutCharacterTransport } from '../characters/characterService.mjs';
import { createNoopDialogueTrace } from '../observability/dialogueTrace.mjs';

export function createRuntime(config, { fetchImpl = globalThis.fetch, telemetry = null, dialogueTrace = null, providers = {}, identityEvidence, identityStore, profileStore, nativeOwner } = {}) {
  const actorPresence=new ActorPresenceStore();
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
  characterService?.initialize().catch(() => {});
  const services = {
    config,
    dialogueTrace,
    finalizeKnowledgeFrame(turn,{input,history,source}) {
      const character=turn.characterProjection;
      const args={turn:turn.identity,frozenAt:turn.knowledgeInputs?.frozenAt??0,
        profile:character?.profile,persistent:character?.persistent===true,knowledgeInputs:turn.knowledgeInputs,
        actor:turn.context.actor,listener:turn.context.listener,world:turn.context.world,referenceMap:turn.context.referenceMap,
        presence:turn.sourcePresence,history,input,source};
      const base=renderKnowledge({...args,includePerceived:false});
      const mode=config.dialogueKnowledge?.mode??'off',ps=runtime.intelligence?.runtime;
      let reason=mode==='off'?'disabled':'unsupported_contract',preview=null;
      if(mode!=='off' && config.provider==='openai' && runtime.dialogueKnowledgeBuildSupported && ps?.observerIndexVersion===1 && ps?.observerSituationVersion===1 && ps?.hostContext?.hostContextVersion===1) {
        reason=runtime.intelligence.assertKnowledgeCurrent(turn.knowledgeInputs);
        if(!reason && !turn.knowledgeInputs?.ownerPendingProof) {
          try {preview=renderKnowledge({...args,includePerceived:true});}
          catch {reason='projection_failed';}
        }else reason ||= 'owner_unverified';
      }
      // Active sending remains fenced until request validity and exact delivery
      // acknowledgement are integrated. Preview is a private scalar read only.
      turn.knowledgeMode=mode;
      turn.knowledgePreview=preview?Object.freeze({selectedObservations:preview.delivery.length,frameBytes:preview.diagnostics.bytes,frameHash:createHash('sha256').update(JSON.stringify(preview.modelAllocation)).digest('hex')}):null;
      turn.knowledgeFallbackReason=reason??(mode==='active'?'unsupported_contract':null);
      try {telemetry?.emit('knowledge_frame_projected',turn.identity,source,{knowledgeMode:mode,preview:!!preview,selectedObservations:preview?.delivery.length??0,frameBytes:preview?.diagnostics.bytes??base.diagnostics.bytes,frameHash:turn.knowledgePreview?.frameHash??createHash('sha256').update(JSON.stringify(base.modelAllocation)).digest('hex'),reason:turn.knowledgeFallbackReason});}catch{}
      const validateKnowledge=frame=>assertOwnedKnowledgeCurrent(turn.knowledgeInputs,{identity:turn.identity,snapshot:turn.characterSnapshot,identityService,perception:runtime.intelligence?.runtime}) || assertKnowledgeItemsCurrent(turn.knowledgeInputs,frame,runtime.intelligence?.runtime);
      turn.knowledgeDelivery=createKnowledgeDelivery({frame:base,baseFrame:base,isCurrent:()=>runtime.host.isCurrent(turn.identity) && (!identityService || identityService.current(turn.identity)),
        prune:frame=>pruneKnowledgeFrame(frame,item=>!validateKnowledge({delivery:[item]})),
        validate:validateKnowledge,
        acknowledge:(key,consumer,outcome)=>runtime.intelligence?.runtime.salience.acknowledge(key,consumer,outcome),
        onOutcome:result=>{turn.knowledgeOutcome=result;try{telemetry?.emit('knowledge_delivery',turn.identity,source,{outcome:result.outcome,selectedObservations:result.selectedObservations,acknowledgedObservations:result.acknowledged,retiredAcknowledgements:result.retired,knowledgeRequestHash:result.requestHash,projectionHash:result.projectionHash,reason:result.retired?'ack_key_retired':null});}catch{}}});
      return base;
    },
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
      try {return runtime.intelligence?.captureKnowledgeInputs({...input,identityConfig:config.persistentIdentity,ownerEvidence:identityService?.evidence}) ?? null;}
      catch {return null;} // Optional knowledge failure cannot prevent an Essential turn.
    },
    validateDecisionShape,
    validateStockDecision,
    captureReferenceMap,
    createTransport(geminiFactory) {
      if (config.provider === 'openai') {
        // The OpenAI route avoids constructing the Gemini transport and its client.
        return new OpenAITransport(runtime);
      }
      const gemini = geminiFactory();
      if (!gemini.provider) Object.defineProperty(gemini, 'provider', { value: 'gemini', configurable: true });
      return gemini;
    },
    attach(connection) { connections.add(connection); telemetry?.emit('bridge_ready', null, null, { provider: 'openai' }); },
    detach(connection) {
      connections.delete(connection);
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
      bridge = value;
    },
    abortTurn(identity, reason) {
      for (const connection of connections) connection.abortTurn(identity, reason);
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
        log: (identity, event, details) => bridge.log?.(identity, event, details),
        telemetry,
      };
    },
  };
  return runtime;
}

import { OpenAITransport } from '../openai/openaiTransport.mjs';
