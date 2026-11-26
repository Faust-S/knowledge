export type PracticalLesson={lesson_id:string;control_number:number;control:string;operation_id:string|null;problem:string;action:string;disposition:string;
 observations:Array<{report_number:number;quality_report_number:number;recorded_defect_status:string;followup_status:string|null;recorded_recheck:boolean}>;
 order_count:number;rechecked_order_count:number;unresolved_order_count:number;status:'REQUIRES_REVIEW'|'REPORTED_CORRECTION_AND_RECHECK';suggested_guidance:string|null};
export type PracticalLessonReview={status:'LOCAL_D05_PRACTICAL_LESSONS';source_model_number:number;source_sha256:string;
 lessons:PracticalLesson[];semantics:'RECORDED_CORRECTIONS_NOT_CAUSAL_PROOF';export_allowed:false;iwxa_package:null};
export function extractD05PracticalLessons(review:unknown,groupId:string,modelNumber:number):Promise<PracticalLessonReview>;
