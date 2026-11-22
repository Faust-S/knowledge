import type {T3ActivityReview} from './t3-selected-host.mjs';
export type T3EvidenceTask = Readonly<{
 code:string; area:string; priority:number; issue:string; next:string;
}>;
export type T3EvidenceGroup = Readonly<{
 area:string;label:string;items:readonly T3EvidenceTask[];
}>;
export type T3EvidencePassport = Readonly<{
 result:'INSUFFICIENT_FOR_RECONSTRUCTION'|'INTERNAL_STRUCTURE_ONLY';
 businessExecution:'NOT_INDEPENDENTLY_PROVEN';
 disclosure:'FORBIDDEN';
 actionCount:number;
 groups:readonly T3EvidenceGroup[];
 info:readonly T3EvidenceTask[];
}>;
export function buildT3EvidencePassport(review:T3ActivityReview):T3EvidencePassport;
