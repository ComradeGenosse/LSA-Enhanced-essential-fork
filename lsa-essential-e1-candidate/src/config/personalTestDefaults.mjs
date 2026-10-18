// Personal fork test convenience. Applied to disk-loaded configs only, so unit-test
// normalization, protocol validation and immutable runtime ownership guards are unchanged.
// To restore explicit per-feature settings, set "personalTestMode": false in the JSON.
// "on" here requests a capability; it never forges native evidence, ACT probe
// outcomes, player authorization, cloud consent or physical completion.
import {MEMORY_K_CAPABILITIES} from '../memory/capabilityPolicy.mjs';
import {M7_LUNA_STANDARD_UPPER_BOUND,M7_PRICING_SOURCE_URL} from '../../../lsa-shared-brain/src/memory/m7Consent.mjs';

// Explicitly approved for this personal mod: stored experience summaries may
// be sent to the existing OpenAI Luna API, within these caps, off-turn only.
// The source-provenance, verified-native-idle and atomic SQLite budget fences
// are still mandatory. No extra editor click or per-session login is required.
export const PERSONAL_M7_BUDGET=Object.freeze({dailyUsd:5,monthlyUsd:50,maxBatchUsd:1});
export const PERSONAL_M7_PRICING=Object.freeze({
  ...M7_LUNA_STANDARD_UPPER_BOUND,source:'operator_verified',
  // Verified against the official OpenAI standard pricing table on 2026-10-18.
  // The existing 30-day stale-price guard still applies; do not fabricate refreshes.
  verifiedAtUtc:'2026-10-18T12:00:00.000Z',
  officialPricingUrl:M7_PRICING_SOURCE_URL,pricingTier:'standard',
});
export function shouldApplyPersonalTestDefaults(configPath,input={}) {
  // Unit-test fixtures commonly load /tmp/config.json; do not silently
  // override their explicit off/test scenarios. Real e1.config.json is the
  // personal game entrypoint, and alternative paths may opt in explicitly.
  return input.personalTestMode===true ||
    (input.personalTestMode!==false &&
      /(?:^|[/\\])e1\.config\.json$/i.test(configPath??''));
}

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
      cloudCuration:{...memoryK.cloudCuration,
        pricing:memoryK.cloudCuration?.pricing??PERSONAL_M7_PRICING,
        // The user's prior approval is captured durably in P2 at first
        // eligible startup; a withdrawn approval is never restored.
        personalApproval:PERSONAL_M7_BUDGET},
      capabilities:{...memoryK.capabilities,...memoryOn}},
    ...(input.speechProvider==='elevenlabs'?{
      expressiveDelivery:{...expressive,mode:'experimental',lunaDeliveryVersion:1},
      actingEnabled:true
    }:{})
  };
}
