// Stateless adapter for an explicitly authorized document provided by its host.
// The host owns source bytes, credentials, read permissions, and lifecycle.
import { sha256 } from '../index.mjs';

const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const MAX_SOURCE_BYTES = 1024 * 1024;

export function createDocumentObservationPort({ sourceRef, pinnedItems, readSnapshot }) {
  if (!valid(sourceRef) || !Array.isArray(pinnedItems) || pinnedItems.length === 0
      || typeof readSnapshot !== 'function') throw new TypeError('invalid document source');
  const specifications = new Map();
  const descriptors = [];
  let commonRevision;
  for (const { linePrefix, ...item } of pinnedItems) {
    if (!valid(item.id) || !valid(item.type) || item.sourceRef !== sourceRef || !valid(linePrefix)
        || /[\r\n]/.test(linePrefix) || !/^sha256:[a-f0-9]{64}$/.test(item.revision)
        || !['observed', 'reported', 'inferred', 'target'].includes(item.epistemic)
        || !Number.isSafeInteger(item.estimatedTokens) || item.estimatedTokens < 0
        || (item.keywords !== undefined && (!Array.isArray(item.keywords)
          || item.keywords.some(keyword => !valid(keyword))))
        || specifications.has(item.id) || (commonRevision !== undefined && item.revision !== commonRevision)) {
      throw new TypeError('invalid pinned source item');
    }
    commonRevision = item.revision;
    specifications.set(item.id, { linePrefix, revision: item.revision });
    // Query exposes only the contract's approved metadata, never host-only fields.
    descriptors.push({ id: item.id, type: item.type, sourceRef: item.sourceRef,
      revision: item.revision, epistemic: item.epistemic, estimatedTokens: item.estimatedTokens,
      ...(item.keywords === undefined ? {} : { keywords: [...item.keywords] }) });
  }
  return {
    async query({ allowedSources }) {
      if (!Array.isArray(allowedSources) || !allowedSources.includes(sourceRef)) return [];
      return descriptors.map(item => ({ ...item, ...(item.keywords === undefined ? {} : { keywords: [...item.keywords] }) }));
    },
    async observe({ sourceRef: requestedSource, itemId, requestedRevision }) {
      const specification = specifications.get(itemId);
      if (requestedSource !== sourceRef || !specification || requestedRevision !== specification.revision) {
        return { sourceRef, currentRevision: 'unavailable', complete: false };
      }
      let contents;
      try { contents = await readSnapshot(); }
      catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          return { sourceRef, currentRevision: 'unavailable', complete: false };
        }
        throw error;
      }
      if (!(typeof contents === 'string' || contents instanceof Uint8Array)) {
        return { sourceRef, currentRevision: 'unavailable', complete: false };
      }
      const bytes = typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents;
      if (bytes.byteLength > MAX_SOURCE_BYTES) return { sourceRef, currentRevision: 'unavailable', complete: false };
      const currentRevision = 'sha256:' + sha256(bytes);
      // One byte snapshot determines both revision and evidence. On mismatch no content leaves the adapter.
      if (currentRevision !== requestedRevision) return { sourceRef, currentRevision, complete: true };
      let document;
      try { document = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return { sourceRef, currentRevision, complete: false }; }
      const lines = document.split(/\r?\n/);
      const prefix = specification.linePrefix;
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(prefix) && lines[i].length > prefix.length) matches.push(i);
      }
      if (matches.length !== 1) return { sourceRef, currentRevision, complete: false };
      const line = lines[matches[0]];
      return { sourceRef, currentRevision, complete: true, excerpt: line,
        evidenceRef: 'line:' + (matches[0] + 1), sha256: sha256(line) };
    }
  };
}
