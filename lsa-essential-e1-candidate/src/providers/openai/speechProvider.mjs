import { speak } from '../../openai/speak.mjs';
import { assertOperationInput } from '../providerContract.mjs';

export function createOpenAISpeechProvider({ config, fetchImpl = globalThis.fetch }) {
  return Object.freeze({
    id: 'openai.speech',
    capabilities: Object.freeze({
      cancellation: true, immutableInput: true, awaitedPcmCallback: true,
      outputFormat: 'pcm_s16le_mono_24000', voices: config.speechVoices,
      instructions: config.speechInstructionsSupported, speed: true,
    }),
    synthesize(input) {
      assertOperationInput(input, 'speech');
      return speak({ ...input, config, fetchImpl });
    },
  });
}
