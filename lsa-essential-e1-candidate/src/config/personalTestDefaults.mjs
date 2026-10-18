// Personal fork test convenience. Applied to disk-loaded configs only, so unit-test
// normalization, protocol validation and immutable runtime ownership guards are unchanged.
// To restore explicit per-feature settings, set "personalTestMode": false in the JSON.
// "on" here requests a capability; it never forges native evidence, ACT probe
// outcomes, player authorization, cloud consent or physical completion.
import {MEMORY_K_CAPABILITIES} from '../memory/capabilityPolicy.mjs';

const memoryOn=Object.freeze(Object.fromEntries(MEMORY_K_CAPABILITIES
  .filter(row=>row.kind!=='prerequisite'&&row.support==='conditional'&&row.modes.includes('on'))
  .map(row=>[row.id,'on'])));
const act3ForTesting=Object.freeze([
  'stop_and_face','approach_person','walk_away_from','exit_vehicle',
  'enter_vehicle_seat','scenario_here','take_cover','begin_driving',
  'grab_item','clear_held_item',
]);

export function applyPersonalTestDefaults(input={}) {
  if(input.personalTestMode===false)return input;
  const memoryK=input.memoryK??{};
  const activities=input.activities??{};
  const reactions=input.reactions??{};
  const expressive=input.expressiveDelivery??{};
  return {
    ...input,
    intelligence:{...input.intelligence,mode:'shadow',radio:'shadow'},
    spontaneousSpeech:{...input.spontaneousSpeech,mode:'experimental',preset:input.spontaneousSpeech?.preset??'normal'},
    dialogueKnowledge:{...input.dialogueKnowledge,mode:'active',activityFacts:'active',dialogueReceipts:'active'},
    activities:{...activities,mode:'on',act5:true,dialogueReceipts:true,
      // Preserve operator probe records. This intentionally does NOT invent "passed" probes.
      act3Capabilities:[...new Set([...(activities.act3Capabilities??[]),...act3ForTesting])],
      act6Capabilities:[...new Set([...(activities.act6Capabilities??[]),'walk_to','drive_to'])]},
    reactions:{...reactions,mode:'on',
      enabled:[...new Set([...(reactions.enabled??[]),'nod','shrug'])]},
    memoryK:{...memoryK,
      // No auto-consent or fake price attestation. M7 remains blocked until
      // an existing explicit P2 approval and verified pricing are available.
      capabilities:{...memoryK.capabilities,...memoryOn}},
    ...(input.speechProvider==='elevenlabs'?{
      expressiveDelivery:{...expressive,mode:'experimental',lunaDeliveryVersion:1},
      actingEnabled:true
    }:{})
  };
}
