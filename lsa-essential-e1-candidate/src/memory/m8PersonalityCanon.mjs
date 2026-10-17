// Memory K L: derive the structured input the existing M8 evaluator reads from
// the editor-approved P2 profile personality.
//
// P2 stores personality as {description, traits[]} only; the profile schema
// rejects any other key. M8's evaluateM8() reads structured fields (humor style,
// caution, loyalty, ...). Passing the P2 object straight through therefore left
// every NPC on the M8 defaults, so two NPCs could never interpret the same facts
// differently.
//
// This is deliberately NOT a personality system: it is a closed, exact-match
// vocabulary over the approved trait strings. Free-text `description`, model
// output and relationship guesses are never parsed, and an unrecognized trait is
// ignored. Canon is read, never written.
const norm=value=>typeof value==='string'?value.trim().toLowerCase():'';

const STYLES=Object.freeze(['goofy','sarcastic','dry','dark','wholesome']);
const INTERESTS=Object.freeze(['cars','music','food','travel']);
// trait -> [field, value]. The first trait listed in the profile wins per field.
const SCALARS=Object.freeze({
  teasing:['teasing',.7],
  cautious:['caution',.85],reckless:['caution',.15],
  loyal:['loyalty',.9],
  nostalgic:['nostalgia',.9],
  bold:['bravado',.85],timid:['bravado',.15],
});

export const M8_PERSONALITY_TRAITS=Object.freeze([...STYLES,...INTERESTS,...Object.keys(SCALARS)]);

/** @param personality the P2 profile `personality` ({description,traits}) */
export function m8PersonalityFromCanon(personality){
  const traits=Array.isArray(personality?.traits)?personality.traits.map(norm):[];
  const out={},interests=[];
  for(const trait of traits){
    if(STYLES.includes(trait)){out.humor??={};out.humor.style??=trait;}
    else if(INTERESTS.includes(trait)){if(!interests.includes(trait))interests.push(trait);}
    else if(Object.hasOwn(SCALARS,trait)){
      const [field,value]=SCALARS[trait];
      if(field==='teasing'){out.humor??={};out.humor.teasing??=value;}
      else out[field]??=value;
    }
  }
  if(interests.length)out.interests=interests;
  return Object.freeze(out);
}
