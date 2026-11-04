// Optional Node host adapter; file path and access authority are supplied by the caller.
import { readFile } from 'node:fs/promises';
import { createDocumentObservationPort } from './document-source.mjs';

export function createLocalFileObservationPort({ filePath, sourceRef, pinnedItems }) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('filePath required');
  return createDocumentObservationPort({ sourceRef, pinnedItems,
    readSnapshot: () => readFile(filePath) });
}
