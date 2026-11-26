// Bind the existing original Control's two injected factories to one exact
// installed network scope. This does not open another Control, Kernel, Vault
// or Registry. The trusted native owner still supplies its real profile.
import {createOriginalKernelNativeRelay} from '../../../t3-core/src/t3/original-kernel-native-relay.mjs';
import {normalizeOriginalInstalledNetworkScope,allowOriginalInstalledNetworkUiOperation} from '../../../t3-core/src/t3/original-installed-network-scope.mjs';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
export function createT4OriginalInstalledControlFactories({scope,registryObjectId='t3.access.signed-registry',
  createProfile,bindPeerHistoryReceiver,originalControlHandlerFactory}={}){
  const selected=normalizeOriginalInstalledNetworkScope(scope);
  if(!ID(registryObjectId)||![createProfile,bindPeerHistoryReceiver,originalControlHandlerFactory].every(f=>typeof f==='function'))
    fail('T4_INSTALLED_CONTROL_ORIGINAL_OWNER_REQUIRED');
  let relay=null,handlerCreated=false;
  const originalRegistryScope=Object.freeze({workspaceId:selected.registryWorkspaceId,objectId:registryObjectId});
  const networkActivation=Object.freeze({role:selected.role,sourceWorkspaceId:selected.sourceWorkspaceId,
    technicalWorkspaceId:selected.technicalWorkspaceId,installedScope:selected,createProfile,bindPeerHistoryReceiver});
  function relayFactory(options){
    if(relay!==null||!options||['networkOwner','originalRegistryScope','networkActivation'].some(k=>Object.hasOwn(options,k)))
      fail('T4_INSTALLED_CONTROL_SINGLE_ORIGINAL_RELAY_REQUIRED');
    relay=createOriginalKernelNativeRelay({...options,originalRegistryScope,networkActivation});
    return relay;
  }
  function handlerFactory(options){
    if(relay===null||handlerCreated||!options||typeof options.ownerFor!=='function'||
      typeof options.originalKernelRelayFor!=='function'||Object.hasOwn(options,'installedNetworkScope'))
      fail('T4_INSTALLED_CONTROL_SINGLE_ORIGINAL_HANDLER_REQUIRED');
    const resolveRelay=options.originalKernelRelayFor,ownerFor=options.ownerFor;
    // Fail closed if an installed Control attempts to bind another relay.
    const originalKernelRelayFor=async input=>{
      if(await resolveRelay(input)!==relay)fail('T4_INSTALLED_CONTROL_ORIGINAL_RELAY_MISMATCH');
      return relay;
    };
    const handler=originalControlHandlerFactory({...options,installedNetworkScope:selected,originalKernelRelayFor,
      async ownerFor(input){
        const owner=await ownerFor(input);
        if(owner==null)return null;
        if(typeof owner.currentContext!=='function')fail('T4_INSTALLED_CONTROL_ORIGINAL_OWNER_REQUIRED');
        const context=await owner.currentContext();
        return allowOriginalInstalledNetworkUiOperation(selected,input.operation,context,relay.networkAttached)?owner:null;
      }});
    if(typeof handler!=='function')fail('T4_INSTALLED_CONTROL_ORIGINAL_HANDLER_REQUIRED');
    handlerCreated=true;return handler;
  }
  // Direct spread into startInteropServer's EXISTING named options. No new
  // IPC route, independent server or replacement product runtime is needed.
  return Object.freeze({originalKernelRelayFactory:relayFactory,originalControlHandlerFactory:handlerFactory});
}
