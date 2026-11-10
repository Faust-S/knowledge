// @vitest-environment jsdom
import {describe,it,expect} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {ViewerRegistry} from "../src/workspace-host/registries/ViewerRegistry";
import {ObjectPreviewCard} from "../src/modules/base/features/workspace/ObjectPreviewCard";
const obj={workspace_id:"w",object_id:"o",schema_id:"note",schema_version:"1.0.0",revision:1,updated_at:"2026-01-01T00:00:00Z",data:{title:"Hello"}} as never;
describe("Workspace card with Host viewer",()=>it("retains fallback",()=>{
 render(<ObjectPreviewCard profileId="generic" object={obj} viewerRegistry={new ViewerRegistry()} onOpen={()=>{}}/>);
 expect(screen.getByTestId("unknown-object-preview")).toBeTruthy();cleanup();
}));
