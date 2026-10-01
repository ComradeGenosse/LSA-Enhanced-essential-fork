const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function assertProvider(provider, { operation, requiredCapabilities = [] } = {}) {
  if (!provider || typeof provider !== 'object') throw new TypeError('Provider must be an object.');
  if (typeof provider.id !== 'string' || !ID.test(provider.id) || provider.id.length > 96) {
    throw new TypeError('Provider id must be a bounded lowercase identifier.');
  }
  if (typeof operation !== 'string' || typeof provider[operation] !== 'function') {
    throw new TypeError(`Provider ${provider.id} does not implement ${operation || 'an operation'}.`);
  }
  if (!provider.capabilities || typeof provider.capabilities !== 'object' || Array.isArray(provider.capabilities)) {
    throw new TypeError(`Provider ${provider.id} must declare capabilities.`);
  }
  for (const capability of requiredCapabilities) {
    if (provider.capabilities[capability] !== true) throw new TypeError(`Provider ${provider.id} lacks ${capability}.`);
  }
  return provider;
}

export function assertOperationInput(input, operation) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${operation} input must be an object.`);
  if (!input.identity || typeof input.identity !== 'object') throw new TypeError(`${operation} requires the immutable native identity.`);
  return input;
}
