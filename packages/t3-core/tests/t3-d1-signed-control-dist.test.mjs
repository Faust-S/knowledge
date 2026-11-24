import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'t3-d1-assemble-'));
  const t2=join(dir,'t2'),t3=join(dir,'compiled'),out=join(dir,'out');
  const put=(root,path,content)=>{
    const target=join(root,path);mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,content);
  };
  put(t2,'_iwxa/loader.js','original loader');
  put(t2,'_iwxa/runtime/0.3.6/runtime.js','original Kernel 0.3.6');
  put(t2,'_iwxa/domain.json',JSON.stringify({origin:'http://127.0.0.1:18883'}));
  put(t2,'_iwxa/domain-shell.json','{}');
  put(t2,'_iwxa/service-catalog.json',JSON.stringify({count:1,entries:[{service_id:'test.original'}]}));
  put(t2,'workspace/workspace.config.json',JSON.stringify({workspace_service_id:'test.original'}));
  put(t2,'workspace/index.html','<p>Original T2 unchanged</p>');
  put(t2,'workspace/assets/original.js','Original T2 chunk');
  put(t3,'signed-workspace.html','<base href="/workspace/"><script type="module" src="/workspace/assets/signed-123.js"></script>');
  put(t3,'isolated-signed-workspace.html','<base href="/workspace/"><script type="module" src="/workspace/assets/signed-123.js"></script>');
  put(t3,'trusted-kernel-realm.html','<base href="/workspace/"><script type="module" src="/workspace/assets/signed-123.js"></script>');
  put(t3,'assets/signed-123.js','console.log("signed")');
  put(t3,'assets/shared-456.css','body{}');
  put(t3,'favicon.ico','icon');
  return {dir,t2,t3,out,put,run:()=>assembleSignedControlDist({
    t2Dist:t2,t3Build:t3,outputDir:out,testOnlyUnqualifiedFixture:true,
  })};
}
test('assemble installed Control one-dist from original Kernel, preserving every original asset',()=>{
  const f=fixture();
  try{
    const result=f.run();
    assert.equal(result.origin,'http://127.0.0.1:18883');
    assert.equal(result.original_runtime_unchanged,true);
    assert.equal(result.original_agent_d6_schema_registered,false,
      'ordinary T2/T3 products do not receive Agent D6 permissions');
    assert.equal(result.signed_assets,2);
    assert.equal(result.isolated_realm_entries,true);
    assert.equal(readFileSync(join(f.out,'workspace/isolated-signed-workspace.html'),'utf8'),
      readFileSync(join(f.t3,'isolated-signed-workspace.html'),'utf8'));
    assert.equal(readFileSync(join(f.out,'workspace/trusted-kernel-realm.html'),'utf8'),
      readFileSync(join(f.t3,'trusted-kernel-realm.html'),'utf8'));
    assert.equal(readFileSync(join(f.out,'workspace/index.html'),'utf8'),'<p>Original T2 unchanged</p>');
    assert.equal(readFileSync(join(f.out,'_iwxa/runtime/0.3.6/runtime.js'),'utf8'),'original Kernel 0.3.6');
    assert.equal(readFileSync(join(f.out,'workspace/assets/signed-123.js'),'utf8'),'console.log("signed")');
    assert.equal(readFileSync(join(f.out,'workspace/assets/original.js'),'utf8'),'Original T2 chunk');
    assert.equal(readFileSync(join(f.out,'workspace/favicon.ico'),'utf8'),'icon');
    assert.throws(()=>f.run(),/T3_D1_DIST_OUTPUT_ALREADY_EXISTS/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('refuse workspace asset collisions before modifying the original T2 or writing output',()=>{
  const f=fixture();
  try{
    f.put(f.t2,'workspace/assets/signed-123.js','Different T2 asset');
    assert.throws(()=>f.run(),/T3_D1_DIST_SIGNED_ASSET_COLLISION/);
    assert.equal(existsSync(f.out),false);
    assert.equal(readFileSync(join(f.t2,'workspace/assets/signed-123.js'),'utf8'),'Different T2 asset');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('refuse insecure external HTTP origin and an absent original service',()=>{
  const f=fixture();
  try{
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({origin:'http://example.test'}));
    assert.throws(()=>f.run(),/T3_D1_DIST_PRODUCT_PINNED_HTTPS_OR_NATIVE_LOOPBACK_ORIGIN_REQUIRED/);
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({origin:'http://127.0.0.1:18883'}));
    f.put(f.t2,'_iwxa/service-catalog.json','{"entries":[]}');
    assert.throws(()=>f.run(),/T3_D1_DIST_ORIGINAL_WORKSPACE_SERVICE_REQUIRED/);
    assert.equal(existsSync(f.out),false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('production assembly rejects a fabricated Kernel even when its files are self-consistent',()=>{
  const f=fixture();
  try{
    assert.throws(()=>assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
    }),/FACTORY2_WITNESS_KERNEL_ARTIFACT_MISMATCH/);
    assert.equal(existsSync(f.out),false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('installed Admin D3 records use the original T2 passport and unchanged Kernel',()=>{
  const f=fixture();
  try{
    const schema='iwxa.admin.applied-results';
    const accessSchema='iwxa.t3.access.signed-registry';
    const path='_iwxa/services/test.original.json';
    const passport={
      service_id:'test.original',supported_levels:['T0','T1','T2'],
      permissions:{workspace:{read:true,create:false},
        objects:{read:['existing.object'],write:['existing.object']}},
      input_object_types:['existing.object'],
      output_object_types:['existing.object'],
      schemas:{'existing.object':{schema_version:'1.0.0'}},
    };
    const source=JSON.stringify(passport);
    f.put(f.t2,path,source);
    f.put(f.t2,'_iwxa/service-catalog.json',JSON.stringify({
      count:1,entries:[{service_id:'test.original',file:path,
        sha256:createHash('sha256').update(source).digest('hex')}],
    }));
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({
      origin:'http://127.0.0.1:18883',
      security:{allowed_object_classes:['existing.object']},
    }));
    f.put(f.t2,'workspace/workspace.config.json',JSON.stringify({
      base_path:'/workspace/',workspace_service_id:'test.original',
    }));
    const result=assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
      testOnlyUnqualifiedFixture:true,installedOriginalAdminD3:true,
    });
    assert.equal(result.original_admin_d3_schema_registered,true);
    assert.equal(result.original_runtime_unchanged,true);
    const installed=JSON.parse(readFileSync(join(f.out,path),'utf8'));
    assert.equal(installed.permissions.workspace.create,true,
      'installed original Admin exposes the existing T2 create operation');
    assert.deepEqual(installed.permissions.operations,["t1.commitObjectGraph"],
      'installed Admin advertises the genuine T2 atomic operation');
    assert.equal(passport.permissions.operations,undefined,
      'normative original T2 passport has not been widened');
    assert.equal(passport.permissions.workspace.create,false,
      'the source and ordinary T2 services are not widened');
    const domain=JSON.parse(readFileSync(join(f.out,'_iwxa/domain.json'),'utf8'));
    const catalog=JSON.parse(readFileSync(join(f.out,'_iwxa/service-catalog.json'),'utf8'));
    for(const row of [installed.permissions.objects.write,
      installed.permissions.objects.read,installed.input_object_types,
      installed.output_object_types,domain.security.allowed_object_classes])
      assert.deepEqual(row,['existing.object',schema,accessSchema]);
    assert.equal(installed.schemas[schema].schema_version,'1.0.0');
    assert.equal(installed.schemas[accessSchema].schema_version,'1.0.0');
    assert.equal(installed.schemas[accessSchema].preserve_unknown,true);
    assert.deepEqual(installed.schemas[accessSchema].json_schema,
      {type:'object'},'original signed AccessRegistry validates status and history');
    assert.deepEqual(
      installed.schemas[schema].json_schema.properties.records.items.properties.result,
      {type:'string'},
      'the original signed recipient accepts an empty Result');
    assert.deepEqual(installed.schemas[schema].json_schema.required,['schema','records']);
    assert.equal(catalog.entries[0].sha256,
      createHash('sha256').update(readFileSync(join(f.out,path))).digest('hex'));
    assert.equal(readFileSync(join(f.t2,path),'utf8'),source,
      'original qualified passport remains unmodified');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('installed Admin D3 requires an original service passport',()=>{
  const f=fixture();
  try{
    assert.throws(()=>assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
      testOnlyUnqualifiedFixture:true,installedOriginalAdminD3:true,
    }),/T3_D1_DIST_ORIGINAL_SERVICE_PASSPORT_PATH/);
    assert.equal(existsSync(f.out),false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('installed Agent D6 registers company work alongside accepted-result only in original T2 passport',()=>{
  const f=fixture();
  try{
    const resultSchema='iwxa.agent.accepted-result';
    const companySchema='iwxa.t3.company-work-record';
    const path='_iwxa/services/test.original.json';
    const original={
      service_id:'test.original',supported_levels:['T0','T1','T2'],
      permissions:{workspace:{read:true,create:false},
        objects:{read:['existing.object'],write:['existing.object']}},
      input_object_types:['existing.object'],
      output_object_types:['existing.object'],
      schemas:{'existing.object':{schema_version:'1.0.0'}},
    };
    const source=JSON.stringify(original);
    f.put(f.t2,path,source);
    f.put(f.t2,'_iwxa/service-catalog.json',JSON.stringify({
      count:1,entries:[{service_id:'test.original',file:path,
        sha256:createHash('sha256').update(source).digest('hex')}],
    }));
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({
      origin:'http://127.0.0.1:18883',
      security:{allowed_object_classes:['existing.object']},
    }));
    f.put(f.t2,'workspace/workspace.config.json',JSON.stringify({
      base_path:'/workspace/',workspace_service_id:'test.original',
    }));
    const compiled=assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
      testOnlyUnqualifiedFixture:true,installedOriginalAgentD6:true,
    });
    assert.equal(compiled.original_agent_d6_schema_registered,true);
    assert.equal(compiled.original_admin_d3_schema_registered,false);
    assert.equal(compiled.original_runtime_unchanged,true);
    const passport=JSON.parse(readFileSync(join(f.out,path),'utf8'));
    assert.equal(passport.permissions.workspace.create,false,
      'source Result publication must not create a Workspace');
    assert.deepEqual(passport.permissions.operations,['t1.commitObjectGraph'],
      'reuse the original inherited T2 graph command');
    for(const row of [passport.permissions.objects.read,
      passport.permissions.objects.write,passport.input_object_types,
      passport.output_object_types]){
      assert.deepEqual(row,['existing.object',resultSchema,companySchema,
        'iwxa.t3.access.signed-registry']);
    }
    const domain=JSON.parse(readFileSync(join(f.out,'_iwxa/domain.json'),'utf8'));
    assert.deepEqual(domain.security.allowed_object_classes,
      ['existing.object',resultSchema,companySchema,
        'iwxa.t3.access.signed-registry']);
    assert.equal(passport.schemas['iwxa.admin.applied-results'],undefined,
      'Agent D6 may not inherit unrelated Admin D3 object permissions');
    assert.equal(passport.schemas['iwxa.t3.access.signed-registry'].schema_version,'1.0.0',
      'reuse the original D1 signed AccessRegistry serialization');
    const company=passport.schemas[companySchema];
    assert.equal(company.schema_version,'1.0.0');
    assert.equal(company.preserve_unknown,false);
    assert.equal(company.json_schema.properties.text.maxLength,2000000);
    assert.deepEqual(company.json_schema.properties.kind.enum,
      ['TASK','DRAFT','DOCUMENT','RESULT','HISTORY']);
    assert.deepEqual(company.json_schema.properties.sourceKind.enum,
      ['ORIGINAL_SIGNED_TASK','ORIGINAL_COMPANY_WORKAREA',
        'ORIGINAL_AGENT_HUMAN_ACCEPTED']);
    const declaration=passport.schemas[resultSchema];
    assert.equal(declaration.schema_version,'1.0.0');
    assert.equal(declaration.preserve_unknown,false);
    const expected=['taskId','resultId','acceptedDigest','signedTaskId',
      'signedTaskRevisionId','signedTaskPackageSha256','contextDigest'];
    assert.deepEqual(declaration.json_schema.required,expected,
      'normal accepted Result must not require an Atlas project');
    assert.deepEqual(Object.keys(declaration.json_schema.properties),
      [...expected,'workRef'],
      'optional exact project binding must remain in the original schema');
    assert.deepEqual(declaration.json_schema.properties.workRef.required,
      ['projectId','workId','revision']);
    assert.equal(declaration.json_schema.properties.workRef.additionalProperties,false);
    assert.equal(readFileSync(join(f.t2,path),'utf8'),source,
      'qualified original source passport must remain unchanged');
    assert.equal(readFileSync(join(f.out,'_iwxa/runtime/0.3.6/runtime.js'),'utf8'),
      'original Kernel 0.3.6');
    const catalog=JSON.parse(readFileSync(join(f.out,'_iwxa/service-catalog.json'),'utf8'));
    assert.equal(catalog.entries[0].sha256,
      createHash('sha256').update(readFileSync(join(f.out,path))).digest('hex'));
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('Agent D6 profile fails closed on missing or conflicting original authority',()=>{
  const f=fixture();
  try{
    assert.throws(()=>assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
      testOnlyUnqualifiedFixture:true,
      installedOriginalAgentD6:true,installedOriginalAdminD3:true,
    }),/T3_D1_DIST_INSTALLED_OWNER_PROFILES_MUST_BE_SEPARATE/);
    assert.throws(()=>assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
      testOnlyUnqualifiedFixture:true,installedOriginalAgentD6:true,
    }),/T3_D1_DIST_ORIGINAL_SERVICE_PASSPORT_PATH/);
    assert.equal(existsSync(f.out),false);
    const path='_iwxa/services/test.original.json';
    const passport={
      service_id:'test.original',supported_levels:['T1','T2'],
      permissions:{workspace:{read:true,create:false},
        objects:{read:[],write:[]}},
      input_object_types:[],output_object_types:[],
      schemas:{'iwxa.agent.accepted-result':{schema_version:'0.0.0'}},
    };
    const bytes=JSON.stringify(passport);
    f.put(f.t2,path,bytes);
    f.put(f.t2,'_iwxa/service-catalog.json',JSON.stringify({
      count:1,entries:[{service_id:'test.original',file:path,
        sha256:createHash('sha256').update(bytes).digest('hex')}],
    }));
    f.put(f.t2,'_iwxa/domain.json',JSON.stringify({
      origin:'http://127.0.0.1:18883',
      security:{allowed_object_classes:[]},
    }));
    f.put(f.t2,'workspace/workspace.config.json',JSON.stringify({
      base_path:'/workspace/',workspace_service_id:'test.original',
    }));
    assert.throws(()=>assembleSignedControlDist({
      t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
      testOnlyUnqualifiedFixture:true,installedOriginalAgentD6:true,
    }),/T3_D1_DIST_ORIGINAL_AGENT_D6_SCHEMA_CONFLICT/);
    assert.equal(existsSync(f.out),false);
    assert.equal(readFileSync(join(f.t2,path),'utf8'),bytes,
      'original service passport must stay intact on failed assembly');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('installed corporate services share work schema declarations and enable only restricted original package scopes',()=>{
  const declarations=[];
  for(const [service,profile] of [
    ['iwxa.admin-center.workspace',{installedOriginalAdminD3:true}],
    ['iwxa.personal-agent.workspace',{installedOriginalAgentD6:true}],
  ]){
    const f=fixture();
    try{
      const path='_iwxa/services/'+service+'.json';
      const passport={service_id:service,supported_levels:['T0','T1','T2'],
        permissions:{workspace:{read:true,create:true,restore:false,purge:false,
          soft_delete:false},objects:{read:[],write:[],delete:[]},
          events:{read_scope:'workspace'},packages:{export:false,import:false,
            export_scope:'readable_objects',import_scope:'writable_objects'}},
        input_object_types:[],output_object_types:[],schemas:{}};
      const source=JSON.stringify(passport);
      f.put(f.t2,path,source);
      f.put(f.t2,'_iwxa/service-catalog.json',JSON.stringify({count:1,entries:[
        {service_id:service,file:path,sha256:createHash('sha256').update(source).digest('hex')}]}));
      f.put(f.t2,'_iwxa/domain.json',JSON.stringify({origin:'http://127.0.0.1:18883',
        security:{allowed_object_classes:[]}}));
      f.put(f.t2,'workspace/workspace.config.json',JSON.stringify({
        base_path:'/workspace/',workspace_service_id:service}));
      assembleSignedControlDist({t2Dist:f.t2,t3Build:f.t3,outputDir:f.out,
        testOnlyUnqualifiedFixture:true,...profile});
      const result=JSON.parse(readFileSync(join(f.out,path),'utf8'));
      assert.deepEqual(result.permissions.packages,{export:true,import:true,
        export_scope:'readable_objects',import_scope:'writable_objects'});
      assert.deepEqual(result.permissions.objects.delete,[]);
      assert.equal(result.permissions.workspace.purge,false);
      assert.equal(result.permissions.workspace.restore,false);
      assert.ok(!result.permissions.objects.read.includes('*'));
      assert.ok(!result.permissions.objects.write.includes('*'));
      declarations.push(['iwxa.t3.company-work-record','iwxa.agent.accepted-result']
        .map(schema=>result.schemas[schema]));
      assert.equal(readFileSync(join(f.t2,path),'utf8'),source);
      assert.equal(readFileSync(join(f.out,'_iwxa/runtime/0.3.6/runtime.js'),'utf8'),
        'original Kernel 0.3.6');
    }finally{rmSync(f.dir,{recursive:true,force:true});}
  }
  assert.deepEqual(declarations[0],declarations[1]);
  assert.ok(declarations[0].every(row=>row?.schema_version==='1.0.0'));
});
