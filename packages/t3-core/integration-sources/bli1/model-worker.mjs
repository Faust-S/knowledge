import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const nativeFetch = globalThis.fetch.bind(globalThis);
let networkDenied = true;
// An additional guard for JS fetch paths; not proof of OS-level isolation.
globalThis.fetch = (resource, options) => {
  if (!networkDenied) return nativeFetch(resource, options);
  const location = typeof resource === 'string' || resource instanceof URL
    ? String(resource) : resource.url;
  const url = new URL(location, self.location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return nativeFetch(resource, options);
  }
  // No network fallback: local cache may serve an exact previously stored
  // response (including WebLLM WASM/config assets). Missing entries fail.
  // This is an application fetch boundary, not OS-level egress attestation.
  return (async () => {
    if (!globalThis.caches) throw new Error('IWXA_NETWORK_DENIED_IN_WORKER');
    const request = resource instanceof Request ? resource : new Request(url, options);
    if (request.method !== 'GET') throw new Error('IWXA_NETWORK_DENIED_IN_WORKER');
    const cached = await globalThis.caches.match(request);
    if (!cached) throw new Error('IWXA_NETWORK_DENIED_IN_WORKER');
    return cached;
  })();
};

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event) => {
  if (event.data?.kind === 'IWXA_NETWORK_POLICY') {
    networkDenied = event.data.denyNetwork !== false;
    return;
  }
  handler.onmessage(event);
};
