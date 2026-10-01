import { transcribePcm } from '../../openai/transcribe.mjs';
import { assertOperationInput } from '../providerContract.mjs';

export function createOpenAITranscriptionProvider({ config, fetchImpl = globalThis.fetch }) {
  return Object.freeze({
    id: 'openai.transcription',
    capabilities: Object.freeze({ cancellation: true, immutableInput: true, pcm16MonoInput: true }),
    transcribe(input) {
      assertOperationInput(input, 'transcription');
      return transcribePcm({ ...input, config, fetchImpl });
    },
  });
}
