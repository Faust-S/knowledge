import type { KnowledgeItem, ObservationPort } from '../index.js';

export interface AtlasRepositoryObservation {
  readonly scope: 'repository';
  readonly complete: boolean;
  readonly repository: string;
  readonly branchHeads: Record<string, string>;
}
export declare function createAtlasPublicRepoObservationPort(options: {
  sourceRef: string;
  repository: string;
  branch: string;
  pinnedItems: readonly KnowledgeItem[];
  /** Host must make a fresh public observation, not return a cached Atlas source.summary. */
  observeRepository: (request: { repository: string }) => Promise<AtlasRepositoryObservation | null>;
  readEvidence: (request: {
    sourceRef: string; itemId: string; requestedRevision: string;
    repository: string; branch: string;
  }) => Promise<{ observedRevision: string; excerpt: string; evidenceRef: string } | null>;
}): ObservationPort;
