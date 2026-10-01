import { abortableDelay } from './abortableDelay.mjs';
import { classifyProviderFailure } from './errorClassifier.mjs';
import { retryPolicyDecision } from './retryPolicy.mjs';

export class ProviderAttemptError extends Error {
  constructor(message, { code = 'provider_attempt_failed' } = {}) { super(message); this.name = 'ProviderAttemptError'; this.code = code; }
}

function guardedTelemetry(telemetry, active) {
  if (!telemetry) return null;
  return {
    event(name, data) { return active() ? telemetry.event?.(name, data) : false; },
    count(name, amount) { return active() ? telemetry.count?.(name, amount) : undefined; },
    audioRaw(bytes) { return active() ? telemetry.audioRaw?.(bytes) : undefined; },
    startSpan(name, data) {
      if (!active()) return () => null;
      const finish = telemetry.startSpan?.(name, data);
      let done = false;
      return (outcome, extra) => { if (done || !active()) return null; done = true; return finish?.(outcome, extra); };
    },
  };
}

export function normalizeRetryConfig(input = {}) {
  const retry = input.retry || {};
  const enabled = retry.enabled ?? true;
  const maxAttempts = retry.maxAttempts ?? 2;
  const baseDelayMs = retry.baseDelayMs ?? 500;
  const maxDelayMs = retry.maxDelayMs ?? 3000;
  const minAttemptBudgetMs = retry.minAttemptBudgetMs ?? 1000;
  const attemptTimeoutMs = retry.attemptTimeoutMs ?? null;
  const honorRetryAfter = retry.honorRetryAfter ?? true;
  const jitter = retry.jitter ?? 'bounded';
  if (typeof enabled !== 'boolean' || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2 ||
      !Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 || !Number.isSafeInteger(maxDelayMs) || maxDelayMs < baseDelayMs ||
      !Number.isSafeInteger(minAttemptBudgetMs) || minAttemptBudgetMs < 1 ||
      (attemptTimeoutMs !== null && (!Number.isSafeInteger(attemptTimeoutMs) || attemptTimeoutMs < 1)) ||
      typeof honorRetryAfter !== 'boolean' || jitter !== 'bounded') {
    throw new TypeError('Provider retry configuration is invalid.');
  }
  return Object.freeze({ enabled, maxAttempts, baseDelayMs, maxDelayMs, minAttemptBudgetMs, attemptTimeoutMs, honorRetryAfter, jitter });
}

function attemptOperation({ run, parentSignal, attemptTimeoutMs, now, attempt }) {
  const controller = new AbortController();
  let timedOut = false;
  let closed = false;
  let timer = null;
  const parentAbort = () => controller.abort(parentSignal?.reason || new ProviderAttemptError('Provider turn cancelled.', { code: 'cancelled' }));
  if (parentSignal?.aborted) parentAbort();
  else parentSignal?.addEventListener('abort', parentAbort, { once: true });
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason || new ProviderAttemptError('Provider attempt cancelled.', { code: 'cancelled' }));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  if (attemptTimeoutMs !== null) timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new ProviderAttemptError('Provider attempt timed out.', { code: 'attempt_timeout' }));
  }, Math.max(1, attemptTimeoutMs));
  const isActive = () => !closed && !controller.signal.aborted;
  const work = Promise.resolve().then(() => run({ signal: controller.signal, isActive, telemetry: guardedTelemetry(run.telemetry, isActive), attempt }));
  work.catch(() => {});
  return {
    promise: Promise.race([work, aborted]),
    close() {
      closed = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', parentAbort);
      controller.signal.removeEventListener('abort', onAbort);
    },
    timedOut: () => timedOut,
    signal: controller.signal,
    isActive,
    now,
  };
}

export async function executeProviderOperation({
  operation, provider, identity, signal, deadlineAt, isCurrent = () => true, canRetry = () => true,
  retryConfig, telemetry = null, run, now = () => performance.now(), random = Math.random,
  delay = abortableDelay,
}) {
  if (typeof run !== 'function') throw new TypeError('Provider executor requires one single-request operation.');
  const policy = normalizeRetryConfig({ retry: retryConfig });
  let lastError;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason || new ProviderAttemptError('Provider turn cancelled.', { code: 'cancelled' });
    if (!isCurrent()) throw new ProviderAttemptError('Provider turn is stale.', { code: 'stale_generation' });
    const remainingAtStart = deadlineAt - now();
    if (remainingAtStart <= 0) throw new ProviderAttemptError('Provider work deadline expired.', { code: 'deadline_exceeded' });
    const timeoutMs = policy.attemptTimeoutMs === null ? remainingAtStart : Math.min(remainingAtStart, policy.attemptTimeoutMs);
    const attemptId = `${operation}:${attempt}`;
    telemetry?.event('provider_selected', { operation, provider });
    telemetry?.event('provider_attempt_started', { operation, provider, attempt, attemptId });
    const execute = context => run({ ...context, attemptId, timeoutMs, remainingDeadlineMs: remainingAtStart });
    execute.telemetry = telemetry;
    const current = attemptOperation({ run: execute, parentSignal: signal, attemptTimeoutMs: timeoutMs, now, attempt });
    let result;
    try {
      result = await current.promise;
      if (!current.isActive() || !isCurrent() || signal?.aborted || now() >= deadlineAt) {
        throw new ProviderAttemptError('Provider result arrived after its attempt closed.', { code: current.timedOut() ? 'attempt_timeout' : 'stale_generation' });
      }
      telemetry?.event('provider_attempt_succeeded', { operation, provider, attempt, attemptId });
      if (attempt > 1) telemetry?.event('provider_retry_recovered', { operation, provider, attempt, maxAttempts: policy.maxAttempts });
      return result;
    } catch (error) {
      lastError = current.timedOut() ? new ProviderAttemptError('Provider attempt timed out.', { code: 'attempt_timeout' }) : error;
    } finally {
      current.close();
    }

    if (signal?.aborted) throw signal.reason || lastError;
    if (!isCurrent()) throw new ProviderAttemptError('Provider turn is stale.', { code: 'stale_generation' });
    if (now() >= deadlineAt) throw new ProviderAttemptError('Provider work deadline expired.', { code: 'deadline_exceeded' });
    const remainingMs = deadlineAt - now();
    const retry = retryPolicyDecision({
      error: lastError, attempt, maxAttempts: policy.maxAttempts, policy: { ...policy, random },
      canRetry: canRetry() === true, remainingMs,
    });
    if (!retry.retry) {
      if (retry.exhausted) telemetry?.event('provider_retry_exhausted', { operation, provider, attempt, maxAttempts: policy.maxAttempts, reason: retry.reason, httpStatus: lastError?.status || 0 });
      else telemetry?.event('provider_retry_skipped', { operation, provider, attempt, maxAttempts: policy.maxAttempts, reason: retry.reason, httpStatus: lastError?.status || 0, remainingDeadlineMs: remainingMs });
      throw lastError;
    }
    telemetry?.event('provider_retry_scheduled', { operation, provider, attempt: attempt + 1, maxAttempts: policy.maxAttempts, retryDelayMs: retry.delayMs, reason: retry.reason, httpStatus: lastError?.status || 0, remainingDeadlineMs: remainingMs });
    try {
      await delay(retry.delayMs, { signal });
    } catch (error) {
      throw signal?.reason || new ProviderAttemptError('Retry delay was cancelled.', { code: 'cancelled' });
    }
    if (signal?.aborted) throw signal.reason || new ProviderAttemptError('Provider turn cancelled.', { code: 'cancelled' });
    if (!isCurrent()) throw new ProviderAttemptError('Provider turn is stale.', { code: 'stale_generation' });
    if (deadlineAt - now() < policy.minAttemptBudgetMs) throw new ProviderAttemptError('Provider work deadline expired before retry.', { code: 'deadline_exceeded' });
    if (canRetry() !== true) throw new ProviderAttemptError('Provider retry crossed a side-effect boundary.', { code: 'side_effect_started' });
  }
  throw lastError;
}

export { classifyProviderFailure };
