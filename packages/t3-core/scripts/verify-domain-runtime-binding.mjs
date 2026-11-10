/**
 * Pre-build guard for a domain's native Host binding.
 * This checks compatibility with the canonical qualified Kernel pair and
 * active module declaration. It does NOT authorize a service or grant rights.
 */
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../src/kernel-client/contracts/runtime-1.3.0/contract-manifest.json',import.meta.url),'utf8'));
const pins = JSON.parse(readFileSync(new URL('../src/factory2/products/domain-completion/qualified-kernel-artifact.json',import.meta.url),'utf8'));
const fail = reason => {throw new Error('T2_NATIVE_HOST_BINDING_'+reason)};
const record = value => value!==null && typeof value==='object' && !Array.isArray(value);

/** Always compare the Host/module contracts against T2's current normative
 * contract and its qualified Kernel artifact manifest, not caller-supplied
 * version constants. Source manifest checks are not a runtime qualification. */
export function verifyDomainRuntimeBinding({domain,workspaceConfig,moduleManifest}) {
 if(!record(domain)||!record(workspaceConfig)||!record(moduleManifest))fail('INPUT_REQUIRED');
 const runtime=domain.runtime;
 const host=workspaceConfig.host;
 const compat=moduleManifest.compatibility;
 const kernel=runtime?.kernel_release;
 const current=contract.contract_version;
 if(typeof kernel!=='string'||!pins.artifacts.some(a=>a.kernel===kernel&&a.contract===current))
  fail('QUALIFIED_KERNEL_CONTRACT_PAIR_REQUIRED');
 if(runtime.runtime_version!==kernel||host?.required_runtime_version!==kernel)
  fail('KERNEL_VERSION_MISMATCH');
 if(host.required_contract_version!==current||compat?.runtime_contract!==current)
  fail('RUNTIME_CONTRACT_MISMATCH');
 if(!moduleManifest.module_id||moduleManifest.module_manifest_version!=='1.0.0'||
    !workspaceConfig.modules?.some(m=>m.module_id===moduleManifest.module_id&&m.state==='active'))
  fail('MODULE_NOT_ACTIVE');
 if(domain.domain_id!==workspaceConfig.domain_id||
    domain.local_store_name!==host.local_store_name||
    host.direct_indexeddb!==false||
    moduleManifest.security?.direct_indexeddb!==false||
    moduleManifest.security?.remote_code!==false||
    moduleManifest.security?.iwxa_executable_payload!==false)
  fail('HOST_SECURITY_OR_DOMAIN_MISMATCH');
 return Object.freeze({
  status:'VERIFIED_METADATA_ONLY',moduleId:moduleManifest.module_id,
  kernel,contract:current,productionActivation:false,grantsCreated:false,
 });
}
