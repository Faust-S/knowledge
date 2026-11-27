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
import {createStoredZip} from "../scripts/zip-store.mjs";
import {execFileSync} from "node:child_process";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {createTemporaryOriginalPersonalAuthority}
  from "./support/t3-original-personal-authority.mjs";

const SERVICE="iwxa.workspace.integration";
const RUNTIME="0.3.6";
const ARTIFACT="iwxa-kernel-k036-same-store-history-20261019-qualified.1";
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * Test-only canonical construction of original T2 1.0 package semantics.
 * A future-schema archive must pass BOTH integrity digests, otherwise an
 * integrity rejection would mask the required real semantic warning.
 * This is never used by runtime Exchange, Kernel or product import.
 */
const d4Digest=bytes=>createHash("sha256").update(bytes).digest("hex");
function d4Canonical(value){
  return JSON.stringify(value,(_key,part)=>{
    if(!part||typeof part!=="object"||Array.isArray(part))return part;
    return Object.fromEntries(Object.keys(part).sort()
      .filter(key=>part[key]!==undefined).map(key=>[key,part[key]]));
  });
}
function d4SemanticDigest(entries,options){
  const index=new Map(entries.map(e=>[e.name,Buffer.from(e.bytes)]));
  const read=name=>(index.get(name)?.toString("utf8")??"").split(/\r?\n/)
    .filter(Boolean).map(line=>JSON.parse(line));
  const lex=field=>(a,b)=>a[field].localeCompare(b[field]);
  const workspaces=read("content/workspaces.ndjson").sort(lex("workspace_id"))
    .map(w=>({workspace_id:w.workspace_id,profile:w.profile,
      capabilities:[...w.capabilities].sort(),read_only:w.read_only??false}));
  const objects=read("content/objects.ndjson").sort((a,b)=>
    a.workspace_id.localeCompare(b.workspace_id)||
    a.object_id.localeCompare(b.object_id)).map(o=>({
      workspace_id:o.workspace_id,object_id:o.object_id,
      schema_id:o.schema_id,schema_version:o.schema_version,
      created_by_service:o.created_by_service,
      updated_by_service:o.updated_by_service,
      revision:o.revision,deleted:o.deleted??false,
      data:o.data,extensions:o.extensions??{},
    }));
  const events=options.include_history?read("content/events.ndjson")
    .filter(e=>e.event_type!=="iwxa.import.applied").sort((a,b)=>
      a.workspace_id.localeCompare(b.workspace_id)||
      a.occurred_at.localeCompare(b.occurred_at)||
      a.event_id.localeCompare(b.event_id)).map(e=>({
        event_id:e.event_id,event_type:e.event_type,
        workspace_id:e.workspace_id,service_id:e.service_id,
        object_id:e.object_id??null,revision:e.revision??null,
        occurred_at:e.occurred_at,idempotency_key:e.idempotency_key??null,
        payload:e.payload,
      })): [];
  const relations=options.include_relations?read("content/relations.ndjson")
    .sort(lex("relation_id")).map(r=>({
      relation_id:r.relation_id,workspace_id:r.workspace_id,
      from_object_id:r.from_object_id,to_object_id:r.to_object_id,
      kind:r.kind,
    })): [];
  const assets=options.include_assets?read("content/assets.ndjson")
    .sort(lex("asset_id")).map(a=>({
      asset_id:a.asset_id,workspace_id:a.workspace_id,
      service_id:a.service_id,object_id:a.object_id??null,
      mime:a.mime,size:a.size,
      ...(a.sha256?{sha256:a.sha256}:{}),
    })): [];
  const schemas=options.include_schemas?[...index.keys()]
    .filter(name=>/^schemas\/[^/]+\.json$/.test(name))
    .map(name=>JSON.parse(index.get(name).toString("utf8")))
    .sort((a,b)=>a.schema_id.localeCompare(b.schema_id)||
      a.schema_version.localeCompare(b.schema_version))
    .map(sc=>({schema_id:sc.schema_id,schema_version:sc.schema_version,
      canonical_sha256:sc.canonical_sha256})): [];
  return d4Digest(Buffer.from(d4Canonical({
    workspaces,objects,events,relations,assets,schemas,
  })));
}


/** Optional real age CLI qualification: no key material or plaintext in
 * artifacts; only original T2 Kernel/Exchange admits the recovered .iwxa.
 * This test does not impersonate an installed publisher or native owner. */
function nativeAgeRecipients(root,bytes){
  const age=process.env.T3_D7_REAL_AGE_BINARY;
  const keygen=process.env.T3_D7_REAL_AGE_KEYGEN;
  assert.ok(age&&existsSync(age)&&keygen&&existsSync(keygen),
    "T3_D7_REAL_NATIVE_AGE_REQUIRED");
  const source=join(root,"age-original.iwxa");
  const cipher=join(root,"age-protected.iwxa.age");
  const identities=["a","b","unlisted"].map(name=>{
    const key=join(root,"age-"+name+".key");
    execFileSync(keygen,["-o",key],{timeout:15000,stdio:"pipe"});
    const publicKey=execFileSync(keygen,["-y",key],{
      timeout:15000,encoding:"utf8",stdio:"pipe"}).trim();
    assert.ok(publicKey.startsWith("age1")&&publicKey.length>50,
      "T3_D7_REAL_X25519_KEY_REQUIRED");
    return {key,publicKey};
  });
  writeFileSync(source,bytes);
  execFileSync(age,["-r",identities[0].publicKey,
    "-r",identities[1].publicKey,"-o",cipher,source],{
    timeout:30000,stdio:"pipe"});
  const encrypted=readFileSync(cipher);
  assert.ok(encrypted.toString("utf8",0,24).startsWith(
    "age-encryption.org/v1\n"),"T3_D7_ORIGINAL_AGE_HEADER_REQUIRED");
  assert.notEqual(d4Digest(encrypted),d4Digest(bytes));
  const opened=identities.slice(0,2).map((identity,index)=>{
    const out=join(root,"opened-"+index+".iwxa");
    execFileSync(age,["-d","-i",identity.key,"-o",out,cipher],{
      timeout:30000,stdio:"pipe"});
    const plaintext=readFileSync(out);
    assert.deepEqual(plaintext,bytes,"original .iwxa bytes changed by age");
    return plaintext;
  });
  const refused=(input,key)=>{
    try{execFileSync(age,["-d","-i",key,"-o",
      join(root,"refused-"+randomUUID()),input],{
        timeout:30000,stdio:"pipe"});return false;}catch{return true;}
  };
  assert.ok(refused(cipher,identities[2].key),
    "unlisted recipient unexpectedly decrypted archive");
  const tampered=Buffer.from(encrypted);
  tampered[tampered.length-1]^=1;
  const damaged=join(root,"tampered.iwxa.age");
  writeFileSync(damaged,tampered);
  assert.ok(identities.slice(0,2).every(x=>refused(damaged,x.key)),
    "tampered age ciphertext was accepted");
  return {opened,encrypted,sourceDigest:d4Digest(bytes)};
}

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
  const linkedObject="draft:pwa:linked";
  const linkedTitle="IWXA linked historical document";
  const relationId="t3-pwa-linked-relation";
  const assetId="t3-pwa-original-file";
  const assetText="Original T2 file bytes survive complete Workspace transfer.";
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
    // For platform qualification, reuse the actual compiled original Host.
    // The legacy kernel-only witness remains available to earlier lanes.
    const compiledHost=process.env.T3_PWA_COMPILED_HOST_DIR;
    if(compiledHost){
      for(const path of ["index.html","exchange/index.html","lifecycle/index.html"]){
        const bytes=readFileSync(join(compiledHost,path));
        assert.ok(bytes.includes("/workspace/assets/"),"ORIGINAL_COMPILED_HOST_ENTRY_REQUIRED");
        put(dist,"workspace/"+path,bytes);
      }
      cpSync(join(compiledHost,"assets"),join(dist,"workspace","assets"),{recursive:true});
    }
    const workspacePath=compiledHost?"/workspace/#/workspace/"+workspace:"/workspace/";
    const assertHost=async page=>{
      if(!compiledHost)return;
      await page.getByTestId("workspace-view").waitFor({state:"visible",timeout:45000});
      assert.equal(await page.getByTestId("module-route-not-found").count(),0);
      assert.equal(await page.getByTestId("module-route-error").count(),0);
    };
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
    const saved=await site.evaluate(async({SERVICE,workspace,object,title,
      linkedObject,linkedTitle,relationId,assetId,assetText})=>{
      const original=await window.IWXA.connect({service_id:SERVICE});
      if(original.contract_version!=="1.3.0" ||
         original.runtime_version!=="0.3.6")throw Error("NOT_ORIGINAL_KERNEL");
      await original.t1.createWorkspace({workspace_id:workspace,profile:"generic"});
      const receipt=await original.t1.putObject({
        workspace_id:workspace,object_id:object,
        schema_id:"iwxa.demo.note",schema_version:"1.0.0",
        base_revision:0,data:{title},
        extensions:{future:{preserve:"cross-consumer"}},
        event:{event_type:"t3.pwa.document.saved",payload:{}},
      });
      const second=await original.t1.putObject({workspace_id:workspace,
        object_id:linkedObject,schema_id:"iwxa.demo.note",schema_version:"1.0.0",
        base_revision:0,data:{title:linkedTitle},
        extensions:{future:{preserve:"linked-ref"}},
        event:{event_type:"t3.pwa.linked.saved",payload:{}},
      });
      await original.t1.putRelation({workspace_id:workspace,
        relation_id:relationId,from_object_id:object,to_object_id:linkedObject,
        kind:"related",event:{event_type:"t3.pwa.relation.saved",payload:{}}});
      // A real file, not an empty include_assets=true flag. The inherited
      // original T2 Kernel writes and exports the complete asset bytes.
      await original.t1.putAsset({workspace_id:workspace,asset_id:assetId,
        object_id:object,mime:"text/plain",
        bytes:new TextEncoder().encode(assetText),
        event:{event_type:"t3.pwa.file.saved",payload:{}}});
      const options={workspaces:[workspace],include_history:true,
        include_assets:true,include_relations:true,include_schemas:true};
      const inventory=await original.t2.exportPreview(options);
      if(inventory.counts.objects!==2||inventory.counts.relations!==1||
         inventory.counts.assets!==1||inventory.counts.schemas<1)
        throw Error("D4_COMPLETE_SOURCE_INVENTORY_INCOMPLETE");
      const archive=await original.t2.exportPackage(options);
      const confirmation=await original.t2.confirmExport({
        package_digest:archive.package_digest,workspace_ids:[workspace],
      });
      return {event:receipt.event.event_id,revision:receipt.object.revision,
        linkedEvent:second.event.event_id,
        exported:confirmation.package_digest===archive.package_digest,
        // Transfer the exact original .iwxa bytes to an INDEPENDENT
        // recipient Store, rather than prove recovery by rereading the
        // source. The corporate A-B-A witness separately exercises identical
        // Event merge and the known original K036 collision defect.
        archiveBytes:Array.from(archive.bytes)};
    },{SERVICE,workspace,object,title,linkedObject,linkedTitle,relationId,
      assetId,assetText});
    assert.equal(saved.revision,1);
    assert.equal(saved.exported,true);
    assert.ok(saved.archiveBytes.length>0);
    const sealed=process.env.T3_D7_REAL_AGE_BINARY
      ? nativeAgeRecipients(root,Buffer.from(saved.archiveBytes)) : null;
    const deliveryA=sealed?.opened[0]??Uint8Array.from(saved.archiveBytes);
    const deliveryB=sealed?.opened[1]??Uint8Array.from(saved.archiveBytes);
    const second=await context.newPage();
    await second.goto(live.origin+workspacePath);
    await second.waitForFunction(()=>typeof window.IWXA?.connect==="function");
    await assertHost(second);
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
    // The broadcast can already mark the OLD document autonomous.
    // Observe the actual user-requested reload, then wait for the original
    // Kernel loader and Host in the new document before reading its Store.
    await Promise.all([
      second.waitForEvent("framenavigated",{
        predicate:frame=>frame===second.mainFrame(),timeout:20000}),
      second.getByRole("button",{name:"Применить изменения в этом окне"}).click(),
    ]);
    await second.waitForLoadState("domcontentloaded");
    await second.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous")&&
      typeof window.IWXA?.connect==="function",null,{timeout:20000});
    await assertHost(second);
    assert.equal((await read(second)).text,title);

    await context.close();context=null;
    context=await launch();
    await context.setOffline(true);
    site=context.pages()[0]||await context.newPage();
    await site.goto(live.origin+workspacePath,{waitUntil:"domcontentloaded",
      timeout:30000});
    await site.waitForFunction(()=>typeof window.IWXA?.connect==="function",
      null,{timeout:30000});
    await assertHost(site);
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
        // A PERSON owns this agent; the specialist has its OWN Ed25519 key
        // and only the signed scoped child GRANT, not the person's key.
        agentActorId:"agent:recipient-analyst",
      });
      assert.equal(originalOwner.actorId,"agent:recipient-analyst");
      const originChain=originalOwner.snapshotSignedState();
      assert.equal(originChain.grants["grant:delegated-agent"].payload.parentGrantId,
        "grant:personal");
      assert.equal(originChain.grants["grant:delegated-agent"].payload.holderId,
        "agent:recipient-analyst");
      const scoped=createSubjectKernelBinding({
        kernel:receiverKernel,access:originalOwner.access,clock:Date.now,
      });
      const preview=await scoped.importPreview(Uint8Array.from(deliveryA));
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
      assert.equal(received?.object?.extensions?.future?.preserve,
        "cross-consumer");
      const linkedReceived=await scoped.getObject(destination,linkedObject);
      assert.equal(linkedReceived?.object?.data?.title,linkedTitle);
      assert.equal(linkedReceived?.object?.extensions?.future?.preserve,
        "linked-ref");
      const recoveredAsset=await receiver.evaluate(async({SERVICE,destination,assetId})=>{
        const original=await IWXA.connect({service_id:SERVICE});
        const file=await original.t1.getAsset(destination,assetId);
        return file?{mime:file.asset.mime,
          text:new TextDecoder().decode(file.bytes)}:null;
      },{SERVICE,destination,assetId});
      assert.deepEqual(recoveredAsset,{mime:"text/plain",text:assetText});
      const signedInventory=await receiver.evaluate(async({SERVICE,destination})=>{
        const original=await IWXA.connect({service_id:SERVICE});
        return original.t2.exportPreview({workspaces:[destination],
          include_history:true,include_relations:true,
          include_assets:true,include_schemas:true});
      },{SERVICE,destination});
      assert.equal(signedInventory.counts.objects,2);
      assert.equal(signedInventory.counts.relations,1);
      assert.equal(signedInventory.counts.assets,1);
      assert.ok(signedInventory.counts.schemas>=1);
      assert.ok(originalOwner.proofCount>=3,
        "original signed Access must recheck preview, commit and readback");
      // Revoke the HUMAN parent after successful recipient import. The
      // original recipient Store keeps the data, while any NEW agent
      // operation is forbidden by the signed ancestor status.
      originalOwner.revoke();
      await assert.rejects(scoped.getObject(destination,object),
        {code:"T3_ACCESS_NOT_PERMITTED"});
      console.log("T3_D4_SIGNED_FOREIGN_WORKSPACE_IWXA_ORIGINAL_KERNEL_PASS",
        JSON.stringify({sourceDifferentFromDestination:true,
          signedOriginalPersonalRecipient:true,
          delegatedAgentRecipient:true,independentAgentKey:true,
          humanParentRevokedAfterImport:true,
          originalKernel:RUNTIME,
          independentRecipientStore:true,originalIwxaBytes:true,
          originalImportMode:"merge",signedOperationProofs:originalOwner.proofCount,
          originalKernelRecipientReadback:true,completeAssetBytesRestored:true,
          secondConsumerNotYetQualified:true}));
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
      const archiveFile=join(root,"original-export.iwxa");
      writeFileSync(archiveFile,Uint8Array.from(deliveryB));
      // CI fixture builder only: Ubuntu's existing unzip reads the original
      // DEFLATE archive. The production parser remains original Kernel 0.3.6.
      const names=execFileSync("unzip",["-Z1",archiveFile],{
        encoding:"utf8",timeout:10000,
      }).trim().split(/\r?\n/).filter(Boolean);
      const originalEntries=names.map(name=>({
        name,bytes:execFileSync("unzip",["-p",archiveFile,name],{
          timeout:10000,maxBuffer:16*1024*1024,
        }),
      }));
      const manifestEntry=originalEntries.find(x=>x.name==="manifest.json");
      assert.ok(manifestEntry,"original T2 .iwxa must contain manifest.json");
      const manifest=JSON.parse(manifestEntry.bytes.toString("utf8"));
      assert.equal(manifest.format_version,"1.0");
      // Unsupported but well-formed semantic data must reach the ORIGINAL
      // schema analysis: never mask it with a mismatching ZIP/SHA digest.
      assert.equal(d4SemanticDigest(originalEntries,manifest.options),
        manifest.semantic_digest,"original semantic-digest fixture parity");
      const unknownId="iwxa.unsupported.future";
      const futureEntries=originalEntries.map(entry=>{
        if(entry.name!=="content/objects.ndjson")return entry;
        const rows=entry.bytes.toString("utf8").split(/\r?\n/)
          .filter(Boolean).map(line=>JSON.parse(line));
        rows[0].schema_id=unknownId;rows[0].schema_version="9.0.0";
        return {name:entry.name,
          bytes:Buffer.from(rows.map(d4Canonical).join("\n")+"\n")};
      });
      const futureMap=new Map(futureEntries.map(e=>[e.name,e.bytes]));
      const fileRows=manifest.files.map(row=>{
        const bytes=futureMap.get(row.path);
        assert.ok(bytes,"original archive manifest lists an absent entry");
        return {...row,size:bytes.byteLength,sha256:d4Digest(bytes)};
      });
      const futureManifest={...manifest,files:fileRows,
        package_digest:d4Digest(Buffer.from(fileRows
          .map(row=>row.path+"\t"+row.sha256+"\n").join(""))),
        semantic_digest:d4SemanticDigest(futureEntries,manifest.options),
      };
      const futureSemantic=createStoredZip(futureEntries.map(entry=>
        entry.name!=="manifest.json"?entry:{
          name:entry.name,bytes:Buffer.from(JSON.stringify(futureManifest)),
        }));
      const unsupportedFormat=createStoredZip(originalEntries.map(entry=>
        entry.name!=="manifest.json"?entry:{
          name:entry.name,bytes:Buffer.from(JSON.stringify({
            ...manifest,format:"iwxa.unsupported.future",
          })),
        }));
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
        {kind:"unsupported-package-profile",bytes:[...unsupportedFormat]},
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
      const semantic=await independent.evaluate(async({
        SERVICE,workspace,object,bytes,unknownId,
      })=>{
        const original=await IWXA.connect({service_id:SERVICE});
        const preview=await original.t2.importPreview(Uint8Array.from(bytes));
        const missing=preview.preview.schemas?.some(row=>
          row.schema_id===unknownId&&row.status==="missing");
        const unsupported=preview.preview.unsupported?.some(row=>
          row.kind==="unknown_schema"&&row.schema_id===unknownId);
        const excluded=preview.preview.excluded_by_permission?.objects??0;
        // Never commit an unsupported source object: the original parser
        // explicitly reports the missing schema for Human Review/refusal.
        await original.t2.importCancel(preview.preview_token);
        const stored=await original.t1.getObject(workspace,object);
        return {missing,unsupported,excluded,unchanged:stored==null};
      },{SERVICE,workspace,object,bytes:[...futureSemantic],unknownId});
      assert.equal(semantic.missing,true,
        "the original Kernel must report missing future schema");
      assert.equal(semantic.unsupported,true,
        "unsupported semantic objects cannot be accepted silently");
      assert.ok(semantic.excluded>=1,
        "the original Kernel must exclude the unsupported source object");
      assert.equal(semantic.unchanged,true,
        "the recipient must remain untouched until a supported import");
      console.log("T3_D4_ORIGINAL_T2_UNSUPPORTED_SEMANTIC_PREVIEW_PASS",
        JSON.stringify({...semantic,originalKernel:"0.3.6",
          independentRecipientStore:true,commitSkipped:true}));
      const raw=await independent.evaluate(async({SERVICE,workspace,object,
        linkedObject,assetId,bytes})=>{
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
        const linked=await original.t1.getObject(workspace,linkedObject);
        const restoredAsset=await original.t1.getAsset(workspace,assetId);
        const inventory=await original.t2.exportPreview({workspaces:[workspace],
          include_history:true,include_relations:true,
          include_assets:true,include_schemas:true});
        const events=await original.t1.listEventsSince(workspace);
        return {beforeAbsent:before===null||before===undefined,
          linkedTitle:linked?.object?.data?.title,
          linkedExtension:linked?.object?.extensions?.future?.preserve,
          originalExtension:record?.object?.extensions?.future?.preserve,
          objects:inventory.counts.objects,relations:inventory.counts.relations,
          assets:inventory.counts.assets,schemas:inventory.counts.schemas,
          assetText:restoredAsset?new TextDecoder().decode(restoredAsset.bytes):null,
          truncatedZipDenied,mode,source:preview.preview.manifest.workspaces[0],
          receiptMode:receipt.mode,receiptSource:receipt.workspace_id_map?.[workspace],
          title:record?.object?.data?.title,revision:record?.object?.revision,
          eventIds:events.map(e=>e.event_id)};
      },{SERVICE,workspace,object,linkedObject,assetId,bytes:[...deliveryB]});
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
      assert.equal(raw.objects,2);
      assert.equal(raw.relations,1);
      assert.equal(raw.assets,1);
      assert.ok(raw.schemas>=1);
      assert.equal(raw.assetText,assetText);
      assert.equal(raw.linkedTitle,linkedTitle);
      assert.equal(raw.originalExtension,"cross-consumer");
      assert.equal(raw.linkedExtension,"linked-ref");
      assert.ok(raw.eventIds.includes(saved.event),
        "original event provenance must survive in the second recipient");
      await t2Recipient.close();t2Recipient=null;
      t2Recipient=await launchT2Recipient();
      independent=t2Recipient.pages()[0]||await t2Recipient.newPage();
      await independent.goto(live.origin+workspacePath);
      await independent.waitForFunction(()=>typeof window.IWXA?.connect==="function");
      await assertHost(independent);
      const recovered=await read(independent);
      const coldAsset=await independent.evaluate(async({SERVICE,workspace,assetId})=>{
        const original=await IWXA.connect({service_id:SERVICE});
        const file=await original.t1.getAsset(workspace,assetId);
        return file?new TextDecoder().decode(file.bytes):null;
      },{SERVICE,workspace,assetId});
      assert.equal(coldAsset,assetText);
      assert.equal(recovered.text,title);
      assert.equal(recovered.revision,saved.revision);
      assert.ok(recovered.eventIds.includes(saved.event),
        "second original T2 consumer must preserve history after cold restart");
      if(sealed) {
        const rejected=await independent.evaluate(async({SERVICE,bytes})=>{
          const original=await IWXA.connect({service_id:SERVICE});
          try{
            const preview=await original.t2.importPreview(Uint8Array.from(bytes));
            if(preview?.preview_token)await original.t2.importCancel(preview.preview_token);
            return false;
          }catch{return true;}
        },{SERVICE,bytes:[...sealed.encrypted]});
        assert.equal(rejected,true,"encrypted envelope is not an original .iwxa");
        console.log("T3_D7_REAL_AGE_TWO_RECIPIENTS_ORIGINAL_EXCHANGE_PASS",
          JSON.stringify({age:"1.3.1",originalKernel:"0.3.6",
            originalArchiveSha256:sealed.sourceDigest,
            recipients:2,sourceObjects:2,sourceRelations:1,
            twoIndependentKernelStores:true,coldRecipientReadback:true,
            encryptedDirectImportDenied:true,
            wrongRecipientDenied:true,tamperDenied:true,
            installedNativeIssuerAccepted:false}));
      }
      console.log("T3_D4_TWO_INDEPENDENT_CONSUMERS_ORIGINAL_IWXA_PASS",JSON.stringify({
        originalKernel:"0.3.6",contract:"1.3.0",
        consumerPorts:["signed-selected-T3","original-T2-Exchange"],
        independentlyPersistedRecipientStores:2,
        exactOriginalArchiveBytes:true,originalEventProvenanceRecovered:true,
        linkedObjectsPreserved:2,relationsPreserved:1,assetsPreserved:1,
        assetBytesAfterColdRestart:true,schemasPreserved:true,
        unknownExtensionsPreserved:true,
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
      compiledOriginalHost: Boolean(compiledHost),
    }));
  }finally{
    if(context)await context.close().catch(()=>{});
    if(live?.server?.listening)await new Promise(r=>live.server.close(r));
    rmSync(root,{recursive:true,force:true});
  }
});
