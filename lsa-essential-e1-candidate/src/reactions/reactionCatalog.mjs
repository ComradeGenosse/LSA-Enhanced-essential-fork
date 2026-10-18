// Closed catalog of cosmetic conversation reactions (default-off feature).
//
// The wire carries only these names. Animation dictionaries, clips, durations and
// flags live in the native executor (native/reactions/ReactionCatalog.cs) and are
// never chosen by the model or by this process. Adding a reaction means adding a
// name here, a cue policy in reactionSelector.mjs, and a verified native entry.
//
// Facial-only expressions are intentionally absent: no GTA Enhanced facial clip
// has been verified, and Essential's lip-sync (and the planned mouth-animation
// work in PR #198) own the face. See docs/plans/npc-gestures-findings.md.
export const REACTION_NAMES = Object.freeze(['facepalm', 'middle_finger', 'nod', 'shrug']);

// Reactions that never run unless BOTH this process (reactions.enabled) and the
// native host (reactions.enabled) list them. They are head-adjacent and their
// clips are unverified on GTA Enhanced, so they are opt-in one by one.
export const OPT_IN_REACTION_NAMES = Object.freeze(['nod', 'shrug']);

const NAME_SET = new Set(REACTION_NAMES);

export function isReactionName(value) {
  return typeof value === 'string' && NAME_SET.has(value);
}

export const REACTION_MODES = Object.freeze(['off', 'shadow', 'on']);

// Only these Essential turn sources may react. Scene-director, special-event,
// NPC-to-NPC and exact-speech lines never gesture.
export const REACTION_SOURCES = Object.freeze(['player_text', 'player_mic']);
