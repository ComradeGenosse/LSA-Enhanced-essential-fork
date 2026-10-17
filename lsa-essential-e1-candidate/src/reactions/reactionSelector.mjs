import { REACTION_SOURCES } from './reactionCatalog.mjs';

// Pure, deterministic, offline reaction selection.
//
// Input is the NPC's own validated spoken line plus a few facts about the turn.
// It deliberately never reads the player's words: a player asking for a facepalm
// must not produce one, and an insult from the player is not an NPC emotion.
// No network, no model, no randomness. "none" is the expected answer; a
// reaction needs a strong cue (weight 2) or two independent weak cues (1 + 1),
// and any quoting, negation, reported speech, playfulness or competing cue
// falls back to "none".

export const SELECTION_THRESHOLD = 2;
const MAX_SCANNED_CHARS = 400;

const FACEPALM_CUES = Object.freeze([
  { id: 'kidding_me', weight: 2, re: /\b(?:are you|you(?:'re| are)|you(?:'ve| have) got to be) (?:seriously |really |actually )?(?:kidding|joking)(?: me)?\b/ },
  { id: 'cant_be_serious', weight: 2, re: /\byou (?:can(?:'t|not)|cannot) (?:possibly )?be (?:serious|real|that (?:dumb|stupid))\b/ },
  { id: 'are_you_serious', weight: 2, re: /\bare you (?:seriously |actually |even )?(?:serious|insane|out of your mind|for real|that (?:dumb|stupid)|this (?:dumb|stupid))\b/ },
  { id: 'for_sake', weight: 2, re: /\bfor (?:fuck'?s|fucking|god'?s|christ'?s|pete'?s|heaven'?s) sake\b/ },
  { id: 'crying_out_loud', weight: 2, re: /\bfor crying out loud\b/ },
  { id: 'jesus_christ', weight: 2, re: /\bjesus(?: fucking| freaking)? christ\b/ },
  { id: 'what_wrong_with_you', weight: 2, re: /\bwhat(?:'s| is) wrong with you\b/ },
  { id: 'how_dumb', weight: 2, re: /\bhow (?:stupid|dumb|dense) (?:are|can) you\b/ },
  { id: 'dumbest', weight: 1, re: /\b(?:dumbest|stupidest) (?:thing|idea|question|plan)\b/ },
  { id: 'cant_believe', weight: 1, re: /\bi (?:can(?:'t|not)|cannot) (?:even )?believe (?:you|this|that|i'm)\b/ },
  { id: 'unbelievable', weight: 1, re: /\bunbelievable\b/ },
  { id: 'give_me_a_break', weight: 1, re: /\bgive me a break\b/ },
  { id: 'oh_brother', weight: 1, re: /\boh,? (?:brother|boy|come on|please)\b/ },
  { id: 'ugh', weight: 1, re: /\bu+gh+\b/ },
  { id: 'seriously', weight: 1, re: /\bseriously\s*[?!]/ },
]);

const MIDDLE_FINGER_CUES = Object.freeze([
  { id: 'fuck_you', weight: 2, re: /\bfuck (?:you|off|yourself)\b/ },
  { id: 'go_fuck', weight: 2, re: /\bgo (?:fuck yourself|screw yourself|to hell)\b/ },
  { id: 'screw_you', weight: 2, re: /\b(?:screw|sod) (?:you|off)\b/ },
  { id: 'piss_off', weight: 2, re: /\bpiss off\b/ },
  { id: 'kiss_my_ass', weight: 2, re: /\bkiss my (?:ass|arse)\b/ },
  { id: 'up_yours', weight: 2, re: /\bup yours\b/ },
  { id: 'eat_shit', weight: 2, re: /\beat (?:shit|a dick)\b/ },
  { id: 'get_lost', weight: 1, re: /\bget (?:the fuck )?(?:lost|out of (?:my|here))\b/ },
  { id: 'shut_up', weight: 1, re: /\bshut (?:the fuck |your fucking )?up\b/ },
  { id: 'drop_dead', weight: 1, re: /\bdrop dead\b/ },
  { id: 'leave_me_alone', weight: 1, re: /\bleave me (?:the fuck )?alone\b/ },
]);

// Words shortly before a cue that make the cue quoted, negated or reported
// instead of performed ("I would never tell you to fuck off").
const QUALIFIER = /\b(?:don'?t|do not|didn'?t|never|won'?t|wouldn'?t|couldn'?t|can'?t|cannot|not|no one|nobody|stop|quit|why would|how dare|said|says|say|saying|told|tell|asked|ask|called|calls|call|word|words|phrase|means?|meant|like)\b/;
const PLAYFUL = /\b(?:ha(?:ha)+|lol|lmao|hehe|just (?:kidding|joking)|i'?m (?:just )?(?:kidding|joking)|jk)\b/;
const GUARD_WINDOW = 36;

function normalize(text) {
  return String(text)
    .slice(0, MAX_SCANNED_CHARS)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_~`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quotedOrQualified(text, index, kind) {
  const window = text.slice(Math.max(0, index - GUARD_WINDOW), index);
  if (/"\s*$/.test(window)) return true;
  // Negation and reported speech only count inside the same sentence.
  const before = window.slice(Math.max(window.lastIndexOf('.'), window.lastIndexOf('!'), window.lastIndexOf('?'), window.lastIndexOf(';')) + 1);
  if (QUALIFIER.test(before)) return true;
  // A question about the phrase ("did he say fuck you?") is not a performance.
  if (kind === 'middle_finger' && /\?/.test(text.slice(index, index + 40))) return true;
  return false;
}

function scan(text, cues, kind) {
  const hits = new Set();
  let score = 0;
  for (const cue of cues) {
    const global = new RegExp(cue.re.source, 'g');
    for (const match of text.matchAll(global)) {
      if (hits.has(cue.id)) break;
      if (quotedOrQualified(text, match.index, kind)) continue;
      hits.add(cue.id);
      score += cue.weight;
    }
  }
  return { score, hits: [...hits] };
}

export function selectReaction({ dialogue, command = '', actionCount = 0, source = 'player_text' } = {}) {
  const none = reason => ({ reaction: 'none', reason, score: 0, cues: [] });
  if (!REACTION_SOURCES.includes(String(source))) return none('source_not_player');
  if ((typeof command === 'string' && command.trim() !== '') || (Number.isFinite(actionCount) && actionCount > 0)) {
    return none('has_command');
  }
  if (typeof dialogue !== 'string' || dialogue.trim() === '') return none('no_dialogue');
  const text = normalize(dialogue);
  if (text.length === 0) return none('no_dialogue');
  if (PLAYFUL.test(text)) return none('playful');

  const facepalm = scan(text, FACEPALM_CUES, 'facepalm');
  const finger = scan(text, MIDDLE_FINGER_CUES, 'middle_finger');
  const facepalmOk = facepalm.score >= SELECTION_THRESHOLD;
  const fingerOk = finger.score >= SELECTION_THRESHOLD;
  if (facepalmOk && fingerOk) return { reaction: 'none', reason: 'ambiguous', score: 0, cues: [] };
  if (facepalmOk) return { reaction: 'facepalm', reason: 'cue', score: facepalm.score, cues: facepalm.hits };
  if (fingerOk) return { reaction: 'middle_finger', reason: 'cue', score: finger.score, cues: finger.hits };
  return none(facepalm.score > 0 || finger.score > 0 ? 'weak_cue' : 'no_cue');
}
