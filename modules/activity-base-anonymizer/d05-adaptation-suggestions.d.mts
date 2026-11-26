import type {D05ParameterDecision} from './d05-route-comparison.mjs';
export function suggestD05ParameterDecisions(review:unknown,groupId:string,modelNumber:number):{
 status:'LOCAL_D05_ADAPTATION_SUGGESTIONS';group_id:string;model_number:number;decisions:Record<string,D05ParameterDecision>;
 explanations:Array<{key:string;scope:string;field:string;reason:'SOURCE_INCOMPLETE'|'VARIANT_DIFFERS'|'COMMON_DECLARATION'|'SELECTED_DECLARATION';
 proposed_mode:D05ParameterDecision['mode'];needs_domain_attention:boolean}>;
 source_semantics:'DECLARATIONS_NOT_EXECUTION';review_required:true;export_allowed:false;iwxa_package:null};

export type D05FunctionalField='label'|'role'|'equipment'|'material'|'responsible_role';
export type D05FunctionalMappingRow={scope:string;field:D05FunctionalField;source_text:string|null;current_requirement:string|null;
 suggested_requirement:string|null;proposal_basis:'SOURCE_WORDING_FOR_REVIEW'|'MISSING_SOURCE'|'DECLARED_FUNCTIONAL_ROLE'|'ROLE_NEEDS_CLARIFICATION';hint:string;
 linked_controls:Array<{check_id:string;title:string;control_type:string;requirements:Array<{field:string;value:import('./d05-route-comparison.mjs').D05DraftValue}>}>};
export type D05FunctionalMappingReview={status:'LOCAL_D05_FUNCTIONAL_MAPPING_REVIEW';group_id:string;model_number:number;rows:D05FunctionalMappingRow[];
 context_requirements:Array<{code:string;scope:string;suggested_requirement:string|null}>;
 source_semantics:'DECLARED_RESOURCES_NOT_VERIFIED_CAPABILITIES';review_required:true;export_allowed:false;iwxa_package:null};
export function reviewD05FunctionalMappings(review:unknown,groupId:string,modelNumber:number,form?:import('./d05-route-comparison.mjs').D05TechnologyProposalForm):D05FunctionalMappingReview;
export function collectD05FunctionalReferences(review:unknown,groupId:string,modelNumber:number,form:import('./d05-route-comparison.mjs').D05TechnologyProposalForm):import('./technology-disclosure-generalization.mjs').SourceReference[];
