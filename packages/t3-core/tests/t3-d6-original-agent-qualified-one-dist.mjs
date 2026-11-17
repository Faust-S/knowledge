// A REAL qualified original T2 0.3.6 distribution, not a Kernel mock.
// Verify that the existing signed One Core packager can prepare the Agent D6
// service passport without changing the original Kernel/Store/runtime bytes.
// This does not claim native signed publication or installed Atlas acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';

const source=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
assert.ok(typeof source==='string'&&source.length>0,
  'T3_D6_QUALIFIED_ORIGINAL_T2_REQUIRED');
const dir=mkdtempSync(join(tmpdir(),'iwxa-t3-agent-d6-original-'));
const output=join(dir,'one-dist');
const base=resolve('.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalPath=join(source,'_iwxa/runtime/0.3.6/runtime.js');
const originalKernel=readFileSync(originalPath);
try{
  const assembled=assembleSignedControlDist({
    t2Dist:source,t3Build:join(base,'dist'),
    outputDir:output,installedOriginalAgentD6:true,
  });
  assert.equal(assembled.original_qualified_artifact,
    'iwxa-kernel-k036-same-store-history-20261019-qualified.1');
  assert.equal(assembled.original_kernel,'0.3.6');
  assert.equal(assembled.original_runtime_unchanged,true);
  assert.equal(assembled.original_agent_d6_schema_registered,true);
  assert.equal(assembled.original_admin_d3_schema_registered,false);
  assert.equal(sha(readFileSync(join(output,'_iwxa/runtime/0.3.6/runtime.js'))),
    sha(originalKernel),'original T2 runtime bytes were changed');
  const sourceCatalog=JSON.parse(readFileSync(
    join(source,'_iwxa/service-catalog.json'),'utf8'));
  const installedCatalog=JSON.parse(readFileSync(
    join(output,'_iwxa/service-catalog.json'),'utf8'));
  const config=JSON.parse(readFileSync(
    join(output,'workspace/workspace.config.json'),'utf8'));
  const service=sourceCatalog.entries.find(
    x=>x.service_id===config.workspace_service_id);
  const installed=installedCatalog.entries.find(
    x=>x.service_id===config.workspace_service_id);
  assert.ok(service&&installed&&installed.file===service.file);
  const sourceBytes=readFileSync(join(source,service.file));
  const installedBytes=readFileSync(join(output,installed.file));
  assert.equal(sourceCatalog.entries.length,installedCatalog.entries.length);
  assert.equal(sha(sourceBytes),service.sha256,
    'source qualified T2 passport integrity changed');
  assert.equal(sha(installedBytes),installed.sha256,
    'assembled Agent D6 passport is not catalog-anchored');
  const original=JSON.parse(sourceBytes),passport=JSON.parse(installedBytes);
  const schema='iwxa.agent.accepted-result';
  assert.equal(passport.service_id,config.workspace_service_id);
  assert.equal(passport.schemas[schema]?.schema_version,'1.0.0');
  assert.deepEqual(passport.permissions.operations,['t1.commitObjectGraph']);
  assert.equal(passport.permissions.workspace.create,
    original.permissions.workspace.create,
    'Agent result publication cannot gain implicit Workspace creation');
  assert.equal(passport.schemas['iwxa.admin.applied-results'],undefined,
    'the Agent profile imported unrelated Admin D3 authority');
  for(const row of [passport.permissions.objects.read,
    passport.permissions.objects.write,passport.input_object_types,
    passport.output_object_types]){
    assert.ok(row.includes(schema),'original D6 schema not authorized');
  }
  const domain=JSON.parse(readFileSync(join(output,'_iwxa/domain.json'),'utf8'));
  assert.ok(domain.security.allowed_object_classes.includes(schema));
  assert.equal(sha(readFileSync(originalPath)),sha(originalKernel),
    'qualified T2 source was modified by assembly');
  console.log('AGENT_D6_ORIGINAL_QUALIFIED_ONE_DIST_PROFILE_PASS');
}finally{
  rmSync(dir,{recursive:true,force:true});
}
