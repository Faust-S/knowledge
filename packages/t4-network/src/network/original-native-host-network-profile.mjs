import {createT4OriginalNativeHostNetworkOwner} from './original-native-host-network-owner.mjs';
import {openT4NativeTopologyTransport} from './network-topology.mjs';
import {createT4OriginalVaultNodeSignaturePort} from './original-vault-node-signature.mjs';
import {createT4OriginalVaultSealedContentPort} from './original-vault-sealed-content.mjs';
import {createT4OriginalSignedReplacementHistoryAccess} from './original-signed-replacement-history-access.mjs';
import {createT4OriginalReplacementHistoryClient,createT4OriginalReplacementHistoryServer} from './original-replacement-owner-history-carrier.mjs';
import {isOriginalKernelNativeRelayForNetworkOwner} from '../../../t3-core/src/t3/original-kernel-native-relay.mjs';

const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
const requireFunctions=(value,keys)=>{
  if(!value||!keys.every(k=>typeof value[k]==='function'))fail('NATIVE_NETWORK_PROFILE_ORIGINAL_PORTS_REQUIRED');
};

// Complete native T4 profile for one original owner/Workspace/peer route.
// The installed owner explicitly selects this profile, supplies its existing
// authenticated channel, Access, Registry and Vault, and attaches networkOwner
// to its ONE original relay. No default grant, substitute signer, retry timer,
// second relay or new durable state is installed by this composition.
export function createT4OriginalNativeHostNetworkProfile({
  role,technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
  scopeRef,ownerEpoch,requiredCryptoSuite,getMode:originalGetMode,
  originalAccess,originalVault,originalTopology,originalPeerHistory,originalPorts,
  readOriginalBaselineAdmissionInput,readOriginalNetworkResumeInput,onStep,monotonicNow,
}={}){
  if(!['SOURCE','RECIPIENT'].includes(role)||typeof originalGetMode!=='function'||
    !originalAccess||!originalVault||!originalPorts||typeof readOriginalBaselineAdmissionInput!=='function'||
    typeof readOriginalNetworkResumeInput!=='function')fail('NATIVE_NETWORK_PROFILE_ORIGINAL_PORTS_REQUIRED');
  requireFunctions(originalVault,['readEncryptedVault','unlockPassphrase']);
  requireFunctions(originalTopology,['readOriginalTopology','verifyOriginalEndpoint','authorizeOriginalOperation','getAuthorizationHeader']);
  requireFunctions(originalPeerHistory,['readOriginalPeerContext','invokeOriginalPeerHistory']);
  if(originalGetMode()!=='T4_NETWORK')fail('NATIVE_NETWORK_PROFILE_MODE_DISABLED');
  const source=role==='SOURCE',localNodeRef=source?sourceNodeRef:recipientNodeRef,
    peerNodeRef=source?recipientNodeRef:sourceNodeRef;
  let closed=false,transport=null;
  const getMode=()=>closed?'LOCAL_T3':originalGetMode();
  const {registry,access,originalEvaluator,expectedContext,clock=Date.now}=originalAccess;
  const subject=Object.freeze({...expectedContext});
  const signed={access,expectedContext:subject,clock};
  const common={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,scopeRef,ownerEpoch,getMode};
  const keys={...common,...signed,registry,originalEvaluator,requiredCryptoSuite};
  const {localKeyRef,remoteKeyRef,recipientKeyRef,readEncryptedVault,unlockPassphrase}=originalVault;
  const {topology,objectFamily,serverNodeRef,readOriginalTopology,verifyOriginalEndpoint,authorizeOriginalOperation,
    getAuthorizationHeader,verifyOriginalOwnerAgreement,fetchImpl,maxBytes,timeoutMs}=originalTopology;
  const {readOriginalPeerContext,invokeOriginalPeerHistory}=originalPeerHistory;
  const carrier={...common,localNodeRef,peerNodeRef,readOriginalPeerContext};
  try{
    const signature=createT4OriginalVaultNodeSignaturePort({...keys,localNodeRef,remoteNodeRef:peerNodeRef,
      localKeyRef,remoteKeyRef,readEncryptedVault,unlockPassphrase,requireDurableNetworkKeyBinding:true});
    const sealed=createT4OriginalVaultSealedContentPort({...keys,role,sourceNodeRef,recipientNodeRef,recipientKeyRef,
      ...(!source?{readEncryptedVault,unlockPassphrase}:{}),enableOriginalReplacementBinding:true});
    const history=createT4OriginalSignedReplacementHistoryAccess({...common,...signed,technicalWorkspaceId,
      sourceNodeRef,recipientNodeRef,localNodeRef,enableOriginalEligibilityRead:true});
    const client=createT4OriginalReplacementHistoryClient({...carrier,invokeOriginalPeerHistory});
    transport=openT4NativeTopologyTransport({topology,workspaceId:sourceWorkspaceId,objectFamily,serverNodeRef,
      nativeWireProfile:'INDEXED',getMode,readOriginalTopology,verifyOriginalEndpoint,authorizeOriginalOperation,
      getAuthorizationHeader,verifyOriginalOwnerAgreement,fetchImpl,maxBytes,timeoutMs,originalSignedAccess:signed});
    const networkOwner=createT4OriginalNativeHostNetworkOwner({role,technicalWorkspaceId,sourceWorkspaceId,
      originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,requiredCryptoSuite,getMode,originalPorts,
      nativeTopologyTransport:transport,originalVaultNodeSignaturePort:signature,originalVaultSealedContentPort:sealed,
      originalSignedReplacementHistoryAccess:history,originalReplacementHistoryClient:client,
      readOriginalBaselineAdmissionInput,readOriginalNetworkResumeInput,onStep,monotonicNow,
      requireSignedTopologyAccess:true,requireOriginalVaultNodeSignature:true,requireDurableNetworkKeyBinding:true,
      requireOriginalVaultSealedContent:true,enablePublicationIndexMigration:true,enableExplicitNetworkResume:true,
      enableLocalSourceCapture:source,enableHistoricalAcknowledgementRecovery:source,enableLocalRetiredRecipientRecovery:!source,
      enableLocalReplacementRecovery:true,enableReplacementTerminalRecovery:true,enableReplacementEligibilityRead:true,
      enableReplacementSourceAdmission:source,enableReplacementSourceContent:source,enableReplacementSourceAckConfirmation:source,
      enableReplacementRecipientAdmission:!source,enableReplacementRecipientContent:!source,enableReplacementRecipientApply:!source});
    const close=()=>{if(closed)return;closed=true;transport.close();};
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_PROFILE_V1',role,networkOwner,
      // This receiver is installed on the original authenticated peer channel,
      // never as a browser relay verb or a new network service. The relay
      // reserves the very same Kernel command slot used by its Host wake.
      bindOriginalPeerHistoryReceiver(relay){
        if(closed||!isOriginalKernelNativeRelayForNetworkOwner(relay,networkOwner)||
          typeof relay.readOriginalReplacementOwnerHistory!=='function')fail('NATIVE_NETWORK_PROFILE_ORIGINAL_RELAY_REQUIRED');
        return createT4OriginalReplacementHistoryServer({...carrier,
          readOriginalReplacementOwnerHistory:input=>relay.readOriginalReplacementOwnerHistory(input)});
      },close});
  }catch(error){closed=true;transport?.close();throw error;}
}
