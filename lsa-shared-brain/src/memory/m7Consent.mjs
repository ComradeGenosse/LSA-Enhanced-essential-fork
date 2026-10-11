// M7 consent and authority contracts. Pure validation: no provider, timers or IO.
import {isUuid} from './evidence.mjs';

const modes=new Set(['off','shadow','experimental']);
const finitePositive=x=>Number.isFinite(x)&&x>0;
export const M7_OFF_CONSENT=Object.freeze({mode:'off',cloudOptIn:false});
export const M7_IDLE_PROOF_KIND='verified_native_idle_v1';
// Negative gameplay/turn authority must be source-known AND idle. An idle
// timestamp or an arbitrary absence of callbacks cannot certify these states.
// These are C-06-derived quiet fields only; not a PS6 Director response grant.
export const M7_PRIORITY_QUIET_FIELDS=Object.freeze([
 'ownerProofCurrent','speakerOwned','speakerAlive','playerIsLocal','playerAlive',
 'ownerPrimaryModeKnown','ownerIdle','micStateKnown','micIdle',
 'conversationStateKnown','conversationIdle','textInputKnown','textInputIdle',
 'controlsInputKnown','controlsInputIdle','scriptStateKnown','scriptSafe',
 'actorReflexKnown','actorReflexIdle','playerTurnSourceCurrent','playerTurnIdle',
 'essentialTurnKnown','essentialTurnIdle','playbackKnown','playbackIdle']);


/**
 * Host must persist explicit player approval of off-turn evidence upload and
 * maximum cloud spend. A mode toggle, API key, model selection or old boolean
 * optIn does NOT constitute consent. Off/shadow need no paid configuration.
 */
export function validateM7Consent(value=M7_OFF_CONSENT){
 if(!value||typeof value!=='object'||!modes.has(value.mode))throw new Error('m7_invalid_consent_mode');
 if(value.mode!=='experimental')return Object.freeze({mode:value.mode,cloudOptIn:false});
 if(value.cloudOptIn!==true||value.consentSource!=='explicit_player_settings'||
   value.offTurnEvidenceUploadAccepted!==true||!Number.isFinite(Date.parse(value.consentedAtUtc))||
   !finitePositive(value.dailyUsd)||!finitePositive(value.monthlyUsd)||
   !finitePositive(value.maxBatchUsd)||value.maxBatchUsd>value.dailyUsd||
   value.maxBatchUsd>value.monthlyUsd||value.dailyUsd>100||value.monthlyUsd>1000)
   throw new Error('m7_explicit_consent_and_budget_required');
 return Object.freeze({mode:'experimental',cloudOptIn:true,
   consentSource:value.consentSource,offTurnEvidenceUploadAccepted:true,
   consentedAtUtc:new Date(value.consentedAtUtc).toISOString(),
   dailyUsd:value.dailyUsd,monthlyUsd:value.monthlyUsd,maxBatchUsd:value.maxBatchUsd});
}

/**
 * K supplies price evidence for the ACTUAL configured Luna model. No
 * auto-discovery, guessed default, alternate model or legacy local transport.
 */
export function validateM7Pricing(config){
 const p=config?.curatorPricing,model=config?.reasoningModel;
 if(config?.provider!=='openai'||typeof model!=='string'||!/luna/i.test(model)||
   typeof config.reasoningBaseUrl!=='string'||!/^https:\/\//.test(config.reasoningBaseUrl)||
   !p||p.model!==model||p.source!=='operator_verified'||
   !Number.isFinite(Date.parse(p.verifiedAtUtc))||
   !finitePositive(p.inputUsdPerMillionTokens)||!finitePositive(p.outputUsdPerMillionTokens)||
   p.inputUsdPerMillionTokens>10000||p.outputUsdPerMillionTokens>10000||
   (config.curatorMaxOutputTokens!==undefined&&
     (!Number.isSafeInteger(config.curatorMaxOutputTokens)||
      config.curatorMaxOutputTokens<128||config.curatorMaxOutputTokens>1600)))
   throw new Error('curation_verified_luna_pricing_required');
 return Object.freeze({model,inputUsdPerMillionTokens:p.inputUsdPerMillionTokens,
   outputUsdPerMillionTokens:p.outputUsdPerMillionTokens,
   verifiedAtUtc:new Date(p.verifiedAtUtc).toISOString(),source:p.source});
}

/**
 * The host is responsible for constructing this snapshot from its authenticated
 * native channel and P2 owner mapping. An actor name/proximity, a guessed NPC,
 * a timer's silence or a bare {isIdle:true} is NOT sufficient.
 * Snapshots are short-lived, must be synchronous and are revalidated after
 * every asynchronous boundary.
 */
export function validateM7IdleProof(proof,{store,characterId,nowUtc,maxAgeMs=3000}={}){
 const at=Date.parse(proof?.observedAtUtc),now=Date.parse(nowUtc);
 if(!proof||proof.kind!==M7_IDLE_PROOF_KIND||proof.nativeVerified!==true||
   !isUuid(proof.hostRunId)||!Number.isSafeInteger(proof.worldEpoch)||proof.worldEpoch<1||
   !isUuid(proof.sessionId)||!isUuid(proof.incarnationId)||!isUuid(proof.encounterId)||
   !Number.isSafeInteger(proof.observerIndex)||proof.observerIndex<0||
   !isUuid(proof.characterId)||!isUuid(proof.worldProfileId)||!isUuid(proof.timelineId)||
   !M7_PRIORITY_QUIET_FIELDS.every(k=>proof.priorityEvidence?.[k]===true)||
   proof.idle!==true||proof.micActive!==false||proof.playerSpeechActive!==false||
   proof.directorBusy!==false||proof.gamePaused!==false||
   !Number.isFinite(proof.idleForMs)||proof.idleForMs<1500||
   !Number.isFinite(at)||!Number.isFinite(now)||at>now+250||
   now-at>maxAgeMs||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<100||maxAgeMs>10000||
   proof.characterId!==characterId||proof.worldProfileId!==store?.worldProfileId||
   proof.timelineId!==store?.activeTimelineId||store?.timelineWritable!==true||
   typeof store.get!=='function'||!store.get(characterId)||
   store.verifiedHostContext?.hostRunId!==proof.hostRunId||
   store.verifiedHostContext?.worldEpoch!==proof.worldEpoch)
   throw new Error('m7_native_idle_proof_required');
 return Object.freeze({
   kind:proof.kind,hostRunId:proof.hostRunId,worldEpoch:proof.worldEpoch,
   sessionId:proof.sessionId,incarnationId:proof.incarnationId,
   encounterId:proof.encounterId,observerIndex:proof.observerIndex,
   characterId:proof.characterId,worldProfileId:proof.worldProfileId,
   timelineId:proof.timelineId
 });
}
