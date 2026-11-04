import type { KnowledgeItem, ObservationPort } from '../index.js';

export declare function createRevisionedObservationPort(options: {
  sourceRef: string;
  pinnedItems: readonly KnowledgeItem[];
  getCurrentRevision: (request: { sourceRef: string }) => Promise<string | null>;
  readEvidence: (request: {
    sourceRef: string; itemId: string; requestedRevision: string;
  }) => Promise<{ observedRevision: string; excerpt: string; evidenceRef: string } | null>;
}): ObservationPort;
