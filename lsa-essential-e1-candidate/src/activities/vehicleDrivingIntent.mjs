// Closed, whole-utterance driving semantics. This is advisory to Luna and a
// publication guard, not a second vehicle-task or player-intent executor.
const normalize = value => String(value || '').toLowerCase().replace(/[’]/g, "'")
  .replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()
  // Discourse/polite address must be at the beginning; never scan a story for
  // a command embedded somewhere in the sentence.
  .replace(/^(?:(?:all right|alright|okay|ok|hey|yo|nathan|dude|man|bro|come on|c'mon|cmon|well|yeah|yep|please) ){0,5}/, '')
  .replace(/^(?:(?:can you|could you|would you|will you|why don't you|just|please) ){0,3}/, '')
  .replace(/^(?:(?:come on|c'mon|cmon|please) ){0,2}/, '')
  .replace(/(?: man| dude| bro| nathan| please)$/,'')
  .trim();

const phrases = Object.freeze({
  continue: /^(?:keep going|keep on going|keep driving|keep on driving|carry on driving|continue driving|just keep driving|keep rolling|keep moving|go on|carry on|don't stop driving|do not stop driving|keep it going)(?: now)?$/,
  speed_up: /^(?:drive faster|go faster|speed up|speed it up|pick up speed|pick up the speed|pick up the pace|drive a bit faster|drive a little faster|hurry up|step on it|floor it)(?: now)?$/,
  slow_down: /^(?:drive slower|go slower|slow down|slow it down|slow down a bit|take it slower|take it easy)(?: now)?$/,
  evasive: /^(?:drive evasively|start driving evasively|drive recklessly|lose the cops|evade the cops)$/,
  normal: /^(?:drive normally|stop driving evasively|drive carefully|drive more carefully)$/,
  start: /^(?:start driving|begin driving|just drive|drive around|let's drive|lets drive|let's go for a drive|lets go for a drive|get us moving|get moving)$/,
  stop: /^(?:stop driving|stop the car|pull over|stop the vehicle|stop driving now)$/,
});
export function drivingIntentKind(input) {
  const value = normalize(input);
  for (const [kind,pattern] of Object.entries(phrases)) if (pattern.test(value)) return kind;
  return null; // navigation and open-ended remarks are handled elsewhere
}
const STOCK_DRIVING = new Set(['begindriving','startdriving','driveevasively','driveevasive',
  'drivenormally','stopdrivingevasively']);
export function stockDrivingCommand(command) {
  const match = /^DO\s*:?[ \t]*([a-z]+)/i.exec(String(command || '').trim());
  return match && STOCK_DRIVING.has(match[1].toLowerCase()) ? match[1].toLowerCase() : null;
}
export function activeAct6Driving(state, binding = null) {
  if (binding && (state?.characterId !== binding.characterId ||
    state?.encounterId !== binding.encounterId ||
    state?.incarnationId !== binding.incarnationId)) return false;
  return state?.stateVersion === 1 && state.intent === 'vehicle_trip' &&
    ['admitting','resolving','preflighting','running','holding','paused','resuming'].includes(state.status);
}
// ACT5 owner.binding intentionally omits the runtime hostContext. Restore the
// separately authenticated context before calling the existing owner-fenced
// activity-state API; never trust an unscoped/retired activity.
export function liveAct6Driving(activities, owner) {
  if (!owner?.binding || !owner?.hostContext || !activities?.stateForCharacter) return false;
  const binding = { ...owner.binding, hostContext: owner.hostContext };
  try {
    const state = activities.stateForCharacter(binding);
    return activeAct6Driving(state, binding) &&
      state?.hostContext?.hostContextVersion === binding.hostContext.hostContextVersion &&
      state?.hostContext?.hostRunId === binding.hostContext.hostRunId &&
      state?.hostContext?.worldEpoch === binding.hostContext.worldEpoch;
  } catch { return false; }
}

export function drivingModelGuidance(kind, act6OwnsDrive = false) {
  if (!kind && !act6OwnsDrive) return '';
  const rules = [
    '[PLAYER VEHICLE COMMAND INTERPRETATION]',
    'Starting free driving, continuing an existing driving task, destination navigation, stopping, normal driving and evasive driving are distinct. Never treat a command acknowledgement as observed physical motion or arrival.',
    'Do not use an unverified DO command for precise speed, throttle, acceleration, or steering. Never claim an exact speed change without an observed capability.',
    'Use only the actions currently listed by Essential, with their real prerequisites; ACT6 destination orders are handled by the verified navigation lane, never by free-drive DO.',
  ];
  if (kind === 'continue') rules.push('The player said to CONTINUE, not to drive evasively or issue a fresh BeginDriving task. Do not change driving style or reset a task. If driving status is unverified, do not claim it is moving.');
  if (kind === 'speed_up') rules.push('Essential has a supported faster-driving behavior: DriveEvasively. Its stock drivefaster/gofaster/speedup aliases intentionally select that mode. When DriveEvasively is currently available for this verified NPC driver and ACT6 does not own the drive, issue the stock DO DriveEvasively command for the requested faster driving. This changes driving style rather than setting an exact numeric speed; do not refuse just because exact speed is unsupported, but never promise a specific speed or physical success without evidence.');
  if (kind === 'slow_down') rules.push('The player wants to slow down. Never use DriveEvasively. If the current driver can execute Essential\'s normal-driving action, use that stock mode. Otherwise state that precise speed control is unavailable.');
  if (kind === 'evasive') rules.push('The player explicitly requested EVASIVE driving. Only offer/issue DriveEvasively if it is in the current action allowlist, the actor is the driver, and ACT6 does not own the trip.');
  if (kind === 'start') rules.push('The player requested to START free driving, not destination navigation. BeginDriving requires a verified NPC driver and available stock action. The handler result is not physical movement.');
  if (kind === 'normal') rules.push('The player requested NORMAL/careful driving, not evasive driving. Use only an actually available normal-mode action, or explain that limitation.');
  if (kind === 'stop') rules.push('The player requested to STOP, not start a new drive or switch to evasive. Stop an ACT6 trip only through its owned cancel path; do not invent a stock stop command.');
  if (act6OwnsDrive) rules.push('The ACT6 vehicle trip currently owns the driving request. Do not issue competing stock BeginDriving or driving-style DO actions, or claim arrival.');
  return '\n' + rules.join('\n');
}

// Last line of defense before Essential sees the transcript. A conflicting
// command is removed, not converted into another physical operation.
export function reconcileDrivingDecision(decision, { kind = null, act6OwnsDrive = false } = {}) {
  const action = stockDrivingCommand(decision?.command);
  const blocked = action && (
    act6OwnsDrive ? 'act6_owns_drive' :
    kind === 'continue' ? 'continuation_must_not_reset_task' :
    kind === 'speed_up' && !['driveevasively','driveevasive'].includes(action) ? 'speed_up_requires_essential_faster_mode' :
    kind === 'slow_down' && !['drivenormally','stopdrivingevasively'].includes(action) ? 'slow_down_requires_normal_mode' :
    kind === 'stop' ? 'stop_must_not_switch_driving_mode' :
    kind === 'start' && ['driveevasively','driveevasive'].includes(action) ? 'start_must_not_be_evasive' :
    kind === 'normal' && ['driveevasively','driveevasive'].includes(action) ? 'normal_must_not_be_evasive' :
    null);
  if (!blocked) return Object.freeze({ decision, blocked: null });
  const dialogue = act6OwnsDrive
    ? "I won't replace the current navigation request with a competing driving mode."
    : kind === 'speed_up'
      ? "I can use Essential's faster driving mode if it's available, but I can't set an exact speed."
      : kind === 'slow_down'
        ? "I'll use normal driving if the controller supports it; I can't set an exact speed."
      : kind === 'continue' ? "Got it. I won't reset or change the current driving task."
      : kind === 'stop' ? "I won't issue a new driving command. I'll need the current controller's supported stop action."
      : "I won't switch into evasive driving without that request.";
  return Object.freeze({ decision: { ...decision, command: '', dialogue }, blocked });
}
