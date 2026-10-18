import { REACTION_MODES, OPT_IN_REACTION_NAMES } from './reactionCatalog.mjs';

const PIPE_NAME = /^[A-Za-z0-9_.-]{1,80}$/;

// `reactions.mode` is off by default. "shadow" selects and reports what would
// happen; the native side decides whether anything is actually animated, and
// only its own `reactions.mode: "on"` ever mutates a ped.
export function normalizeReactionConfig(value) {
  const valid = value && typeof value === 'object' && !Array.isArray(value);
  const mode = valid && REACTION_MODES.includes(value.mode) ? value.mode : 'off';
  const pipeName = valid && typeof value.pipeName === 'string' && PIPE_NAME.test(value.pipeName)
    ? value.pipeName : 'LSA.Reactions.v1';
  // Opt-in reactions (nod, shrug) must be listed here AND in the native config.
  const enabled = valid && Array.isArray(value.enabled)
    ? Object.freeze([...new Set(value.enabled.filter(name => OPT_IN_REACTION_NAMES.includes(name)))])
    : Object.freeze([]);
  return Object.freeze({ mode, pipeName, enabled });
}
