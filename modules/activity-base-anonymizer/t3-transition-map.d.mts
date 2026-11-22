import type {T3StructuralCandidate} from './t3-selected-host.mjs';
export type T3TransitionMapEdge=Readonly<{
  from:string;to:string;cohort_band:'3-9'|'10-49'|'50+';
  relation:'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY';
}>;
export type T3TransitionMapNode=Readonly<{
  id:string;label:string;incoming:readonly T3TransitionMapEdge[];
  outgoing:readonly T3TransitionMapEdge[];
}>;
export type T3TransitionMap=Readonly<{
  nodes:readonly T3TransitionMapNode[];
  transitions:readonly T3TransitionMapEdge[];
  cyclic:boolean;branched:boolean;linear:boolean;
  branch_points:number;convergence_points:number;
  isolated_event_kinds:number;
  source_role:'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY';
  inferred_edges:0;export_allowed:false;
}>;
export function buildT3TransitionMap(view:T3StructuralCandidate):T3TransitionMap;
