export type EpistemicKind = 'observed' | 'reported' | 'inferred' | 'target';
export interface KnowledgeItem {
  readonly id: string;
  readonly type: string;
  readonly sourceRef: string;
  readonly revision: string;
  readonly epistemic: EpistemicKind;
  readonly estimatedTokens: number;
  readonly keywords?: readonly string[];
}
export interface ContextRequest {
  readonly taskId: string;
  readonly terms: readonly string[];
  readonly allowedSources: readonly string[];
  readonly maxTokens: number;
  readonly allowInferred?: boolean;
  readonly profile?: string;
}
export interface SourceObservation {
  readonly sourceRef: string;
  readonly currentRevision: string;
  readonly complete: boolean;
  readonly excerpt?: string;
  readonly evidenceRef?: string;
  readonly sha256?: string;
}
export interface ObservationPort {
  query(request: { taskId: string; terms: string[]; allowedSources: string[]; profile?: string }): Promise<KnowledgeItem[]>;
  observe(request: { sourceRef: string; requestedRevision: string; itemId: string }): Promise<SourceObservation>;
}
// Supplied and authorized by each host. K01 itself never calls write().
export interface MemoryPort {
  read(id: string): Promise<KnowledgeItem | null>;
  query(request: { terms: string[] }): Promise<KnowledgeItem[]>;
  write(item: KnowledgeItem): Promise<void>;
}
export interface ContextSelection {
  readonly id: string;
  readonly type: string;
  readonly sourceRef: string;
  readonly revision: string;
  readonly epistemic: EpistemicKind;
  readonly evidenceRef: string;
  readonly sha256: string;
  readonly excerpt: string;
  readonly estimatedTokens: number;
  readonly relevance: number;
  readonly inclusionReason: string;
}
export interface ContextOmission {
  readonly id: string;
  readonly sourceRef: string;
  readonly reason: 'inferred_excluded' | 'budget_exceeded' | 'incomplete_source' | 'stale' | 'unverified_evidence';
  readonly requestedRevision?: string;
  readonly currentRevision?: string;
}
export interface ContextProjection {
  readonly contractVersion: string;
  readonly taskId: string;
  readonly selected: ContextSelection[];
  readonly omissions: ContextOmission[];
  readonly estimatedTokens: number;
  readonly missing: boolean;
}
export declare const CONTRACT_VERSION: '0.2.1';
export declare function selectContext(request: ContextRequest, port: ObservationPort): Promise<ContextProjection>;
export declare function traceEvidence(projection: ContextProjection): Array<Pick<ContextSelection, 'id' | 'sourceRef' | 'revision' | 'epistemic' | 'evidenceRef' | 'sha256'>>;
export declare function summarizeMemory(items: readonly KnowledgeItem[], constraints: { maxTokens: number; allowInferred?: boolean }): {
  contractVersion: string;
  selected: Array<Pick<KnowledgeItem, 'id' | 'sourceRef' | 'revision' | 'epistemic' | 'type'>>;
  estimatedTokens: number;
};
export declare function sha256(bytes: string | Uint8Array): string;
