import {describe,it,expect} from "vitest";
import {ViewerRegistry} from "../src/workspace-host/registries/ViewerRegistry";
import {buildBaseViewerContributions} from "../src/modules/base/viewers";
import {activateProfile} from "../src/config/profile-loader";
import {PERSONAL_TYPES} from "../src/profiles/personal";
import {ORGANIZATION_TYPES} from "../src/profiles/organization";
function registry(){const r=new ViewerRegistry();const entries=buildBaseViewerContributions().map(contribution=>({contributionId:contribution.id,ownerModuleId:contribution.moduleId,requiredOperations:[],contribution}));expect(r.registerMany("iwxa.workspace.base",entries).ok).toBe(true);return r;}
describe("built-in profiles and Host viewers",()=>{
 it("registers all declared personal and organization types",()=>{
  const r=registry();
  for(const schemaId of PERSONAL_TYPES)expect(r.resolve({profileId:"personal",schemaId,schemaVersion:"1.0.0",surface:"detail"})).not.toBeNull();
  for(const schemaId of ORGANIZATION_TYPES)expect(r.resolve({profileId:"organization",schemaId,schemaVersion:"1.0.0",surface:"detail"})).not.toBeNull();
 });
 it("loads personal, organization and health profile in one build",async()=>{
  for(const id of ["personal","organization","health"] as const){
   const p=await activateProfile(id);expect(p.definition.id).toBe(id);
  }
 });
});
