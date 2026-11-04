import type { KnowledgeItem, ObservationPort } from '../index.js';
import type { AtlasRepositoryObservation } from './atlas-public-source.mjs';

export declare function atlasProjectSourceRef(projectId: string, sourceId: string): string;
export declare function createAtlasProjectObservationPort(options: {
  projectId: string;
  sourceId: string;
  repository: string;
  branch: string;
  pinnedItems: readonly KnowledgeItem[];
  getSnapshot: () => Promise<unknown>;
  observeRepository: (request: {repository: string}) => Promise<AtlasRepositoryObservation | null>;
  readEvidence: (request: {
    sourceRef: string; itemId: string; requestedRevision: string;
    repository: string; branch: string;
  }) => Promise<{ observedRevision: string; excerpt: string; evidenceRef: string } | null>;
}): ObservationPort;
