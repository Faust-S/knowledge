// W05.49 exact released K036 only, original company persistence owner.
// D1 decisions and installed artifact/Task reads are controlled fixtures;
// no claim about signed private authority, installed Agent or corporate ACCEPT.
import {createHash} from "node:crypto";
import {createTrustedOriginalCompanyWorkspacePersistence,ORIGINAL_COMPANY_RECORD_SCHEMA}
  from "../src/t3/original-company-workspace-persistence.mjs";
const sha=s=>createHash("sha256").update(s).digest("hex");
const operations=["t1.getWorkspace","t1.getObject","t1.listEventsSince","t1.commitObjectGraph","t1.createWorkspace"];
const exportOptions=workspace_id=>({workspaces:[workspace_id],include_history:true,
  include_assets:true,include_relations:true,include_schemas:true});

export async function qualifyOriginalCompanySharedResultOnK036({openEmpty,check,same,expectReject}){
  const ws="qualification-company-shared-result",org="org:qualification";
  const source={organizationId:org,workspaceId:ws,executorId:"person:source",taskId:"task:source",
    taskRevisionId:sha("source-task"),packageSha256:sha("source-package")};
  const reader={...source,executorId:"person:reader",taskId:"task:dependent",
    taskRevisionId:sha("dependent-task"),packageSha256:sha("dependent-package")};
  const text="Original company accepted Agent Result. ".repeat(2048);
  const reference={sourceTask:source,artifactId:"RES-source",artifactSha256:sha(text)};
  const makeOwner=(client,task,canWrite=false)=>{
    const readContext={kind:"CORP",context_id:"ctx:"+task.executorId,
      actor_id:task.executorId,principal_id:org,organization_id:org,role_id:"role:worker",
      grant_id:"grant:read:"+task.executorId,realm_id:"realm:qualification",
      audience:"service:agent",resource:ws,workspace_id:ws,purpose:"workspace.read",scope_revision:1};
    const portFor=(op)=>{
      const write=op==="commitObjectGraph"||op==="createWorkspace";
      if(write&&!canWrite)return null;
      const context=write?{...readContext,grant_id:"grant:write:"+task.executorId,purpose:"workspace.work"}:readContext;
      return {currentContext:()=>({...context}),actionFor:operation=>
        operation==="t1.commitObjectGraph"?"object.write":operation==="t1.createWorkspace"?"workspace.create":"workspace.read",
        operationDigest:x=>sha(JSON.stringify(x)),
        authorize:request=>({schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
          allowed:true,outcome:"PERMITTED",evidenceOnly:true,requestDigest:sha(JSON.stringify(request)),
          policyDigest:sha("fixture-policy"),operationDigest:request.operationDigest,
          evidenceDigest:sha("fixture-evidence"),statusSequence:1,organizationId:org,workspaceId:ws,
          grantId:context.grant_id,productionActivation:false,doesNotTransferData:true,
          doesNotAcceptCorporateCopy:true,validUntil:new Date(Date.now()+60000).toISOString()}),
        verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(JSON.stringify(request))};
    };
    const kernel={sessionInfo:{contract_version:client.contract_version,runtime_version:client.runtime_version},
      hasOperation:op=>operations.includes(op)&&typeof client.t1[op.slice(3)]==="function",
      getWorkspace:id=>client.t1.getWorkspace(id),getObject:(id,object)=>client.t1.getObject(id,object),
      listEventsSince:(id,since)=>client.t1.listEventsSince(id,since??""),
      commitObjectGraph:command=>client.t1.commitObjectGraph(command),
      createWorkspace:command=>client.t1.createWorkspace(command)};
    return createTrustedOriginalCompanyWorkspacePersistence({kernel,selectSignedAccess:portFor,
      readOriginalSignedTask:()=>task,isHostActive:()=>true,
      readInstalledCompanyArtifact:({kind,artifactId})=>{
        if(!canWrite)throw Error("reader must never invoke source artifact owner");
        const body=kind==="RESULT"?text:"Other company material preserved in whole Workspace";
        return {kind,artifactId,operationId:"receipt:"+artifactId,organizationId:org,workspaceId:ws,
          executorId:task.executorId,taskId:task.taskId,taskRevisionId:task.taskRevisionId,
          taskPackageSha256:task.packageSha256,mimeType:"text/plain",text:body,sha256:sha(body),
          sourceKind:kind==="RESULT"?"ORIGINAL_AGENT_HUMAN_ACCEPTED":"ORIGINAL_COMPANY_WORKAREA"};
      }});
  };
  const writer=await openEmpty();
  await writer.t1.createWorkspace({workspace_id:ws,profile:"personal"});
  const owner=makeOwner(writer,source,true);
  const saved=await owner.commit("RESULT",reference.artifactId);
  check("company Result commits through exact released K036 owner",saved.originalKernelReadback===true);
  const document=await owner.commit("DOCUMENT","DOC-other");
  check("whole company Workspace contains independent material",document.originalKernelReadback===true);
  const before=await makeOwner(writer,reader).readSharedResult(reference);
  same("second employee reads original K036 Result identity",before.originalObject.object_id,saved.originalObjectId);
  same("second employee reads original K036 Result bytes",before.originalObject.data.text,text);
  check("K036 shared Result observation is not corporate acceptance or dispatch",
    before.corporateAcceptanceProven===false&&before.sourceCurrentnessProven===false&&
    before.resultReuseProven===false&&before.executionAuthorized===false);
  const packageArtifact=await writer.t2.exportPackage(exportOptions(ws));
  check("whole company Workspace exported by original Exchange",packageArtifact.bytes instanceof Uint8Array&&packageArtifact.bytes.length>0);
  const receiver=await openEmpty();
  same("company receiver starts with empty original Workspace catalog",await receiver.t1.listWorkspaces(),[]);
  const preview=await receiver.t2.importPreview(packageArtifact.bytes);
  await receiver.t2.importCommit({preview_token:preview.preview_token,package_digest:preview.package_digest,plan:{mode:"full"}});
  const observed=await makeOwner(receiver,reader).readSharedResult(reference);
  same("same-ID Exchange preserves exact shared Result data",observed.originalObject.data,before.originalObject.data);
  same("same-ID Exchange preserves exact shared Result ID",observed.originalObject.object_id,before.originalObject.object_id);
  const rows=await receiver.t1.listObjects({workspace_id:ws,schema_id:ORIGINAL_COMPANY_RECORD_SCHEMA});
  same("whole company Workspace restoration keeps both original objects",rows.map(x=>x.object_id).sort(),
    [saved.originalObjectId,document.originalObjectId].sort());
  same("whole company Workspace semantic digest restored",
    (await receiver.t2.exportPackage(exportOptions(ws))).manifest.semantic_digest,packageArtifact.manifest.semantic_digest);
  await expectReject("restored shared Result refuses changed artifact hash",
    ()=>makeOwner(receiver,reader).readSharedResult({...reference,artifactSha256:sha("changed")}),
    ["T3_COMPANY_SHARED_RESULT_CONTENT_CHANGED"]);
  await expectReject("restored shared Result refuses foreign organization",
    ()=>makeOwner(receiver,reader).readSharedResult({...reference,sourceTask:{...source,organizationId:"org:other"}}),
    ["T3_COMPANY_SHARED_RESULT_SCOPE_REQUIRED"]);
  same("shared Result observations create no extra objects",
    (await receiver.t1.listObjects({workspace_id:ws,schema_id:ORIGINAL_COMPANY_RECORD_SCHEMA})).length,2);
  return {source:"EXACT_K036_RUNTIME_CONTROLLED_D1_AND_ARTIFACT_FIXTURE",wholeWorkspaceRestored:true,
    originalResultReadback:true,corporateAcceptanceProven:false,sourceCurrentnessProven:false,
    resultReuseProven:false,executionAuthorized:false};
}
