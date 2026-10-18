const localFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // Existing editor/control integration tests use a real loopback HTTP server.
  if (url.protocol === 'http:' && ['127.0.0.1','[::1]','localhost'].includes(url.hostname))
    return localFetch(input,options);
  throw new Error('External network access is disabled in Memory K verification.');
};
