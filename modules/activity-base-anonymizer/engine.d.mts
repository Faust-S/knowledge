export declare const A0_SCHEMA: string;
export declare const A1_SCHEMA: string;
export declare const CANDIDATE_SCHEMA: string;
export declare class ActivityHold extends Error {code: string; constructor(code: string);}
export interface ProcessStage {id: string; roles: string[];}
export interface ProcessEdge {from: string; to: string; trace_occurrences: number; relation: string;}
export interface ProcessGraph {id: string; trace_count: number; states: ProcessStage[]; observed_successions: ProcessEdge[];}
export interface Preview {
  schema: string; stage: string; processes: ProcessGraph[];
  role_count: number; selected_case_count: number; unverified_event_count: number;
  source_pin_count: number; provenance_verification: string;
  anonymous: false; export_allowed: false; iwxa_package: null; risk_assessment: string;
}
export declare function sha256Canonical(value: unknown): Promise<string>;
export declare function analyzeSnapshot(snapshot: unknown): Promise<{
  preview: Preview; internalEvidence: ReadonlyArray<Readonly<{
    event_id: string; source_id: string; revision: string; status: string
  }>>;
}>;
export declare function buildSyntheticExample(): Promise<unknown>;