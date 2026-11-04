// Canonical request fingerprint; caller retains all source access and Task authority.
// SHA-256 is an equality check, not authentication or private-data encryption.
import { createHash } from 'node:crypto';

const valid = s => typeof s === 'string' && s.length > 0 && s.length <= 512
  && s.trim() === s && !/[\x00-\x1f]/.test(s);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const normalizedStrings = (values, label, limit, lowercase = false) => {
  if (!Array.isArray(values) || values.length > limit
      || values.some(value => !valid(value))) {
    throw new TypeError('invalid context ' + label);
  }
  return [...new Set(values.map(value => lowercase ? value.toLowerCase() : value))].sort(compare);
};
export function fingerprintContextRequest(request) {
  if (!request || !valid(request.taskId)
      || (request.profile !== undefined && !valid(request.profile))
      || (request.allowInferred !== undefined && typeof request.allowInferred !== 'boolean')) {
    throw new TypeError('invalid context request identity');
  }
  const fields = [
    request.taskId,
    normalizedStrings(request.terms, 'terms', 128, true),
    normalizedStrings(request.allowedSources, 'sources', 4096),
    request.profile ?? null,
    request.allowInferred === true,
  ];
  return createHash('sha256')
    .update('iwxa-k01-context-request-v1\0', 'utf8')
    .update(JSON.stringify(fields), 'utf8')
    .digest('hex');
}
