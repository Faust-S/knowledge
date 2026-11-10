import type {Preview} from './engine.mjs';
export type SyntheticRisk = {
  schema: string;
  status: 'HOLD' | 'STRUCTURE_PRESERVED_REVIEW_REQUIRED';
  reason_codes: string[];
  residual_risk: string;
  anonymity: 'NOT_ESTABLISHED';
  export_allowed: false;
  iwxa_package: null;
  structural_candidate: null | Array<{
    process_id: string;
    cohort_band: string;
    states: Array<{state_id: string; structural_roles: string[]}>;
    observed_order: Array<{from: string; to: string; relation: string; cohort_band: string}>;
  }>;
};
export const RISK_SCHEMA: string;
export function screenSyntheticDisclosure(snapshot: unknown): Promise<{preview: Preview; risk: SyntheticRisk}>;