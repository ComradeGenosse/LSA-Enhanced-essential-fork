// Contextual ballistics R0: a pure, default-unwired, observer-safe projection.
// This is NOT a source of authority. Only native source-time correlation and
// witness receipts may supply the inputs when later integrated with PS2/PS4.
// Never infer a physical hit, a shooter, intent, or a miss from proximity alone.

export const BALLISTICS_R0_LIMITS = Object.freeze({
  maxEvidence: 16,
  maxCorrelationMs: 1500,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = value => typeof value === 'string' && UUID.test(value);
const tick = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const bodyRegions = new Set(['head', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg']);
const surfaces = new Set(['wall', 'ground', 'vehicle', 'other']);
const directions = new Set(['skyward', 'downward', 'toward_person', 'other']);

/**
 * Candidate PS4 lane item from future native-verified source receipts.
 *
 * `firing` must be an actual `shooting` producer's firing signal with a
 * current C-02 source anchor. `verifiedPlayerCaptureRef` must come from the
 * current native local-player anchor, NOT a character name or caller text.
 * `witness` must be the exact PS2 source-time receipt for this firing signal.
 * Each `evidence` row must be separately native-confirmed and joined to the
 * ORIGINAL firing signal, shooter anchor, and native game-tick window.
 *
 * This standalone module does not authenticate these facts and is deliberately
 * not connected to the production model, PS3, or Director until that seam exists.
 */
export function projectContextualBallistics({firing, witness, evidence = [], verifiedPlayerCaptureRef} = {}) {
  if (!firing || firing.producer !== 'shooting' || firing.kind !== 'firing' ||
      !uuid(firing.signalId) || !uuid(firing.sourceCaptureRef) || !tick(firing.gameTick) ||
      !witness || witness.status !== 'witnessed' || !uuid(witness.observerCaptureRef) ||
      witness.firingSignalId !== firing.signalId || witness.sampledGameTick !== firing.gameTick ||
      !['visual', 'auditory'].includes(witness.channel) ||
      !Array.isArray(evidence) || evidence.length > BALLISTICS_R0_LIMITS.maxEvidence ||
      (verifiedPlayerCaptureRef != null && !uuid(verifiedPlayerCaptureRef))) return null;

  const seesShooter = witness.channel === 'visual' && witness.knowsSource === true;
  const shooter = seesShooter && verifiedPlayerCaptureRef
    ? firing.sourceCaptureRef === verifiedPlayerCaptureRef ? 'player' : 'another_person'
    : 'unidentified';
  const item = {
    event: 'gunfire_context',
    witnessedAs: witness.channel === 'visual' ? 'seen' : 'heard',
    shooter,
    // One sampled firing transition is not the number of rounds fired.
    impact: Object.freeze({kind: 'unconfirmed'}),
  };

  if (witness.channel !== 'visual') return Object.freeze(item);

  const correlated = evidence.filter(row => row &&
    uuid(row.evidenceId) && row.firingSignalId === firing.signalId &&
    row.sourceCaptureRef === firing.sourceCaptureRef && tick(row.gameTick) &&
    ((row.gameTick - firing.gameTick) >>> 0) <= BALLISTICS_R0_LIMITS.maxCorrelationMs);

  // Native damage callback attribution is not a visual NPC witness receipt.
  // Never reveal unseen victim information or body parts to this observer.
  const visibleImpact = witness.sawImpact === true && witness.knowsTarget === true;
  if (visibleImpact) {
    const damage = correlated.find(row => row.kind === 'ped_damage' &&
      row.proof === 'native_damage_callback' && row.classification === 'bullet' &&
      uuid(row.targetCaptureRef));
    if (damage) {
      const region = damage.boneVerified === true && bodyRegions.has(damage.bodyRegion)
        ? {bodyRegion: damage.bodyRegion} : {};
      item.impact = Object.freeze({kind: 'person_hit', ...region});
      return Object.freeze(item);
    }
    const surface = correlated.find(row => row.kind === 'world_impact' &&
      row.proof === 'native_impact' && surfaces.has(row.surface));
    if (surface) {
      item.impact = Object.freeze({kind: 'surface_hit', surface: surface.surface});
      return Object.freeze(item);
    }
  }

  // A verified aim/trajectory estimate is NOT a verified bullet impact or intent.
  if (seesShooter && witness.sawDirection === true) {
    const direction = correlated.find(row => row.kind === 'trajectory' &&
      row.proof === 'native_geometry_sample' && directions.has(row.direction));
    if (direction) item.trajectory = direction.direction;
  }
  return Object.freeze(item);
}


// Only a verified bullet-damage callback may be causally associated with
// a separately witnessed firing event. Both observations must belong to
// this exact observer, attacker, native adapter run and bounded game-tick
// window. Native target sight is still required independently.
export function witnessedBulletAttribution({signal,receipt,priorFiring,nativeRun,nowMonotonicMs}={}) {
  if(signal?.kind!=='damage' || signal.producer!=='ped_damage' ||
     signal.facts?.classification!=='bullet' || !uuid(signal.source) ||
     !uuid(signal.target) || !tick(signal.gameTick) ||
     receipt?.status!=='witnessed' || receipt.evidence?.channel!=='visual' ||
     receipt.knowsTarget!==true || !uuid(receipt.observer?.captureRef) ||
     !priorFiring || priorFiring.nativeRun!==nativeRun ||
     priorFiring.observer!==receipt.observer.captureRef ||
     priorFiring.shooter!==signal.source ||
     !tick(priorFiring.gameTick) ||
     !Number.isSafeInteger(nowMonotonicMs) ||
     !Number.isSafeInteger(priorFiring.monotonicMs) ||
     nowMonotonicMs<priorFiring.monotonicMs ||
     nowMonotonicMs-priorFiring.monotonicMs>750 ||
     ((signal.gameTick-priorFiring.gameTick)>>>0)>750)
    return false;
  return true;
}
