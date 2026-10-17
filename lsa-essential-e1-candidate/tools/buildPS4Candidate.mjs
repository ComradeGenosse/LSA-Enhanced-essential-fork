// Build the exact native add-on first, then seal the candidate with its
// verified PS4 source/binary manifest. No unverified runtime capability grant.
import {buildCharactersAddon} from './buildCharactersAddon.mjs';
import {buildCandidate} from './buildCandidate.mjs';

const native=await buildCharactersAddon({
  rphReferencePath:process.env.LSA_IDENTITY_RPH_REFERENCE,
  frameworkReferenceRoot:process.env.LSA_IDENTITY_FRAMEWORK_ROOT,
  damageReferencePath:process.env.LSA_INTELLIGENCE_DAMAGE_REFERENCE,
  rnuiReferencePath:process.env.LSA_RNUI_REFERENCE,
  dotnetPath:process.env.LSA_BUILD_DOTNET||'dotnet',
});
const candidate=await buildCandidate({
  nativePayloadPath:native.target,
  sourcePath:process.env.LSA_E1_SOURCE||undefined,
});
if(candidate.manifest.dialogueKnowledgeContract?.available!==true)
  throw new Error('ps4_verified_native_payload_unavailable');
console.log(JSON.stringify({
  candidate: candidate.target,
  native: native.target,
  dialogueKnowledge: candidate.manifest.dialogueKnowledgeContract,
},null,2));
