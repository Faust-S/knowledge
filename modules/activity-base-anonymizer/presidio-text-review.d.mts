
export type PresidioFinding={entity_type:string;start:number;end:number;score:number};
export type PresidioReview={status:'LOCAL_PRESIDIO_SCREENING_REVIEW';language:'en'|'ru';version:'2.2.366';
 model:string;model_version:string;spacy_version:string;supported_entities:string[];score_threshold:number;
 scanned_field_count:number;flagged_field_count:number;finding_count:number;
 fields:Array<{path:string;text_length:number;findings:PresidioFinding[]}>;
 source_match:'EXACT_CURRENT_TECHNOLOGY_AND_TEXT_INVENTORY';source_authority:'UNVERIFIED_LOCAL_TOOL_OUTPUT';
 scope:'IDENTIFYING_TEXT_SCREENING_ONLY';privacy_conclusion:'NOT_ESTABLISHED';
 domain_validation:'NOT_PERFORMED';anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null};
export function reviewPresidioTextScreening(candidate:unknown,raw:unknown):Promise<PresidioReview>;

export function productTextInventory(data:unknown):Array<{path:string;text:string}>;
export function reviewProductPresidioTextScreening(preview:unknown,raw:unknown):Promise<Omit<PresidioReview,'source_match'|'scope'>&{source_match:'EXACT_CURRENT_PRODUCT_AND_TEXT_INVENTORY';scope:'PRODUCT_IDENTIFYING_TEXT_SCREENING_ONLY'}>;
