const TRANSIENT_CODES = new Set([
  'connection_reset', 'connection_closed', 'temporary_network_failure', 'timeout_before_effect', 'network_error', 'timeout',
  'attempt_timeout', 'request_timeout', 'econnreset', 'ecconnreset', 'epipe', 'econnclosed', 'etimedout', 'und_err_socket',
  'und_err_connect_timeout', 'und_err_headers_timeout',
]);
const PERMANENT_CODES = new Set([
  'insufficient_quota', 'quota_exceeded', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'billing_hard_limit_reached',
  'invalid_api_key', 'permission_denied', 'model_not_found', 'invalid_request_error', 'invalid_request',
]);
const TRANSIENT_RATE_CODES = new Set(['slow_down', 'rate_limit_exceeded']);
const TRANSIENT_SERVER_TYPES = new Set(['server_error', 'api_error', 'internal_server_error', 'service_unavailable_error']);
const ALLOWED_ERROR_CODES = new Set([...TRANSIENT_CODES, ...PERMANENT_CODES, ...TRANSIENT_RATE_CODES,
  'rate_limit_error', 'server_is_overloaded', 'request_timeout', 'server_error', 'api_error',
  'network_error','timeout',
  'internal_server_error', 'service_unavailable_error', 'insufficient_quota', 'authentication_error',
  'invalid_request_error', 'permission_denied', 'invalid_api_key', 'model_not_found']);

export function normalizeProviderCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return ALLOWED_ERROR_CODES.has(code) ? code : '';
}

export function parseRetryAfter(value, wallNowMs = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(input)) {
    const ms = Number(input) * 1000;
    return Number.isSafeInteger(Math.ceil(ms)) ? Math.ceil(ms) : null;
  }
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return null;
  const ms = Math.max(0, timestamp - wallNowMs);
  return Number.isSafeInteger(Math.ceil(ms)) ? Math.ceil(ms) : null;
}

export function providerErrorDetails(body) {
  const error = body?.error && typeof body.error === 'object' ? body.error : body;
  if (!error || typeof error !== 'object') return {};
  const code = normalizeProviderCode(error.code);
  const type = normalizeProviderCode(error.type);
  return { ...(code ? { providerErrorCode: code } : {}), ...(type ? { providerErrorType: type } : {}) };
}

export function classifyProviderFailure(error) {
  if (!error || typeof error !== 'object') return { retryable: false, reason: 'unknown_error' };
  const status = Number.isInteger(error.status) ? error.status : 0;
  const code = normalizeProviderCode(error.providerErrorCode || error.code);
  const type = normalizeProviderCode(error.providerErrorType || error.errorType);
  if (PERMANENT_CODES.has(code) || PERMANENT_CODES.has(type)) return { retryable: false, reason: 'permanent_provider_error' };
  if (TRANSIENT_CODES.has(code)) return { retryable: true, reason: code };
  if (TRANSIENT_CODES.has(type)) return { retryable: true, reason: type };
  if (status === 429) {
    if (type === 'rate_limit_error' || TRANSIENT_RATE_CODES.has(code)) return { retryable: true, reason: code || type };
    return { retryable: false, reason: 'unknown_rate_limit' };
  }
  if (status === 408) return { retryable: true, reason: 'http_408' };
  if (status === 500 && TRANSIENT_SERVER_TYPES.has(type || code)) return { retryable: true, reason: type || code };
  if ([502, 503, 504].includes(status) && !['invalid_request_error', 'authentication_error'].includes(type)) {
    return { retryable: true, reason: `http_${status}` };
  }
  return { retryable: false, reason: code || type ? 'non_retryable_provider_error' : 'unknown_error' };
}
