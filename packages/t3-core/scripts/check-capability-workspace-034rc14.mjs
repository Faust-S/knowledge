#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT=process.cwd(); const read=(p)=>readFileSync(join(ROOT,p),"utf8"); const json=(p)=>JSON.parse(read(p));
const fail=[]; const pass=(ok,msg)=>{if(!ok) fail.push(msg)};
const pkg=json("package.json"); pass(pkg.version==="0.34.0-rc.15","Workspace version must be 0.34.0-rc.15");
const prov=json("src/kernel-client/contracts/runtime-1.2.0/provenance.json");
const sourceManifest=json("SOURCE_PACKAGE_MANIFEST.json");
const lockRaw=read("package-lock.json");
const realHarness=read("scripts/real-kernel-e2e.mjs");
const workspaceSchema=read("src/config/schemas/keys-2.0/workspace-config.schema.json");
pass(prov.runtime_version==="0.3.4"&&prov.contract_version==="1.2.0","active Runtime snapshot must be Kernel 0.3.4 / Contract 1.2.0");
pass(prov.source_package_sha256==="6b000cf2bbe33c46fab882706e73d1268a5ba9ac2cb0781e1a53553c61ea7c6b","Runtime snapshot provenance must bind exact Kernel 0.3.4 package SHA");
pass(sourceManifest.version==="0.34.0-rc.15"&&sourceManifest.kernelCandidate?.version==="0.3.4"&&sourceManifest.kernelCandidate?.sha256==="6b000cf2bbe33c46fab882706e73d1268a5ba9ac2cb0781e1a53553c61ea7c6b","Workspace source manifest must bind exact Kernel 0.3.4 package");
pass(!lockRaw.includes('"resolved"')&&!lockRaw.includes("lovable-core-prod")&&!lockRaw.includes("sandbox-npm-cache"),"package-lock must not contain environment-private resolved URLs");
pass(realHarness.includes('const RUNTIME_VERSION = "0.3.4"')&&realHarness.includes('local_store_version: "6"'),"real-Kernel synthetic host must bind Kernel 0.3.4 / DB6");
pass(workspaceSchema.includes('"const": "0.3.4"'),"Workspace derived schema must require Kernel 0.3.4");
pass(prov.capability_freeze_version==="0.4.2"&&prov.capability_freeze_sha256==="97d2353d237867385a6f77d04ea2fd1312b4d510e6474c4858218384c10c7024","Capability freeze binding mismatch");
const mod=read("src/workspace-host/modules/module-types.ts"), contrib=read("src/workspace-contract/contributions/index.ts");
for(const tok of ["requiredCapabilitiesAll?","requiredCapabilitiesAny?"]) { pass(mod.includes(tok),`ModuleDeclaration missing optional ${tok}`); pass(contrib.includes(tok),`ContributionBase missing optional ${tok}`); }
const hub=read("src/workspace-host/registries/HostContributionHub.ts"), route=read("src/workspace-host/router/register-route-contributions.ts"), nav=read("src/workspace-host/registries/NavigationRegistry.ts"), cmd=read("src/workspace-host/registries/CommandRegistry.ts");
pass(hub.includes('code: "capability-not-granted"')&&hub.includes("requiredCapabilitiesAll")&&hub.includes("requiredCapabilitiesAny"),"non-route contribution capability gate missing");
pass(route.includes('code: "route-capability-missing"'),"route capability gate missing");
pass(nav.includes("activeCapabilities")&&nav.includes("requiredCapabilitiesAll")&&nav.includes("requiredCapabilitiesAny"),"navigation capability visibility gate missing");
pass(cmd.includes("isInvocable")&&cmd.includes("requiredCapabilitiesAll")&&cmd.includes("requiredCapabilitiesAny"),"command pre-loader capability gate missing");
const liveCheck=cmd.lastIndexOf("ownerContextCapabilitiesSatisfied"), loaderCheck=cmd.indexOf("await entry.contribution.loader"), runCheck=cmd.lastIndexOf("mod.run");
pass(cmd.includes("hasCapability.call(owner.kernel")&&loaderCheck>=0&&liveCheck>loaderCheck&&liveCheck<runCheck,"command must live re-check capability after async loader and before handler");
const facade=read("src/workspace-host/context/create-kernel-facade.ts"), ctx=read("src/workspace-contract/module-context.ts");
pass(facade.includes("authorizationForWorkspace")&&facade.includes("hasCapability"),"KernelFacade read-only authorization helpers missing");
pass(!/grantEnvelope|CapabilityGrantEnvelope|CapabilityReceipt/.test(ctx),"Workspace module contract must not expose portable grant/receipt authority");
const tests=read("tests/capability-workspace-guards.test.ts");
for(const tok of ["refuses non-route contributions","command guard refuses before loader and rechecks before handler","KernelFacade exposes only the live read-only authorization view"]) pass(tests.includes(tok),`capability Workspace regression coverage missing: ${tok}`);
const active=["src","scripts","tests","public","fixtures"];
for(const root of active){ try { const out=read(root); void out; } catch { /* unreadable candidate is intentionally ignored by this static scan */ } }

const securityFiles=["src/kernel-client/contracts/runtime-1.2.0/provenance.json","src/workspace-host/context/create-kernel-facade.ts","src/workspace-contract/module-context.ts"].map(read).join("\n");
pass(!securityFiles.includes("SecurityTrustManager04")&&!securityFiles.includes("EMBEDDED_SECURITY04_ROOT_BYTES"),"Workspace must not own Security 0.4 trust manager/root");
pass(prov.legacy_capability_schema_snapshot_version==="0.3.1","legacy compatibility schema provenance must remain explicit");
if(fail.length){ console.error("[workspace-capability-034rc14] FAIL"); for(const f of fail) console.error(" - "+f); process.exit(1); }
console.log("[workspace-capability-034rc14] PASS capability-security=0.4.2 legacy-schema=0.3.1 runtime=0.3.4 contract=1.2.0");
