import { classifyProviderFailure } from './errorClassifier.mjs';

export function retryPolicyDecision({ error, attempt, maxAttempts, policy, canRetry, remainingMs }) {
  if (!policy.enabled) return { retry: false, reason: 'disabled' };
  const classification = classifyProviderFailure(error);
  if (!classification.retryable) return { retry: false, reason: classification.reason };
  if (!canRetry) return { retry: false, reason: 'side_effect_started' };
  if (attempt >= maxAttempts) return { retry: false, exhausted: true, reason: 'attempt_limit', classification };
  const retryAfterMs = policy.honorRetryAfter !== false && Number.isSafeInteger(error?.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : null;
  const random = Math.max(0, Math.min(1, policy.random()));
  const jitteredBackoffMs = Math.ceil(policy.baseDelayMs * (0.5 + random * 0.5));
  const delayMs = retryAfterMs === null ? jitteredBackoffMs : retryAfterMs;
  if (delayMs > policy.maxDelayMs) return { retry: false, reason: 'retry_after_above_max', delayMs, classification };
  if (!Number.isFinite(remainingMs) || delayMs + policy.minAttemptBudgetMs > remainingMs) {
    return { retry: false, reason: 'insufficient_deadline', delayMs, classification };
  }
  return { retry: true, delayMs, reason: classification.reason, classification };
}
