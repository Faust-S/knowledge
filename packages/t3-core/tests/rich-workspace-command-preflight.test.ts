import {describe,expect,it,vi} from "vitest";
import type {ObjectRecord} from "../src/kernel-client/contracts/runtime-1.2.0";
import type {CommandsFacade} from "../src/workspace-contract";
import {
  invokePreparedWorkspaceOwnerCommand,
  prepareWorkspaceOwnerCommand,
  preparedWorkspaceOwnerCommandIsCurrent,
} from "../src/modules/base/features/workspace/rich-workspace-command-preflight";

function object(id:string,schemaId:string,revision=1,workspaceId="w"):ObjectRecord{
  return {
    object_id:id,workspace_id:workspaceId,schema_id:schemaId,schema_version:"1",
    created_by_service:"svc",updated_by_service:"svc",
    created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-02T00:00:00Z",
    revision,data:{secret:"must-not-enter-draft"},extensions:{},
  };
}

const descriptor={
  id:"notes.review",
  label:"Проверить заметки",
  commandId:"notes.review.execute",
  schemaIds:["note"],
  selectionSize:2,
  sameSchema:true,
} as const;

function commands(available=true){
  return {
    has:vi.fn((id:string)=>available&&id===descriptor.commandId),
    invoke:vi.fn(async (_id:string,args?:unknown)=>({ok:true,args})),
  } satisfies CommandsFacade;
}

describe("T2.5 P2 owner-command draft preflight",()=>{
  it("builds a metadata-only exact-revision draft for an available owner command",()=>{
    const facade=commands();
    const result=prepareWorkspaceOwnerCommand({
      descriptor,workspaceId:"w",
      objects:[object("b","note",3),object("a","note",2),object("foreign","note",1,"w2")],
      selectedObjectIds:["b","a"],commands:facade,
    });
    expect(result.status).toBe("READY");
    if(result.status!=="READY") throw new Error("expected ready");
    expect(result.prepared.draft).toEqual({
      workspaceId:"w",
      objects:[
        {objectId:"a",schemaId:"note",revision:2},
        {objectId:"b",schemaId:"note",revision:3},
      ],
    });
    expect(JSON.stringify(result.prepared.draft)).not.toContain("secret");
    expect(facade.has).toHaveBeenCalledWith("notes.review.execute");
  });

  it("fails closed for selection, schema, same-schema and command availability mismatches",()=>{
    const mixed=[object("a","note"),object("b","task")];
    expect(prepareWorkspaceOwnerCommand({descriptor,workspaceId:"w",objects:mixed,selectedObjectIds:["a"],commands:commands()}).status).toBe("INVALID_SELECTION_SIZE");
    expect(prepareWorkspaceOwnerCommand({descriptor,workspaceId:"w",objects:mixed,selectedObjectIds:["a","b"],commands:commands()}).status).toBe("SCHEMA_NOT_APPLICABLE");
    const mixedDescriptor={...descriptor,schemaIds:["note","task"]};
    expect(prepareWorkspaceOwnerCommand({descriptor:mixedDescriptor,workspaceId:"w",objects:mixed,selectedObjectIds:["a","b"],commands:commands()}).status).toBe("SAME_SCHEMA_REQUIRED");
    expect(prepareWorkspaceOwnerCommand({descriptor,workspaceId:"w",objects:[object("a","note"),object("b","note")],selectedObjectIds:["a","b"],commands:commands(false)}).status).toBe("COMMAND_UNAVAILABLE");
  });

  it("invalidates a prepared draft on workspace, selection or exact revision change and invokes only explicitly",async()=>{
    const facade=commands();
    const objects=[object("a","note",1),object("b","note",2)];
    const result=prepareWorkspaceOwnerCommand({descriptor,workspaceId:"w",objects,selectedObjectIds:["a","b"],commands:facade});
    if(result.status!=="READY") throw new Error("expected ready");
    expect(preparedWorkspaceOwnerCommandIsCurrent({prepared:result.prepared,descriptor,workspaceId:"w",objects,selectedObjectIds:["a","b"]})).toBe(true);
    expect(preparedWorkspaceOwnerCommandIsCurrent({prepared:result.prepared,descriptor,workspaceId:"w",objects:[object("a","note",9),object("b","note",2)],selectedObjectIds:["a","b"]})).toBe(false);
    await invokePreparedWorkspaceOwnerCommand({commands:facade,prepared:result.prepared,descriptor,workspaceId:"w",objects,selectedObjectIds:["a","b"]});
    expect(facade.invoke).toHaveBeenCalledTimes(1);
    expect(facade.invoke).toHaveBeenCalledWith("notes.review.execute",result.prepared.draft);
    await expect(invokePreparedWorkspaceOwnerCommand({commands:facade,prepared:result.prepared,descriptor,workspaceId:"w2",objects,selectedObjectIds:["a","b"]})).rejects.toThrow("WORKSPACE_OWNER_COMMAND_DRAFT_STALE");
    expect(facade.invoke).toHaveBeenCalledTimes(1);
  });

  it("invalidates prepared authority when the profile owner-command descriptor changes", async()=>{
    const facade=commands();
    const objects=[object("a","note",1),object("b","note",2)];
    const result=prepareWorkspaceOwnerCommand({descriptor,workspaceId:"w",objects,selectedObjectIds:["a","b"],commands:facade});
    if(result.status!=="READY") throw new Error("expected ready");
    const changed={...descriptor,commandId:"notes.review.v2"};
    expect(preparedWorkspaceOwnerCommandIsCurrent({
      prepared:result.prepared,descriptor:changed,workspaceId:"w",objects,selectedObjectIds:["a","b"],
    })).toBe(false);
    await expect(invokePreparedWorkspaceOwnerCommand({
      commands:facade,prepared:result.prepared,descriptor:changed,workspaceId:"w",objects,selectedObjectIds:["a","b"],
    })).rejects.toThrow("WORKSPACE_OWNER_COMMAND_DRAFT_STALE");
    expect(facade.invoke).not.toHaveBeenCalled();
  });
});
