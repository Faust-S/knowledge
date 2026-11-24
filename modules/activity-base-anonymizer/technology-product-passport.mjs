// Ordinary T2 service passport and subject schema. The original Host
// installs the passport; it does not mint a grant. The private reviewer
// passport stays nonexportable. No second .iwxa format or archive writer.
import {TECHNOLOGY_SCHEMA,TECHNOLOGY_VERSION,PERSONAL_TARGET,D05_TARGET} from './technology-product.mjs';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const str=maxLength=>({type:'string',minLength:1,maxLength});
const nullableStr=maxLength=>({type:['string','null'],maxLength});
const en=(...values)=>({enum:values});
const arr=(items,minItems,maxItems)=>({type:'array',items,minItems,maxItems});
const record=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const ref=pattern=>({type:'string',pattern});
const param=record({field:en('quantity','calendarMode','workingDays','hoursPerDay','overallReserve','duration','unit','setup','buffer','slack'),
 mode:en('RETAIN_DECLARATION','PARAMETERIZE'),
 value:{oneOf:[{type:'string',maxLength:4096},{type:'null'},arr({type:'integer',minimum:0,maximum:6},1,7)]},guidance:nullableStr(4096)});
const opId=ref('^op_[0-9]{3,5}$'),checkId=ref('^check_[0-9]{3,5}$');
const operation=record({operation_id:opId,label:str(4096),kind:en('internal','subcontract','wait','inspection','transport'),
 parallel:{type:'boolean'},milestone:{type:'boolean'},predecessors:arr(opId,0,128),role:str(4096),
 equipment_requirement:str(4096),material_requirement:str(4096),parameters:arr(param,5,5)});
const qualityField=record({field:en('related_material_id','related_product_characteristic','requirement','unit','lower_limit','target_value',
 'upper_limit','allowed_values','result_type','inspection_method','inspection_method_custom','sampling_rule','required_evidence',
 'blocking','action_on_failure','action_custom','comment'),
 use:en('DECLARED_SOURCE_CONDITION','FUNCTIONAL_MAPPING_REQUIRED'),
 value:{type:['string','boolean','null'],maxLength:4096},status:en('DECLARED','NOT_SPECIFIED_OR_NOT_APPLICABLE','LOCAL_REFERENCE_REVIEW_REQUIRED')});
const qualityCheck=record({check_id:checkId,title:str(4096),operation_id:{oneOf:[opId,{type:'null'}]},
 control_type:en('incoming-material','before-op','in-op','after-op','final','subcontract-acceptance','packaging','completeness','pre-shipment'),
 responsible_role:str(4096),declared_fields:arr(qualityField,1,17)});
const d05=record({terms:record(Object.fromEntries(['purpose','inputs','outputs','applicability','adaptation_guidance','local_context_guidance'].map(k=>[k,str(4096)]))),
 route_parameters:arr(param,5,5),operations:arr(operation,1,128),quality_checks:arr(qualityCheck,1,256)});
const personal=record({purpose:str(4096),inputs:str(4096),outputs:str(4096),applicability:str(4096),instructions:str(16000),
 result_requirements:arr(str(1000),1,32),
 cadence:record({mode:en('RETAIN_INTERVAL','RECIPIENT_INTERVAL'),interval_seconds:{type:['integer','null'],minimum:60,maximum:31536000},
 guidance:nullableStr(4096)}),context_requirements:arr(str(1000),0,16)});
export const TECHNOLOGY_DECLARATION=freeze({
 schema_version:TECHNOLOGY_VERSION,preserve_unknown:false,
 json_schema:{...record({title:str(240),target:en(D05_TARGET,PERSONAL_TARGET),technology:{type:'object'}}),oneOf:[
  record({title:str(240),target:{const:D05_TARGET},technology:d05}),
  record({title:str(240),target:{const:PERSONAL_TARGET},technology:personal}),
 ]},embedded:{}
});
export const TECHNOLOGY_SERVICE='iwxa.activity.technology';
export const TECHNOLOGY_PASSPORT=freeze({
 service_id:TECHNOLOGY_SERVICE,service_version:TECHNOLOGY_VERSION,
 base_path:'/workspace/activity-technology/',supported_levels:['T1','T2'],
 input_object_types:[TECHNOLOGY_SCHEMA],output_object_types:[TECHNOLOGY_SCHEMA],
 schemas:{[TECHNOLOGY_SCHEMA]:TECHNOLOGY_DECLARATION},
 permissions:{workspace:{list:false,read:true,create:true,soft_delete:false,restore:false,purge:false},
  objects:{read:[TECHNOLOGY_SCHEMA],write:[TECHNOLOGY_SCHEMA],delete:[]},
  events:{read_scope:'service'},packages:{export:true,import:true,export_scope:'readable_objects',import_scope:'writable_objects'}}
});
