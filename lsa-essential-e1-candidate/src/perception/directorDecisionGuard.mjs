// Defense-in-depth at the final stock dispatch path for a *natively proven*
// PS6 speech ticket. Prompt-only constraints are never sufficient.
import { isUuid } from '../identity/identityContract.mjs';

export function assertDirectorSpeechDecision(decision, {source, directorTicket, streamMode} = {}) {
  const director = source === 'scene_director' || directorTicket !== undefined;
  if (!director) return true; // preserve all existing E1–E6 stock turns
  if (!directorTicket || directorTicket.schemaVersion !== 1 ||
      !isUuid(directorTicket.ticketId) ||
      directorTicket.dedupeKey !== `ps:${directorTicket.ticketId}` ||
      directorTicket.priority !== 'director_urgent' &&
      directorTicket.priority !== 'director_routine') {
    throw new TypeError('director_ticket_unverified');
  }
  if (decision?.command !== '' || decision?.activityProposal !== undefined ||
      (streamMode && streamMode !== 'dialogue_only')) {
    throw new TypeError('director_speech_effect_forbidden');
  }
  return true;
}
