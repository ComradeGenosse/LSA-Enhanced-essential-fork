const VISUAL_RANGE = Object.freeze({ firing: 50, injury: 35, death_seen: 35, action_observed: 35, location_changed: 35, activity_changed: 35, vehicle_transition: 40, character_present: 60 });
const AUDITORY_RANGE = Object.freeze({ gunshot: 60, siren: 60, speech: 12, impact: 25 });
const finite = n => Number.isFinite(n) && n >= 0;
const known = v => v !== undefined && v !== null && v !== 'unknown';

// Evaluates only source-time evidence supplied by the checked native adapter.
// Missing geometry never becomes a positive visual or auditory claim.
export function evaluateWitness({ event, observer, sample, source, target }) {
  if (!event || !observer || !sample || !Number.isSafeInteger(sample.gameTick) || sample.gameTick < 0 || sample.gameTick > 0xffffffff) return result('unknown', 'invalid_sample');

  if (event.kind === 'damage' || event.kind === 'death' || event.kind === 'firing') {
    const involved = event.targetCaptureRef && event.targetCaptureRef === observer.captureRef || event.kind === 'firing' && event.sourceCaptureRef === observer.captureRef;
    if (involved) return result('witnessed', 'self', { channel: 'self', basis: event.basis === 'native_callback' ? 'native_callback' : 'sampled_state', sampledGameTick: sample.gameTick });
  }

  const visualLimit = VISUAL_RANGE[event.kind];
  if (visualLimit !== undefined) {
    if (!finite(sample.distanceMeters) || !known(sample.sameInterior) || !known(sample.occlusion) || !known(sample.facing)) return result('unknown', 'visual_evidence_incomplete');
    if (sample.distanceMeters > visualLimit) return result('did_not_witness', 'visual_out_of_range');
    if (sample.sameInterior !== true) return result('did_not_witness', 'different_interior');
    if (sample.occlusion !== 'clear') return sample.occlusion === 'blocked' ? result('did_not_witness', 'visual_blocked') : result('unknown', 'visual_occlusion_unknown');
    if (sample.facing !== 'in_cone' && event.kind !== 'death_seen') return result('did_not_witness', 'outside_visual_cone');
    return result('witnessed', 'visual', { channel: 'visual', basis: 'sampled_state', sampledGameTick: sample.gameTick });
  }

  const soundKind = event.soundKind;
  const limit = AUDITORY_RANGE[soundKind];
  if (limit === undefined) return result('unknown', 'no_verified_witness_rule');
  if (sample.soundSourceVerified !== true) return result('unknown', 'sound_source_unverified');
  if (!finite(sample.distanceMeters) || !known(sample.sameAcousticSpace) || !known(sample.sourceVehicle) || !known(sample.observerVehicle)) return result('unknown', 'auditory_evidence_incomplete');
  const radius = sample.sourceVehicle === 'enclosed' || sample.observerVehicle === 'enclosed' ? limit / 2 : limit;
  if (sample.sameAcousticSpace !== true) return result('did_not_witness', 'acoustic_space_blocked');
  if (sample.distanceMeters > radius) return result('did_not_witness', 'auditory_out_of_range');
  if (sample.acousticPath !== 'clear') return sample.acousticPath === 'blocked' ? result('did_not_witness', 'acoustic_path_blocked') : result('unknown', 'acoustic_path_unknown');
  return result('witnessed', 'auditory', { channel: 'auditory', basis: 'audibility_model', sampledGameTick: sample.gameTick });
}

export function reportEvidence({ speakerCaptureRef, observerCaptureRef, sampledGameTick, reportRef }) {
  if (!speakerCaptureRef || !observerCaptureRef || !Number.isSafeInteger(sampledGameTick) || sampledGameTick < 0 || sampledGameTick > 0xffffffff || !reportRef) return result('unknown', 'report_evidence_incomplete');
  if (speakerCaptureRef === observerCaptureRef) return result('unknown', 'self_report_not_hearsay');
  return result('reported', 'dialogue_report', { channel: 'report', basis: 'dialogue_report', sampledGameTick, reportRef });
}

function result(status, reason, evidence = null) { return Object.freeze({ status, reason, evidence }); }

export const WITNESS_RULES = Object.freeze({ visualRangeMeters: VISUAL_RANGE, auditoryRangeMeters: AUDITORY_RANGE, maxVisualConeDegrees: 120 });
