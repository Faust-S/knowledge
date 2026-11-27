import test from "node:test";
import assert from "node:assert/strict";
import {registerT3LocalInferenceService} from "../scripts/register-t3-local-inference.mjs";
import {AGENT_CONVERSATION_SCHEMA,AGENT_CONVERSATION_DECLARATION} from "../src/t3/agent-conversation-declaration.mjs";
const D="iwxa.local-inference.draft";
const A=AGENT_CONVERSATION_SCHEMA;
const fixture=()=>({
  domain:{domain_id:"iwxa.personal-agent",origin:"https://localhost",security:{allowed_object_classes:[]}},
  workspaceConfig:{workspace_service_id:"iwxa.personal-agent.workspace",base_path:"/workspace/",
    module_loading:{strategy:"compile-time-registry",allow_remote_modules:false},security:{trusted_build_modules_only:true},
    modules:[{module_id:"iwxa.workspace.base",state:"active"}]},
  passport:{service_id:"iwxa.personal-agent.workspace",supported_levels:["T1"],
    input_object_types:[],output_object_types:[],schemas:{},
    permissions:{workspace:{read:true},objects:{read:[],write:[],delete:[]},operations:[]}},
});
test("archive is opt-in only in Android Agent original native module",()=>{
  const f=fixture();registerT3LocalInferenceService({...f,androidNativeInference:true,androidConversationArchive:true});
  assert.deepEqual(Object.keys(f.passport.schemas),[D,A]);
  assert.deepEqual(f.passport.schemas[A],AGENT_CONVERSATION_DECLARATION);
  for(const a of [f.domain.security.allowed_object_classes,f.passport.input_object_types,f.passport.output_object_types,
    f.passport.permissions.objects.read,f.passport.permissions.objects.write,f.workspaceConfig.modules.at(-1).object_schemas])assert.deepEqual(a,[D,A]);
  assert.deepEqual(f.passport.permissions.objects.delete,[]);assert.deepEqual(f.passport.permissions.operations,[]);
  const first=JSON.stringify(f);registerT3LocalInferenceService({...f,androidNativeInference:true,androidConversationArchive:true});
  assert.equal(JSON.stringify(f),first);
});
test("older native and browser profiles do not get conversation schema",()=>{
  for(const native of [false,true]){const f=fixture();registerT3LocalInferenceService({...f,androidNativeInference:native});assert.deepEqual(Object.keys(f.passport.schemas),[D]);}
});
test("foreign product and non-native activation are refused before mutation",()=>{
  for(const change of [f=>f.domain.origin="https://other.test",f=>f.domain.domain_id="other",f=>f.workspaceConfig.workspace_service_id="other"]){
    const f=fixture();change(f);const before=JSON.stringify(f);
    assert.throws(()=>registerT3LocalInferenceService({...f,androidNativeInference:true,androidConversationArchive:true}),/NATIVE_PRODUCT_REQUIRED/);assert.equal(JSON.stringify(f),before);
  }
  const f=fixture(),before=JSON.stringify(f);assert.throws(()=>registerT3LocalInferenceService({...f,androidConversationArchive:true}),/NATIVE_PRODUCT_REQUIRED/);assert.equal(JSON.stringify(f),before);
});
test("conflicting archive declaration is refused before any permission changes",()=>{
  const f=fixture();f.passport.schemas[A]={schema_version:"1.0.0",json_schema:{type:"object"}};const before=JSON.stringify(f);
  assert.throws(()=>registerT3LocalInferenceService({...f,androidNativeInference:true,androidConversationArchive:true}),/CONVERSATION_SCHEMA_CONFLICT/);assert.equal(JSON.stringify(f),before);
});
