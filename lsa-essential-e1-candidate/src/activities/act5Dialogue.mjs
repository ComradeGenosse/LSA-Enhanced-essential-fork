import { randomUUID } from 'node:crypto';
import { sameHostContext } from '../context/hostContext.mjs';
import { planSpec } from './intentTemplates.mjs';
import { validateSlots } from './contracts.mjs';

// ACT5 does not plan or execute steps. It retains one short-lived, spoken
// invitation until the PLAYER explicitly accepts; ActivityEngine owns dispatch.
const YES = new Set(['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'alright', 'go ahead', 'do it', "let's do it", 'lets do it', 'sounds good', "yeah let's go", 'yes please']);
const NO = new Set(['no', 'nope', 'nah', 'not now', 'no thanks', 'maybe later', 'never mind', 'nevermind', "don't", 'dont', 'cancel that', 'forget it']);
const CANCEL = new Set(['stop', 'stop that', 'cancel the activity', 'cancel that activity', 'stop doing that', 'stop driving', 'stop walking', 'stop the trip', 'cancel the trip']);
const OFFER_MS = 90_000;
const TERMINAL = new Set(['none','completed','failed','cancelled','superseded','expired','abandoned']);
const COOLDOWN_MS = 90_000;
export const ACT5_SLOTS = Object.freeze({
  hold_position: Object.freeze({}),
  accompany: Object.freeze({ person: Object.freeze({ kind: 'player' }) }),
  resume_previous: Object.freeze({}),
  sit_here: Object.freeze({}),
  // ACT3 choices are offered only when every native step has opted-in,
  // probe-verified capabilities. Player is the only resolvable person here.
  approach_and_face: Object.freeze({ person: Object.freeze({ kind: 'player' }) }),
  leave_scene: Object.freeze({}),
  take_cover_and_hold: Object.freeze({}),
  // Closed, player-approved waypoint trips; never accept model coordinates or freeform named locations.
  go_to_place: Object.freeze({ place: Object.freeze({ kind: 'waypoint' }) }),
  vehicle_trip: Object.freeze({ place: Object.freeze({ kind: 'waypoint' }) }),
});
const clean = value => String(value || '').trim().toLowerCase().replace(/[.,!?]+/g, ' ').replace(/\s+/g, ' ').trim();
// Closed, explicit player requests only. Never forward a model-supplied string as a
// location query or infer a Ped/vehicle handle from natural language.
const NAV_NAMES = Object.freeze(new Map([
  ['airport','airport'], ['los santos international airport','los santos international airport'],
  ['lsia','lsia'], ['del perro pier','del perro pier'],
  ['vespucci beach','vespucci beach'], ['sandy shores airfield','sandy shores airfield'], ['paleto bay','paleto bay'],
]));
export function parseAct6PlayerRequest(input) {
  const utterance = clean(input);
  const match = /^(walk over to|walk to|go to|head to|drive us to|drive to|take me to) (?:the )?([a-z0-9 ]+?)( and wait)?$/.exec(utterance);
  if (!match) return null;
  const target = match[2] === 'waypoint' || match[2] === 'my waypoint' ? {kind:'waypoint'} : NAV_NAMES.has(match[2]) ? {kind:'named',query:NAV_NAMES.get(match[2])} : null;
  if (!target) return null;
  const driving = match[1].includes('drive') || match[1]==='take me to';
  if (driving && match[3]) return null; // No unsupported drive-then-wait composite.
  const intent = driving ? 'vehicle_trip' : match[3] ? 'move_to_and_hold' : 'go_to_place';
  return Object.freeze({intent,slots:Object.freeze({place:Object.freeze(target)})});
}
const keyFor = identity => identity && String(identity.pedId) + ':' + String(identity.sessionNonce);
const sameTurn = (a, b) => a?.pedId === b?.pedId && a?.sessionNonce === b?.sessionNonce &&
  a?.turnId === b?.turnId && a?.generationId === b?.generationId;

export function validateAct5Choice(activity, intents) {
  if (activity === null) return true;
  if (!activity || typeof activity !== 'object' || Array.isArray(activity) ||
      Object.keys(activity).sort().join(',') !== 'intent,slots' ||
      !Array.isArray(intents) || !intents.includes(activity.intent) ||
      !Object.hasOwn(ACT5_SLOTS, activity.intent) ||
      !validateSlots(activity.intent, activity.slots)) return false;
  return JSON.stringify(activity.slots) === JSON.stringify(ACT5_SLOTS[activity.intent]);
}

export class Act5Dialogue {
  constructor({ activities, characterService, now = () => Date.now(), id = randomUUID, report = () => {} }) {
    this.activities = activities;
    this.characterService = characterService;
    this.now = now;
    this.id = id;
    this.report = report;
    this.pending = new Map();
    this.cooldown = new Map();
    this.lastAccepted = new Map();
    this.seenTurns = new Set();
    this.approvals = new Map();
  }

  #ready() {
    const runtime = this.activities?.client?.runtime;
    const engine = this.activities?.engine;
    return engine?.config?.act5 === true && engine.config.mode === 'on' &&
      runtime?.ready === true && engine.hello?.nativeRun === runtime.nativeRun &&
      engine.hello?.adapterEpoch === runtime.adapterEpoch ? runtime : null;
  }

  async #owner(turn) {
    const runtime = this.#ready();
    const profile = turn?.characterInputs?.profile;
    const claim = turn?.characterInputs?.claim;
    if (!runtime || turn?.characterProjection?.persistent !== true ||
        !profile?.characterId || turn.characterProjection.profile?.characterId !== profile.characterId ||
        !profile.promotion?.ownerAlias || !claim?.incarnationId ||
        !sameHostContext(runtime.hostContext, turn?.knowledgeInputs?.activityInputs?.binding?.hostContext))
      return null;
    // Both snapshots must agree with the present, native owner. An ambiguous
    // target, a retired incarnation or a failed native request closes ACT5.
    try {
      const capture = await this.characterService?.native?.request('capture');
      if (!capture || capture.ownerAlias !== profile.promotion.ownerAlias) return null;
      const live = await this.characterService.native.request('inspect', { ownerAlias: profile.promotion.ownerAlias });
      if (!live?.ownershipToken || live.ownerAlias !== capture.ownerAlias ||
          live.encounterId !== capture.encounterId ||
          live.encounterId !== turn.knowledgeInputs.activityInputs.binding.encounterId ||
          live.claim?.incarnationId !== claim.incarnationId ||
          !this.#ready() || !sameHostContext(runtime.hostContext, this.activities.client.runtime.hostContext)) return null;
      return {
        binding: { characterId: profile.characterId, ownerAlias: live.ownerAlias,
          ownershipToken: live.ownershipToken, encounterId: live.encounterId,
          incarnationId: live.claim.incarnationId },
        nativeRun: runtime.nativeRun, adapterEpoch: runtime.adapterEpoch,
        hostContext: runtime.hostContext, sessionKey: keyFor(turn.identity),
      };
    } catch { return null; }
  }

  async prepare(turn, source) {
    if (!['player_text', 'player_mic'].includes(source)) return null;
    const owner = await this.#owner(turn);
    if (!owner) return null;
    const characterId = owner.binding.characterId;
    const pending = this.pending.get(characterId);
    if (pending && (pending.expiresAt <= this.now() ||
        pending.owner.binding.encounterId !== owner.binding.encounterId ||
        pending.owner.binding.incarnationId !== owner.binding.incarnationId ||
        pending.owner.sessionKey !== owner.sessionKey ||
        pending.owner.nativeRun !== owner.nativeRun)) this.pending.delete(characterId);
    const activityStatus = this.activities.status(characterId);
    const busy = !TERMINAL.has(activityStatus?.status);
    const intents = busy || this.pending.has(characterId) || (this.cooldown.get(characterId) || 0) > this.now()
      ? [] : Object.keys(ACT5_SLOTS).filter(intent => {
          const spec = planSpec(intent, ACT5_SLOTS[intent]);
          if (!Array.isArray(spec.steps) || !spec.steps.length) return false;
          return spec.steps.every(step => {
            const capability = step.capability;
            const row = this.activities.engine.registry.get(capability);
            if (!row || !['ACT2','ACT3','ACT6'].includes(row.phase)) return false;
            if (row.phase === 'ACT3' && !(this.activities.engine.config.act3Capabilities || []).includes(capability)) return false;
            if (row.phase === 'ACT6' && !(this.activities.engine.config.act6Capabilities || []).includes(capability)) return false;
            return this.activities.engine.registry.enabled(capability, {
              mode: 'on', hello: this.activities.engine.hello?.capabilities, requested: [capability],
              passedProbes: this.activities.engine.config.passedProbes || [],
              source: 'player_dialogue', priority: 'player_direct',
            });
          });
        });
    return Object.freeze({ owner, intents: Object.freeze(intents), activityStatus: activityStatus?.status || 'unknown',
      pendingIntent: this.pending.get(characterId)?.activity.intent || null });
  }

  async publish(turn, decision, context, isCurrent) {
    if (!decision?.activity || !context?.intents?.includes(decision.activity.intent) ||
        !validateAct5Choice(decision.activity, context.intents) || !isCurrent?.()) return false;
    const idKey = keyFor(turn.identity) + ':' + turn.identity.turnId + ':' + turn.identity.generationId;
    if (this.seenTurns.has(idKey)) return false;
    const current = await this.#owner(turn);
    if (!current || !isCurrent() || current.binding.characterId !== context.owner.binding.characterId ||
        current.binding.ownershipToken !== context.owner.binding.ownershipToken ||
        current.binding.encounterId !== context.owner.binding.encounterId ||
        current.nativeRun !== context.owner.nativeRun ||
        (this.cooldown.get(current.binding.characterId) || 0) > this.now()) return false;
    const characterId = current.binding.characterId;
    if (this.pending.has(characterId) || !TERMINAL.has(this.activities.status(characterId).status)) return false;
    this.seenTurns.add(idKey);
    if (this.seenTurns.size > 256) this.seenTurns.delete(this.seenTurns.values().next().value);
    const proposal = {
      proposalVersion: 1, proposalId: this.id(), source: 'player_dialogue',
      subject: { characterId }, intent: decision.activity.intent,
      slots: structuredClone(decision.activity.slots), priority: 'player_direct',
      origin: { turn: { pedId: String(turn.identity.pedId), sessionNonce: turn.identity.sessionNonce,
        turnId: turn.identity.turnId, generationId: turn.identity.generationId } },
      proposedAtMs: this.now(),
    };
    this.pending.set(characterId, { activity: decision.activity, proposal, owner: current, expiresAt: this.now() + OFFER_MS });
    this.cooldown.set(characterId, this.now() + COOLDOWN_MS);
    this.report('act5_proposed', { intent: proposal.intent });
    return true; // Proposal only; no ACT goal or native command.
  }

  async onPlayerInput(turn, input, context, isCurrent) {
    if (!context?.owner || !isCurrent?.()) return null;
    const characterId = context.owner.binding.characterId;
    const response = clean(input);
    const pending = this.pending.get(characterId);
    if (!pending) {
      // Player-directed ACT6 navigation enters the existing publication-bound ACT5 admission
      // lane. The command cannot dispatch on an STT fragment or an unverified Luna response.
      const request = parseAct6PlayerRequest(response);
      if (request && TERMINAL.has(this.activities.status(characterId)?.status) &&
          this.activities.engine.config.act6Capabilities?.includes(request.intent === 'vehicle_trip' ? 'drive_to' : 'walk_to')) {
        const owner = await this.#owner(turn);
        const runtime = this.#ready();
        const now = this.now();
        if (!owner || !runtime || !isCurrent?.() ||
            owner.binding.encounterId !== context.owner.binding.encounterId ||
            owner.binding.ownershipToken !== context.owner.binding.ownershipToken ||
            owner.nativeRun !== context.owner.nativeRun) return null;
        const proposed = {
          proposalVersion:1,proposalId:this.id(),source:'player_dialogue',
          subject:{characterId},intent:request.intent,slots:request.slots,
          priority:'player_direct',
          origin:{turn:{pedId:String(turn.identity.pedId),sessionNonce:turn.identity.sessionNonce,
            turnId:turn.identity.turnId,generationId:turn.identity.generationId}},
          proposedAtMs:now,
        };
        const turnKey = keyFor(turn.identity)+':'+turn.identity.turnId+':'+turn.identity.generationId;
        if (this.approvals.has(turnKey) || this.seenTurns.has(turnKey)) return null;
        this.seenTurns.add(turnKey);
        if (this.seenTurns.size > 256) this.seenTurns.delete(this.seenTurns.values().next().value);
        this.approvals.set(turnKey,{owner,pending:{activity:request,proposal:proposed,expiresAt:now+OFFER_MS}});
        this.report('act6_player_direct_staged',{intent:request.intent});
        return Object.freeze({kind:'approval_pending',intent:request.intent});
      }
      if (!CANCEL.has(response)) return null;
      const last = this.lastAccepted.get(characterId);
      if (!last || this.activities.engine.activities.find(a => a.activityId === last)?.status === undefined) return null;
      const owner = await this.#owner(turn);
      if (!owner || !isCurrent() || owner.binding.encounterId !== context.owner.binding.encounterId) return null;
      const running = this.activities.engine.activities.find(a => a.activityId === last && !['cancelled','failed','completed','superseded','expired','abandoned'].includes(a.status));
      if (!running) return null;
      const result = this.activities.cancel(characterId);
      this.report('act5_cancelled', { ok: result?.ok === true });
      return Object.freeze({ kind: result?.ok ? 'cancelled' : 'unavailable', intent: running.template });
    }
    if (!YES.has(response) && !NO.has(response) && !CANCEL.has(response)) return null;
    this.pending.delete(characterId);
    if (!YES.has(response)) {
      this.report('act5_declined', { intent: pending.activity.intent });
      return Object.freeze({ kind: 'declined', intent: pending.activity.intent });
    }
    const owner = await this.#owner(turn);
    if (!owner || !isCurrent() || this.now() >= pending.expiresAt ||
        owner.binding.characterId !== pending.owner.binding.characterId ||
        owner.binding.encounterId !== pending.owner.binding.encounterId ||
        owner.binding.incarnationId !== pending.owner.binding.incarnationId ||
        owner.binding.ownershipToken !== pending.owner.binding.ownershipToken ||
        owner.nativeRun !== pending.owner.nativeRun ||
        owner.sessionKey !== pending.owner.sessionKey ||
        !TERMINAL.has(this.activities.status(characterId).status)) {
      this.report('act5_rejected', { reason: 'owner_or_activity_changed' });
      return Object.freeze({ kind: 'unavailable', intent: pending.activity.intent });
    }
    // Consent is captured here but dispatch waits for the existing validated
    // output_transcript publication boundary. A malformed Luna reply never acts.
    const turnKey = keyFor(turn.identity) + ':' + turn.identity.turnId + ':' + turn.identity.generationId;
    this.approvals.set(turnKey, {pending, owner});
    if (this.approvals.size > 32) this.approvals.delete(this.approvals.keys().next().value);
    return Object.freeze({ kind: 'approval_pending', intent: pending.activity.intent });
  }

  async commitApproved(turn, isCurrent) {
    const turnKey = keyFor(turn?.identity) + ':' + turn?.identity?.turnId + ':' + turn?.identity?.generationId;
    const staged = this.approvals.get(turnKey);
    if (!staged) return {ok:false,reason:'no_pending_approval'};
    this.approvals.delete(turnKey);
    const {pending,owner} = staged;
    if (!isCurrent?.() || this.now() >= pending.expiresAt) return {ok:false,reason:'stale_player_turn'};
    const current = await this.#owner(turn);
    const characterId = owner.binding.characterId;
    if (!current || !isCurrent() ||
        current.binding.characterId !== owner.binding.characterId ||
        current.binding.encounterId !== owner.binding.encounterId ||
        current.binding.incarnationId !== owner.binding.incarnationId ||
        current.binding.ownershipToken !== owner.binding.ownershipToken ||
        current.nativeRun !== owner.nativeRun || current.adapterEpoch !== owner.adapterEpoch ||
        current.sessionKey !== owner.sessionKey ||
        !TERMINAL.has(this.activities.status(characterId).status)) {
      this.report('act5_rejected',{reason:'owner_or_activity_changed'});
      return {ok:false,reason:'owner_or_activity_changed'};
    }
    const result = this.activities.engine.assign(pending.proposal,current.binding,{playerApproved:true});
    if (result?.ok) this.lastAccepted.set(characterId,result.activityId);
    this.report(result?.ok?'act5_admitted':'act5_rejected',{intent:pending.activity.intent,reason:result?.reason||null});
    return result;
  }

  clear() { this.pending.clear(); this.lastAccepted.clear(); this.cooldown.clear(); this.seenTurns.clear(); this.approvals.clear(); }
}
