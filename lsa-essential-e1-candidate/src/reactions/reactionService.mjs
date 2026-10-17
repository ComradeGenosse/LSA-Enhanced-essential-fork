import { REACTION_SOURCES } from './reactionCatalog.mjs';
import { selectReaction, deliveryAllows } from './reactionSelector.mjs';
import { DELIVERY_VALUES } from '../voice/emotion/deliveryContract.mjs';

// Per-turn glue between a validated NPC line and the native reaction pipe.
//
// - Selection is the pure deterministic selector; there is no model call, no
//   new request and no change to Luna's {dialogue, command} output.
// - A frame is sent at most once per turn, and only after BOTH the line has been
//   validated AND Essential reported that this exact turn's audio really began
//   playing. A line that fails validation, is rejected, is cancelled or never
//   plays therefore never produces a frame.
// - The turn's trusted speech-delivery value (ElevenLabs/Luna intent already
//   resolved elsewhere) can only veto a gesture whose tone it contradicts.
// - Every method is best effort: nothing here can delay, fail or alter a turn.
// - Reports carry the reaction name and a reason code only, never line text.

const TERMINAL_EVENTS = new Set(['playback_ended', 'audio_turn_rejected', 'interrupt', 'cancel', 'fail']);

export function createReactionService({ config, client, report = null } = {}) {
  if (!config || config.mode === 'off' || !client) return null;
  const counters = { turns: 0, selected: 0, none: 0, sent: 0, dropped: 0, vetoed: 0 };
  const enabled = Object.freeze([...(config.enabled ?? [])]);
  const emit = (type, data) => { try { report?.(type, data); } catch { /* telemetry only */ } };

  return {
    mode: config.mode,
    counters: () => ({ ...counters }),
    openTurn({ identity, source, signal = null, isCurrent = () => true } = {}) {
      if (!identity || !REACTION_SOURCES.includes(String(source))) return null;
      counters.turns += 1;
      let selection = null; let started = false; let ended = false; let sent = false; let released = false; let deliveryValue = null;

      const maybeSend = () => {
        if (sent || released || ended || !started || !selection || selection.reaction === 'none') return;
        if (signal?.aborted || !isCurrent()) return;
        sent = true;
        if (!deliveryAllows(selection.reaction, deliveryValue)) {
          counters.vetoed += 1;
          emit('reaction_dropped', { reaction: selection.reaction, reason: 'delivery_veto', delivery: deliveryValue });
          return;
        }
        const ok = client.send({
          reaction: selection.reaction,
          tuple: { pedId: identity.pedId, turnId: identity.turnId, generationId: identity.generationId },
        });
        if (ok) { counters.sent += 1; emit('reaction_sent', { reaction: selection.reaction }); }
        else { counters.dropped += 1; emit('reaction_dropped', { reaction: selection.reaction, reason: 'channel_not_ready' }); }
      };

      return {
        validated({ dialogue, command, actionCount } = {}) {
          if (selection || released) return;
          try { selection = selectReaction({ dialogue, command, actionCount, source, enabled }); }
          catch { selection = { reaction: 'none', reason: 'selector_error', score: 0, cues: [] }; }
          if (selection.reaction === 'none') { counters.none += 1; return; }
          counters.selected += 1;
          emit('reaction_selected', { reaction: selection.reaction, reason: selection.reason, score: selection.score });
          maybeSend();
        },
        // First trusted delivery value of the turn (a validated enum, never text).
        delivery(value) {
          if (released || deliveryValue !== null) return;
          if (typeof value === 'string' && DELIVERY_VALUES.includes(value)) deliveryValue = value;
        },
        native(event) {
          if (released || !event || typeof event.type !== 'string') return;
          if (event.type === 'playback_started') { started = true; maybeSend(); return; }
          if (TERMINAL_EVENTS.has(event.type)) ended = true;
        },
        release() { released = true; },
      };
    },
  };
}
