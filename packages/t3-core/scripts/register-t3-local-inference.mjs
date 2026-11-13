// Build-time registration of the existing BLI1 module in the inherited T2 Host.
// This changes only the assembled T3 dist metadata, never the normative T2
// source, original Kernel, Store, Access owner, or browser model cache.
import {LOCAL_INFERENCE_DRAFT_SCHEMA,LOCAL_INFERENCE_DRAFT_DECLARATION}
  from "../src/t3/local-inference-draft.mjs";

export const LOCAL_INFERENCE_MODULE_ID="iwxa.t3.local-inference";
const fail=code=>{throw Error("T3_D5_MODULE_"+code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const append=(rows,value)=>{if(!rows.includes(value))rows.push(value);};

export function registerT3LocalInferenceService({domain,workspaceConfig,passport}={}){
  const schema=LOCAL_INFERENCE_DRAFT_SCHEMA;
  const module={
    module_id:LOCAL_INFERENCE_MODULE_ID,state:"active",ui_mode:"standard",
    route_base:"/workspace/",slots:["inspector"],required_levels:["T1"],
    required_operations:["t1.getWorkspace"],object_schemas:[schema],
    dependencies:["iwxa.workspace.base"],
  };
  if(workspaceConfig?.base_path!=="/workspace/"||
     workspaceConfig?.module_loading?.strategy!=="compile-time-registry"||
     workspaceConfig?.module_loading?.allow_remote_modules!==false||
     workspaceConfig?.security?.trusted_build_modules_only!==true||
     !Array.isArray(workspaceConfig.modules)||
     !workspaceConfig.modules.some(row=>
       row.module_id==="iwxa.workspace.base"&&row.state==="active"))
    fail("INHERITED_WORKSPACE_REQUIRED");
  if(passport?.service_id!==workspaceConfig.workspace_service_id||
     !Array.isArray(passport?.supported_levels)||
     !passport.supported_levels.includes("T1")||
     passport.permissions?.workspace?.read!==true||
     !passport.schemas||typeof passport.schemas!=="object"||
     Array.isArray(passport.schemas))
    fail("ORIGINAL_SERVICE_REQUIRED");
  const rows=[domain?.security?.allowed_object_classes,
    passport.input_object_types,passport.output_object_types,
    passport.permissions?.objects?.read,passport.permissions?.objects?.write];
  if(rows.some(row=>!Array.isArray(row)))
    fail("ORIGINAL_SCHEMA_PERMISSIONS_REQUIRED");
  const existing=workspaceConfig.modules.filter(row=>
    row.module_id===LOCAL_INFERENCE_MODULE_ID);
  if(existing.length>1||(existing.length===1&&!same(existing[0],module)))
    fail("MODULE_CONFLICT");
  if(Object.hasOwn(passport.schemas,schema) &&
     !same(passport.schemas[schema],LOCAL_INFERENCE_DRAFT_DECLARATION))
    fail("SCHEMA_CONFLICT");
  // All preflight checks above run before the first mutation. Existing
  // service and other subject/module permissions are never replaced.
  if(existing.length===0)workspaceConfig.modules.push(module);
  for(const row of rows)append(row,schema);
  if(!Object.hasOwn(passport.schemas,schema))
    passport.schemas[schema]=LOCAL_INFERENCE_DRAFT_DECLARATION;
  return {module_id:LOCAL_INFERENCE_MODULE_ID,schema_id:schema,
    registered:true,already_registered:existing.length===1};
}
