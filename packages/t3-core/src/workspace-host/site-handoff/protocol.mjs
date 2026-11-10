/** T2-owned browser-to-Host proposal transport. This carries NO authority. */
export const HANDOFF_PROTOCOL = 'IWXA_T2_SITE_HANDOFF/1';
export const HANDOFF_ORIGIN_QUERY = 'iwxa_t2_site_origin';
export const MAX_T0_DOCUMENT_BYTES = 18 * 1024 * 1024;
export const NONCE_PATTERN = /^[a-zA-Z0-9_-]{20,96}$/;

export function exactOrigin(raw) {
  if (typeof raw !== 'string' || raw.length > 256) throw new Error('T2_HANDOFF_ORIGIN_INVALID');
  let value;
  try { value = new URL(raw); } catch { throw new Error('T2_HANDOFF_ORIGIN_INVALID'); }
  if (value.origin !== raw || value.protocol !== 'https:' || value.username || value.password ||
      value.pathname !== '/' || value.search || value.hash) throw new Error('T2_HANDOFF_ORIGIN_INVALID');
  return value.origin;
}

/** Only the qualification loopback Host is a valid destination at this stage.
 * An arbitrary HTTPS server could otherwise obtain a sensitive Club backup. */
export function destinationUrl(raw, siteOrigin) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('T2_HANDOFF_DESTINATION_INVALID'); }
  try { exactOrigin(url.origin); }
  catch { throw new Error('T2_HANDOFF_DESTINATION_INVALID'); }
  if (url.origin === exactOrigin(siteOrigin) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.hash ||
      url.pathname !== '/workspace/' || url.search) throw new Error('T2_HANDOFF_DESTINATION_INVALID');
  url.searchParams.set(HANDOFF_ORIGIN_QUERY, siteOrigin); // public origin only, NEVER user data
  return url;
}

/** Receivers accept only the one origin explicitly named by the opening site.
 * Source origin remains untrusted until a domain-specific allowlist and
 * raw-backup validator independently verify it. */
export function claimedSiteOrigin(hostLocation) {
  const url = new URL(hostLocation);
  if (url.pathname !== '/workspace/' || url.hash ||
      [...url.searchParams.keys()].length !== 1 ||
      !url.searchParams.has(HANDOFF_ORIGIN_QUERY)) throw new Error('T2_HANDOFF_REQUEST_INVALID');
  return exactOrigin(url.searchParams.get(HANDOFF_ORIGIN_QUERY));
}

export function isMessage(value, kind) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    value.protocol === HANDOFF_PROTOCOL && value.kind === kind &&
    typeof value.nonce === 'string' && NONCE_PATTERN.test(value.nonce);
}

export function checkCandidateBytes(raw, maxBytes = MAX_T0_DOCUMENT_BYTES) {
  if (typeof raw !== 'string' || !raw.length || raw.length > maxBytes ||
      new TextEncoder().encode(raw).length > maxBytes) throw new Error('T2_HANDOFF_CANDIDATE_SIZE_INVALID');
  return raw;
}

export function nonceFrom(cryptoSource) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function')
    throw new Error('T2_HANDOFF_SECURE_NONCE_REQUIRED');
  const bytes = new Uint8Array(24);
  cryptoSource.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
