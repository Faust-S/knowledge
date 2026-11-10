import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateWitnessContract,verifiedInputFixture,stageQualificationReader,assertNoUnrelatedMutation,selectWitnessOption,witnessedNewWorkspaceIds} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const file=(path,value)=>writeFileSync(path,JSON.stringify(value));
function host(){
 const temp=mkdtempSync(join(tmpdir(),'t2-witness-check-')),root=join(temp,'site');
 for(const dir of ['_iwxa/services','_iwxa/security','workspace'])mkdirSync(join(root,dir),{recursive:true});
 const id='ru.test',source={service_id:id,service_version:'1.0.0',base_path:'/workspace/',supported_levels:['T0','T1','T2'],input_object_types:[],output_object_types:['ru.note'],schemas:{'ru.note':{schema_version:'1.0.0',preserve_unknown:true,json_schema:{type:'object'},embedded:{}}},permissions:{workspace:{list:true,read:true,create:true,soft_delete:false,restore:false,purge:false},objects:{read:['ru.note'],write:['ru.note'],delete:[]},events:{read_scope:'service'},packages:{export:true,import:true,export_scope:'workspace',import_scope:'workspace'}}};
 file(join(root,'_iwxa/services/'+id+'.json'),source);
 file(join(root,'_iwxa/domain.json'),{status:'development',domain_id:'ru.test',modules:[{service_id:id,base_path:'/workspace/'}]});
 file(join(root,'workspace/workspace.config.json'),{workspace_service_id:id});
 file(join(root,'_iwxa/security/capability-control-plane.json'),{schema_version:'0.3.1',snapshot_id:'unit',resolver_id:'unit',trusted_issuers:[],issuance_policies:[],services:[{schema_version:'0.3.1',service_id:id,capability_control:'NONE',capability_ceiling:[],activation_any_of:[],operation_guards:[]}]});
 const sourceBytes=readFileSync(join(root,'_iwxa/services/'+id+'.json'));
 file(join(root,'_iwxa/service-catalog.json'),{count:1,entries:[{service_id:id,service_version:'1.0.0',base_path:'/workspace/',supported_levels:['T0','T1','T2'],file:'_iwxa/services/'+id+'.json',sha256:sha(sourceBytes)}]});
 return {temp,root};
}
function journey(actions=[{type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}]){
 return {serviceId:'ru.test',readServiceId:'iwxa.t2.qualification.reader',denyServiceId:'iwxa.t2.qualification.reader',family:'note',schemaId:'ru.note',route:'/workspace/',resultSelector:'#result',actions};
}
function contract(j){return {witness:{runner:'T2_PLAYWRIGHT_KERNEL_READBACK',previewOrigin:'LOOPBACK_TLS',auditorMode:'ISOLATED_READ_ONLY',journeys:[j]},inventory:{}};}
const inventory={serviceIds:['ru.test'],routes:['/workspace/'],persistentFamilies:['note']};
test('ordinary and file-upload journeys validate without relaxing fresh challenge',()=>{
 assert.doesNotThrow(()=>validateWitnessContract(contract(journey()),inventory));
 const j=journey([{type:'setInputFiles',selector:'input[type=file]',fixtureId:'signed'},{type:'expectConfirm',message:'Send result?',decision:'accept'}, {type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}]);
 const c=contract(j);c.witness.fileFixtures=[{id:'signed',name:'valid.iwxa',sha256:'a'.repeat(64)}];
 assert.doesNotThrow(()=>validateWitnessContract(c,inventory));
 assert.throws(()=>validateWitnessContract(contract(journey([{type:'setInputFiles',selector:'input[type=file]',fixtureId:'unlisted'},{type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}])),inventory),/FILE_FIXTURE_UNDECLARED/);
 assert.throws(()=>validateWitnessContract(contract(journey([{type:'setInputFiles',selector:'input[type=file]',fixtureId:'bad'}])),inventory),/FILE_FIXTURE_UNDECLARED|FRESH_UI_CHALLENGE_REQUIRED/);
});
test('signed fixture bytes come from external qualification root and match SHA',()=>{
 const {root,temp}=host();
 try{
  const run=join(temp,'outside'),dir=join(run,'WITNESS_FIXTURES');mkdirSync(dir,{recursive:true});
  const bytes=Buffer.from('valid signed fixture placeholder');writeFileSync(join(dir,'signed'),bytes);
  const w={fileFixtures:[{id:'signed',name:'valid.iwxa',sha256:sha(bytes)}]};
  assert.deepEqual(verifiedInputFixture(run,root,w,'signed').buffer,bytes);
  writeFileSync(join(dir,'signed'),Buffer.from('tampered'));
  assert.throws(()=>verifiedInputFixture(run,root,w,'signed'),/FILE_FIXTURE_HASH_MISMATCH/);
  assert.throws(()=>verifiedInputFixture(root,root,w,'signed'),/FILE_FIXTURE_ROOT_IN_SITE/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('temporary auditor has no write, delete, import, or lifecycle permissions and is removed',()=>{
 const {temp,root}=host();
 try{
  const orig=readFileSync(join(root,'_iwxa/domain.json'));
  const stage=stageQualificationReader(root,{auditorMode:'ISOLATED_READ_ONLY',journeys:[journey()]});
  assert.notEqual(stage.root,root);
  const reader=JSON.parse(readFileSync(join(stage.root,'_iwxa/services/iwxa.t2.qualification.reader.json')));
  assert.deepEqual(reader.permissions.objects,{read:['*'],write:[],delete:[]});
  assert.equal(reader.permissions.workspace.purge,false);
  assert.equal(reader.permissions.packages.import,false);
  assert.equal(reader.permissions.packages.export,false);
  assert.equal(reader.permissions.packages.export_scope,'readable_objects');
  assert.equal(reader.permissions.packages.import_scope,'writable_objects');
  assert.deepEqual(readFileSync(join(root,'_iwxa/domain.json')),orig);
  assert.equal(existsSync(join(root,'_iwxa/services/iwxa.t2.qualification.reader.json')),false);
  const stagedRoot=stage.root;stage.cleanup();assert.equal(existsSync(stagedRoot),false);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('unexpected related object fails, declared relation requires receipt',()=>{
 const key={workspaceId:'ws',objectId:'main'};
 const baseline={workspaceIds:['ws'],rows:[],relations:[],events:[]};
 const primary={workspaceId:'ws',objectId:'main',object:{workspace_id:'ws',object_id:'main',schema_id:'ru.note'}};
 const related={workspaceId:'ws',objectId:'other',object:{workspace_id:'ws',object_id:'other',schema_id:'ru.note'}};
 const mutation=id=>({serviceId:'ru.test',operation:'putObject',input:[{object_id:id}],receipt:{object:{workspace_id:'ws',object_id:id},event:{event_id:id,workspace_id:'ws'}}});
 assert.doesNotThrow(()=>assertNoUnrelatedMutation(baseline,{...baseline,rows:[primary]},key,undefined,[mutation('main')],'ru.test'));
 assert.throws(()=>assertNoUnrelatedMutation(baseline,{...baseline,rows:[primary,related]},key,undefined,[mutation('main'),mutation('other')],'ru.test'),/UNDECLARED_OBJECT_WRITE/);
 assert.doesNotThrow(()=>assertNoUnrelatedMutation(baseline,{...baseline,rows:[primary,related]},key,{objects:[{change:'create',schemaId:'ru.note',count:1}],relations:[]},[mutation('main'),mutation('other')],'ru.test'));
});

test('history without a corresponding Kernel receipt is rejected',()=>{
 const identity={workspaceId:'ws',objectId:'main'};
 const before={workspaceIds:['ws'],rows:[],relations:[],events:[]};
 const after={...before,rows:[{workspaceId:'ws',objectId:'main',object:{schema_id:'ru.note'}}],events:[{workspaceId:'ws',event:{event_id:'unexpected',workspace_id:'ws',event_type:'user.note.created',service_id:'ru.test'}}]};
 const mutation={serviceId:'ru.test',operation:'putObject',input:[{workspace_id:'ws',object_id:'main'}],receipt:{object:{workspace_id:'ws',object_id:'main'},event:{workspace_id:'ws',event_id:'expected'}}};
 assert.throws(()=>assertNoUnrelatedMutation(before,after,identity,undefined,[mutation],'ru.test'),/UNOBSERVED_HISTORY_EVENT/);
});
test('related relation requires declared effect and observed receipt',()=>{
 const identity={workspaceId:'ws',objectId:'main'};
 const before={workspaceIds:['ws'],rows:[],relations:[],events:[]};
 const primary={workspaceId:'ws',objectId:'main',object:{schema_id:'ru.note'}};
 const related={workspaceId:'ws',relation:{workspace_id:'ws',relation_id:'link',kind:'depends-on'}};
 const after={...before,rows:[primary],relations:[related]};
 const write={serviceId:'ru.test',operation:'putObject',receipt:{object:{workspace_id:'ws',object_id:'main'},event:{workspace_id:'ws',event_id:'event'}}};
 assert.throws(()=>assertNoUnrelatedMutation(before,after,identity,undefined,[write],'ru.test'),/UNOBSERVED_RELATION_WRITE/);
 const relationWrite={serviceId:'ru.test',operation:'putRelation',receipt:{relation:related.relation,event:{workspace_id:'ws',event_id:'relation-event'}}};
 assert.throws(()=>assertNoUnrelatedMutation(before,after,identity,undefined,[write,relationWrite],'ru.test'),/UNDECLARED_RELATION_WRITE/);
 assert.doesNotThrow(()=>assertNoUnrelatedMutation(before,after,identity,{objects:[],relations:[{change:'create',kind:'depends-on',count:1}]},[write,relationWrite],'ru.test'));
});

test('select DSL accepts dynamic index and retains literal value semantics',()=>{
 const dynamic=contract(journey([{type:'select',selector:'#workspace',index:1},{type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}]));
 assert.doesNotThrow(()=>validateWitnessContract(dynamic,inventory));
 const legacy=contract(journey([{type:'select',selector:'#workspace',value:'known-ws'},{type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}]));
 assert.doesNotThrow(()=>validateWitnessContract(legacy,inventory));
 for(const select of [{index:0},{index:-1},{index:1.5},{index:NaN},{index:Infinity},{index:'1'},{index:1,value:'ws'},{value:'ws',index:undefined},{}]){
  const c=contract(journey([{type:'select',selector:'#workspace',...select},{type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}]));
  assert.throws(()=>validateWitnessContract(c,inventory),/SELECT_TARGET_INVALID/);
 }
 assert.throws(()=>validateWitnessContract(contract(journey([{type:'select',selector:'#workspace',value:3},{type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}])),inventory),/ACTION_VALUE_INVALID/);
});
test('select contract refuses empty target, including legacy empty placeholder',()=>{
 for(const value of ['', '   ']){
  assert.throws(()=>validateWitnessContract(contract(journey([
   {type:'select',selector:'#workspace',value},
   {type:'fill',selector:'#title',value:'{{T2_CHALLENGE}}'}
  ])),inventory),/SELECT_TARGET_INVALID/);
 }
});
test('dynamic Workspace index selects one live option and refuses ambiguity, missing and disabled choices',async()=>{
 const id='ws-'+randomUUID();
 const fake=(options,change=()=>{})=>{
  const node={tagName:'SELECT',disabled:false,multiple:false,options,selectedIndex:0};
  let writes=0;
  return {node,get writes(){return writes;},
   locator(selector){assert.equal(selector,'option');return {nth(i){return {async waitFor(){if(i>=options.length)throw Error('missing option');}}}}},
   async evaluate(fn,index){return fn(node,index);},
   async selectOption(arg){writes++;node.selectedIndex=Object.hasOwn(arg,'index')?arg.index:options.findIndex(o=>o.value===arg.value);change(node);return [options[node.selectedIndex].value];}
  };
 };
 let ui=fake([{value:''},{value:id}]);
 await selectWitnessOption(ui,{index:1});
 assert.equal(ui.node.selectedIndex,1);assert.equal(ui.writes,1);
 ui=fake([{value:''},{value:'ws-existing'},{value:id}]);
 await assert.rejects(selectWitnessOption(ui,{index:1}),/SELECT_INDEX_AMBIGUOUS/);
 assert.equal(ui.writes,0);
 ui=fake([{value:''},{value:id,disabled:true}]);
 await assert.rejects(selectWitnessOption(ui,{index:1}),/SELECT_INDEX_OPTION_INVALID/);
 assert.equal(ui.writes,0);
 ui=fake([{value:''}]);
 await assert.rejects(selectWitnessOption(ui,{index:1}),/missing option/);
 ui=fake([{value:''},{value:id}],node=>{node.options[1]={value:'ws-swapped'}});
 await assert.rejects(selectWitnessOption(ui,{index:1}),/SELECT_TARGET_MISMATCH/);
 ui=fake([{value:''},{value:id}]);
 await assert.rejects(selectWitnessOption(ui,{value:''}),/SELECT_TARGET_INVALID/);
 assert.equal(ui.writes,0);
 ui=fake([{value:''},{value:id}]);
 await selectWitnessOption(ui,{value:id});
 assert.equal(ui.writes,1);
});

test('created workspace target is grounded in current journey Kernel receipt',()=>{
 const id='ws-'+randomUUID(),old='ws-old';
 const history=[{type:'commit',operation:'createWorkspace',input:[{workspace_id:old}],receipt:{workspace_id:old}},
 {type:'commit',operation:'createWorkspace',input:[{workspace_id:id}],receipt:{workspace_id:id}},
 {type:'commit',operation:'createWorkspace',input:[{workspace_id:'ws-forged'}],receipt:{workspace_id:'ws-other'}}];
 assert.deepEqual(witnessedNewWorkspaceIds(history,[old]),[id]);
 assert.deepEqual(witnessedNewWorkspaceIds(history,[old,id]),[]);
});
test('newly created workspace is selectable among existing options, but only with receipt evidence',async()=>{
 const id='ws-'+randomUUID(),old='ws-old',options=[{value:''},{value:old},{value:id}];
 let selectedIndex=0;
 const node={tagName:'SELECT',disabled:false,multiple:false,options,get selectedIndex(){return selectedIndex;}};
 const loc={locator(){return {nth(){return {async waitFor(){}}}};},
  async evaluate(fn,target){return fn(node,target);},
  async selectOption(arg){selectedIndex=options.findIndex(o=>o.value===arg.value);return [arg.value];}};
 await selectWitnessOption(loc,{createdWorkspace:true},{getCreatedWorkspaces:()=>[id]});
 assert.equal(selectedIndex,2);
 selectedIndex=0;
 await assert.rejects(selectWitnessOption(loc,{index:1}),/SELECT_INDEX_AMBIGUOUS/);
 assert.equal(selectedIndex,0);
 await assert.rejects(selectWitnessOption(loc,{createdWorkspace:true},{getCreatedWorkspaces:()=>[old,id]}),/SELECT_CREATED_WORKSPACE_AMBIGUOUS/);
});
test('controlled asynchronous focus waits for Host confirmation before allowing next write',async()=>{
 const id='ws-'+randomUUID(),options=[{value:''},{value:id}];
 let pending=false,confirmed=false,selectedIndex=0;
 const node={tagName:'SELECT',multiple:false,options,get selectedIndex(){return selectedIndex;},get disabled(){return pending;}};
 const loc={
  locator(){return {nth(){return {async waitFor(){}}}};},
  async evaluate(fn,index){return fn(node,index);},
  async selectOption(){selectedIndex=1;pending=true;setTimeout(()=>{confirmed=true;pending=false;},140);return [id];}
 };
 const started=Date.now();
 await selectWitnessOption(loc,{index:1},{confirmationTimeoutMs:1000});
 assert.equal(confirmed,true);assert.ok(Date.now()-started>=120);
});
test('failed asynchronous Host focus is never accepted as successful workspace selection',async()=>{
 const id='ws-'+randomUUID(),options=[{value:''},{value:id}];
 let pending=false,selectedIndex=0;
 const node={tagName:'SELECT',multiple:false,options,get selectedIndex(){return selectedIndex;},get disabled(){return pending;}};
 const loc={
  locator(){return {nth(){return {async waitFor(){}}}};},
  async evaluate(fn,index){return fn(node,index);},
  async selectOption(){selectedIndex=1;pending=true;setTimeout(()=>{selectedIndex=0;pending=false;},90);return [id];}
 };
 await assert.rejects(selectWitnessOption(loc,{index:1},{confirmationTimeoutMs:450}),/SELECT_CONFIRMATION_TIMEOUT/);
 assert.equal(selectedIndex,0);
});
