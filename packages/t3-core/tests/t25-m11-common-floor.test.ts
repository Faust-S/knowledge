import {describe,expect,it} from "vitest";
import type {ObjectRecord,ObjectWithRelations,RelationRecord} from "../src/kernel-client/contracts/runtime-1.2.0";
import {PERSONAL_PROFILE_DEFINITION} from "../src/profiles/personal/definition";
import {ORGANIZATION_PROFILE_DEFINITION} from "../src/profiles/organization/definition";
import {RELATION_INDEX_MAX_SOURCE_OBJECTS,buildWorkspaceRelationIndex,projectWorkspaceRelationIndex,selectRelationIndexSources} from "../src/modules/base/features/workspace/relation-index-model";

function object(id:string,schemaId:string,workspaceId:string):ObjectRecord{
 return {
  workspace_id:workspaceId,object_id:id,schema_id:schemaId,schema_version:"1",
  created_by_service:"fixture",updated_by_service:"fixture",
  created_at:"2026-09-20T00:00:00Z",updated_at:"2026-09-20T00:00:00Z",
  revision:1,data:{},extensions:{},
 };
}
function relation(id:string,from:string,to:string,workspaceId:string):RelationRecord{
 return {
  relation_id:id,workspace_id:workspaceId,from_object_id:from,to_object_id:to,
  kind:"related",created_at:"2026-09-20T00:00:00Z",created_by_service:"fixture",
 };
}
function detail(source:ObjectRecord,outgoing:RelationRecord[]=[],incoming:RelationRecord[]=[]):ObjectWithRelations{
 return {object:source,relations:{outgoing,incoming}};
}
function schemaIds(definition:{sections:readonly {schemaIds:readonly string[]}[]}):string[]{
 return [...new Set(definition.sections.flatMap(section=>section.schemaIds))].sort();
}
function qualifyProfile(profileId:string,schemas:string[]){
 const workspaceId="m11-"+profileId;
 const [leftSchema,rightSchema]=schemas;
 const left=object(profileId+"-a",leftSchema,workspaceId);
 const right=object(profileId+"-b",rightSchema,workspaceId);
 const edge=relation(profileId+"-r",left.object_id,right.object_id,workspaceId);
 const model=buildWorkspaceRelationIndex({
  workspaceId,
  objects:[left,right],
  sources:[
   {sourceObjectId:left.object_id,state:"ready" as const,detail:detail(left,[edge],[])},
   {sourceObjectId:right.object_id,state:"ready" as const,detail:detail(right,[],[edge])},
  ],
 });
 return {
  model,
  cross:projectWorkspaceRelationIndex(model.entries,"cross-schema",null),
  schemas:[leftSchema,rightSchema],
 };
}

describe("T2.5 M11 materially different adopter common-floor qualification",()=>{
 it("uses materially different Personal and Organization schema vocabularies",()=>{
  const personal=schemaIds(PERSONAL_PROFILE_DEFINITION);
  const organization=schemaIds(ORGANIZATION_PROFILE_DEFINITION);
  expect(personal.length).toBeGreaterThanOrEqual(2);
  expect(organization.length).toBeGreaterThanOrEqual(2);
  expect(personal).not.toEqual(organization);
  expect(personal.filter(id=>organization.includes(id))).toEqual([]);
 });

 it("the same Workspace relation-index floor works for Personal and Organization without profile-specific branches",()=>{
  const personal=qualifyProfile("personal",schemaIds(PERSONAL_PROFILE_DEFINITION));
  const organization=qualifyProfile("organization",schemaIds(ORGANIZATION_PROFILE_DEFINITION));
  for(const qualified of [personal,organization]){
   expect(qualified.model.entries).toHaveLength(1);
   expect(qualified.model.entries[0].fromSchemaId).toBe(qualified.schemas[0]);
   expect(qualified.model.entries[0].toSchemaId).toBe(qualified.schemas[1]);
   expect(qualified.cross).toHaveLength(1);
   expect(qualified.model.diagnostics).toEqual({
    sourceLoadFailures:0,sourceMissing:0,sourceIdentityMismatches:0,rejectedRelations:0,relationIdConflicts:0,
   });
  }
 });

 it("applies the same fail-closed Workspace and canonical identity checks to both adopters",()=>{
  for(const [profileId,schemas] of [
   ["personal",schemaIds(PERSONAL_PROFILE_DEFINITION)],
   ["organization",schemaIds(ORGANIZATION_PROFILE_DEFINITION)],
  ] as const){
   const workspaceId="m11-"+profileId+"-validation";
   const left=object(profileId+"-a",schemas[0],workspaceId);
   const right=object(profileId+"-b",schemas[1],workspaceId);
   const invalidRelations=[
    relation(profileId+"-cross-workspace",left.object_id,right.object_id,"other-workspace"),
    relation(profileId+"-unsafe",left.object_id,"bad id!",workspaceId),
    relation(profileId+"-endpoint-mismatch",right.object_id,left.object_id,workspaceId),
   ];
   const relationModel=buildWorkspaceRelationIndex({
    workspaceId,
    objects:[left,right],
    sources:[{sourceObjectId:left.object_id,state:"ready" as const,detail:detail(left,invalidRelations,[])}],
   });
   expect(relationModel.entries).toEqual([]);
   expect(relationModel.diagnostics.rejectedRelations).toBe(3);

   const sourceIdentityModel=buildWorkspaceRelationIndex({
    workspaceId,
    objects:[left,right],
    sources:[{sourceObjectId:left.object_id,state:"ready" as const,detail:detail(right,[],[])}],
   });
   expect(sourceIdentityModel.entries).toEqual([]);
   expect(sourceIdentityModel.diagnostics.sourceIdentityMismatches).toBe(1);
  }
 });

 it("keeps the relation-index source floor bounded and deterministic for both adopters",()=>{
  for(const [profileId,schemas] of [
   ["personal",schemaIds(PERSONAL_PROFILE_DEFINITION)],
   ["organization",schemaIds(ORGANIZATION_PROFILE_DEFINITION)],
  ] as const){
   const workspaceId="m11-"+profileId+"-bounded";
   const objects=Array.from({length:RELATION_INDEX_MAX_SOURCE_OBJECTS+5},(_,index)=>
    object(profileId+"-"+String(RELATION_INDEX_MAX_SOURCE_OBJECTS+4-index).padStart(3,"0"),schemas[index%schemas.length],workspaceId),
   );
   const first=selectRelationIndexSources(objects);
   const second=selectRelationIndexSources([...objects].reverse());
   expect(first.objects).toHaveLength(RELATION_INDEX_MAX_SOURCE_OBJECTS);
   expect(first.isTruncated).toBe(true);
   expect(first.objects.map(item=>item.object_id)).toEqual(second.objects.map(item=>item.object_id));
   expect(first.objects.map(item=>item.object_id)).toEqual(
    [...first.objects].map(item=>item.object_id).sort(),
   );
  }
 });

 it("M11 common claim is limited to the shared relation/index mechanism, not domain semantics",()=>{
  const personal=schemaIds(PERSONAL_PROFILE_DEFINITION);
  const organization=schemaIds(ORGANIZATION_PROFILE_DEFINITION);
  expect(personal).toContain("goal");
  expect(organization).toContain("process");
  expect(personal).not.toContain("process");
  expect(organization).not.toContain("goal");
 });
});
