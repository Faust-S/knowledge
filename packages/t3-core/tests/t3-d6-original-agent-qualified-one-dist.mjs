// Genuine original T2 0.3.6 bytes in an existing IWXA integration Host.
// A qualified Kernel artifact is not by itself a complete domain One Dist.
// Reuse the established materializeIntegrationHost, not a second Kernel.
// No original private issuer or fake signed receipt is used in this test.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';
import {materializeIntegrationHost} from '../scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
assert.ok(typeof qualified==='string'&&qualified.length>0,
  'T3_D6_QUALIFIED_ORIGINAL_T2_REQUIRED');
const dir=mkdtempSync(join(tmpdir(),'iwxa-t3-agent-d6-original-'));
const source=join(dir,'qualified-integration-host'),output=join(dir,'agent-one-dist');
const base=resolve('.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifactId='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
try{
  mkdirSync(join(source,'workspace/assets'),{recursive:true});
  cpSync(join(qualified,'_iwxa'),join(source,'_iwxa'),{recursive:true});
  assertQualifiedKernelArtifact(source,{
    kernel:'0.3.6',contract:'1.3.0',artifactId,
  });
  // The same original integration Host materializer is already exercised
  // by t3-d1-signed-control-one-dist.browser.mjs on the real T2 Kernel.
  const host=materializeIntegrationHost(source,'http://127.0.0.1:18883');
  host.domain.runtime.kernel_release='0.3.6';
  host.domain.runtime.runtime_version='0.3.6';
  host.workspaceConfig.host.required_runtime_version='0.3.6';
  host.workspaceConfig.host.required_contract_version='1.3.0';
  writeFileSync(join(source,'_iwxa/domain.json'),JSON.stringify(host.domain));
  writeFileSync(join(source,'workspace/workspace.config.json'),
    JSON.stringify(host.workspaceConfig));
  const serviceId=host.workspaceConfig.workspace_service_id;
  const servicePath='_iwxa/services/'+serviceId+'.json';
  const originalPassport=Buffer.from(JSON.stringify(host.passport));
  writeFileSync(join(source,servicePath),originalPassport);
  writeFileSync(join(source,'_iwxa/service-catalog.json'),JSON.stringify({
    count:1,entries:[{
      service_id:serviceId,service_version:host.passport.service_version,
      base_path:host.passport.base_path,
      supported_levels:host.passport.supported_levels,
      file:servicePath,sha256:sha(originalPassport),
    }],
  }));
  writeFileSync(join(source,'workspace/index.html'),
    '<!doctype html><title>Original qualified T2 source</title>');
  cpSync(join(base,'public/favicon.ico'),join(source,'workspace/favicon.ico'));

  const originalRuntime=readFileSync(
    join(source,'_iwxa/runtime/0.3.6/runtime.js'));
  const originalLoader=readFileSync(join(source,'_iwxa/loader.js'));
  const assembled=assembleSignedControlDist({
    t2Dist:source,t3Build:join(base,'dist'),
    outputDir:output,installedOriginalAgentD6:true,
  });
  assert.equal(assembled.original_qualified_artifact,artifactId);
  assert.equal(assembled.original_kernel,'0.3.6');
  assert.equal(assembled.original_runtime_unchanged,true);
  assert.equal(assembled.original_agent_d6_schema_registered,true);
  assert.equal(assembled.original_admin_d3_schema_registered,false);
  assert.equal(sha(readFileSync(join(output,'_iwxa/runtime/0.3.6/runtime.js'))),
    sha(originalRuntime),'original T2 runtime changed');
  assert.equal(sha(readFileSync(join(output,'_iwxa/loader.js'))),
    sha(originalLoader),'original T2 loader changed');

  const catalog=JSON.parse(readFileSync(
    join(output,'_iwxa/service-catalog.json'),'utf8'));
  const entry=catalog.entries.find(x=>x.service_id===serviceId);
  assert.ok(entry&&entry.file===servicePath);
  const assembledPassport=readFileSync(join(output,servicePath));
  assert.equal(sha(assembledPassport),entry.sha256);
  assert.equal(sha(readFileSync(join(source,servicePath))),sha(originalPassport));
  const installed=JSON.parse(assembledPassport);
  assert.equal(installed.schemas['iwxa.agent.accepted-result']?.schema_version,'1.0.0');
  assert.equal(installed.schemas['iwxa.t3.access.signed-registry']?.schema_version,'1.0.0');
  assert.equal(installed.schemas['iwxa.admin.applied-results'],undefined);
  assert.deepEqual(installed.permissions.operations,['t1.commitObjectGraph']);
  assert.equal(installed.permissions.workspace.create,
    host.passport.permissions.workspace.create,
    'Agent D6 may not widen original Workspace creation rights');
  for(const row of [installed.permissions.objects.read,
    installed.permissions.objects.write,installed.input_object_types,
    installed.output_object_types]){
    for(const schema of ['iwxa.agent.accepted-result','iwxa.t3.access.signed-registry'])
      assert.ok(row.includes(schema),'original D6 schema not authorized: '+schema);
  }
  assert.equal(sha(readFileSync(join(source,'_iwxa/runtime/0.3.6/runtime.js'))),
    sha(originalRuntime),'qualified original Kernel source mutated');
  console.log('AGENT_D6_ORIGINAL_QUALIFIED_ONE_DIST_PROFILE_PASS');
}finally{
  rmSync(dir,{recursive:true,force:true});
}
