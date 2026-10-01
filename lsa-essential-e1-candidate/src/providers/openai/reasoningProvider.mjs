import { decide } from '../../openai/decide.mjs';
import { assertOperationInput } from '../providerContract.mjs';

export function createOpenAIReasoningProvider({ config, fetchImpl = globalThis.fetch }) {
  return Object.freeze({
    id: 'openai.reasoning',
    capabilities: Object.freeze({ cancellation: true, immutableInput: true, strictDecisionParsing: true }),
    decide(input) {
      assertOperationInput(input, 'reasoning');
      return decide({ ...input, config, fetchImpl });
    },
  });
}
