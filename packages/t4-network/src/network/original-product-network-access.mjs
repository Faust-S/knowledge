// Trusted native product adapter. Reuses the exact original One Core
// Registry and signed Access factories; no new registry, keys or grants.
import {digest} from '../../../t3-core/src/t3/access/core.mjs';
import {isOriginalKernelRegistryStatePort} from '../../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createOriginalPersonalAccessCheck} from '../../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {createOrganizationalOperationGate} from '../../../t3-core/src/t3/access/organizational-operation.mjs';
import {createSignedAccessHostPort} from '../../../t3-core/src/t3/signed-access-host-port.mjs';
import {bindT4ProductNetworkSelection} from './original-product-network-selection.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};

// The existing native owner supplies an explicitly selected grant/context,
// existing proof custody and its already constructed ORIGINAL Registry.
// The returned originalAccess is consumed by the unchanged RC.1 profile.
// Kernel object/asset/technical grants remain separate, via SubjectBinding.
export function createT4OriginalProductNetworkAccess({registry,personal=null,corporate=null,clock=Date.now,...selection}={}){
  if(!isOriginalKernelRegistryStatePort(registry)||typeof clock!=='function')
    fail('T4_PRODUCT_NETWORK_ORIGINAL_REGISTRY_REQUIRED');
  const scope=bindT4ProductNetworkSelection(selection);
  const selected=scope.selected;
  const personalMode=selected.kind==='PERSONAL';
  if(personalMode?(corporate!==null||typeof personal?.signProof!=='function'):
    (personal!==null||!['IWXA_CONTROL_CENTER','IWXA_ADMIN_CENTER'].includes(corporate?.productId)||
      typeof corporate.inputFor!=='function'||typeof corporate.prove!=='function'||
      (corporate.confirm!==undefined&&typeof corporate.confirm!=='function')))
    fail('T4_PRODUCT_NETWORK_ORIGINAL_PROOF_OWNER_REQUIRED');
  // Capture trusted callbacks once, never a mutable client-supplied object.
  const signProof=personalMode?personal.signProof.bind(personal):null;
  const inputFor=personalMode?null:corporate.inputFor.bind(corporate);
  const prove=personalMode?null:corporate.prove.bind(corporate);
  const confirm=personalMode||corporate.confirm===undefined?null:corporate.confirm.bind(corporate);
  const guarded=fn=>async input=>{
    scope.requireRequest(input?.request,input?.context);
    const result=await fn(input);
    scope.current();
    return result;
  };
  const originalEvaluator=personalMode?createOriginalPersonalAccessCheck({registry,clock,signProof:guarded(signProof)}):
    createOrganizationalOperationGate({registry});
  const access=createSignedAccessHostPort({currentContext:scope.current,actionFor:scope.requireAction,
    operationDigest:({operation,input,context})=>{
      scope.requireContext(context);scope.requireAction(operation);
      return digest({operation,input,context});
    },canonicalDigest:digest,clock,
    ...(personalMode?{personal:{check:originalEvaluator}}:{corporate:{productId:corporate.productId,gate:originalEvaluator,
      async inputFor(context){
        scope.requireContext(context);
        const input=structuredClone(await inputFor(context));
        scope.current();
        if(input?.selection?.userConfirmed!==true||input.selection.automaticSwitch!==false||
          input.selection.contextType!=='ORGANIZATION'||input.selection.grantId!==selected.grant_id||
          input.selection.workspaceId!==selected.workspace_id||input.selection.organizationId!==selected.organization_id)
          fail('T4_PRODUCT_NETWORK_ORIGINAL_SELECTION_REQUIRED');
        return input;
      },prove:guarded(prove),...(confirm===null?{}:{confirm:guarded(confirm)})}})});
  return Object.freeze({originalAccess:Object.freeze({registry,access,originalEvaluator,expectedContext:selected,clock}),
    requiredActions:scope.actions,close:scope.close});
}
