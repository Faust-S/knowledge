import type { ObservationPort } from '../index.js';
import type { PinnedDocumentItem } from './document-source.mjs';
export declare function createLocalFileObservationPort(options: {
  filePath: string;
  sourceRef: string;
  pinnedItems: readonly PinnedDocumentItem[];
}): ObservationPort;
