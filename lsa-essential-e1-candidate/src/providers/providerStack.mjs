import { assertProvider } from './providerContract.mjs';
import { createOpenAIReasoningProvider } from './openai/reasoningProvider.mjs';
import { createOpenAITranscriptionProvider } from './openai/transcriptionProvider.mjs';
import { createOpenAISpeechProvider } from './openai/speechProvider.mjs';

export function createProviderStack(config, { fetchImpl = globalThis.fetch, providers = {} } = {}) {
  if (config?.provider !== 'openai') throw new TypeError('The E1 provider stack only serves the OpenAI route.');
  const reasoning = assertProvider(providers.reasoning || createOpenAIReasoningProvider({ config, fetchImpl }), { operation: 'decide', requiredCapabilities: ['cancellation', 'strictDecisionParsing'] });
  const transcription = assertProvider(providers.transcription || createOpenAITranscriptionProvider({ config, fetchImpl }), { operation: 'transcribe', requiredCapabilities: ['cancellation', 'pcm16MonoInput'] });
  const speech = assertProvider(providers.speech || createOpenAISpeechProvider({ config, fetchImpl }), { operation: 'synthesize', requiredCapabilities: ['cancellation', 'awaitedPcmCallback'] });
  if (config.structuredStreamingEnabled && (typeof reasoning.decideStreaming !== 'function' || reasoning.capabilities.structuredStreaming !== true)) {
    throw new TypeError(`Provider ${reasoning.id} does not support the enabled structured streaming contract.`);
  }
  if (speech.capabilities.outputFormat !== 'pcm_s16le_mono_24000') throw new TypeError(`Provider ${speech.id} does not implement the E1 PCM output contract.`);

  return Object.freeze({
    reasoning,
    transcription,
    speech,
    decide: input => reasoning.decide(input),
    decideStreaming: input => reasoning.decideStreaming(input),
    transcribe: input => transcription.transcribe(input),
    speak: input => speech.synthesize(input),
  });
}
