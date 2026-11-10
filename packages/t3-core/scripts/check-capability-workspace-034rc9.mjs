#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT=process.cwd(); const read=(p)=>readFileSync(join(ROOT,p),"utf8"); const json=(p)=>JSON.parse(read(p));
const fail=[]; const pass=(ok,msg)=>{if(!ok) fail.push(msg)};
const pkg=json("package.json"); pass(pkg.version==="0.34.0-rc.9","Workspace version must be 0.34.0-rc.9");
const prov=json("src/kernel-client/contracts/runtime-1.2.0/provenance.json");
pass(prov.runtime_version==="0.2.7"&&prov.contract_version==="1.2.0","active Runtime snapshot must be Kernel 0.2.7 / Contract 1.2.0");
pass(prov.capability_freeze_version==="0.3.1"&&prov.capability_freeze_sha256==="05fc2ba1a6e2974ee746c5bb7e43359dd1454aaba4e5b5b2e2676b28e17d9cfe","Capability freeze binding mismatch");
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
if(fail.length){ console.error("[workspace-capability-034rc9] FAIL"); for(const f of fail) console.error(" - "+f); process.exit(1); }
console.log("[workspace-capability-034rc9] PASS capability=0.3.1 runtime=0.2.7 contract=1.2.0");
