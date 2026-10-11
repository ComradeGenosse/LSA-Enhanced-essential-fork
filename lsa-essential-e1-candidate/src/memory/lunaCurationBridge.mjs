// Optional Essential seam; no live hooks or billable requests on import.
// Reuse E1's existing reasoning transport, key/base URL and Luna model selection.
import { requestJson } from '../openai/request.mjs';
import { createLunaCurationAdapter } from '../../../lsa-shared-brain/src/memory/lunaCurator.mjs';
export function createEssentialLunaCurator(config,{fetchImpl=globalThis.fetch}={}){
  if(config?.provider!=='openai')throw new Error('curation_requires_existing_openai_provider');
  return createLunaCurationAdapter({config,requestJson:args=>requestJson({...args,fetchImpl})});
}
