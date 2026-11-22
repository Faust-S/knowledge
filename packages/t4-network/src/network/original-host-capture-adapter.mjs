import {captureT4OriginalObjectMutation} from './original-object-mutation-capture.mjs';
import {reconcileT4OriginalMutationIntent} from './original-object-intent-recovery.mjs';
import {captureT4OriginalHostSubjectMutation,
  reconcileT4OriginalHostSubjectMutation} from './original-host-subject-capture.mjs';

export class T4OriginalHostCaptureAdapterError extends Error{
  constructor(code){super(code);this.name='T4OriginalHostCaptureAdapterError';this.code=code;}
}
const fail=code=>{throw new T4OriginalHostCaptureAdapterError(code);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);

export function createT4OriginalHostCaptureAdapter({
  originalKernel,originalWriteOwnerRef,getMode,
  authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
  persistOriginalIntent,readOriginalIntent,
  persistOriginalOutbox,readOriginalOutbox,
}={}){
  if(typeof getMode!=='function'||
    typeof originalKernel?.hasOperation!=='function'||
    originalKernel.hasOperation('t1.putObject')!==true||
    typeof originalKernel.putObject!=='function')
    fail('ORIGINAL_HOST_T3_WRITE_PORT_REQUIRED');
  const mode=()=>{
    const m=getMode();
    if(m!=='LOCAL_T3'&&m!=='T4_NETWORK')
      fail('ORIGINAL_HOST_CAPTURE_MODE_UNKNOWN');
    return m;
  };
  const hostCapturePorts=()=>({
    originalKernel,originalWriteOwnerRef,getMode,
    authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
    persistOriginalIntent,readOriginalIntent,
    persistOriginalOutbox,readOriginalOutbox,
  });
  const requiredOriginalHostCapturePorts=()=>{
    if(!ID(originalWriteOwnerRef)||
      [authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
        persistOriginalIntent,readOriginalIntent,persistOriginalOutbox,
        readOriginalOutbox].some(f=>typeof f!=='function'))
      fail('ORIGINAL_HOST_T4_CAPTURE_PORTS_REQUIRED');
  };
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_ADAPTER_V1',
    t3OriginalSessionIsSovereign:true,
    createsIndependentHost:false,createsIndependentStore:false,
    createsIndependentTaskEngine:false,
    async putObject({mutationInput,sourceCursor,captureRef}={}){
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.putObject(mutationInput);
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_PUT_RESULT_V1',
          t4Mode:'LOCAL_T3',originalReceipt,
          originalT3OperationUsed:true,originalHostUnchanged:true,
          capture:null,networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!mutationInput||
        !ID(mutationInput.workspace_id)||!ID(mutationInput.object_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const captured=await captureT4OriginalObjectMutation({
        ...hostCapturePorts(),workspaceId:mutationInput.workspace_id,
        objectId:mutationInput.object_id,captureRef,sourceCursor,mutationInput,
      });
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_PUT_RESULT_V1',
        t4Mode:'T4_NETWORK',originalReceipt:captured.originalT3Receipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,
        capture:captured,networkPublished:false});
    },
    async putAsset({mutationInput,sourceCursor,captureRef}={}){
      if(originalKernel.hasOperation('t1.putAsset')!==true||
        typeof originalKernel.putAsset!=='function')
        fail('ORIGINAL_HOST_T3_ASSET_PORT_REQUIRED');
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.putAsset(mutationInput);
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
          subjectKind:'ASSET_PUT',t4Mode:'LOCAL_T3',originalReceipt,
          capture:null,originalT3OperationUsed:true,originalHostUnchanged:true,
          networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!ID(mutationInput?.workspace_id)||
        !ID(mutationInput?.asset_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const capture=await captureT4OriginalHostSubjectMutation({
        ...hostCapturePorts(),kind:'ASSET_PUT',
        workspaceId:mutationInput.workspace_id,captureRef,sourceCursor,
        mutationInput,
      });
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
        subjectKind:'ASSET_PUT',t4Mode:'T4_NETWORK',capture,
        originalReceipt:capture.originalReceipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,
        networkPublished:false});
    },
    async putRelation({mutationInput,sourceCursor,captureRef}={}){
      if(originalKernel.hasOperation('t1.putRelation')!==true||
        typeof originalKernel.putRelation!=='function')
        fail('ORIGINAL_HOST_T3_RELATION_PORT_REQUIRED');
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.putRelation(mutationInput);
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
          subjectKind:'RELATION_PUT',t4Mode:'LOCAL_T3',originalReceipt,
          capture:null,originalT3OperationUsed:true,originalHostUnchanged:true,
          networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!ID(mutationInput?.workspace_id)||
        !ID(mutationInput?.relation_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const capture=await captureT4OriginalHostSubjectMutation({
        ...hostCapturePorts(),kind:'RELATION_PUT',
        workspaceId:mutationInput.workspace_id,captureRef,sourceCursor,
        mutationInput,
      });
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
        subjectKind:'RELATION_PUT',t4Mode:'T4_NETWORK',capture,
        originalReceipt:capture.originalReceipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,
        networkPublished:false});
    },
    async deleteObject({mutationInput}={}){
      if(originalKernel.hasOperation('t1.deleteObject')!==true||
        typeof originalKernel.deleteObject!=='function')
        fail('ORIGINAL_HOST_T3_DELETE_OBJECT_PORT_REQUIRED');
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.deleteObject(mutationInput);
        return Object.freeze({
          schema:'IWXA_T4_ORIGINAL_HOST_OBJECT_DELETE_RESULT_V1',
          t4Mode:'LOCAL_T3',originalReceipt,originalT3OperationUsed:true,
          originalHostUnchanged:true,capture:null,networkPublished:false,
        });
      }
      // The released T3 original delete may retain live Relation edges
      // while its attached Asset vanishes from getAsset. No T4 Object
      // Delete delta or replay can be authorized by an advisory preflight.
      fail('ORIGINAL_HOST_T4_OBJECT_DELETE_NOT_QUALIFIED');
    },
    async reconcileAssetMutation({captureRef,workspaceId,assetId}={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,assetId].every(ID))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return reconcileT4OriginalHostSubjectMutation({
        ...hostCapturePorts(),kind:'ASSET_PUT',captureRef,workspaceId,
        subjectId:assetId,
      });
    },
    async reconcileRelationMutation({captureRef,workspaceId,relationId}={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,relationId].every(ID))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return reconcileT4OriginalHostSubjectMutation({
        ...hostCapturePorts(),kind:'RELATION_PUT',captureRef,workspaceId,
        subjectId:relationId,
      });
    },
    async reconcileObjectMutation({
      captureRef,workspaceId,objectId,
    }={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,objectId].every(ID))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return reconcileT4OriginalMutationIntent({
        ...hostCapturePorts(),captureRef,workspaceId,objectId,
      });
    },
  });
}
