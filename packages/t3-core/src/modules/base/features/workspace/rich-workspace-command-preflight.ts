import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceObjectOwnerCommandDescriptor } from "../../../../profiles/definition";
import type { CommandsFacade } from "../../../../workspace-contract";
import { isSafeOpaqueId } from "../../../../shell/routing";

export interface WorkspaceOwnerCommandObjectRef {
  objectId: string;
  schemaId: string;
  revision: number;
}

export interface WorkspaceOwnerCommandDraft {
  workspaceId: string;
  objects: readonly WorkspaceOwnerCommandObjectRef[];
}

export interface PreparedWorkspaceOwnerCommand {
  descriptorId: string;
  label: string;
  commandId: string;
  descriptorFingerprint: string;
  draft: WorkspaceOwnerCommandDraft;
  selectionFingerprint: string;
}

export type WorkspaceOwnerCommandPreflight =
  | { status: "READY"; prepared: PreparedWorkspaceOwnerCommand }
  | {
      status:
        | "INVALID_DESCRIPTOR"
        | "INVALID_SELECTION_SIZE"
        | "SELECTION_NOT_CANONICAL"
        | "SCHEMA_NOT_APPLICABLE"
        | "SAME_SCHEMA_REQUIRED"
        | "COMMAND_UNAVAILABLE";
      prepared: null;
    };

function safeToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && !/[\u0000-\u001f]/u.test(value);
}

function descriptorFingerprint(descriptor: WorkspaceObjectOwnerCommandDescriptor): string {
  return JSON.stringify([
    descriptor.id,
    descriptor.label,
    descriptor.commandId,
    [...descriptor.schemaIds].sort(),
    descriptor.selectionSize,
    descriptor.sameSchema,
  ]);
}

function canonicalSelection(input: {
  workspaceId: string;
  objects: readonly ObjectRecord[];
  selectedObjectIds: readonly string[];
}): WorkspaceOwnerCommandObjectRef[] | null {
  const ids=[...new Set(input.selectedObjectIds.filter((id)=>typeof id==="string"&&id.length>0))].sort();
  const byId=new Map(
    input.objects
      .filter((object)=>object.workspace_id===input.workspaceId && isSafeOpaqueId(object.object_id))
      .map((object)=>[object.object_id,object] as const),
  );
  const refs:WorkspaceOwnerCommandObjectRef[]=[];
  for(const id of ids){
    const object=byId.get(id);
    if(!object
      || typeof object.schema_id!=="string"
      || object.schema_id.length===0
      || !Number.isInteger(object.revision)
      || object.revision<0){
      return null;
    }
    refs.push({objectId:object.object_id,schemaId:object.schema_id,revision:object.revision});
  }
  return refs;
}

export function buildWorkspaceOwnerCommandSelectionFingerprint(input:{
  workspaceId:string;
  objects:readonly ObjectRecord[];
  selectedObjectIds:readonly string[];
}):string|null{
  const refs=canonicalSelection(input);
  if(!refs) return null;
  return JSON.stringify([input.workspaceId,refs.map((ref)=>[ref.objectId,ref.schemaId,ref.revision])]);
}

export function prepareWorkspaceOwnerCommand(input:{
  descriptor:WorkspaceObjectOwnerCommandDescriptor;
  workspaceId:string;
  objects:readonly ObjectRecord[];
  selectedObjectIds:readonly string[];
  commands?:CommandsFacade;
}):WorkspaceOwnerCommandPreflight{
  const {descriptor}=input;
  if(!descriptor
    || !safeToken(descriptor.id)
    || !safeToken(descriptor.label)
    || !safeToken(descriptor.commandId)
    || !Array.isArray(descriptor.schemaIds)
    || descriptor.schemaIds.length===0
    || descriptor.schemaIds.some((schemaId)=>!safeToken(schemaId))
    || !Number.isInteger(descriptor.selectionSize)
    || descriptor.selectionSize<1
    || descriptor.selectionSize>100
    || typeof descriptor.sameSchema!=="boolean"){
    return {status:"INVALID_DESCRIPTOR",prepared:null};
  }

  const refs=canonicalSelection(input);
  if(!refs) return {status:"SELECTION_NOT_CANONICAL",prepared:null};
  if(refs.length!==descriptor.selectionSize){
    return {status:"INVALID_SELECTION_SIZE",prepared:null};
  }
  const allowed=new Set(descriptor.schemaIds);
  if(refs.some((ref)=>!allowed.has(ref.schemaId))){
    return {status:"SCHEMA_NOT_APPLICABLE",prepared:null};
  }
  if(descriptor.sameSchema && new Set(refs.map((ref)=>ref.schemaId)).size!==1){
    return {status:"SAME_SCHEMA_REQUIRED",prepared:null};
  }
  if(!input.commands?.has(descriptor.commandId)){
    return {status:"COMMAND_UNAVAILABLE",prepared:null};
  }

  const draft=Object.freeze({
    workspaceId:input.workspaceId,
    objects:Object.freeze(refs.map((ref)=>Object.freeze({...ref}))),
  });
  const selectionFingerprint=JSON.stringify([
    input.workspaceId,
    refs.map((ref)=>[ref.objectId,ref.schemaId,ref.revision]),
  ]);
  return {
    status:"READY",
    prepared:Object.freeze({
      descriptorId:descriptor.id,
      label:descriptor.label,
      commandId:descriptor.commandId,
      descriptorFingerprint:descriptorFingerprint(descriptor),
      draft,
      selectionFingerprint,
    }),
  };
}

export function preparedWorkspaceOwnerCommandIsCurrent(input:{
  prepared:PreparedWorkspaceOwnerCommand;
  descriptor:WorkspaceObjectOwnerCommandDescriptor;
  workspaceId:string;
  objects:readonly ObjectRecord[];
  selectedObjectIds:readonly string[];
}):boolean{
  const fingerprint=buildWorkspaceOwnerCommandSelectionFingerprint(input);
  return fingerprint!==null
    && input.prepared.draft.workspaceId===input.workspaceId
    && input.prepared.selectionFingerprint===fingerprint
    && input.prepared.descriptorId===input.descriptor.id
    && input.prepared.commandId===input.descriptor.commandId
    && input.prepared.descriptorFingerprint===descriptorFingerprint(input.descriptor);
}

export async function invokePreparedWorkspaceOwnerCommand<TResult=unknown>(input:{
  commands:CommandsFacade;
  prepared:PreparedWorkspaceOwnerCommand;
  descriptor:WorkspaceObjectOwnerCommandDescriptor;
  workspaceId:string;
  objects:readonly ObjectRecord[];
  selectedObjectIds:readonly string[];
}):Promise<TResult>{
  if(!preparedWorkspaceOwnerCommandIsCurrent(input)){
    throw new Error("WORKSPACE_OWNER_COMMAND_DRAFT_STALE");
  }
  if(!input.commands.has(input.prepared.commandId)){
    throw new Error("WORKSPACE_OWNER_COMMAND_UNAVAILABLE");
  }
  return input.commands.invoke<TResult>(input.prepared.commandId,input.prepared.draft);
}
