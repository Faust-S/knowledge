// Installed product composition only. The original RC.1 profile, Access
// evaluator, signed Registry and native Control factories remain the owners.
import {isOriginalKernelRegistryStatePortForKernel} from '../../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {isOriginalPersonalAccessCheckForRegistry} from '../../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {isOriginalOrganizationalOperationGateForRegistry} from '../../../t3-core/src/t3/access/organizational-operation.mjs';
import {isOriginalSignedAccessHostPortForEvaluator} from '../../../t3-core/src/t3/signed-access-host-port.mjs';
import {normalizeOriginalInstalledNetworkScope} from '../../../t3-core/src/t3/original-installed-network-scope.mjs';
import {createT4OriginalProductNetworkAccess} from './original-product-network-access.mjs';
import {createT4OriginalNativeHostNetworkProfile} from './original-native-host-network-profile.mjs';
import {createT4OriginalInstalledControlFactories} from './original-installed-control-factories.mjs';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);

// SubjectBinding still performs the original exact-command JIT. Reject a
// second registry/evaluator, even if its signed state and policy are equal.
export function bindT4OriginalProductKernelAccess({registry,scope,lifetime,resolveOriginalKernelAccess}={}){
  const selected=normalizeOriginalInstalledNetworkScope(scope);
  if(typeof lifetime?.isHostActive!=='function'||typeof resolveOriginalKernelAccess!=='function')
    fail('T4_INSTALLED_PRODUCT_KERNEL_OWNER_REQUIRED');
  const active=()=>{if(lifetime.isHostActive()!==true)fail('T4_INSTALLED_PRODUCT_HOST_DISPOSED');};
  return async proof=>{
    active();
    if(!obj(proof)||proof.sessionId!==lifetime.sessionId||proof.contextEpoch!==lifetime.contextEpoch||
      proof.originalKernelOperation!==true||proof.networkGrantsNoWriteAuthority!==true||
      !Array.isArray(proof.args)||typeof proof.operation!=='string'||!proof.operation.startsWith('t1.'))return null;
    const first=proof.args[0],ws=typeof first==='string'?first:first?.workspace_id;
    if(![selected.sourceWorkspaceId,selected.technicalWorkspaceId].includes(ws))return null;
    const bound=await resolveOriginalKernelAccess(structuredClone(proof));active();
    if(bound==null)return null;
    const {access,originalEvaluator}=bound;
    const context=await access?.currentContext?.();active();
    if(!['PERSONAL','CORP'].includes(context?.kind)||context.workspace_id!==ws||context.resource!==ws||
      !isOriginalSignedAccessHostPortForEvaluator(access,context.kind,originalEvaluator)||
      !(context.kind==='PERSONAL'?isOriginalPersonalAccessCheckForRegistry(originalEvaluator,registry):
        isOriginalOrganizationalOperationGateForRegistry(originalEvaluator,registry)))
      fail('T4_INSTALLED_PRODUCT_KERNEL_REGISTRY_MISMATCH');
    return access;
  };
}

// The already installed owner provides the real registry for this exact
// Relay lifetime, selected signed grant, original proof/Vault custody,
// topology and original subject/technical operation ports. No default
// credentials, source evidence, grant or new Registry are manufactured.
export function createT4OriginalProductProfileFactory({scope,registryObjectId='t3.access.signed-registry',readOriginalOwnerInputs}={}){
  const selected=normalizeOriginalInstalledNetworkScope(scope);
  if(!ID(registryObjectId)||typeof readOriginalOwnerInputs!=='function')fail('T4_INSTALLED_PRODUCT_ORIGINAL_OWNER_REQUIRED');
  return async lifetime=>{
    if(!obj(lifetime)||!lifetime.registryKernel||typeof lifetime.isHostActive!=='function'||
      !/^[A-Za-z0-9_-]{43}$/.test(lifetime.sessionId??'')||
      !Number.isSafeInteger(lifetime.contextEpoch)||lifetime.contextEpoch<0)
      fail('T4_INSTALLED_PRODUCT_ORIGINAL_HOST_REQUIRED');
    let closed=false,authority=null,profile=null;
    const active=()=>!closed&&lifetime.isHostActive()===true;
    const requireActive=()=>{if(!active())fail('T4_INSTALLED_PRODUCT_HOST_DISPOSED');};
    const close=()=>{
      if(closed)return;
      closed=true;
      try{authority?.close();}finally{profile?.close();}
    };
    try{
      requireActive();
      const input=await readOriginalOwnerInputs(lifetime);requireActive();
      if(!obj(input)||!obj(input.profile)||!obj(input.networkAccess)||typeof input.resolveOriginalKernelAccess!=='function')
        fail('T4_INSTALLED_PRODUCT_ORIGINAL_OWNER_REQUIRED');
      const {registry,networkAccess,profile:options}=input;
      if(!isOriginalKernelRegistryStatePortForKernel(registry,lifetime.registryKernel,{
        workspaceId:selected.registryWorkspaceId,objectId:registryObjectId}))
        fail('T4_INSTALLED_PRODUCT_ORIGINAL_REGISTRY_MISMATCH');
      if(options.role!==selected.role||options.sourceWorkspaceId!==selected.sourceWorkspaceId||
        options.technicalWorkspaceId!==selected.technicalWorkspaceId||Object.hasOwn(options,'originalAccess')||
        !obj(options.originalPorts)||Object.hasOwn(options.originalPorts,'resolveOriginalAccess')||typeof options.getMode!=='function')
        fail('T4_INSTALLED_PRODUCT_PROFILE_SCOPE_MISMATCH');
      const originalMode=options.getMode,getMode=()=>active()?originalMode():'LOCAL_T3';
      // Read the existing signed state before exposing any profile. This is
      // not issuance, automatic migration, or permission to use stale data.
      await registry.readState();requireActive();
      authority=createT4OriginalProductNetworkAccess({registry,role:selected.role,sourceWorkspaceId:selected.sourceWorkspaceId,
        expectedContext:networkAccess.expectedContext,currentContext:networkAccess.currentContext,getMode,
        personal:networkAccess.personal,corporate:networkAccess.corporate,clock:networkAccess.clock,
        enableSourceEventWindowRead:options.enableSourceEventWindowRead??false,
        enableRecipientResultRead:options.enableRecipientResultRead??false});
      const resolver=bindT4OriginalProductKernelAccess({registry,scope:selected,lifetime:{...lifetime,isHostActive:active},
        resolveOriginalKernelAccess:input.resolveOriginalKernelAccess});
      profile=createT4OriginalNativeHostNetworkProfile({...options,getMode,originalAccess:authority.originalAccess,
        originalPorts:{...options.originalPorts,resolveOriginalAccess:resolver}});
      requireActive();
      return Object.freeze({...profile,close});
    }catch(error){close();throw error;}
  };
}
export function createT4OriginalInstalledProductControlFactories({scope,registryObjectId='t3.access.signed-registry',
  readOriginalOwnerInputs,bindPeerHistoryReceiver,originalControlHandlerFactory}={}){
  return createT4OriginalInstalledControlFactories({scope,registryObjectId,bindPeerHistoryReceiver,originalControlHandlerFactory,
    createProfile:createT4OriginalProductProfileFactory({scope,registryObjectId,readOriginalOwnerInputs})});
}
