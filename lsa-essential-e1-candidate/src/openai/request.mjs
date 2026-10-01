import { createHash } from 'node:crypto';
import { parseRetryAfter, providerErrorDetails } from '../reliability/errorClassifier.mjs';

export class ProviderRequestError extends Error {
  constructor(message, { status = 0, code = 'provider_request_failed', providerErrorCode, providerErrorType, retryAfterMs } = {}) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
    this.code = code;
    this.providerErrorCode = providerErrorCode;
    this.providerErrorType = providerErrorType;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function responseFailure(response, label) {
  let details = {};
  try { details = providerErrorDetails(await response.json()); } catch { /* A non-JSON error body is not retry evidence. */ }
  const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
  return new ProviderRequestError(`${label} failed with HTTP ${response.status}.`, {
    status: response.status, ...details, ...(retryAfterMs === null ? {} : { retryAfterMs }),
  });
}

export function endpoint(baseUrl, route) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(route || '').replace(/^\/+/, '');
  if (!base || !suffix) throw new TypeError('Provider endpoint is incomplete.');
  return `${base}/${suffix}`;
}

export async function requestJson({ fetchImpl = globalThis.fetch, url, key, body, signal, timeoutMs = 45_000, telemetry, operation = 'model', model }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('This Node runtime does not provide fetch.');
  if (!String(key || '').trim()) throw new ProviderRequestError('The selected OpenAI credential is missing.', { code: 'missing_credential' });
  const requestAbort = new AbortController();
  const cancel = () => requestAbort.abort(signal?.reason ?? new Error('turn_aborted'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => requestAbort.abort(new Error('request_timeout')), timeoutMs);
  const started = performance.now();
  let spanDone;
  try { spanDone = telemetry?.startSpan(operation, { model }); } catch {}
  try {
    requestAbort.signal.throwIfAborted();
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: requestAbort.signal,
    });
    const requestId = safeRequestId(response.headers?.get?.('x-request-id'));
    telemetry?.event('provider_headers', { operation, httpStatus: response.status, durationMs: performance.now() - started, requestId });
    requestAbort.signal.throwIfAborted();
    if (!response.ok) throw await responseFailure(response, 'OpenAI request');
    try {
      const value = await response.json(); requestAbort.signal.throwIfAborted();
      spanDone?.('finished', { httpStatus: response.status, requestId });
      return value;
    }
    catch { throw new ProviderRequestError('OpenAI returned invalid JSON.', { status: response.status, code: 'invalid_response' }); }
  } catch (error) {
    spanDone?.('failed', { code: safeCode(error?.code), httpStatus: Number.isInteger(error?.status) ? error.status : 0 });
    if (error instanceof ProviderRequestError) throw error;
    if (signal?.aborted) throw new ProviderRequestError('OpenAI request was cancelled.', { code: 'cancelled' });
    if (requestAbort.signal.aborted) throw new ProviderRequestError('OpenAI request timed out.', { code: 'timeout' });
    throw new ProviderRequestError('OpenAI request could not be completed.', { code: 'network_error' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function safeCode(value) { const code = String(value || ''); return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? code : 'provider_request_failed'; }
export function safeRequestId(value) {
  const id = String(value || '');
  return /^req_[A-Za-z0-9_-]{4,128}$/.test(id) ? `rid_${createHash('sha256').update(id).digest('hex').slice(0, 16)}` : undefined;
}

export async function requestBytes({ fetchImpl = globalThis.fetch, url, key, body, signal, timeoutMs = 45_000, onChunk, telemetry, operation = 'tts', model }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('This Node runtime does not provide fetch.');
  if (!String(key || '').trim()) throw new ProviderRequestError('The selected OpenAI credential is missing.', { code: 'missing_credential' });
  const abort = new AbortController();
  const cancel = () => abort.abort(signal?.reason ?? new Error('turn_aborted'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => abort.abort(new Error('request_timeout')), timeoutMs);
  const started = performance.now();
  let spanDone;
  try { spanDone = telemetry?.startSpan(operation, { model }); } catch {}
  let rawBytes = 0;
  let chunks = 0;
  let firstByte = true;
  let bodyReadMs = 0;
  let handoffMs = 0;
  let consumerError = false;
  let requestId;
  try {
    abort.signal.throwIfAborted();
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: abort.signal,
    });
    requestId = safeRequestId(response.headers?.get?.('x-request-id'));
    telemetry?.event('provider_headers', { operation, httpStatus: response.status, durationMs: performance.now() - started, requestId });
    abort.signal.throwIfAborted();
    if (!response.ok) throw await responseFailure(response, 'OpenAI speech request');
    if (!response.body?.getReader) throw new ProviderRequestError('OpenAI speech response has no readable body.', { code: 'empty_body' });
    const reader = response.body.getReader();
    const stopReader = () => { Promise.resolve(reader.cancel(abort.signal.reason)).catch(() => {}); };
    abort.signal.addEventListener('abort', stopReader, { once: true });
    try {
      while (true) {
        abort.signal.throwIfAborted();
        const readStart = performance.now();
        const { done, value } = await reader.read();
        bodyReadMs += performance.now() - readStart;
        abort.signal.throwIfAborted();
        if (done) break;
        if (value?.byteLength) {
          chunks++;
          rawBytes += value.byteLength;
          if (operation === 'tts') telemetry?.audioRaw?.(value.byteLength);
          if (firstByte) { firstByte = false; telemetry?.event('provider_first_byte', { operation, durationMs: performance.now() - started, rawBytes: value.byteLength }); }
          const handoffStart = performance.now();
          try { await onChunk(value); }
          catch (error) { consumerError = true; throw error; }
          handoffMs += performance.now() - handoffStart;
        }
        abort.signal.throwIfAborted();
      }
    } catch (error) {
      try { await reader.cancel(error); } catch { /* Preserve the request failure. */ }
      throw error;
    } finally {
      abort.signal.removeEventListener('abort', stopReader);
      reader.releaseLock?.();
    }
    spanDone?.('finished', { rawBytes, chunks, bodyReadMs, handoffMs, requestId });
  } catch (error) {
    spanDone?.('failed', { rawBytes, chunks, bodyReadMs, handoffMs, code: safeCode(error?.code), httpStatus: Number.isInteger(error?.status) ? error.status : 0 });
    if (error instanceof ProviderRequestError) throw error;
    if (consumerError) throw error;
    if (signal?.aborted) throw new ProviderRequestError('OpenAI speech request was cancelled.', { code: 'cancelled' });
    if (abort.signal.aborted) throw new ProviderRequestError('OpenAI speech request timed out.', { code: 'timeout' });
    throw new ProviderRequestError('OpenAI speech request could not be completed.', { code: 'network_error' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
