import {encodeOriginalNetworkRelayArgs} from "./original-kernel-native-relay-codec.mjs";

const METHODS=Object.freeze(["putObject","deleteObject","putAsset","deleteAsset","putRelation","deleteRelation"]);
const UNSUPPORTED=new Set(["createWorkspace","commitObjectGraph","softDeleteWorkspace","restoreWorkspace",
  "purgeCommit","importCommit","confirmExport"]);
const PASS=Object.freeze({kind:"LOCAL_T3"});
const validId=value=>typeof value==="string"&&value.length>0&&value.length<=256;
const fail=code=>{throw Object.assign(Error(code),{code});};

// Constructed only in the original trusted Kernel realm from its pinned
// Host configuration. The ordinary UI cannot negotiate a source binding.
export function createOriginalLocalSourceMutationRoute({workspaceId,originalKernelRelay,isHostActive}={}){
  if(!validId(workspaceId)||typeof originalKernelRelay!=="function"||typeof isHostActive!=="function")
    fail("T3_LOCAL_SOURCE_CAPTURE_CONFIGURATION_INVALID");
  let binding=null;
  const requireLive=()=>{if(isHostActive()!==true)fail("T3_HOST_DISPOSED");};
  return Object.freeze({
    accept(negotiated){
      requireLive();
      if(binding!==null||negotiated?.networkRelayVersion!==1||
        negotiated.localSourceMutationVersion!==1||negotiated.localSourceWorkspaceId!==workspaceId||
        !/^[A-Za-z0-9_-]{43}$/.test(negotiated.sessionId??"")||
        !Number.isSafeInteger(negotiated.contextEpoch)||negotiated.contextEpoch<0||
        !Array.isArray(negotiated.networkMethods)||
        !Array.isArray(negotiated.localSourceMutationMethods)||
        negotiated.localSourceMutationMethods.length!==METHODS.length||
        !METHODS.every(method=>negotiated.networkMethods.includes(method)&&
          negotiated.localSourceMutationMethods.includes(method)))
        fail("T3_LOCAL_SOURCE_CAPTURE_NEGOTIATION_INVALID");
      binding=Object.freeze({sessionId:negotiated.sessionId,epoch:negotiated.contextEpoch});
    },
    clear(){binding=null;},
    async route(method,args){
      if(!METHODS.includes(method)&&!UNSUPPORTED.has(method))return PASS;
      requireLive();
      if(!Array.isArray(args)||args.length!==1)fail("T3_LOCAL_SOURCE_CAPTURE_COMMAND_INVALID");
      const first=args[0];
      const target=method==="importCommit"||method==="purgeCommit"?null:
        method==="confirmExport"?(first?.workspace_ids?.length===1?first.workspace_ids[0]:null):
        typeof first==="string"?first:first?.workspace_id;
      // Import/purge confirmations carry an original preview token rather
      // than a workspace ID. Until atomic capture is implemented, refuse
      // such unclassified mutations in this explicitly opted-in realm.
      if(validId(target)&&target!==workspaceId)return PASS;
      if(UNSUPPORTED.has(method))fail("T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED");
      if(target!==workspaceId)fail("T3_LOCAL_SOURCE_CAPTURE_SCOPE_INVALID");
      const selected=binding;
      if(!selected)fail("T3_LOCAL_SOURCE_CAPTURE_BINDING_REQUIRED");
      const exact=encodeOriginalNetworkRelayArgs(method,structuredClone(args));
      const result=await originalKernelRelay("sourceMutation",{
        sessionId:selected.sessionId,method,args:exact,
      });
      requireLive();
      if(binding!==selected)fail("T3_LOCAL_SOURCE_CAPTURE_OUTCOME_UNKNOWN");
      // Mode changes require reconfiguration of the trusted realm. Never
      // perform an untracked raw write in a configured source after a relay
      // error, ambiguous receipt, or a LOCAL_T3 mode change.
      if(result?.state==="LOCAL_T3_BYPASS")fail("T3_LOCAL_SOURCE_CAPTURE_MODE_CHANGED");
      if(result?.state!=="ORIGINAL_SOURCE_MUTATION_CAPTURED"||
        result.originalT3OutboxVerified!==true||result.networkPublished!==false||
        !validId(result.captureRef)||!result.originalReceipt||
        typeof result.originalReceipt!=="object")
        fail("T3_LOCAL_SOURCE_CAPTURE_RECEIPT_INVALID");
      return Object.freeze({kind:"CAPTURED",originalReceipt:result.originalReceipt});
    },
  });
}
