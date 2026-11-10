import {describe,it,expect} from "vitest";
import {ViewerRegistry} from "../src/workspace-host/registries/ViewerRegistry";
import {buildBaseViewerContributions} from "../src/modules/base/viewers";
function registered(){
 const r=new ViewerRegistry();
 const entries=buildBaseViewerContributions().map(contribution=>({contributionId:contribution.id,ownerModuleId:contribution.moduleId,requiredOperations:[],contribution}));
 expect(r.registerMany("iwxa.workspace.base",entries).ok).toBe(true);return r;
}
describe("one Host viewer registry",()=>{
 it("preserves all 48 built-in preview and detail views",()=>{
  const r=registered();expect(r.size()).toBe(48);
  for(const [profileId,schemaId] of [["generic","note"],["personal","project"],["organization","risk"],["learning","reflection"],["health","sensitive-object"]]){
   for(const surface of ["preview","detail"] as const)expect(r.resolve({profileId,schemaId,schemaVersion:"1.0.0",surface})).not.toBeNull();
  }
 });
 it("does not automatically block generic presentation by health profile name",()=>{
  expect(registered().resolve({profileId:"health",schemaId:"note",schemaVersion:"1.0.0",surface:"detail"})?.isFallback).toBe(true);
 });
});
