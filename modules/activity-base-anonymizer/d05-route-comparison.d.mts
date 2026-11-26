export type D05RouteGroup={
 id:string;basis:'AMBIGUOUS_OPERATION_OCCURRENCES'|'EXACT_NAMED_DEPENDENCY_STRUCTURE'|'SINGLE_MODEL';
 model_count:number;model_numbers:number[];source_kinds:string[];
 operations:Array<{id:string;name:string;kind:'internal'|'subcontract'|'wait'|'inspection'|'transport';
 parallel:boolean;milestone:boolean;predecessors:string[]}>;
 dependency_count:number;differing_fields:string[];incomplete_fields:string[];
};
export type D05RecordedExecutionReview={status:'LOCAL_D05_RECORDED_EXECUTION_REVIEW';
 profiles:Array<{model_number:number;source_references?:Array<{value:string;replacement:string;kind:'CUSTOMER'|'PERFORMER'|'CONTRACTOR'}>;reports:Array<{report_number:number;source_refs:Array<{object_id:string;revision:number;schema_id:string}>;
 operations:Array<{operation_id:string;status:string;duration_minutes:number|null;labor_minutes:number|null;quantity_output:number|null;
 quantity_accepted:number|null;quantity_rejected:number|null;accepted_with_deviation:boolean|null;previous_cycle_count:number|null;result_note:string|null;pause_reason:string|null}>;
 actuals:Array<Record<string,unknown>>;quality:Array<Record<string,unknown>>;defects:Array<Record<string,unknown>>;
 semantics:'RECORDED_REPORTS_NOT_VERIFIED_FINAL_ACCEPTANCE'}>;issues:string[]}>;
 report_count:number;source_record_count:number;unused_record_count:number;
 epistemic_status:'SOURCE_REPORTED_NOT_INDEPENDENTLY_OBSERVED';domain_completion_validation:'NOT_PERFORMED_BY_ACTIVITY';export_allowed:false;iwxa_package:null};
export type D05RouteReview={
 technology_draft?:D05TechnologyDraft;recorded_execution_review?:D05RecordedExecutionReview;
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

export type D05DraftOptions={includeTechnologyDraft?:boolean;recordedDetails?:unknown};
export type D05DraftValue=string|boolean|number[]|null;
export type D05DraftUse='DECLARED_SOURCE_CONDITION'|'ADAPTATION_REVIEW'|'FUNCTIONAL_MAPPING_REQUIRED';
export type D05DraftCondition={key:string;scope:string;field:string;use:D05DraftUse;value:D05DraftValue};
export type D05DraftCheck={id:string;operation_id:string|null;title:string;control_type:string;
 comparison:'COMMON_DECLARATION'|'SOURCE_SPECIFIC'|'NOT_COMPARABLE';
 fields:Array<{field:string;use:D05DraftUse;value:D05DraftValue;
 status:'DECLARED'|'NOT_SPECIFIED_OR_NOT_APPLICABLE'|'LOCAL_REFERENCE_REVIEW_REQUIRED'}>};
export type D05DraftProfile={model_number:number;source_kind:string;source_revision:number|null;
 conditions:D05DraftCondition[];quality_status:D05QualityModel['status']|'NOT_READ';quality_issues:string[];
 checks:D05DraftCheck[];local_context_review:string[];unresolved:string[]};
export type D05TechnologyDraftGroup={group_id:string;shared_check_count:number;shared_condition_keys:string[];
 differing_condition_keys:string[];unresolved_condition_keys:string[];profiles:D05DraftProfile[];
 variant_policy:'KEEP_ORIGINAL_CONDITION_BUNDLES'};
export type D05TechnologyDraft={status:'LOCAL_TECHNOLOGY_DRAFT';groups:D05TechnologyDraftGroup[];
 purpose:'PREPARE_FOR_DOMAIN_AND_DISCLOSURE_REVIEW';model_semantics:'DECLARED_CONDITIONS_NOT_EXECUTION';
 applicability:'NOT_ESTABLISHED';external_transfer:false};

export type D05TechnologyProposalForm={
 purpose?:string;inputs?:string;outputs?:string;applicability?:string;adaptation_guidance?:string;
 local_context_guidance?:string;
 operations?:Record<string,{label?:string;role?:string;equipment?:string;material?:string}>;
 quality_roles?:Record<string,string>;
};
export type D05TechnologyProposal={
 status:'PROPOSAL_NEEDS_INPUT'|'PROPOSAL_WITH_SOURCE_GAPS'|'PROPOSAL_FOR_DOMAIN_REVIEW';source_model_number:number;
 source_revision:number|null;declared_by:'LOCAL_USER_PROPOSAL';
 terms:Record<string,string|null>;
 operations:Array<{operation_id:string;source_name:string;kind:D05RouteGroup['operations'][number]['kind'];
 parallel:boolean;milestone:boolean;predecessors:string[];proposed:Record<string,string|null>;
 source_parameter_conditions:D05DraftCondition[]}>;
 quality_checks:Array<{check_id:string;title:string;operation_id:string|null;control_type:string;
 declared_fields:D05DraftCheck['fields'];proposed_responsible_role:string|null}>;
 source_route_parameters:D05DraftCondition[];
 missing_fields:Array<{scope:string;field:string}>;unresolved_source_requirements:string[];
 local_context_review:string[];source_quality_status:D05DraftProfile['quality_status'];
 domain_validation:'NOT_PERFORMED';applicability:'NOT_ESTABLISHED';
 anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
};
export function prepareD05TechnologyProposal(review:unknown,groupId:string,modelNumber:number,form:D05TechnologyProposalForm):D05TechnologyProposal;

export type D05ParameterDecision={mode:'RETAIN_DECLARATION'|'PARAMETERIZE';guidance?:string};
export type D05DisclosureParameter={field:string;mode:'NEEDS_DECISION'|'RETAIN_DECLARATION'|'PARAMETERIZE';
 value:D05DraftValue;guidance:string|null};
export type D05DisclosureCandidate={
 status:'LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW'|'LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT';
 technology:{terms:Record<string,string|null>;route_parameters:D05DisclosureParameter[];
  operations:Array<{operation_id:string;label:string|null;kind:D05RouteGroup['operations'][number]['kind'];
   parallel:boolean;milestone:boolean;predecessors:string[];role:string|null;equipment_requirement:string|null;
   material_requirement:string|null;parameters:D05DisclosureParameter[]}>;
  quality_checks:Array<{check_id:string;title:string;operation_id:string|null;control_type:string;
   responsible_role:string|null;declared_fields:D05DraftCheck['fields']}>};
 text_review_fields:Array<{path:string;text:string}>;
 parameter_summary:{retained:number;parameterized:number;pending:number};
 pending_parameter_decisions:Array<{key:string;scope:string;field:string}>;
 missing_proposal_fields:D05TechnologyProposal['missing_fields'];unresolved_source_requirements:string[];
 source_quality_status:D05DraftProfile['quality_status'];domain_validation:'NOT_PERFORMED';
 disclosure_review:'NOT_PERFORMED';anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
};
export function prepareD05DisclosureCandidate(review:unknown,groupId:string,modelNumber:number,
 form:D05TechnologyProposalForm,decisions:Record<string,D05ParameterDecision>):D05DisclosureCandidate;

export function disclosureTextInventory(technology:unknown):Array<{path:string;text:string}>;
