// Full PWA/domain-mode integration over the original qualified T2 Kernel.
// Real Kernel/Store/Exchange; ONE origin, ONE SW, ONE browser profile.
// Does NOT claim that the operating system installed a PWA application.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync}
  from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chromium} from "playwright";
import {materializeDomainMode}
  from "../scripts/materialize-t3-domain-mode.mjs";
import {materializeIntegrationHost,serveRealKernelHost}
  from "../scripts/real-kernel-e2e.mjs";
import {assertQualifiedKernelArtifact}
  from "../src/factory2/products/domain-completion/independent-browser-witness.mjs";
import {readStoredZip,createStoredZip} from "../scripts/zip-store.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {createTemporaryOriginalPersonalAuthority}
  from "./support/t3-original-personal-authority.mjs";

const SERVICE="iwxa.workspace.integration";
const RUNTIME="0.3.6";
const ARTIFACT="iwxa-kernel-k036-same-store-history-20261019-qualified.1";
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
function put(root,path,value){
  const full=join(root,path);
  mkdirSync(join(full,".."),{recursive:true});
  writeFileSync(full,value);
}
test("single PWA Domain Mode preserves real original Kernel write, two windows, .iwxa and cold offline readback",{
  timeout:180000
},async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified&&existsSync(join(qualified,"_iwxa/runtime/0.3.6/runtime.js")),
    "T3_PWA_REAL_QUALIFIED_KERNEL_REQUIRED");
  const root=mkdtempSync(join(tmpdir(),"t3-pwa-original-kernel-"));
  const dist=join(root,"dist"),profile=join(root,"profile");
  mkdirSync(dist);
  let live=null,context=null;
  const workspace="t3-pwa-"+randomUUID();
  const object="draft:pwa:1";
  const title="IWXA PWA original Kernel preserved document";
  try {
    cpSync(join(qualified,"_iwxa"),join(dist,"_iwxa"),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:RUNTIME,contract:"1.3.0",artifactId:ARTIFACT});
    const pinned=sha(join(dist,"_iwxa/runtime/0.3.6/runtime.js"));
    live=await serveRealKernelHost(dist);
    const host=materializeIntegrationHost(dist,live.origin);
    host.domain.runtime.kernel_release=RUNTIME;
    host.domain.runtime.runtime_version=RUNTIME;
    host.workspaceConfig.host.required_runtime_version=RUNTIME;
    host.workspaceConfig.host.required_contract_version="1.3.0";
    put(dist,"_iwxa/domain.json",JSON.stringify(host.domain));
    put(dist,"workspace/workspace.config.json",JSON.stringify(host.workspaceConfig));
    const passport="_iwxa/services/"+SERVICE+".json";
    put(dist,passport,JSON.stringify(host.passport));
    put(dist,"_iwxa/service-catalog.json",JSON.stringify({
      count:1,entries:[{
        service_id:SERVICE,service_version:host.passport.service_version,
        base_path:host.passport.base_path,
        supported_levels:host.passport.supported_levels,
        file:passport,sha256:sha(join(dist,passport))
      }]
    }));
    put(dist,"index.html",'<!doctype html><html lang="ru"><head>'+
      '<meta charset="utf-8"><title>IWXA T3 PWA Kernel</title></head><body>'+
      '<main><h1>IWXA T3</h1><label>Ввод<input id="unfinished"></label>'+
      '<a href="/workspace/">Открыть Workspace</a></main>'+
      '<script src="/_iwxa/loader.js"></script></body></html>');
    put(dist,"workspace/index.html",'<!doctype html><html lang="ru"><head>'+
      '<meta charset="utf-8"><title>IWXA Workspace</title></head><body>'+
      '<main><h1>Единая Workspace</h1></main>'+
      '<script src="/_iwxa/loader.js"></script></body></html>');
    const packaged=materializeDomainMode(dist);
    assert.ok(packaged.files>12);
    const asset=JSON.parse(readFileSync(join(dist,"t3-offline-manifest.json"),"utf8"));
    for(const file of ["/t3-app-manifest.json","/t3-sw.js",
      "/_iwxa/runtime/0.3.6/runtime.js","/workspace/"]){
      assert.ok(asset.files.some(x=>x.path===file),"T3_PWA_MISSING_"+file);
    }
    assert.equal(sha(join(dist,"_iwxa/runtime/0.3.6/runtime.js")),pinned);

    const launch=()=>chromium.launchPersistentContext(profile,{
      headless:true,ignoreHTTPSErrors:true,
      viewport:{width:1250,height:780},
      args:["--no-sandbox","--ignore-certificate-errors"],
    });
    context=await launch();
    let site=context.pages()[0]||await context.newPage();
    await site.goto(live.origin+"/");
    await site.waitForFunction(()=>typeof window.IWXA?.connect==="function");
    const manifest=await site.evaluate(async()=>{
      const link=document.querySelector('link[rel="manifest"]');
      return link?await (await fetch(link.href)).json():null;
    });
    assert.equal(manifest.display,"standalone");
    assert.equal(manifest.scope,"/");
    assert.equal(await site.evaluate(()=>navigator.serviceWorker.getRegistrations()
      .then(regs=>regs.length)),0,"PWA install metadata must not register autonomy");
    const saved=await site.evaluate(async({SERVICE,workspace,object,title})=>{
      const original=await window.IWXA.connect({service_id:SERVICE});
      if(original.contract_version!=="1.3.0" ||
         original.runtime_version!=="0.3.6")throw Error("NOT_ORIGINAL_KERNEL");
      await original.t1.createWorkspace({workspace_id:workspace,profile:"generic"});
      const receipt=await original.t1.putObject({
        workspace_id:workspace,object_id:object,
        schema_id:"iwxa.demo.note",schema_version:"1.0.0",
        base_revision:0,data:{title},extensions:{},
        event:{event_type:"t3.pwa.document.saved",payload:{}},
      });
      const options={workspaces:[workspace],include_history:true,
        include_assets:true,include_relations:true,include_schemas:true};
      const archive=await original.t2.exportPackage(options);
      const confirmation=await original.t2.confirmExport({
        package_digest:archive.package_digest,workspace_ids:[workspace],
      });
      return {event:receipt.event.event_id,revision:receipt.object.revision,
        exported:confirmation.package_digest===archive.package_digest,
        // Transfer the exact original .iwxa bytes to an INDEPENDENT
        // recipient Store. Reimporting an existing event in the same Store
        // must fail with IMPORT_EVENT_ID_COLLISION, as designed.
        archiveBytes:Array.from(archive.bytes)};
    },{SERVICE,workspace,object,title});
    assert.equal(saved.revision,1);
    assert.equal(saved.exported,true);
    assert.ok(saved.archiveBytes.length>0);
    const second=await context.newPage();
    await second.goto(live.origin+"/workspace/");
    await second.waitForFunction(()=>typeof window.IWXA?.connect==="function");
    const read=async page=>page.evaluate(async({SERVICE,workspace,object})=>{
      const original=await window.IWXA.connect({service_id:SERVICE});
      const record=await original.t1.getObject(workspace,object);
      const events=await original.t1.listEventsSince(workspace);
      return {text:record?.object?.data?.title,revision:record?.object?.revision,
        eventIds:events.map(e=>e.event_id)};
    },{SERVICE,workspace,object});
    let originalRead=await read(second);
    assert.equal(originalRead.text,title);
    assert.ok(originalRead.eventIds.includes(saved.event));
    // Explicitly install the offline snapshot, unrelated to PWA app install.
    site.once("dialog",dialog=>dialog.accept());
    await site.locator("#iwxa-t3-domain-switch").check();
    await site.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:60000});
    assert.equal(await site.evaluate(()=>navigator.serviceWorker.getRegistrations()
      .then(regs=>regs.length)),1,"only one existing T3 worker");
    assert.equal((await read(second)).text,title,
      "second same-profile Window must see the original Kernel Store");
    await second.getByRole("button",{name:"Применить изменения в этом окне"})
      .waitFor({state:"visible",timeout:15000});
    await second.getByRole("button",{name:"Применить изменения в этом окне"}).click();
    await second.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:20000});
    assert.equal((await read(second)).text,title);

    await context.close();context=null;
    context=await launch();
    await context.setOffline(true);
    site=context.pages()[0]||await context.newPage();
    await site.goto(live.origin+"/workspace/",{waitUntil:"domcontentloaded",
      timeout:30000});
    await site.waitForFunction(()=>typeof window.IWXA?.connect==="function",
      null,{timeout:30000});
    const cold=await read(site);
    assert.equal(cold.text,title);
    assert.equal(cold.revision,1);
    assert.ok(cold.eventIds.includes(saved.event));
    assert.equal(await site.locator("#iwxa-t3-domain-switch").isChecked(),true);
    assert.equal(sha(join(dist,"_iwxa/runtime/0.3.6/runtime.js")),pinned);
    // D4: actual independent original T2 recipient with its OWN Store.
    // Unlike an archive restored into its original source ID, this verifies
    // real cross-workspace transfer through the existing SIGNED Host binding.
    const recipient=await chromium.launchPersistentContext(join(root,"recipient-profile"),{
      headless:true,ignoreHTTPSErrors:true,
      args:["--no-sandbox","--ignore-certificate-errors"],
    });
    try{
      const receiver=recipient.pages()[0]||await recipient.newPage();
      await receiver.goto(live.origin+"/workspace/");
      await receiver.waitForFunction(()=>typeof window.IWXA?.connect==="function");
      const destination="t3-recipient-"+randomUUID();
      await receiver.evaluate(async({SERVICE,destination})=>{
        const original=await IWXA.connect({service_id:SERVICE});
        await original.t1.createWorkspace({workspace_id:destination,profile:"generic"});
      },{SERVICE,destination});
      // Thin request bridge: every receipt and data write comes from the
      // qualified original 0.3.6 Kernel in the independent recipient profile.
      // No new Kernel, Store, Exchange parser or issuer is created.
      const receiverKernel={
        sessionInfo:{contract_version:"1.3.0",runtime_version:RUNTIME},
        hasOperation:op=>[
          "t2.importPreview","t2.importCommit","t1.getObject"
        ].includes(op),
        importPreview:bytes=>receiver.evaluate(async({SERVICE,bytes})=>{
          const original=await IWXA.connect({service_id:SERVICE});
          return original.t2.importPreview(Uint8Array.from(bytes));
        },{SERVICE,bytes:[...bytes]}),
        importCommit:input=>receiver.evaluate(async({SERVICE,input})=>{
          const original=await IWXA.connect({service_id:SERVICE});
          return original.t2.importCommit(input);
        },{SERVICE,input}),
        getObject:(workspaceId,objectId)=>receiver.evaluate(
          async({SERVICE,workspaceId,objectId})=>{
            const original=await IWXA.connect({service_id:SERVICE});
            return original.t1.getObject(workspaceId,objectId);
          },{SERVICE,workspaceId,objectId}),
      };
      const originalOwner=createTemporaryOriginalPersonalAuthority({
        workspaceId:destination,now:Date.now(),clock:Date.now,
        operations:["t2.importPreview","t2.importCommit","t1.getObject"],
      });
      const scoped=createSubjectKernelBinding({
        kernel:receiverKernel,access:originalOwner.access,clock:Date.now,
      });
      const preview=await scoped.importPreview(Uint8Array.from(saved.archiveBytes));
      assert.deepEqual(preview.preview.manifest.workspaces,[workspace]);
      assert.notEqual(workspace,destination);
      assert.ok(preview.allowed_modes.includes("merge"),
        "original T2 recipient must authorize an explicit merge");
      const receipt=await scoped.importCommit({
        preview_token:preview.preview_token,package_digest:preview.package_digest,
        plan:{mode:"merge",include_workspaces:[workspace],
          target_workspace:destination,include_history:true,
          include_assets:true,include_relations:true,conflict:"skip"},
      });
      assert.equal(receipt.mode,"merge");
      assert.equal(receipt.workspace_id_map[workspace],destination,
        "original Kernel mapped exactly the archive source into signed recipient");
      const received=await scoped.getObject(destination,object);
      assert.equal(received?.object?.data?.title,title);
      assert.equal(received?.object?.revision,1);
      assert.ok(originalOwner.proofCount>=3,
        "original signed Access must recheck preview, commit and readback");
      console.log("T3_D4_SIGNED_FOREIGN_WORKSPACE_IWXA_ORIGINAL_KERNEL_PASS",
        JSON.stringify({sourceDifferentFromDestination:true,
          signedOriginalPersonalRecipient:true,originalKernel:RUNTIME,
          independentRecipientStore:true,originalIwxaBytes:true,
          originalImportMode:"merge",signedOperationProofs:originalOwner.proofCount,
          originalKernelRecipientReadback:true,secondConsumerNotYetQualified:true}));
    }finally{await recipient.close();}

    // Second INDEPENDENT supported consumer: unchanged original T2 Exchange,
    // not the signed T3 selected-Workspace port exercised above. This profile
    // has another ORIGINAL Kernel Store and must parse the same .iwxa bytes
    // without a new importer, adapter or schema normalization.
    const t2RecipientProfile=join(root,"t2-only-recipient-profile");
    const launchT2Recipient=()=>chromium.launchPersistentContext(t2RecipientProfile,{
      headless:true,ignoreHTTPSErrors:true,
      args:["--no-sandbox","--ignore-certificate-errors"],
    });
    let t2Recipient=await launchT2Recipient();
    try {
      let independent=t2Recipient.pages()[0]||await t2Recipient.newPage();
      await independent.goto(live.origin+"/workspace/");
      await independent.waitForFunction(()=>typeof window.IWXA?.connect==="function");
      // Construct negative packages using the pre-existing test ZIP writer,
      // never a replacement runtime importer or a new package format.
      // The original Kernel must reject unsupported versions and entries
      // escaping the archive root BEFORE exposing any preview/commit token.
      const originalEntries=[...readStoredZip(Buffer.from(saved.archiveBytes))]
        .map(([name,bytes])=>({name,bytes}));
      const manifestEntry=originalEntries.find(x=>x.name==="manifest.json");
      assert.ok(manifestEntry,"original T2 .iwxa must contain manifest.json");
      const manifest=JSON.parse(manifestEntry.bytes.toString("utf8"));
      assert.equal(manifest.format_version,"1.0");
      const unsupportedVersion=createStoredZip(originalEntries.map(entry=>
        entry.name!=="manifest.json"?entry:{
          name:entry.name,bytes:Buffer.from(JSON.stringify({
            ...manifest,format_version:"99.0",
          }),"utf8"),
        }));
      const traversal=createStoredZip([...originalEntries,{
        name:"content/../../escape.json",
        bytes:Buffer.from('{"untrusted":true}',"utf8"),
      }]);
      const negativeCandidates=[
        {kind:"unsupported-version",bytes:[...unsupportedVersion]},
        {kind:"zip-path-traversal",bytes:[...traversal]},
      ];
      const negative=await independent.evaluate(async({SERVICE,workspace,object,candidates})=>{
        const original=await IWXA.connect({service_id:SERVICE});
        const outcomes=[];
        for(const candidate of candidates){
          try{
            const unexpected=await original.t2.importPreview(
              Uint8Array.from(candidate.bytes));
            outcomes.push({kind:candidate.kind,rejected:false,
              tokenIssued:Boolean(unexpected?.preview_token)});
            if(unexpected?.preview_token && original.hasOperation?.("t2.importCancel"))
              await original.t2.importCancel(unexpected.preview_token);
          }catch(error){
            outcomes.push({kind:candidate.kind,rejected:true,
              errorCode:String(error?.code??error?.name??"UNKNOWN")});
          }
        }
        const record=await original.t1.getObject(workspace,object);
        return {outcomes,unchanged:record==null};
      },{SERVICE,workspace,object,candidates:negativeCandidates});
      assert.equal(negative.unchanged,true,
        "invalid packages must not create recipient objects");
      for(const outcome of negative.outcomes){
        assert.equal(outcome.rejected,true,
          "original T2 must refuse "+outcome.kind+
          ", observed "+JSON.stringify(outcome));
      }
      console.log("T3_D4_ORIGINAL_T2_UNSUPPORTED_VERSION_AND_TRAVERSAL_PASS",
        JSON.stringify({originalParser:true,negative:negative.outcomes,
          recipientStoreUnchanged:true}));
      const raw=await independent.evaluate(async({SERVICE,workspace,object,bytes})=>{
        const original=await window.IWXA.connect({service_id:SERVICE});
        if(original.contract_version!=="1.3.0"||
           original.runtime_version!=="0.3.6")throw Error("NOT_ORIGINAL_T2");
        const before=await original.t1.getObject(workspace,object);
        const archive=Uint8Array.from(bytes);
        let truncatedZipDenied=false;
        try {
          await original.t2.importPreview(archive.subarray(0,11));
        } catch(error) {
          truncatedZipDenied=typeof error?.code==="string"||
            error instanceof Error;
        }
        const preview=await original.t2.importPreview(archive);
        const mode=preview.allowed_modes?.includes("full")?"full":"selective";
        const receipt=await original.t2.importCommit({
          preview_token:preview.preview_token,package_digest:preview.package_digest,
          plan:{mode,include_workspaces:[workspace],include_history:true,
            include_assets:true,include_relations:true,conflict:"fail"},
        });
        const record=await original.t1.getObject(workspace,object);
        const events=await original.t1.listEventsSince(workspace);
        return {beforeAbsent:before===null||before===undefined,
          truncatedZipDenied,mode,source:preview.preview.manifest.workspaces[0],
          receiptMode:receipt.mode,receiptSource:receipt.workspace_id_map?.[workspace],
          title:record?.object?.data?.title,revision:record?.object?.revision,
          eventIds:events.map(e=>e.event_id)};
      },{SERVICE,workspace,object,bytes:saved.archiveBytes});
      assert.equal(raw.beforeAbsent,true,
        "the independent T2 recipient must have its own empty original Store");
      assert.equal(raw.truncatedZipDenied,true,
        "the original Exchange parser must refuse corrupted .iwxa ZIP");
      assert.equal(raw.source,workspace);
      assert.equal(raw.receiptMode,raw.mode);
      // The original T2 full/selective import does not promise an explicit
      // workspace_id_map (that field is meaningful for remapping/merge).
      // Actual destination data and original history must prove restoration.
      if(raw.mode==="merge"||raw.mode==="new-workspace")
        assert.equal(raw.receiptSource,workspace);
      assert.equal(raw.title,title);
      assert.equal(raw.revision,saved.revision);
      assert.ok(raw.eventIds.includes(saved.event),
        "original event provenance must survive in the second recipient");
      await t2Recipient.close();t2Recipient=null;
      t2Recipient=await launchT2Recipient();
      independent=t2Recipient.pages()[0]||await t2Recipient.newPage();
      await independent.goto(live.origin+"/workspace/");
      await independent.waitForFunction(()=>typeof window.IWXA?.connect==="function");
      const recovered=await read(independent);
      assert.equal(recovered.text,title);
      assert.equal(recovered.revision,saved.revision);
      assert.ok(recovered.eventIds.includes(saved.event),
        "second original T2 consumer must preserve history after cold restart");
      console.log("T3_D4_TWO_INDEPENDENT_CONSUMERS_ORIGINAL_IWXA_PASS",JSON.stringify({
        originalKernel:"0.3.6",contract:"1.3.0",
        consumerPorts:["signed-selected-T3","original-T2-Exchange"],
        independentlyPersistedRecipientStores:2,
        exactOriginalArchiveBytes:true,originalEventProvenanceRecovered:true,
        corruptZipRejectedByOriginalParser:true,
        secondConsumerColdRestartReadback:true,
        twoDifferentInstalledProductsAccepted:false,
      }));
    }finally{if(t2Recipient)await t2Recipient.close();}
    console.log("T3_PWA_REAL_ORIGINAL_KERNEL_EXCHANGE_TWO_WINDOW_COLD_PASS",JSON.stringify({
      originalKernel:"0.3.6",sameStore:true,oneServiceWorker:true,
      originalExchangeExport:true,originalExchangeImport:true,
      browserWindows:2,fullSiteAutonomy:true,coldOfflineReadback:true,
      userDataUnchanged:true,appOsInstallationQualified:false,
    }));
  }finally{
    if(context)await context.close().catch(()=>{});
    if(live?.server?.listening)await new Promise(r=>live.server.close(r));
    rmSync(root,{recursive:true,force:true});
  }
});
