export type D05RouteGroup={
 id:string;basis:'AMBIGUOUS_OPERATION_OCCURRENCES'|'EXACT_NAMED_DEPENDENCY_STRUCTURE'|'SINGLE_MODEL';
 model_count:number;model_numbers:number[];source_kinds:string[];
 operations:Array<{id:string;name:string;kind:'internal'|'subcontract'|'wait'|'inspection'|'transport';
 parallel:boolean;milestone:boolean;predecessors:string[]}>;
 dependency_count:number;differing_fields:string[];incomplete_fields:string[];
};
export type D05RouteReview={
 technology_draft?:D05TechnologyDraft;
 status:'LOCAL_MODEL_COMPARISON';model_count:number;group_count:number;repeated_group_count:number;
 groups:D05RouteGroup[];epistemic_status:'CALCULATED_OR_DECLARED_NOT_OBSERVED';
 source_authority:'UNVERIFIED_LOCAL_COPY';technology_equivalence:'NOT_ESTABLISHED';
 anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
};
export function reviewD05RouteModels(records:unknown,options?:D05DraftOptions):D05RouteReview;
export function buildD05RouteComparisonExample():unknown[];

export type D05QualityModel={
 model_number:number;check_count:number;blocking_count:number;
 status:'NO_LINKED_PLAN'|'AMBIGUOUS_PLAN'|'INCOMPLETE_PLAN'|'DECLARED_CHECKS_READ';
 issue_codes:string[];
};
export type D05QualityReview={
 status:'LOCAL_NORMATIVE_QUALITY_REVIEW';
 groups:Array<{group_id:string;comparison:'NOT_COMPARABLE'|'DECLARED_FIELDS_DIFFER'|'NO_DIFFERENCE_IN_CHECKED_FIELDS';
 differing_fields:string[];models:D05QualityModel[]}>;
 quality_validation:'NOT_PERFORMED_BY_ACTIVITY';
 revision_alignment:'CURRENT_SNAPSHOT_NOT_APPROVED_TECHNOLOGY';
 execution_evidence:'NOT_ESTABLISHED';
};
export type D05RouteQualityReview=D05RouteReview & {quality_review:D05QualityReview};
export function reviewD05RouteModelsWithQuality(records:unknown,planDetails:unknown,templateRecords:unknown,options?:D05DraftOptions):D05RouteQualityReview;

export function reviewD05ResultSelection(records:unknown,options?:D05DraftOptions):D05RouteReview|D05RouteQualityReview;
export function buildD05RouteQualityComparisonExample(workspaceId?:string):Array<{
 object:Record<string,unknown>;relations:{incoming:unknown[];outgoing:Record<string,unknown>[]};
}>;

export type D05DraftOptions={includeTechnologyDraft?:boolean};
export type D05DraftValue=string|boolean|number[]|null;
export type D05DraftUse='DECLARED_SOURCE_CONDITION'|'ADAPTATION_REVIEW'|'FUNCTIONAL_MAPPING_REQUIRED';
export type D05DraftCondition={key:string;scope:string;field:string;use:D05DraftUse;value:D05DraftValue};
export type D05DraftCheck={id:string;operation_id:string|null;title:string;control_type:string;
 fields:Array<{field:string;use:D05DraftUse;value:D05DraftValue;
 status:'DECLARED'|'NOT_SPECIFIED_OR_NOT_APPLICABLE'|'LOCAL_REFERENCE_REVIEW_REQUIRED'}>};
export type D05DraftProfile={model_number:number;source_kind:string;source_revision:number|null;
 conditions:D05DraftCondition[];quality_status:D05QualityModel['status']|'NOT_READ';quality_issues:string[];
 checks:D05DraftCheck[];local_context_review:string[];unresolved:string[]};
export type D05TechnologyDraftGroup={group_id:string;shared_condition_keys:string[];
 differing_condition_keys:string[];unresolved_condition_keys:string[];profiles:D05DraftProfile[];
 variant_policy:'KEEP_ORIGINAL_CONDITION_BUNDLES'};
export type D05TechnologyDraft={status:'LOCAL_TECHNOLOGY_DRAFT';groups:D05TechnologyDraftGroup[];
 purpose:'PREPARE_FOR_DOMAIN_AND_DISCLOSURE_REVIEW';model_semantics:'DECLARED_CONDITIONS_NOT_EXECUTION';
 applicability:'NOT_ESTABLISHED';external_transfer:false};
