import type { KnowledgeItem, ObservationPort } from '../index.js';
export type PinnedDocumentItem = KnowledgeItem & { readonly linePrefix: string };
export declare function createDocumentObservationPort(options: {
  sourceRef: string;
  pinnedItems: readonly PinnedDocumentItem[];
  readSnapshot: () => Promise<string | Uint8Array>;
}): ObservationPort;
