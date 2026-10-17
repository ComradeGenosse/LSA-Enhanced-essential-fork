// Native owner-fiber scene evidence. The Director describes an opportunity,
// never a fixed line or an invented relationship/memory. Essential/Luna choose
// the words in the NPC's existing character voice.
const SOCIAL_CONTEXT=Object.freeze({
  shared_vehicle_entry:'You and the player have just boarded together. Start a natural conversation about the trip.',
  reunion:'You have just rejoined the player after time apart. Greet them naturally in character.',
  shared_idle:'You and the player have spent quiet time together. Start a natural, potentially unrelated conversation.',
  travel:'You are traveling together. Start a casual conversation without repeating known plans.',
  activity_transition:'A shared activity has changed. Start a natural conversation only if it fits the moment.',
  manual:'The player has invited you to choose a topic. Initiate a natural conversation; do not merely answer a command.',
  personal_curiosity:'Spend time chatting naturally. Share a thought or joke, or ask a question. Only use verified past facts.',
});
export function renderDirectorSocialContext(proposal) {
  if(proposal?.source!=='native_director_social' ||
     !Object.hasOwn(SOCIAL_CONTEXT,proposal.sceneType))return null;
  const role=proposal.role==='driver'?' You are driving.':
    proposal.role==='passenger'?' You are a passenger.':'';
  const context=SOCIAL_CONTEXT[proposal.sceneType]+role+' Dialogue only; no actions.';
  return context.length<=160&&!/[\r\n\t\0]/.test(context)?context:null;
}
