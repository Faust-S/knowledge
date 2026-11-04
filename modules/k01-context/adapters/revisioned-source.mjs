// K01 adapter for host-owned, revisioned sources. No Git/API client or state store.
import { sha256 } from '../index.mjs';

const valid = value => typeof value === 'string' && value.trim() === value
  && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
const MAX_EXCERPT_BYTES = 65536;

export function createRevisionedObservationPort({
  sourceRef, pinnedItems, getCurrentRevision, readEvidence,
}) {
  if (!valid(sourceRef) || !Array.isArray(pinnedItems) || pinnedItems.length === 0
      || typeof getCurrentRevision !== 'function' || typeof readEvidence !== 'function') {
    throw new TypeError('invalid revisioned source');
  }
  const items = new Map();
  let pinnedRevision;
  for (const raw of pinnedItems) {
    if (!raw || !valid(raw.id) || !valid(raw.type) || raw.sourceRef !== sourceRef
        || !valid(raw.revision) || !['observed','reported','inferred','target'].includes(raw.epistemic)
        || !Number.isSafeInteger(raw.estimatedTokens) || raw.estimatedTokens < 0
        || (raw.keywords !== undefined && (!Array.isArray(raw.keywords)
            || raw.keywords.some(word => !valid(word))))
        || items.has(raw.id) || (pinnedRevision !== undefined && pinnedRevision !== raw.revision)) {
      throw new TypeError('invalid pinned KnowledgeItem');
    }
    pinnedRevision = raw.revision;
    items.set(raw.id, {
      id: raw.id, type: raw.type, sourceRef, revision: raw.revision,
      epistemic: raw.epistemic, estimatedTokens: raw.estimatedTokens,
      ...(raw.keywords === undefined ? {} : { keywords: [...raw.keywords] }),
    });
  }
  const incomplete = () => ({ sourceRef, currentRevision: 'unavailable', complete: false });
  const current = async () => {
    try {
      const revision = await getCurrentRevision({ sourceRef });
      return valid(revision) ? revision : null;
    } catch { return null; }
  };
  return {
    async query({ allowedSources }) {
      if (!Array.isArray(allowedSources) || !allowedSources.includes(sourceRef)) return [];
      return [...items.values()].map(item => ({
        ...item, ...(item.keywords === undefined ? {} : { keywords: [...item.keywords] }),
      }));
    },
    async observe({ sourceRef: ref, itemId, requestedRevision }) {
      const item = items.get(itemId);
      if (ref !== sourceRef || !item || requestedRevision !== item.revision) return incomplete();
      const before = await current();
      if (before === null) return incomplete();
      if (before !== item.revision) return { sourceRef, currentRevision: before, complete: true };
      let evidence;
      try {
        evidence = await readEvidence({
          sourceRef, itemId: item.id, requestedRevision: item.revision,
        });
      } catch { return incomplete(); }
      // Must observe the current owner-controlled source a second time: fail closed on drift.
      const after = await current();
      if (after === null) return incomplete();
      if (after !== before) return { sourceRef, currentRevision: after, complete: true };
      if (!evidence || !valid(evidence.observedRevision)) return incomplete();
      if (evidence.observedRevision !== after) {
        return { sourceRef, currentRevision: evidence.observedRevision, complete: true };
      }
      if (typeof evidence.excerpt !== 'string' || !evidence.excerpt
          || Buffer.byteLength(evidence.excerpt, 'utf8') > MAX_EXCERPT_BYTES
          || !valid(evidence.evidenceRef)) return incomplete();
      return {
        sourceRef, currentRevision: after, complete: true,
        excerpt: evidence.excerpt, evidenceRef: evidence.evidenceRef,
        sha256: sha256(evidence.excerpt),
      };
    },
  };
}
