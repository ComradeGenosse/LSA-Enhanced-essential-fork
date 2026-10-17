import { REACTION_MODES } from './reactionCatalog.mjs';

const PIPE_NAME = /^[A-Za-z0-9_.-]{1,80}$/;

// `reactions.mode` is off by default. "shadow" selects and reports what would
// happen; the native side decides whether anything is actually animated, and
// only its own `reactions.mode: "on"` ever mutates a ped.
export function normalizeReactionConfig(value) {
  const valid = value && typeof value === 'object' && !Array.isArray(value);
  const mode = valid && REACTION_MODES.includes(value.mode) ? value.mode : 'off';
  const pipeName = valid && typeof value.pipeName === 'string' && PIPE_NAME.test(value.pipeName)
    ? value.pipeName : 'LSA.Reactions.v1';
  return Object.freeze({ mode, pipeName });
}
