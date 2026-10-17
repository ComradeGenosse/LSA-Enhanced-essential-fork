// Native owner-fiber scene evidence. The Director describes an opportunity,
// never a fixed line or an invented relationship/memory. Essential/Luna choose
// the words in the NPC's existing character voice.
const SOCIAL_CONTEXT=Object.freeze({
  shared_vehicle_entry:'You and the player have just settled into the same vehicle. Initiate a natural conversation about the new journey.',
  reunion:'You have just rejoined the player after time apart. Greet them naturally in character.',
  shared_idle:'You and the player have spent quiet time together. Start a natural, potentially unrelated conversation.',
  travel:'You and the player are traveling together. Initiate a casual conversation; avoid repetitive destination questions.',
  activity_transition:'A shared activity has changed. Start a natural conversation only if it fits the moment.',
  manual:'The player has invited you to choose a topic. Initiate a natural conversation; do not merely answer a command.',
});
export function renderDirectorSocialContext(proposal) {
  if(proposal?.source!=='native_director_social' ||
     !Object.hasOwn(SOCIAL_CONTEXT,proposal.sceneType))return null;
  const role=proposal.role==='driver'?' You are driving.':
    proposal.role==='passenger'?' You are a passenger.':'';
  const context=SOCIAL_CONTEXT[proposal.sceneType]+role+' Dialogue only; no actions.';
  return context.length<=160&&!/[\r\n\t\0]/.test(context)?context:null;
}
