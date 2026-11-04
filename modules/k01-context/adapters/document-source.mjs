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
  for (const { linePrefix, ...item } of pinnedItems) {
    if (!valid(item.id) || item.sourceRef !== sourceRef || !valid(linePrefix)
        || !/^sha256:[a-f0-9]{64}$/.test(item.revision) || specifications.has(item.id)) {
      throw new TypeError('invalid pinned source item');
    }
    specifications.set(item.id, linePrefix);
    descriptors.push({ ...item });
  }
  return {
    async query({ allowedSources }) {
      if (!Array.isArray(allowedSources) || !allowedSources.includes(sourceRef)) return [];
      return descriptors.map(item => ({ ...item, keywords: item.keywords ? [...item.keywords] : undefined }));
    },
    async observe({ sourceRef: requestedSource, itemId, requestedRevision }) {
      if (requestedSource !== sourceRef || !specifications.has(itemId)
          || !valid(requestedRevision)) return { sourceRef, currentRevision: 'unavailable', complete: false };
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
      const prefix = specifications.get(itemId);
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
