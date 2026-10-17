// Closed, whole-utterance driving semantics. This is advisory to Luna and a
// publication guard, not a second vehicle-task or player-intent executor.
const normalize = value => String(value || '').toLowerCase().replace(/[’]/g, "'")
  .replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/^(?:(?:all right|alright|okay|ok|hey|yo|nathan|dude|man|please) ){0,3}/, '')
  .replace(/^(?:can you|could you|would you|will you|just) /, '')
  .replace(/^please /, '');

const phrases = Object.freeze({
  continue: /^(?:keep going|keep on going|keep driving|keep on driving|carry on driving|continue driving|just keep driving|keep rolling|keep moving|go on|carry on)$/,
  speed: /^(?:drive faster|go faster|speed up|pick up the pace|can you drive faster|drive a bit faster|drive slower|slow down|slow down a bit|hurry up|step on it|floor it)$/,
  evasive: /^(?:drive evasively|start driving evasively|drive recklessly|lose the cops|evade the cops)$/,
  normal: /^(?:drive normally|stop driving evasively|drive carefully|drive more carefully)$/,
  start: /^(?:start driving|begin driving|just drive|drive around|let's drive|lets drive|let's go for a drive|lets go for a drive)$/,
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
export function drivingModelGuidance(kind, act6OwnsDrive = false) {
  if (!kind && !act6OwnsDrive) return '';
  const rules = [
    '[PLAYER VEHICLE COMMAND INTERPRETATION]',
    'Starting free driving, continuing an existing driving task, destination navigation, stopping, normal driving and evasive driving are distinct. Never treat a command acknowledgement as observed physical motion or arrival.',
    'Do not use an unverified DO command for precise speed, throttle, acceleration, or steering. Never claim an exact speed change without an observed capability.',
    'Use only the actions currently listed by Essential, with their real prerequisites; ACT6 destination orders are handled by the verified navigation lane, never by free-drive DO.',
  ];
  if (kind === 'continue') rules.push('The player said to CONTINUE, not to drive evasively or issue a fresh BeginDriving task. Do not change driving style or reset a task. If driving status is unverified, do not claim it is moving.');
  if (kind === 'speed') rules.push('The player requested a SPEED change, not evasive/reckless driving. Essential maps faster aliases to evasive mode; do not silently substitute DriveEvasively. Explain the available driving modes and any lack of precise speed control.');
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
    kind === 'speed' ? 'speed_is_not_evasive_mode' :
    kind === 'stop' ? 'stop_must_not_switch_driving_mode' :
    kind === 'start' && ['driveevasively','driveevasive'].includes(action) ? 'start_must_not_be_evasive' :
    kind === 'normal' && ['driveevasively','driveevasive'].includes(action) ? 'normal_must_not_be_evasive' :
    null);
  if (!blocked) return Object.freeze({ decision, blocked: null });
  const dialogue = act6OwnsDrive
    ? "I won't replace the current navigation request with a competing driving mode."
    : kind === 'speed'
      ? "I can't reliably set an exact faster speed. Evasive driving is a separate mode, if that's what you want."
      : kind === 'continue' ? "Got it. I won't reset or change the current driving task."
      : kind === 'stop' ? "I won't issue a new driving command. I'll need the current controller's supported stop action."
      : "I won't switch into evasive driving without that request.";
  return Object.freeze({ decision: { ...decision, command: '', dialogue }, blocked });
}
