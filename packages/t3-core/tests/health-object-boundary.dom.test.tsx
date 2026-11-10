// @vitest-environment jsdom
import {describe,it,expect,vi} from "vitest";
import {useMemo} from "react";
import {renderHook,waitFor,cleanup} from "@testing-library/react";
import {useWorkspaceContent} from "../src/modules/base/features/workspace/useWorkspaceContent";
import {createDevMockClient} from "../src/kernel-client/dev-mock";
import {createKernelFacade} from "../src/workspace-host/context/create-kernel-facade";
import {adapter} from "../src/kernel-client";
import {ViewerRegistry} from "../src/workspace-host/registries/ViewerRegistry";
import {buildBaseViewerContributions} from "../src/modules/base/viewers";
describe("user-controlled presentation without profile blocks",()=>{
 it("reads an authorized health workspace normally",async()=>{
  const session=createDevMockClient({seedWorkspaces:[{workspace_id:"h",profile:"health",capabilities:[],read_only:false,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"}]});
  const list=vi.spyOn(adapter,"listObjects");
  const {result}=renderHook(()=>useWorkspaceContent({kernel:useMemo(()=>createKernelFacade({session}),[session]),workspaceId:"h"}));
  await waitFor(()=>expect(result.current.profile.status).toBe("ready"));
  await waitFor(()=>expect(result.current.objectsState).toBe("ready"));
  expect(list).toHaveBeenCalled();cleanup();vi.restoreAllMocks();
 });
 it("does not block registered viewers because a profile is health",()=>{
  const r=new ViewerRegistry();const list=buildBaseViewerContributions().map(contribution=>({contributionId:contribution.id,ownerModuleId:contribution.moduleId,requiredOperations:[],contribution}));
  expect(r.registerMany("iwxa.workspace.base",list).ok).toBe(true);
  expect(r.resolve({profileId:"health",schemaId:"note",schemaVersion:"1.0.0",surface:"detail"})?.isFallback).toBe(true);
 });
});
