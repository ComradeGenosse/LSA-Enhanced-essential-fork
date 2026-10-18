import { randomUUID } from 'node:crypto';
import { sameHostContext } from '../context/hostContext.mjs';
import { planSpec } from './intentTemplates.mjs';
import { validateSlots } from './contracts.mjs';
import { inspectNavigationReadiness } from './navigationReadiness.mjs';

// ACT5 does not plan or execute steps. It retains one short-lived, spoken
// invitation until the PLAYER explicitly accepts; ActivityEngine owns dispatch.
// Short, whole-utterance consents only. These never match a passing mention of "yes"
// in unrelated speech, and imperative approvals are tied to the offered intent.
const YES = new Set(['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'alright', 'go ahead', 'do it',
  "let's do it", 'lets do it', 'sounds good', "yeah let's go", 'yes please',
  'yeah lets do that', 'yes lets do that', 'sure go ahead', 'yeah go ahead',
  'okay go ahead', 'ok go ahead', 'yeah sure', 'sure thing', 'yes go ahead',
  'go for it', 'sounds great', 'that sounds good', 'lets go', 'yeah lets go',
  'alright lets do it', 'okay lets do it', 'absolutely', 'please do', 'sounds great do it',
  'sounds good do it', 'yes please do', 'that sounds great']);
const NO = new Set(['no', 'nope', 'nah', 'not now', 'no thanks', 'maybe later',
  'never mind', 'nevermind', "don't", 'dont', 'cancel that', 'forget it',
  'actually never mind', 'actually no', 'no stay here instead',
  'no just stay here', 'no stay here', 'not right now', 'better not', 'please dont',
  'nah thanks', 'no please dont']);
const CANCEL = new Set(['stop', 'stop that', 'cancel the activity', 'cancel that activity',
  'stop doing that', 'stop what youre doing', 'stop doing it', 'please stop',
  'stop please', 'cancel it']);
// Explicit navigation stop commands may cancel the most recent owned ACT6
// journey regardless of whether the trip came from ACT5 or player UX.
// Generic ACT5 "stop" retains the stricter dialogue-only cancellation policy.
const NAV_STOP = new Set(['stop driving','stop the car','stop the trip','cancel the trip',
  'end the trip','stop walking','stop moving','stop navigation']);
const DRIVE_STOP = new Set(['stop driving','stop the car','stop the trip','cancel the trip','end the trip']);
const WALK_STOP = new Set(['stop walking','stop moving']);
export const isAct6StopRequest = input => NAV_STOP.has(clean(input));
// Keep one ACT6 admission source even when Luna proposes a competing stock DO
// or an ACT5 activity for an explicit navigation command. No native action is
// issued here; commitApproved still runs after the transcript publication gate.
export function reconcileAct6Decision(decision, reply, {nativeHandoffStarted=false}={}) {
  if (!['go_to_place','vehicle_trip','move_to_and_hold'].includes(reply?.intent))
    return Object.freeze({decision,suppressed:false});
  const conflict=Boolean(decision?.command) ||
    (Object.hasOwn(decision || {},'activity') && decision.activity !== null);
  if (!conflict) return Object.freeze({decision,suppressed:false});
  if (nativeHandoffStarted) throw Object.assign(new TypeError('ACT6 command conflict after audio handoff.'),
    {code:'act6_late_reconciliation'});
  const dialogue=reply.kind==='approval_pending' ? "Okay, I'll try to navigate there." :
    reply.reason==='driver_required' ? "I need to be in the driver's seat first." :
    reply.reason==='place_unresolved' || reply.reason==='destination_unresolved'
      ? "I can't verify that destination right now." :
    "I can't safely start navigation right now.";
  return Object.freeze({decision:Object.freeze({...decision,dialogue,command:'',
    ...(Object.hasOwn(decision,'activity')?{activity:null}:{})}),suppressed:true});
}
const NAV_NAMES = Object.freeze(new Map([
  ['airport','airport'],['lsia','lsia'],['los santos international airport','los santos international airport'],
  ['del perro pier','del perro pier'],['vespucci beach','vespucci beach'],
  ['sandy shores airfield','sandy shores airfield'],['paleto bay','paleto bay'],
]));
const INTENT_YES = Object.freeze({
  board_vehicle: new Set(['sure hop in','yeah hop in','yes hop in','go ahead hop in',
    'sure get in','yes get in','go ahead get in','you can hop in']),
  ride_along: new Set(['sure hop in','yeah hop in','yes hop in','come along',
    'sure come along','sure ride along','yes ride along','go ahead and ride along']),
  exit_vehicle_and_hold: new Set(['sure get out','yes get out','go ahead get out',
    'get out and wait','sure get out and wait']),
  scenario_here: new Set(['sure grab a coffee','yes grab a coffee','go ahead grab a coffee',
    'sure have a coffee','go ahead have a coffee']),
  approach_and_face: new Set(['sure come over','yeah come over','yes come over']),
  leave_scene: new Set(['sure head out','yeah head out','go ahead head out']),
  take_cover_and_hold: new Set(['sure take cover','yes take cover','go ahead take cover']),
});
const OFFER_MS = 90_000;
const TERMINAL = new Set(['none','completed','failed','cancelled','superseded','expired','abandoned']);
const COOLDOWN_MS = 90_000;
const REPEAT_INTENT_MS = 300_000; // no repeated prompt for the same activity inside five minutes
// Each option is a complete, closed, native-resolvable slot combination. The
// model cannot make up seat indices, scenarios, entity handles or destinations.
// The last scenario (sit_bench) deliberately stays blocked in ACT3.
const frozen = values => Object.freeze(values.map(value => Object.freeze(value)));
const player = Object.freeze({ kind: 'player' });
const playerVehicle = Object.freeze({ kind: 'player_vehicle' });
export const ACT5_CHOICES = Object.freeze({
  hold_position: frozen([{}]),
  accompany: frozen([{ person: player }]),
  resume_previous: frozen([{}]),
  sit_here: frozen([{}]),
  approach_and_face: frozen([{ person: player }]),
  leave_scene: frozen([{}]),
  take_cover_and_hold: frozen([{}]),
  scenario_here: frozen(['drink_coffee','smoke','phone','lean','stand_idle','clipboard','binoculars']
    .map(scenario => ({ scenario }))),
  board_vehicle: frozen(['any_passenger','passenger','rear']
    .map(seat => ({ vehicle: playerVehicle, seat }))),
  ride_along: frozen(['any_passenger','passenger','rear'].map(seat => ({ seat }))),
  exit_vehicle_and_hold: frozen([{}]),
  // ACT6 is independently opt-in and requires current native availability.
  go_to_place: frozen([{place:{kind:'waypoint'}}]),
  vehicle_trip: frozen([{place:{kind:'waypoint'}}]),
});
// Backward-compatible primary option. Validation and provider schemas always
// use ACT5_CHOICES, not this first-choice convenience map.
export const ACT5_SLOTS = Object.freeze(Object.fromEntries(
  Object.entries(ACT5_CHOICES).map(([intent, choices]) => [intent, choices[0]])));

const clean = value => String(value || '').trim().toLowerCase()
  .replace(/[’]/g, "'").replace(/[.,!?;:]+/g, ' ')
  .replace(/'/g, '')
  .replace(/\s+/g, ' ').trim();
// Only bounded player imperatives are eligible. Do not make Luna's free-form
// interpretation a source of coordinates, landmarks, or execution authority.
const NAV_VERB = /^(drive us over to|drive us over|drive over to|drive over|drive us to|drive to|take us over to|take us to|take me to|bring us to|get us to|walk over to|walk to|go over to|go to|head over to|head to|head for|head toward) (.+?)( and wait)?$/;
const stripLeadIn = input => {
  let utterance = clean(input);
  // Speech recognition commonly prepends harmless address/politeness words.
  // Allow only a small closed prefix list; never fuzzy-match an interior order.
  utterance = utterance.replace(/^(?:(?:all right|alright|okay|ok|hey|yo|nathan|dude|man|well|so|now|then) ){0,3}/, '');
  utterance = utterance.replace(/^(?:can you|could you|would you|will you|why dont you) /, '');
  utterance = utterance.replace(/^(?:(?:please|just|go ahead and) ){0,2}/, '');
  return utterance;
};
const navigationMatch = input => NAV_VERB.exec(stripLeadIn(input));
const drives = (verb, options) => /^(drive|take|bring|get us)/.test(verb) ||
  verb.startsWith('head ') && options?.actorIsDriver === true && options?.actorInVehicle === true;

// Classify explicit navigation orders even when the destination is unsupported:
// callers must not silently fall back to aimless stock vehicle driving.
// Player-directed seating is a closed, whole-utterance intent. The slot is NOT a
// Luna-authored V### alias: native ACT3 resolves the player's live vehicle and
// revalidates identity, seat availability, and ownership before executing.
export function parseVehicleSeatPlayerRequest(input) {
  const value=stripLeadIn(input).replace(/(?: man| dude| bro| nathan| please)$/,'').trim();
  let seat=null;
  if (/^(?:get|hop|jump) (?:in|into) (?:the )?drivers? seat$/.test(value) ||
      /^(?:take|grab) (?:the )?drivers? seat$/.test(value) ||
      /^(?:get|hop|jump) behind (?:the )?wheel$/.test(value) ||
      /^(?:you drive|you drive this time|hop in and drive|jump in and drive|take the wheel|you get behind the wheel)$/.test(value))
    seat='driver';
  else if (/^(?:get|hop|jump) (?:in|into) (?:the )?(?:front )?passenger seat$/.test(value) ||
           /^(?:take|grab) (?:the )?(?:front )?passenger seat$/.test(value) ||
           /^(?:ride shotgun|call shotgun|sit shotgun)$/.test(value))
    seat='passenger';
  else if (/^(?:get|hop|jump) (?:in|into) (?:the )?(?:back|rear) seat$/.test(value) ||
           /^(?:sit in|take) (?:the )?(?:back|rear) seat$/.test(value))
    seat='rear';
  else if (/^(?:get|hop|jump) in(?:to)? (?:my|the|our) (?:car|vehicle|truck|ride)$/.test(value) ||
           /^(?:get|hop|jump) in$/.test(value))
    seat='any_passenger';
  if(!seat)return null;
  return Object.freeze({intent:'board_vehicle',
    slots:Object.freeze({vehicle:Object.freeze({kind:'player_vehicle'}),seat})});
}

// Diagnostic category only: never emit raw model commands or pretend a
// reference-shaped V### string has passed Essential's live entity validation.
export function vehicleSeatModelCommandKind(command) {
  const value=String(command||'').trim();
  if(!value)return 'none';
  if(/<[^>]+>|\{[^}]+\}|\bVXXX\b/i.test(value))return 'placeholder';
  if(/^DO\s+[A-Za-z][A-Za-z0-9]*\s+V\d{3}$/i.test(value))return 'reference_shaped';
  return 'other';
}

// Pure post-model guard. A direct native ACT3 seat order cannot be replaced by
// an arbitrary DO token or claimed complete just because Luna said it was.
// Tested independently of network, STT, Essential parser and the native runner.
export function reconcileVehicleSeatDecision(decision, seatRequest, reply, {nativeHandoffStarted=false} = {}) {
  if (!seatRequest || reply?.intent!=='board_vehicle')
    return Object.freeze({decision,reason:null,accepted:false});
  if(nativeHandoffStarted)
    throw Object.assign(new TypeError('Seat decision cannot change after audio handoff.'),{code:'vehicle_seat_late_reconciliation'});
  const seat=seatRequest.slots.seat,accepted=reply.kind==='approval_pending';
  const dialogue=accepted
    ? seat==='driver' ? "I'll try to get behind the wheel." :
      seat==='passenger' ? "I'll try the front passenger seat." :
      seat==='rear' ? "I'll try the back seat." : "I'll try to hop in."
    : reply.reason==='seat_occupied' ? "That seat is taken." :
      reply.reason==='vehicle_moving' ? "The car needs to stop before I can get in." :
      reply.reason==='vehicle_unavailable' ? "I can't verify which car to get into." :
      reply.reason==='actor_busy' ? "I'm busy with another activity right now." :
      reply.reason==='seat_change_unavailable' ? "I can't safely change to that seat from here." :
      reply.reason==='vehicle_mismatch' ? "I'm in a different vehicle." :
      reply.reason==='capability_disabled' ? "I can't use the seat-entry controller right now." :
      "I can't safely take that seat right now.";
  return Object.freeze({decision:Object.freeze({...decision,dialogue,command:'',
    ...(Object.hasOwn(decision,'activity')?{activity:null}:{})}),
    reason:accepted?'native_admission_pending':reply.reason||'native_unavailable',
    accepted});
}

export function navigationRequestKind(input, options = {}) {
  const match = navigationMatch(input);
  return match ? (drives(match[1], options) ? 'vehicle_trip' : 'go_to_place') : null;
}

// Native resolution and admission still own all actual destination validation.
// "There" refers to a map waypoint ONLY when the current native inspect
// explicitly confirms an active waypoint. Otherwise ask for a destination.
export function parseAct6PlayerRequest(input, options = {}) {
  const match = navigationMatch(input);
  if (!match) return null;
  const driving = drives(match[1], options);
  if (driving && match[3]) return null;
  const name = match[2].replace(/^(?:the|my|our) /, '');
  const waypoint = ['waypoint','map marker','map waypoint','gps marker','marker','map pin','gps pin'].includes(name) ||
    name === 'there' && options.waypointAvailable === true;
  const target = waypoint ? {kind:'waypoint'} :
    NAV_NAMES.has(name) ? {kind:'named',query:NAV_NAMES.get(name)} : null;
  if (!target) return null;
  const intent = driving ? 'vehicle_trip' : match[3] ? 'move_to_and_hold' : 'go_to_place';
  return Object.freeze({intent,slots:Object.freeze({place:Object.freeze(target)})});
}
const replyKind = (response, intent) => {
  if (NO.has(response) || CANCEL.has(response)) return 'decline';
  if (YES.has(response) || INTENT_YES[intent]?.has(response) === true) return 'approve';
  if ((intent === 'board_vehicle' || intent === 'ride_along') &&
      new Set(['okay get in','ok get in','sure hop in','yeah hop in','yes get in',
        'go ahead get in','hop in','get in','come on in','ride with me']).has(response)) return 'approve';
  if (intent === 'exit_vehicle_and_hold' &&
      new Set(['go ahead get out','okay get out','sure get out','get out and wait']).has(response)) return 'approve';
  if (intent === 'take_cover_and_hold' &&
      new Set(['take cover','yeah take cover','okay take cover','go take cover']).has(response)) return 'approve';
  if (intent === 'scenario_here' &&
      new Set(['have at it','yeah do that','sure do that','okay do that']).has(response)) return 'approve';
  return null;
};
// This is only a read-only advertisement filter, never authorization to act.
// Native inspect supplies fresh booleans; admission still reacquires C-02
// anchors and native preflight after the player's consent.
export function act5WorldAvailable(intent, slots, state) {
  // An explicitly unsafe native owner may not propose any physical activity.
  if (state?.version === 1 && state.safe !== true) return false;
  // Older native installs have no advisory snapshot: retain ACT2's historical
  // checks, but never expose an ACT3 physical offer without native evidence.
  if (intent === 'go_to_place' || intent === 'vehicle_trip' || intent === 'move_to_and_hold') {
    if (state?.version !== 1 || state.safe !== true) return false;
    return intent !== 'vehicle_trip' ? state.actorOnFoot === true :
      state.actorInVehicle === true && state.actorIsDriver === true;
  }
  if (intent === 'sit_here' || intent === 'accompany') {
    if (state?.version !== 1) return true;
    return state.safe === true && state.actorOnFoot === true &&
      (intent !== 'accompany' || state.playerNearby === true);
  }
  if (!['scenario_here','approach_and_face','board_vehicle','ride_along',
        'exit_vehicle_and_hold','leave_scene','take_cover_and_hold'].includes(intent)) return true;
  if (state?.version !== 1 || state.safe !== true) return false;
  if (intent === 'board_vehicle' || intent === 'ride_along') {
    // If already seated, let ACT3 preflight verify the *same anchored car*
    // and exact seat before it returns alreadySatisfied. A seat index alone
    // is never proof the actor occupies the player's vehicle.
    if (state.actorInVehicle === true) {
      // The actor must be in this exact player vehicle; a seat index alone is
      // not an owner/vehicle binding. ACT3 still reacquires the native anchor.
      if (state.vehicleAvailable!==true || state.actorVehicleIsPlayerVehicle!==true) return false;
      const index=state.actorSeatIndex;
      if (slots.seat==='driver' && index===0)
        return state.vehicleStopped===true && state.driverFree===true;
      return (slots.seat==='driver' && index===-1 ||
        slots.seat==='passenger' && index===0 ||
        slots.seat==='rear' && index>=1 ||
        slots.seat==='any_passenger' && index>=0);
    }
    if (state.actorInVehicle !== false || state.vehicleAvailable !== true ||
        state.vehicleStopped !== true) return false;
    if (slots.seat === 'driver') return state.driverFree === true;
    if (slots.seat === 'passenger') return state.frontFree === true;
    if (slots.seat === 'rear') return state.rearFree === true;
    return state.passengerFree === true;
  }
  if (intent === 'exit_vehicle_and_hold') return state.actorInVehicle === true;
  if (intent === 'scenario_here') return state.actorOnFoot === true && state.scenarioReady === true;
  if (intent === 'approach_and_face' || intent === 'leave_scene')
    return state.actorOnFoot === true && state.playerNearby === true;
  if (intent === 'take_cover_and_hold') return state.actorOnFoot === true;
  return false;
}
const keyFor = identity => identity && String(identity.pedId) + ':' + String(identity.sessionNonce);
const sameTurn = (a, b) => a?.pedId === b?.pedId && a?.sessionNonce === b?.sessionNonce &&
  a?.turnId === b?.turnId && a?.generationId === b?.generationId;

export function validateAct5Choice(activity, intents, choices = ACT5_CHOICES) {
  if (activity === null) return true;
  if (!activity || typeof activity !== 'object' || Array.isArray(activity) ||
      Object.keys(activity).sort().join(',') !== 'intent,slots' ||
      !Array.isArray(intents) || !intents.includes(activity.intent) ||
      !Object.hasOwn(choices, activity.intent) ||
      !validateSlots(activity.intent, activity.slots)) return false;
  // Canonical structural equality, independent of object-key ordering.
  const same = (a,b) => Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(k => Object.hasOwn(b,k) &&
      (a[k] && typeof a[k] === 'object'
        ? b[k] && typeof b[k] === 'object' && Object.keys(a[k]).length === Object.keys(b[k]).length &&
          Object.keys(a[k]).every(n => a[k][n] === b[k][n])
        : a[k] === b[k]));
  return Array.isArray(choices?.[activity.intent]) && choices[activity.intent].some(options => same(activity.slots, options));
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
    this.lastOffered = new Map();
    this.lastAccepted = new Map();
    this.seenTurns = new Set();
    this.approvals = new Map();
  }

  #ready() {
    const runtime = this.activities?.client?.runtime;
    const engine = this.activities?.engine;
    // ACT5 suggestions are optional; independently enabled ACT6 player orders
    // still require the same live native connection and owner fences.
    return (engine?.config?.act5 === true || (engine?.config?.act6Capabilities?.length || 0) > 0) &&
      engine.config.mode === 'on' &&
      runtime?.ready === true && engine.hello?.nativeRun === runtime.nativeRun &&
      engine.hello?.adapterEpoch === runtime.adapterEpoch ? runtime : null;
  }

  // Read-only readiness diagnostic. This never grants native capabilities or
  // overrides the authoritative Engine admission and native preflight.
  navigationReadiness(intent) {
    const state=inspectNavigationReadiness(this.activities);
    return (intent === 'vehicle_trip' ? state.drive : state.walk).reason;
  }

  async #owner(turn) {
    const runtime = this.#ready();
    const initialNativeRun = runtime?.nativeRun;
    const initialAdapterEpoch = runtime?.adapterEpoch;
    const initialClientRun = this.activities?.client?.clientRun;
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
          !this.#ready() || this.activities.client.runtime.nativeRun !== initialNativeRun ||
          this.activities.client.runtime.adapterEpoch !== initialAdapterEpoch ||
          this.activities.client.clientRun !== initialClientRun ||
          !sameHostContext(runtime.hostContext, this.activities.client.runtime.hostContext)) return null;
      return {
        binding: { characterId: profile.characterId, ownerAlias: live.ownerAlias,
          ownershipToken: live.ownershipToken, encounterId: live.encounterId,
          incarnationId: live.claim.incarnationId },
        nativeRun: runtime.nativeRun, adapterEpoch: runtime.adapterEpoch,
        hostContext: runtime.hostContext, nativeClientRun: initialClientRun,
        sessionKey: keyFor(turn.identity), activityOffer: live.activityOffer || null,
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
        pending.owner.nativeRun !== owner.nativeRun ||
        pending.owner.adapterEpoch !== owner.adapterEpoch ||
        pending.owner.nativeClientRun !== owner.nativeClientRun ||
        pending.owner.binding.ownershipToken !== owner.binding.ownershipToken ||
        !sameHostContext(pending.owner.hostContext,owner.hostContext))) this.pending.delete(characterId);
    const activityStatus = this.activities.status(characterId);
    const busy = !TERMINAL.has(activityStatus?.status);
    const canOffer = !busy && !this.pending.has(characterId) &&
      (this.cooldown.get(characterId) || 0) <= this.now();
    const lastOffered = this.lastOffered.get(characterId);
    const eligible = this.activities.engine.config.act5 === true
      ? Object.fromEntries(Object.entries(ACT5_CHOICES).map(([intent, options]) => [
      intent, !canOffer || lastOffered?.intent === intent && this.now() - lastOffered.at < REPEAT_INTENT_MS
        ? [] : options.filter(slots => {
        if (!act5WorldAvailable(intent,slots,owner.activityOffer)) return false;
        const spec = planSpec(intent, slots);
        if (!Array.isArray(spec.steps) || !spec.steps.length) return false;
        return spec.steps.every(step => {
          const capability = step.capability;
          const row = this.activities.engine.registry.get(capability);
          if (!row || !['ACT2','ACT3','ACT6'].includes(row.phase)) return false;
          if (row.phase === 'ACT3' &&
              !(this.activities.engine.config.act3Capabilities || []).includes(capability)) return false;
          if (row.phase === 'ACT6' &&
              !(this.activities.engine.config.act6Capabilities || []).includes(capability)) return false;
          return row.allowedSources.includes('player_dialogue') &&
            row.allowedPriority.includes('player_direct') && row.execution.path !== 'none' &&
            this.activities.engine.registry.enabled(capability, {
              mode:'on', hello:this.activities.engine.hello?.capabilities, requested:[capability],
              passedProbes:this.activities.engine.config.passedProbes || [],
              source:'player_dialogue', priority:'player_direct',
            });
        });
      }),
    ])) : {};
    const intents = Object.keys(eligible).filter(intent => eligible[intent].length);
    return Object.freeze({ owner, intents:Object.freeze(intents), activityStatus:activityStatus?.status || 'unknown',
      pendingIntent:this.pending.get(characterId)?.activity.intent || null,
      availableChoices:Object.freeze(Object.fromEntries(intents.map(intent => [
        intent, eligible[intent].map(slots => structuredClone(slots))]))) });
  }

  async publish(turn, decision, context, isCurrent) {
    if (this.activities?.engine?.config?.act5 !== true) return false;
    if (!decision?.activity || !context?.intents?.includes(decision.activity.intent) ||
        !validateAct5Choice(decision.activity, context.intents, context.availableChoices) ||
        !isCurrent?.()) return false;
    const idKey = keyFor(turn.identity) + ':' + turn.identity.turnId + ':' + turn.identity.generationId;
    if (this.seenTurns.has(idKey)) return false;
    const current = await this.#owner(turn);
    if (!current || !isCurrent() || current.binding.characterId !== context.owner.binding.characterId ||
        current.binding.ownershipToken !== context.owner.binding.ownershipToken ||
        current.binding.encounterId !== context.owner.binding.encounterId ||
        current.binding.incarnationId !== context.owner.binding.incarnationId ||
        current.nativeRun !== context.owner.nativeRun ||
        current.adapterEpoch !== context.owner.adapterEpoch ||
        current.nativeClientRun !== context.owner.nativeClientRun ||
        current.sessionKey !== context.owner.sessionKey ||
        !sameHostContext(current.hostContext,context.owner.hostContext) ||
        !act5WorldAvailable(decision.activity.intent,decision.activity.slots,current.activityOffer) ||
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
    this.lastOffered.set(characterId,{ intent:proposal.intent,at:this.now() });
    this.report('act5_proposed', { intent: proposal.intent });
    return true; // Proposal only; no ACT goal or native command.
  }

  async onPlayerInput(turn, input, context, isCurrent) {
    if (!context?.owner || !isCurrent?.()) return null;
    const characterId = context.owner.binding.characterId;
    const response = clean(input);
    const nativeOptions = context.owner.activityOffer || {};
    const request = parseAct6PlayerRequest(response, nativeOptions);
    const navigationIntent = navigationRequestKind(response, nativeOptions);
    const seatRequest = parseVehicleSeatPlayerRequest(response);
    let pending = this.pending.get(characterId);
    // An explicit new order supersedes an unrelated invitation, but "hop in"
    // can still approve the seat choice Nathan offered moments before.
    if (pending && (navigationIntent || seatRequest && replyKind(response,pending.activity.intent)!=='approve')) {
      this.pending.delete(characterId); pending = null;
    }
    if (!pending && NAV_STOP.has(response)) {
      const owner = await this.#owner(turn);
      if (!owner || !isCurrent?.() || owner.binding.characterId !== characterId ||
          owner.binding.encounterId !== context.owner.binding.encounterId ||
          owner.binding.incarnationId !== context.owner.binding.incarnationId ||
          owner.binding.ownershipToken !== context.owner.binding.ownershipToken ||
          owner.nativeRun !== context.owner.nativeRun ||
          owner.adapterEpoch !== context.owner.adapterEpoch ||
          owner.nativeClientRun !== context.owner.nativeClientRun ||
          owner.sessionKey !== context.owner.sessionKey ||
          !sameHostContext(owner.hostContext,context.owner.hostContext)) return null;
      const latest = this.activities.engine.activities.filter(a=>a.actor.characterId === characterId).at(-1);
      if (!latest || TERMINAL.has(latest.status) ||
          latest.actor.encounterId !== owner.binding.encounterId ||
          latest.actor.incarnationId !== owner.binding.incarnationId ||
          latest.actor.ownershipToken !== owner.binding.ownershipToken ||
          !['go_to_place','vehicle_trip','move_to_and_hold'].includes(latest.template) ||
          DRIVE_STOP.has(response) && latest.template !== 'vehicle_trip' ||
          WALK_STOP.has(response) && !['go_to_place','move_to_and_hold'].includes(latest.template)) return null;
      const result = this.activities.cancel(characterId);
      this.report('act6_player_stop',{ok:result?.ok===true,intent:latest.template});
      return Object.freeze({kind:result?.ok?'cancelled':'unavailable',intent:latest.template});
    }
    if (!pending) {
      if (seatRequest) {
        const intent='board_vehicle', seat=seatRequest.slots.seat;
        if (!TERMINAL.has(this.activities.status(characterId)?.status))
          return Object.freeze({kind:'unavailable',intent,reason:'actor_busy',seat});
        // Use the same ACT3 registry, capability probes and player-direct
        // authority as every other physical activity. No stock DO fallback.
        const capability='enter_vehicle_seat';
        const row=this.activities.engine.registry.get(capability);
        if (!this.activities.engine.config.act3Capabilities?.includes(capability) ||
            !row || row.phase!=='ACT3' || !row.allowedSources.includes('player_dialogue') ||
            !row.allowedPriority.includes('player_direct') || row.execution.path==='none' ||
            !this.activities.engine.registry.enabled(capability,{
              mode:'on',hello:this.activities.engine.hello?.capabilities,
              requested:[capability],passedProbes:this.activities.engine.config.passedProbes || [],
              source:'player_dialogue',priority:'player_direct'
            }))
          return Object.freeze({kind:'unavailable',intent,reason:'capability_disabled',seat});
        const owner=await this.#owner(turn);
        if (!owner || !isCurrent?.() ||
            owner.binding.characterId!==characterId ||
            owner.binding.encounterId!==context.owner.binding.encounterId ||
            owner.binding.incarnationId!==context.owner.binding.incarnationId ||
            owner.binding.ownershipToken!==context.owner.binding.ownershipToken ||
            owner.nativeRun!==context.owner.nativeRun ||
            owner.adapterEpoch!==context.owner.adapterEpoch ||
            owner.nativeClientRun!==context.owner.nativeClientRun ||
            owner.sessionKey!==context.owner.sessionKey ||
            !sameHostContext(owner.hostContext,context.owner.hostContext))
          return Object.freeze({kind:'unavailable',intent,reason:'owner_unavailable',seat});
        const native=owner.activityOffer;
        if (!act5WorldAvailable(intent,seatRequest.slots,native)) {
          const reason=native?.safe!==true?'native_unavailable':
            native.actorInVehicle===true && native.actorVehicleIsPlayerVehicle!==true?'vehicle_mismatch':
            native.actorInVehicle===true && seat==='driver' && native.actorSeatIndex===0 && native.vehicleStopped!==true?'vehicle_moving':
            native.actorInVehicle===true && seat==='driver' && native.actorSeatIndex===0 && native.driverFree!==true?'seat_occupied':
            native.actorInVehicle===true?'seat_change_unavailable':
            native.vehicleAvailable!==true?'vehicle_unavailable':
            native.vehicleStopped!==true?'vehicle_moving':
            seat==='driver'&&native.driverFree!==true?'seat_occupied':
            seat==='passenger'&&native.frontFree!==true?'seat_occupied':
            seat==='rear'&&native.rearFree!==true?'seat_occupied':
            seat==='any_passenger'&&native.passengerFree!==true?'seat_occupied':'native_unavailable';
          return Object.freeze({kind:'unavailable',intent,reason,seat});
        }
        const turnKey=keyFor(turn.identity)+':'+turn.identity.turnId+':'+turn.identity.generationId;
        if (this.seenTurns.has(turnKey) || this.approvals.has(turnKey))
          return Object.freeze({kind:'unavailable',intent,reason:'duplicate_turn',seat});
        const now=this.now(),proposed={
          proposalVersion:1,proposalId:this.id(),source:'player_dialogue',
          subject:{characterId},intent,slots:seatRequest.slots,priority:'player_direct',
          origin:{turn:{pedId:String(turn.identity.pedId),sessionNonce:turn.identity.sessionNonce,
            turnId:turn.identity.turnId,generationId:turn.identity.generationId}},
          proposedAtMs:now,
        };
        this.seenTurns.add(turnKey);
        if(this.seenTurns.size>256)this.seenTurns.delete(this.seenTurns.values().next().value);
        this.approvals.set(turnKey,{owner,pending:{activity:seatRequest,proposal:proposed,expiresAt:now+OFFER_MS}});
        if(this.approvals.size>32)this.approvals.delete(this.approvals.keys().next().value);
        this.report('vehicle_seat_staged',{intent,seat});
        return Object.freeze({kind:'approval_pending',intent,seat});
      }
      // This direct-player ACT6 lane still commits only after the existing
      // output_transcript boundary; a native owner is inspected again at commit.
      if (navigationIntent) {
        const intent = request?.intent || navigationIntent;
        const deny = reason => {
          this.report('act6_player_direct_rejected', {intent,code:reason});
          return Object.freeze({kind:'unavailable',intent,reason});
        };
        this.report('act6_player_direct_recognized', {intent,destinationKind:request?.slots?.place?.kind || 'unresolved',
          act5Suggestions:this.activities.engine.config.act5 === true});
        if (!request) return deny('destination_unresolved');
        if (!TERMINAL.has(this.activities.status(characterId)?.status)) return deny('actor_busy');
        const readiness = this.navigationReadiness(intent);
        const needed = intent === 'vehicle_trip' ? 'drive_to' : 'walk_to';
        const row = this.activities.engine.registry.get(needed);
        this.report('act6_player_direct_readiness', {intent,capability:needed,code:readiness || 'ready',
          nativeAdvertised:this.activities.engine.hello?.capabilities?.[needed] === true,
          missingProbeCount:row?.probes?.filter(p=>!this.activities.engine.config.passedProbes?.includes(p)).length || 0,
          act5Suggestions:this.activities.engine.config.act5 === true});
        if (readiness) return deny(readiness);
        const owner=await this.#owner(turn);
        if (!owner || !isCurrent?.() ||
            owner.binding.characterId !== characterId ||
            owner.binding.encounterId !== context.owner.binding.encounterId ||
            owner.binding.incarnationId !== context.owner.binding.incarnationId ||
            owner.binding.ownershipToken !== context.owner.binding.ownershipToken ||
            owner.nativeRun !== context.owner.nativeRun ||
            owner.adapterEpoch !== context.owner.adapterEpoch ||
            owner.nativeClientRun !== context.owner.nativeClientRun ||
            owner.sessionKey !== context.owner.sessionKey ||
            !sameHostContext(owner.hostContext,context.owner.hostContext))
          return deny('owner_unavailable');
        if (request.slots.place?.kind === 'waypoint' && owner.activityOffer?.waypointAvailable === false)
          return deny('place_unresolved');
        if (!act5WorldAvailable(intent,request.slots,owner.activityOffer))
          return deny(intent === 'vehicle_trip' && owner.activityOffer?.safe === true &&
            owner.activityOffer?.actorIsDriver !== true ? 'driver_required' : 'native_unavailable');
        // Deictic "there" never gains a guessed waypoint after a native change.
        const freshRequest=parseAct6PlayerRequest(response,owner.activityOffer);
        if (!freshRequest || JSON.stringify(freshRequest)!==JSON.stringify(request))
          return deny('destination_unresolved');
        const turnKey=keyFor(turn.identity)+':'+turn.identity.turnId+':'+turn.identity.generationId;
        if (this.seenTurns.has(turnKey) || this.approvals.has(turnKey)) return deny('duplicate_turn');
        const now=this.now();
        const proposed={
          proposalVersion:1,proposalId:this.id(),source:'player_dialogue',
          subject:{characterId},intent:request.intent,slots:request.slots,priority:'player_direct',
          origin:{turn:{pedId:String(turn.identity.pedId),sessionNonce:turn.identity.sessionNonce,
            turnId:turn.identity.turnId,generationId:turn.identity.generationId}},
          proposedAtMs:now,
        };
        this.seenTurns.add(turnKey);
        if (this.seenTurns.size>256) this.seenTurns.delete(this.seenTurns.values().next().value);
        this.approvals.set(turnKey,{owner,pending:{activity:request,proposal:proposed,expiresAt:now+OFFER_MS}});
        if (this.approvals.size>32) this.approvals.delete(this.approvals.keys().next().value);
        this.report('act6_player_direct_staged',{intent:request.intent,destinationKind:request.slots.place.kind});
        return Object.freeze({kind:'approval_pending',intent:request.intent});
      }
      if (!CANCEL.has(response)) return null;
      const last = this.lastAccepted.get(characterId);
      if (!last) return null;
      const owner = await this.#owner(turn);
      if (!owner || !isCurrent() || owner.binding.encounterId !== context.owner.binding.encounterId ||
          owner.binding.ownershipToken !== context.owner.binding.ownershipToken ||
          owner.nativeClientRun !== context.owner.nativeClientRun) return null;
      const running = this.activities.engine.activities.find(a => a.activityId === last &&
        a.source === 'player_dialogue' &&
        !['cancelled','failed','completed','superseded','expired','abandoned'].includes(a.status));
      // ActivityEngine.cancel addresses the current activity by CHARACTER, not ID.
      // Never accidentally cancel a later player-UX or stock Essential action.
      if (!running || this.activities.engine.activities.filter(a => a.actor.characterId === characterId).at(-1)?.activityId !== last ||
          owner.binding.ownershipToken !== running.actor.ownershipToken ||
          owner.binding.encounterId !== running.actor.encounterId ||
          owner.binding.incarnationId !== running.actor.incarnationId) return null;
      const result = this.activities.cancel(characterId);
      this.report('act5_cancelled', { ok: result?.ok === true });
      return Object.freeze({ kind: result?.ok ? 'cancelled' : 'unavailable', intent: running.template });
    }
    const answer = replyKind(response,pending.activity.intent);
    if (!answer) return null;
    this.pending.delete(characterId);
    if (answer !== 'approve') {
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
        owner.adapterEpoch !== pending.owner.adapterEpoch ||
        owner.nativeClientRun !== pending.owner.nativeClientRun ||
        !sameHostContext(owner.hostContext,pending.owner.hostContext) ||
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
        current.nativeClientRun !== owner.nativeClientRun ||
        current.sessionKey !== owner.sessionKey ||
        !sameHostContext(current.hostContext,owner.hostContext) ||
        !TERMINAL.has(this.activities.status(characterId).status) ||
        !act5WorldAvailable(pending.activity.intent,pending.activity.slots,current.activityOffer)) {
      this.report('act5_rejected',{reason:'owner_or_activity_changed'});
      return {ok:false,reason:'owner_or_activity_changed'};
    }
    const result = this.activities.engine.assign(pending.proposal,current.binding,{playerApproved:true});
    if (result?.ok) this.lastAccepted.set(characterId,result.activityId);
    if (['go_to_place','vehicle_trip','move_to_and_hold'].includes(pending.activity.intent))
      this.report(result?.ok?'act6_player_direct_admitted':'act6_player_direct_rejected',
        {intent:pending.activity.intent,activityId:result?.activityId,code:result?.reason || 'accepted'});
    this.report(result?.ok?'act5_admitted':'act5_rejected',{intent:pending.activity.intent,reason:result?.reason||null});
    if(pending.activity.intent==='board_vehicle')
      this.report('vehicle_seat_commit',{intent:'board_vehicle',seat:pending.activity.slots?.seat,
        accepted:result?.ok===true,reason:result?.reason||null});
    return result;
  }

  clear() { this.pending.clear(); this.lastAccepted.clear(); this.cooldown.clear(); this.lastOffered.clear(); this.seenTurns.clear(); this.approvals.clear(); }
}
