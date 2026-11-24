import type {ProductPreview} from './technology-product.mjs';
export type ProductTextEditKind='TEXT'|'CONTROL_TEXT'|'FIXED';
export type ProductTextEdit={path:string;previous:string;replacement:string;reason:string};
export function editableProductTexts(data:unknown):Array<{path:string;text:string;edit_kind:ProductTextEditKind}>;
export function reviseTechnologyProductText(preview:unknown,changes:unknown):Promise<{preview:ProductPreview;local_review:{
 base_product_sha256:string;product_sha256:string;edits:Array<ProductTextEdit&{edit_kind:ProductTextEditKind}>;
 requires_new_screening:true;requires_domain_review:true;semantic_equivalence:'NOT_ESTABLISHED';export_allowed:false}}>;
