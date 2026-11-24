import type {D05ParameterDecision} from './d05-route-comparison.mjs';
export function suggestD05ParameterDecisions(review:unknown,groupId:string,modelNumber:number):{
 status:'LOCAL_D05_ADAPTATION_SUGGESTIONS';group_id:string;model_number:number;decisions:Record<string,D05ParameterDecision>;
 explanations:Array<{key:string;scope:string;field:string;reason:'SOURCE_INCOMPLETE'|'VARIANT_DIFFERS'|'COMMON_DECLARATION'|'SELECTED_DECLARATION';
 proposed_mode:D05ParameterDecision['mode'];needs_domain_attention:boolean}>;
 source_semantics:'DECLARATIONS_NOT_EXECUTION';review_required:true;export_allowed:false;iwxa_package:null};
