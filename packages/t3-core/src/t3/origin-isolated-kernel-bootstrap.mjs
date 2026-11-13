// Original T2 Runtime Contract 1.3.0 over the T3 D1 isolated MessagePort.
// No new Kernel implementation: all T1/T2 calls reach the signed facade
// inside the original Kernel origin, which is the only Store owner.
const CONTRACT='1.3.0';
const LEVELS=new Set(['T0','T1','T2']);
const MODES=new Set(['full','limited','read-only','update-required','emergency-export']);
const T1=Object.freeze([
  'listWorkspaces','getWorkspace','createWorkspace','listObjects','getObject',
  'commitObjectGraph','putObject','deleteObject','putRelation','deleteRelation',
  'listAssets','getAsset','putAsset','deleteAsset','listEventsSince',
  'softDeleteWorkspace','restoreWorkspace','purgePreview','purgeCommit','purgeCancel',
]);
const T2=Object.freeze([
  'exportPreview','exportPackage','confirmExport',
  'importPreview','importCommit','importCancel',
]);
const ALL=new Set(['t0.validate',...T1.map(x=>'t1.'+x),...T2.map(x=>'t2.'+x)]);
const fail=code=>Object.assign(new Error(code),{code});
const validString=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const validInfo=(info,serviceId)=>{
  if(!info||typeof info!=='object'||Array.isArray(info)||
     info.contract_version!==CONTRACT||!validString(info.runtime_version)||
     !info.service||info.service.service_id!==serviceId||
     !validString(info.service.base_path)||!validString(info.service.service_version)||
     !MODES.has(info.mode)||
     !Array.isArray(info.granted_levels)||
     info.granted_levels.some(x=>!LEVELS.has(x))||
     !Array.isArray(info.granted_operations)||
     info.granted_operations.some(x=>!ALL.has(x)))
    throw fail('T3_D1_ORIGINAL_KERNEL_DESCRIPTION_INVALID');
  return info;
};
export const ORIGINAL_KERNEL_CONTRACT_OPERATIONS=Object.freeze([...ALL]);
export function createIsolatedOriginalKernelBootstrap({client,serviceId}={}){
  if(!client||typeof client.invoke!=='function'||!validString(serviceId))
    throw fail('T3_D1_ORIGINAL_KERNEL_CLIENT_REQUIRED');
  return Object.freeze({
    version:1,
    async connect({service_id}={}){
      if(service_id!==serviceId)throw fail('T3_D1_ORIGINAL_KERNEL_SERVICE_MISMATCH');
      const meta=validInfo(await client.invoke('describeSession'),serviceId);
      const call=method=>(...args)=>client.invoke(method,...args);
      // The original T2 identity/capability declaration is returned from the
      // trusted Kernel origin. UI cannot invent a grant by declaring one here.
      return Object.freeze({
        contract_version:meta.contract_version,runtime_version:meta.runtime_version,
        service:Object.freeze({...meta.service}),mode:meta.mode,
        granted_levels:Object.freeze([...meta.granted_levels]),
        granted_operations:Object.freeze([...meta.granted_operations]),
        authorization:Object.freeze({
          forWorkspace:call('authorizationForWorkspace'),
          hasCapability:call('hasCapability'),
        }),
        t0:Object.freeze({validate:call('validateObjects')}),
        t1:Object.freeze(Object.fromEntries(T1.map(name=>[name,call(name)]))),
        t2:Object.freeze(Object.fromEntries(T2.map(name=>[name,call(name)]))),
      });
    },
  });
}