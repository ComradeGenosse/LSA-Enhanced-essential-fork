import { buildRequest, extractResponseText, parseDecisionJson } from '../context/essentialDecision.mjs';
import { endpoint, requestJson } from './request.mjs';

export async function decide({ config, context, input, history, signal, timeoutMs = config.providerWorkDeadlineMs ?? config.turnDeadlineMs, source, fetchImpl = globalThis.fetch, telemetry }) {
  const body = buildRequest({
    model: config.reasoningModel,
    effort: config.reasoningEffort,
    systemInstruction: context.systemInstruction,
    actor: context.actor,
    listener: context.listener,
    world: context.world,
    contextText: context.contextText,
    internalEvent: context.internalEvent,
    source: source || context.source,
    input,
    history,
    maxOutputTokens: config.maxOutputTokens,
  });
  const response = await requestJson({
    fetchImpl,
    url: endpoint(config.reasoningBaseUrl, 'responses'),
    key: config.reasoningKey,
    body,
    signal,
    timeoutMs,
    telemetry,
    operation: 'model',
    model: config.reasoningModel,
  });
  const usage = response?.usage;
  if (usage && typeof usage === 'object') {
    const details = usage.input_tokens_details || {};
    const outputDetails = usage.output_tokens_details || {};
    telemetry?.event('model_usage', {
      inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
      outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
      totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
      cachedInputTokens: Number.isFinite(details.cached_tokens) ? details.cached_tokens : null,
      reasoningTokens: Number.isFinite(outputDetails.reasoning_tokens) ? outputDetails.reasoning_tokens : null,
      model: typeof response.model === 'string' ? response.model : config.reasoningModel,
    });
  } else telemetry?.event('model_usage', { outcome: 'unknown' });
  return parseDecisionJson(extractResponseText(response));
}
