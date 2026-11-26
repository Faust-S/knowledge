export type PracticalLesson={lesson_id:string;control_number:number;control:string;operation_id:string|null;problem:string;action:string;disposition:string;
 observations:Array<{model_number:number;report_number:number;quality_report_number:number;recorded_defect_status:string;followup_status:string|null;recorded_recheck:boolean}>;
 scope:string;severity:string;deviation_type:string|null;wording_review_required:boolean;
 variants:Array<{problem:string;action:string;order_count:number;observations:PracticalLesson['observations']}>;
 order_count:number;rechecked_order_count:number;unresolved_order_count:number;status:'REQUIRES_REVIEW'|'REPORTED_CORRECTION_AND_RECHECK';suggested_guidance:string|null};
export type PracticalLessonReview={status:'LOCAL_D05_PRACTICAL_LESSONS';source_model_number:number;source_sha256:string;
 source_model_numbers:number[];source_report_count:number;excluded_duplicate_order_count:number;excluded_unaligned_count:number;
 lessons:PracticalLesson[];related_candidates:import('./practical-rule-wording.mjs').RelatedWordingPair[];related_comparison_limited:boolean;semantics:'RECORDED_CORRECTIONS_NOT_CAUSAL_PROOF';export_allowed:false;iwxa_package:null};
export type PracticalExperienceOptions={includeCompatibleDeclarations?:boolean};
export function extractD05PracticalLessons(review:unknown,groupId:string,modelNumber:number,options?:PracticalExperienceOptions):Promise<PracticalLessonReview>;
export function selectD05PracticalExperience(review:unknown,groupId:string,modelNumber:number,options?:PracticalExperienceOptions):Promise<{
 model_numbers:number[];reports:unknown[];duplicate_order_count:number;source_references:import('./technology-disclosure-generalization.mjs').SourceReference[]}>;

