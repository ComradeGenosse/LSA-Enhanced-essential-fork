const DIRECT_RADIO_PATTERNS = Object.freeze([
  /\bwhat(?:'s| is) (?:this|that|the) (?:song|track|music)\b/i,
  /\bwhat(?:'s| is) playing\b/i,
  /\bwhat(?:'s| is) on (?:the )?radio\b/i,
  /\bwhat (?:radio )?station (?:is this|is that|are we listening to|is playing)\b/i,
  /\bwho (?:sings|is singing|performs|performed) (?:this|that|it|the song|the track)\b/i,
  /\b(?:song|track|music|radio|station|artist)\b[^?!.]{0,80}\b(?:playing|called|name|hear|hearing|listening to|this|that)\b/i,
  /\b(?:do you|can you) (?:know|recognize|hear|identify) (?:this|that|the) (?:song|track|music)\b/i,
]);

const safeLine = value => typeof value === 'string' && value.length > 0 && value.length <= 240 &&
  !/[\u0000-\u001f\u007f]/.test(value) && !value.includes('\n') && !value.includes('\r');

export function radioTurnRelevant(input) {
  const text = String(input || '').trim().slice(0, 12_000);
  if (!text) return false;
  return DIRECT_RADIO_PATTERNS.some(pattern => pattern.test(text));
}

export function currentConversationObserver(runtime) {
  if (!runtime?.anchors || typeof runtime.current !== 'function') return null;
  const matches = [...runtime.anchors.values()].filter(anchor =>
    anchor?.kind === 'ped' && anchor.observer === true && anchor.conversation === true &&
    typeof anchor.captureRef === 'string' && runtime.current(anchor.captureRef));
  return matches.length === 1 ? matches[0].captureRef : null;
}

export function latestRadioObservation(runtime, observerRef) {
  if (!observerRef || !runtime?.observations?.entries) return null;
  let selected = null;
  for (const entry of runtime.observations.entries.values()) {
    const observation = entry?.value;
    if (!observation || observation.eventType !== 'radio_heard' || observation.observer?.captureRef !== observerRef) continue;
    if (observation.expiresAtMonotonicMs <= runtime.now()) continue;
    if (!selected || observation.observedAt.gameTick > selected.observedAt.gameTick ||
        observation.observedAt.gameTick === selected.observedAt.gameTick && observation.revision > selected.revision) selected = observation;
  }
  return selected;
}

export function renderRadioContext(observation) {
  if (!observation || observation.eventType !== 'radio_heard') return null;
  const claim = observation.claims?.find(item =>
    item?.kind === 'sound' && item.certainty === 'supported' &&
    item.evidence?.channel === 'auditory' && item.details?.soundType === 'radio');
  if (!claim) return null;
  const details = claim.details;
  const station = safeLine(details.stationName) ? details.stationName : '';
  if (details.trackKnown === true && details.contentKind === 'music' && safeLine(details.title) && safeLine(details.artist)) {
    const title = JSON.stringify(details.title);
    return station
      ? `Audible environment: the vehicle radio is playing ${title} by ${details.artist} on ${station}.`
      : `Audible environment: the vehicle radio is playing ${title} by ${details.artist}.`;
  }
  if (details.trackKnown === true && details.contentKind === 'commercial' && safeLine(details.title)) {
    const title = JSON.stringify(details.title);
    return station
      ? `Audible environment: a commercial titled ${title} is playing on ${station}.`
      : `Audible environment: a commercial titled ${title} is playing on the vehicle radio.`;
  }
  return station
    ? `Audible environment: ${station} is playing; the current radio content is not identified.`
    : 'Audible environment: the vehicle radio is playing; the current radio content is not identified.';
}

export function selectRadioContext(runtime, input) {
  if (!radioTurnRelevant(input)) return null;
  const observerRef = currentConversationObserver(runtime);
  if (!observerRef) return null;
  const observation = latestRadioObservation(runtime, observerRef);
  if (!observation) return null;
  const player = [...runtime.anchors.values()].find(anchor => anchor.kind === 'player' && runtime.current(anchor.captureRef))?.captureRef ?? null;
  const decision = runtime.salience.evaluate(observation, {
    nowMonotonicMs: runtime.now(),
    lifetimeCurrent: runtime.current(observerRef),
    channelHealthy: Boolean(runtime.epoch),
    perceptionSupported: true,
    playerCaptureRef: player,
    activity: 'unknown',
    requestedEnvironmentChannels: ['radio'],
  });
  if (!decision || decision.context !== 'candidate' || decision.response !== 'none' || decision.memory !== 'none') return null;
  const text = renderRadioContext(observation);
  if (!text) return null;
  return Object.freeze({
    kind: 'radio',
    text,
    observationId: observation.observationId,
    revision: observation.revision,
    decisionKey: decision.decisionKey,
  });
}
