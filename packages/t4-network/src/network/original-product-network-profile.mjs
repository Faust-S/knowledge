// Installed product composition only. The original RC.1 profile, Access
// evaluator, signed Registry and native Control factories remain the owners.
import {resolveOriginalKernelRegistryStatePortForKernel} from '../../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {isOriginalPersonalAccessCheckForRegistry} from '../../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {isOriginalOrganizationalOperationGateForRegistry} from '../../../t3-core/src/t3/access/organizational-operation.mjs';
import {isOriginalSignedAccessHostPortForEvaluator} from '../../../t3-core/src/t3/signed-access-host-port.mjs';
import {normalizeOriginalInstalledNetworkScope} from '../../../t3-core/src/t3/original-installed-network-scope.mjs';
import {createT4OriginalProductNetworkAccess} from './original-product-network-access.mjs';
import {createT4OriginalNativeHostNetworkProfile} from './original-native-host-network-profile.mjs';
import {createT4OriginalInstalledControlFactories} from './original-installed-control-factories.mjs';
import {openT4OriginalNativePeerStartup,releaseT4OriginalNativePeerStartup} from './original-native-peer-startup.mjs';
import {createT4OriginalPeerHistoryTlsConnection,isT4OriginalPeerHistoryTlsConnection,T4_ORIGINAL_PEER_HISTORY_TLS_ALPN}
  from './original-peer-history-tls-connection.mjs';
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
      !Number.isSafeInteger(lifetime.contextEpoch)||lifetime.contextEpoch<0||
      (lifetime.activationSignal!==undefined&&!(lifetime.activationSignal instanceof AbortSignal)))
      fail('T4_INSTALLED_PRODUCT_ORIGINAL_HOST_REQUIRED');
    let closed=false,authority=null,profile=null,peerConnection=null,receiverBound=false,receiverActive=false;
    const peerStartupAbort=new AbortController();
    const signal=lifetime.activationSignal===undefined?peerStartupAbort.signal:AbortSignal.any([peerStartupAbort.signal,lifetime.activationSignal]);
    const active=()=>!closed&&!signal.aborted&&lifetime.isHostActive()===true;
    const requireActive=()=>{if(!active())fail('T4_INSTALLED_PRODUCT_HOST_DISPOSED');};
    const close=()=>{
      if(closed)return;
      closed=true;
      peerStartupAbort.abort();
      try{authority?.close();}finally{try{profile?.close();}finally{peerConnection?.close();}}
    };
    try{
      requireActive();
      const input=await readOriginalOwnerInputs(lifetime);requireActive();
      if(!obj(input)||!obj(input.profile)||!obj(input.networkAccess)||typeof input.resolveOriginalKernelAccess!=='function')
        fail('T4_INSTALLED_PRODUCT_ORIGINAL_OWNER_REQUIRED');
      const {registry,networkAccess,profile:options}=input;
      const registryBound=await resolveOriginalKernelRegistryStatePortForKernel(registry,lifetime.registryKernel,{
        workspaceId:selected.registryWorkspaceId,objectId:registryObjectId});
      requireActive();
      if(!registryBound)fail('T4_INSTALLED_PRODUCT_ORIGINAL_REGISTRY_MISMATCH');
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
      const {originalPeerTls,...nativeOptions}=options;
      if(originalPeerTls!==undefined){
        if(!obj(originalPeerTls)||Object.hasOwn(options,'originalPeerHistory')||
          Object.keys(originalPeerTls).some(k=>!['endpoint','readOriginalCredentials','authorizeOriginalPeerConnection',
            'localCertificateSha256','peerCertificateSha256','timeoutMs'].includes(k)))
          fail('T4_INSTALLED_PRODUCT_PEER_STARTUP_INVALID');
        const source=selected.role==='SOURCE';
        peerConnection=await openT4OriginalNativePeerStartup({
          endpoint:originalPeerTls.endpoint,readOriginalCredentials:originalPeerTls.readOriginalCredentials,
          authorizeOriginalPeerConnection:originalPeerTls.authorizeOriginalPeerConnection,
          identity:{workspaceId:selected.sourceWorkspaceId,originalWriteOwnerRef:options.originalWriteOwnerRef,
            scopeRef:options.scopeRef,ownerEpoch:options.ownerEpoch,
            localNodeRef:source?options.sourceNodeRef:options.recipientNodeRef,
            peerNodeRef:source?options.recipientNodeRef:options.sourceNodeRef,
            contextEpoch:lifetime.contextEpoch,localCertificateSha256:originalPeerTls.localCertificateSha256,
            peerCertificateSha256:originalPeerTls.peerCertificateSha256},
          getMode,isOriginalHostActive:active,signal,deferIncomingUntilReceiver:true,
          timeoutMs:originalPeerTls.timeoutMs,alpn:T4_ORIGINAL_PEER_HISTORY_TLS_ALPN,
          createOriginalConnection:createT4OriginalPeerHistoryTlsConnection});
        requireActive();
        if(!isT4OriginalPeerHistoryTlsConnection(peerConnection))fail('T4_INSTALLED_PRODUCT_PEER_STARTUP_INVALID');
        nativeOptions.originalPeerHistory=peerConnection;
      }
      profile=createT4OriginalNativeHostNetworkProfile({...nativeOptions,getMode,originalAccess:authority.originalAccess,
        originalPorts:{...options.originalPorts,resolveOriginalAccess:resolver}});
      requireActive();
      return Object.freeze({...profile,close,bindOriginalPeerHistoryReceiver(relay){
        requireActive();
        if(receiverBound)fail('T4_INSTALLED_PRODUCT_PEER_RECEIVER_ALREADY_BOUND');
        const receiver=profile.bindOriginalPeerHistoryReceiver(relay);
        receiverBound=true;
        return receiver;
      },activateOriginalPeerHistoryReceiver(){
        // Binding the native receiver is not the READY transition. Wait for
        // the original relay to release its activation reservation and
        // publish the accepted Host session on its existing next/result loop.
        requireActive();
        if(!receiverBound||receiverActive)fail('T4_INSTALLED_PRODUCT_PEER_RECEIVER_NOT_PENDING');
        if(peerConnection!==null)releaseT4OriginalNativePeerStartup(peerConnection);
        receiverActive=true;
      }});
    }catch(error){close();throw error;}
  };
}
export function createT4OriginalInstalledProductControlFactories({scope,registryObjectId='t3.access.signed-registry',
  readOriginalOwnerInputs,bindPeerHistoryReceiver,originalControlHandlerFactory}={}){
  return createT4OriginalInstalledControlFactories({scope,registryObjectId,bindPeerHistoryReceiver,originalControlHandlerFactory,
    createProfile:createT4OriginalProductProfileFactory({scope,registryObjectId,readOriginalOwnerInputs})});
}
