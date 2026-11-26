import type {ProductPreview} from './technology-product.mjs';
export type ProductTextEditKind='TEXT'|'CONTROL_TEXT'|'FIXED';
export type ProductTextEdit={path:string;previous:string;replacement:string;reason:string};
export type TextChangeReview={changed_markers:Array<{kind:'NUMBERS'|'UNITS'|'COMPARISONS'|'CONDITIONS'|'OBLIGATIONS';before:string[];after:string[]}>;semantic_equivalence:'NOT_ESTABLISHED'};
export type ReviewedProductTextEdit=ProductTextEdit&{edit_kind:ProductTextEditKind;text_review:TextChangeReview};
export type ProductRevisionReview={base_product_sha256:string;product_sha256:string;edits:ReviewedProductTextEdit[];
 requires_new_screening:true;requires_domain_review:true;semantic_equivalence:'NOT_ESTABLISHED';export_allowed:false};
export function reviewTechnologyTextChange(previous:string,replacement:string):TextChangeReview;
export function editableProductTexts(data:unknown):Array<{path:string;text:string;edit_kind:ProductTextEditKind}>;
export function reviseTechnologyProductText(preview:unknown,changes:unknown):Promise<{preview:ProductPreview;local_review:ProductRevisionReview}>;

export type TransferContentIssue={path:string;code:'EXPLICIT_PLACEHOLDER'|'GENERIC_PROCEDURE'|'PARAMETER_WITHOUT_SELECTION_RULE'|'IDENTICAL_DISTINCT_ROLES';related_paths:string[]};
export type TransferContentReview={status:'LOCAL_TECHNOLOGY_CONTENT_REVIEW';issues:TransferContentIssue[];editable_field_count:number;
 recipient:{target:'D05_OPERATION_ROUTE_QUALITY';route_parameter_count:number;operation_count:number;operation_parameter_count:number;
 quality_control_count:number;blocking_control_count:number;material_mapping_count:number}|
 {target:'PERSONAL_AGENT_TASK_PROMPT';result_requirement_count:number;context_requirement_count:number;recipient_interval:boolean};
 semantic_usefulness:'REQUIRES_RECIPIENT_REVIEW';recipient_validation:'REQUIRES_ORIGINAL_CONSUMER';export_allowed:false};
export function reviewTechnologyTransferContent(data:unknown):TransferContentReview;
