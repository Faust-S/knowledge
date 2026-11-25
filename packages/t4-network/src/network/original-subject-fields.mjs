// Subject metadata follows the original T3 Workspace API contract, not the
// technical identifier grammar. Do not normalize or change signed values.
export const validT4OriginalAssetMime=value=>typeof value==='string'&&value.length>0&&value.length<=255;
export const validT4OriginalRelationKind=value=>typeof value==='string'&&value.length>0&&value.length<=128;
