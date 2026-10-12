// M7 consent and authority contracts. Pure validation: no provider, timers or IO.
import {isUuid} from './evidence.mjs';

const modes=new Set(['off','shadow','experimental']);
const finitePositive=x=>Number.isFinite(x)&&x>0;
export const M7_OFF_CONSENT=Object.freeze({mode:'off',cloudOptIn:false});
export const M7_IDLE_PROOF_KIND='verified_native_idle_v1';
export const M7_PRICING_SOURCE_URL='https://developers.openai.com/api/docs/pricing';
// Published 2026-10-12 standard GPT-6 Luna long-context upper tier.
// This is a CONSERVATIVE RESERVATION price, not the charged invoice rate.
export const M7_LUNA_STANDARD_UPPER_BOUND=Object.freeze({model:'gpt-6-luna',inputUsdPerMillionTokens:0.20,outputUsdPerMillionTokens:0.75});
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
   value.maxBatchUsd>value.monthlyUsd||value.dailyUsd>100||value.monthlyUsd>1000||
   (value.consentRevision!==undefined&&(!Number.isSafeInteger(value.consentRevision)||value.consentRevision<1))||
   (value.approvalId!==undefined&&!isUuid(value.approvalId)))
   throw new Error('m7_explicit_consent_and_budget_required');
 return Object.freeze({mode:'experimental',cloudOptIn:true,
   consentSource:value.consentSource,offTurnEvidenceUploadAccepted:true,
   consentedAtUtc:new Date(value.consentedAtUtc).toISOString(),
   dailyUsd:value.dailyUsd,monthlyUsd:value.monthlyUsd,maxBatchUsd:value.maxBatchUsd,
   ...(value.consentRevision!==undefined?{consentRevision:value.consentRevision}:{}),
   ...(value.approvalId!==undefined?{approvalId:value.approvalId}:{})});
}

/**
 * K supplies price evidence for the ACTUAL configured Luna model. No
 * auto-discovery, guessed default, alternate model or legacy local transport.
 */
export function validateM7Pricing(config){
 const p=config?.curatorPricing,model=config?.reasoningModel;
 if(config?.provider!=='openai'||model!=='gpt-6-luna'||
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

/** Price verification required for the LIVE Essential transport (not test fixtures).
 * Only standard OpenAI-hosted GPT-6 Luna, with no custom server, fast tier,
 * or unpriced regional uplift. The caller pins independently reviewed rates
 * that upper-bound long-context standard rates; usage is not an invoice. */
export function validateM7ProductionPricing(config,{nowUtc=new Date().toISOString()}={}){
 const price=validateM7Pricing(config);
 const p=config.curatorPricing;
 const base=new URL(config.reasoningBaseUrl);
 const verified=Date.parse(p.verifiedAtUtc),current=Date.parse(nowUtc);
 if(base.origin!=='https://api.openai.com'||!['/v1','/v1/'].includes(base.pathname)||
    base.search||base.hash||p.pricingTier!=='standard'||
    p.officialPricingUrl!==M7_PRICING_SOURCE_URL||
    !Number.isFinite(current)||verified>current+300000||current-verified>30*86400000||
    price.inputUsdPerMillionTokens<M7_LUNA_STANDARD_UPPER_BOUND.inputUsdPerMillionTokens||
    price.outputUsdPerMillionTokens<M7_LUNA_STANDARD_UPPER_BOUND.outputUsdPerMillionTokens)
   throw new Error('m7_official_standard_luna_price_attestation_required');
 return price;
}

/** Independent P2 readback of an explicit, revisioned player settings approval.
 * Call after EVERY await boundary; a mere config mode is not persisted consent.
 * K/W06 must provide a serialized P2 port, not a JavaScript settings echo. */
export function validateM7PersistedApproval(record,policy,{store,model}={}){
 if(policy?.mode!=='experimental'||!policy.cloudOptIn||
    !isUuid(policy.approvalId)||!Number.isSafeInteger(policy.consentRevision)||
    policy.consentRevision<1||!record||
    record.source!=='p2_explicit_player_settings'||record.mode!=='experimental'||
    record.cloudOptIn!==true||record.offTurnEvidenceUploadAccepted!==true||
    record.approvalId!==policy.approvalId||record.consentRevision!==policy.consentRevision||
    record.model!==model||record.worldProfileId!==store?.worldProfileId||
    record.timelineId!==store?.activeTimelineId||
    !Number.isFinite(Date.parse(record.persistedAtUtc))||
    !Number.isFinite(Date.parse(record.consentedAtUtc))||
    new Date(record.consentedAtUtc).toISOString()!==policy.consentedAtUtc||
    record.dailyUsd!==policy.dailyUsd||record.monthlyUsd!==policy.monthlyUsd||
    record.maxBatchUsd!==policy.maxBatchUsd)return false;
 return true;
}
