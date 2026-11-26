export function practicalWordingKey(value:string):string;

export type RelatedWordingPair={left_id:string;right_id:string;shared_terms:string[];distinct_observations:number};
export function compareRelatedPracticalWordings(rows:Array<{id:string;partition:string;sections:string[];observations:string[]}>,options?:{actionSection?:number}):{pairs:RelatedWordingPair[];limited:boolean};

export function explicitPracticalInstructions(value:string):string[];
