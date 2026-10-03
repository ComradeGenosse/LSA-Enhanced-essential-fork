import { ProviderRequestError, endpoint, responseFailure, safeRequestId } from './request.mjs';
import { createSegmentDecoder } from './segmentDecoder.mjs';

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

export const segmentedDecisionSchema = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['mode', 'segments', 'command'],
  properties: {
    mode: { type: 'string', enum: ['dialogue_only', 'buffered_action'] },
    segments: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['text'],
        properties: { text: { type: 'string' } },
      },
    },
    command: { type: 'string' },
  },
});

// Emits only complete segment objects after local schema and text validation.
// The original JSON object remains buffered and is strictly reconciled at EOF.
export async function streamDecision({
  config, body, signal, timeoutMs = config.providerWorkDeadlineMs, fetchImpl = globalThis.fetch,
  telemetry, onSegment = () => {}, dialogueAttempt, maxSegments = 6, maxSegmentChars = 240, maxDialogueChars = 1200,
}) {
  if (!String(config.reasoningKey || '').trim()) throw new ProviderRequestError('The selected OpenAI credential is missing.', { code: 'missing_credential' });
  const decoder = createSegmentDecoder({ maxSegments, maxSegmentChars, maxDialogueChars });
  const streamStartedAt = performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || new Error('turn_aborted'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs);
  const started = performance.now();
  let spanDone;
  try { spanDone = telemetry?.startSpan('model', { model: config.reasoningModel }); } catch {}
  let requestId;
  try {
    controller.signal.throwIfAborted();
    try { dialogueAttempt?.request(body); } catch {}
    const response = await fetchImpl(endpoint(config.reasoningBaseUrl, 'responses'), {
      method: 'POST',
      headers: { authorization: `Bearer ${config.reasoningKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }), signal: controller.signal,
    });
    requestId = safeRequestId(response.headers?.get?.('x-request-id'));
    telemetry?.event('provider_headers', { operation: 'model', httpStatus: response.status, durationMs: performance.now() - started, requestId });
    if (!response.ok) throw await responseFailure(response, 'OpenAI streaming decision');
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/event-stream')) throw new ProviderRequestError('OpenAI returned an unexpected streaming response.', { code: 'invalid_response' });
    if (!response.body?.getReader) throw new ProviderRequestError('OpenAI returned no streaming response body.', { code: 'empty_body' });

    let outputIndex = null;
    let outputItemId = null;
    let responseId = null;
    let terminal = null;
    let sawDelta = false;
    for await (const event of readSse(response.body, controller.signal)) {
      let data;
      try { data = JSON.parse(event.data); }
      catch { throw new ProviderRequestError('OpenAI returned a malformed streaming event.', { code: 'invalid_response' }); }
      const type = String(data?.type || event.event || '');
      if (type === 'response.output_item.added') {
        const item = data.item;
        if (item?.type === 'reasoning') continue;
        if (item?.type !== 'message' || item?.role !== 'assistant' || !Number.isInteger(data.output_index)) {
          throw new ProviderRequestError('OpenAI returned an unsupported decision output item.', { code: 'invalid_response' });
        }
        if (outputIndex !== null && outputIndex !== data.output_index) throw new ProviderRequestError('OpenAI returned multiple decision messages.', { code: 'invalid_response' });
        outputIndex = data.output_index;
        outputItemId = typeof item.id === 'string' ? item.id : outputItemId;
      } else if (type === 'response.output_item.done') {
        const item = data.item;
        if (item?.type === 'reasoning') continue;
        if (item?.type !== 'message' || item?.role !== 'assistant' || data.output_index !== outputIndex ||
            (outputItemId && item.id !== outputItemId)) throw new ProviderRequestError('OpenAI completed an unexpected decision output item.', { code: 'invalid_response' });
      } else if (type === 'response.created' || type === 'response.in_progress') {
        const id = data.response?.id;
        if (typeof id === 'string') {
          if (responseId && responseId !== id) throw new ProviderRequestError('OpenAI changed the response identity mid-stream.', { code: 'invalid_response' });
          responseId = id;
        }
      } else if (type === 'response.content_part.added' || type === 'response.content_part.done') {
        if (data.part?.type === 'refusal') throw new ProviderRequestError('Luna refused the request.', { code: 'model_refusal' });
        if (data.part?.type && data.part.type !== 'output_text') throw new ProviderRequestError('OpenAI returned an unsupported decision content part.', { code: 'invalid_response' });
      } else if (type === 'response.output_text.delta') {
        if (outputIndex === null || data.output_index !== outputIndex || !outputItemId || data.item_id !== outputItemId) throw new ProviderRequestError('OpenAI changed the decision message identity.', { code: 'invalid_response' });
        if (typeof data.delta !== 'string') throw new ProviderRequestError('OpenAI returned a malformed text delta.', { code: 'invalid_response' });
        try { dialogueAttempt?.appendDelta(data.delta); } catch {}
        if (!sawDelta) { sawDelta = true; telemetry?.event('model_first_content_delta', { durationMs: performance.now() - streamStartedAt }); }
        let segments;
        try {
          decoder.append(data.delta);
          segments = decoder.takeNewSegments();
        } catch (error) {
          if (error instanceof ProviderRequestError) throw error;
          throw new ProviderRequestError('OpenAI streamed an invalid structured decision.', { code: 'invalid_response' });
        }
        for (const segment of segments) {
          try { dialogueAttempt?.segment({ sequence: segment.sequence, text: segment.text, mode: decoder.mode }); } catch {}
          telemetry?.event('stream_segment_validated', {
            segmentSequence: segment.sequence, segmentChars: segment.text.length,
            durationMs: performance.now() - streamStartedAt,
          });
          try { await onSegment(segment, decoder.mode); }
          catch (error) {
            if (signal?.aborted) throw new ProviderRequestError('OpenAI streaming decision was cancelled.', { code: 'cancelled' });
            if (error instanceof ProviderRequestError) throw error;
            // A local delivery failure must not masquerade as malformed model output.
            throw new ProviderRequestError('The structured dialogue segment could not be delivered.', { code: 'segment_delivery_failed' });
          }
        }
      } else if (type === 'response.output_text.done') {
        if (data.output_index !== outputIndex || data.item_id !== outputItemId || data.text !== decoder.text) {
          throw new ProviderRequestError('OpenAI completed text did not match its streamed deltas.', { code: 'invalid_response' });
        }
      } else if (type === 'response.refusal.delta' || type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
        if (type === 'response.refusal.delta' && typeof data.delta === 'string') {
          try { dialogueAttempt?.outputText(data.delta, { responseKind: 'refusal' }); } catch {}
        }
        throw new ProviderRequestError(type === 'response.refusal.delta' ? 'Luna refused the request.' : 'OpenAI streaming decision did not complete.', {
          code: type === 'response.refusal.delta' ? 'model_refusal' : type === 'response.incomplete' ? 'incomplete_response' : 'invalid_response',
        });
      } else if (type === 'response.completed') {
        terminal = data.response;
        break;
      } else if (type.startsWith('response.output_') || type.startsWith('response.refusal.')) {
        throw new ProviderRequestError('OpenAI returned an unsupported decision event.', { code: 'invalid_response' });
      }
    }
    controller.signal.throwIfAborted();
    if (!terminal || terminal.status !== 'completed' || terminal.error) throw new ProviderRequestError('OpenAI stream ended without a completed response.', { code: 'incomplete_response' });
    if (responseId && terminal.id !== responseId) throw new ProviderRequestError('OpenAI completed a different response than the streamed response.', { code: 'invalid_response' });
    const output = Array.isArray(terminal.output) ? terminal.output : [];
    const messages = output.filter(item => item?.type === 'message' && item?.role === 'assistant');
    if (messages.length !== 1) throw new ProviderRequestError('OpenAI completed response did not contain exactly one assistant decision.', { code: 'invalid_response' });
    if (outputIndex === null || messages[0].id !== outputItemId) throw new ProviderRequestError('OpenAI completed response did not match the streamed decision item.', { code: 'invalid_response' });
    if (messages[0].status && messages[0].status !== 'completed') throw new ProviderRequestError('OpenAI assistant decision item did not complete.', { code: 'incomplete_response' });
    const contents = messages[0].content || [];
    if (contents.some(part => part?.type === 'refusal')) throw new ProviderRequestError('Luna refused the request.', { code: 'model_refusal' });
    const terminalText = contents.filter(part => part?.type === 'output_text').map(part => part.text).join('');
    try { dialogueAttempt?.outputText(terminalText, { responseKind: 'terminal_output_text' }); } catch {}
    if (!terminalText || terminalText !== decoder.text) throw new ProviderRequestError('OpenAI stream text did not match its completed response.', { code: 'invalid_response' });
    let result;
    try { result = decoder.finish(); }
    catch { throw new ProviderRequestError('OpenAI completed an invalid structured decision.', { code: 'invalid_response' }); }
    telemetry?.event('model_usage', {
      inputTokens: Number.isFinite(terminal.usage?.input_tokens) ? terminal.usage.input_tokens : null,
      outputTokens: Number.isFinite(terminal.usage?.output_tokens) ? terminal.usage.output_tokens : null,
      totalTokens: Number.isFinite(terminal.usage?.total_tokens) ? terminal.usage.total_tokens : null,
      model: typeof terminal.model === 'string' ? terminal.model : config.reasoningModel,
    });
    spanDone?.('finished', { httpStatus: response.status, requestId });
    return result;
  } catch (error) {
    spanDone?.('failed', { code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'provider_request_failed' });
    if (error instanceof ProviderRequestError) throw error;
    if (signal?.aborted) throw new ProviderRequestError('OpenAI streaming decision was cancelled.', { code: 'cancelled' });
    if (controller.signal.aborted) throw new ProviderRequestError('OpenAI streaming decision timed out.', { code: 'timeout' });
    throw new ProviderRequestError('OpenAI streaming decision could not be completed.', { code: 'network_error' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function* readSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventBytes = 0;
  let responseBytes = 0;
  let streamDone = false;
  let fields = [];
  const cancel = () => { Promise.resolve(reader.cancel(signal.reason)).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) { streamDone = true; break; }
      responseBytes += value?.byteLength || 0;
      if (responseBytes > MAX_RESPONSE_BYTES) throw new ProviderRequestError('OpenAI streaming response exceeded its size limit.', { code: 'response_too_large' });
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n/.exec(buffer))) {
        const line = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        eventBytes += boundary[0].length + Buffer.byteLength(line);
        if (eventBytes > MAX_EVENT_BYTES) throw new ProviderRequestError('OpenAI streaming event exceeded its size limit.', { code: 'response_too_large' });
        if (!line) {
          const data = fields.filter(field => field.startsWith('data:')).map(field => field.slice(5).replace(/^ /, '')).join('\n');
          const event = fields.find(field => field.startsWith('event:'))?.slice(6).trim() || '';
          fields = []; eventBytes = 0;
          if (data) yield { event, data };
        } else if (!line.startsWith(':')) fields.push(line);
      }
      if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) throw new ProviderRequestError('OpenAI streaming event exceeded its size limit.', { code: 'response_too_large' });
    }
    buffer += decoder.decode();
    if (buffer || fields.length) {
      const lines = [...fields, ...buffer.split(/\r?\n/)];
      const data = lines.filter(field => field.startsWith('data:')).map(field => field.slice(5).replace(/^ /, '')).join('\n');
      if (data) yield { event: lines.find(field => field.startsWith('event:'))?.slice(6).trim() || '', data };
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!streamDone) { try { await reader.cancel(); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}
