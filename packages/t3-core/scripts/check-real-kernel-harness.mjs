#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { materializeIntegrationHost, validateSynthesizedWorkspaceHost } from "./real-kernel-e2e.mjs";
const root=mkdtempSync(join(tmpdir(),"iwxa-rk-harness-check-"));
const fail=[]; const pass=(ok,msg)=>{if(!ok)fail.push(msg)};
try {
  const origin="https://127.0.0.1:4443";
  const cfg=materializeIntegrationHost(root,origin);
  validateSynthesizedWorkspaceHost(cfg,origin);
  pass(cfg.domain.enabled_profiles.includes(cfg.workspaceConfig.profile),"synthetic workspace profile must be enabled by domain");
  pass(cfg.domain.origin===origin&&cfg.shell.origin===origin,"synthetic host must use the same HTTPS origin");
  pass(cfg.workspaceConfig.host.required_runtime_version==="0.3.5","synthetic host must bind Kernel 0.3.5");
  pass(cfg.domain.runtime.local_store_version==="6","synthetic host must declare LocalStore DB6");
  pass(existsSync(resolve(root,"_iwxa/brand/logo.svg")),"synthetic host must materialize configured brand logo");
  pass(existsSync(resolve(root,"_iwxa/tokens.css")),"synthetic host must materialize configured theme tokens");
  pass(existsSync(resolve(root,"favicon.ico")),"synthetic host must materialize configured root favicon");
  const source=readFileSync(resolve(process.cwd(),"scripts/real-kernel-e2e.mjs"),"utf8");
  pass(!source.includes('enabled_profiles: ["integration"]'),"stale integration-only profile must not return");
  pass(!source.includes('origin: `http://127.0.0.1'),"HTTP loopback host is invalid under Domain Keys HTTPS origin rule");
  pass(!/waitForFunction\(\(\) => typeof window\./.test(source)&&!/page\.evaluate\(\(\) => \([\s\S]*?window\./.test(source),"browser-context callbacks must not reintroduce lint-undefined window globals");
  pass(source.includes('fetch("/_iwxa/security/capability-control-plane.json"')&&source.includes("REAL_KERNEL_CONTROL_PLANE_ENDPOINT_INVALID"),"browser harness must prove control-plane endpoint before guarded operations");
  pass(source.includes('catch { body = null; }')&&!source.includes('catch {}'),"browser control-plane probe JSON fallback must remain lint-clean");
  pass(source.includes("REAL_KERNEL_SCENARIO_FAILED")&&source.includes("details=${JSON.stringify"),"browser harness must preserve capability error code/details");
  pass(source.includes("bad_responses: badResponses")&&source.includes("request_failures: requestFailures")&&source.includes("page_errors: pageErrors"),"browser harness receipt must expose URL-level HTTP/request/page diagnostics");
  pass(source.includes('context.on("page", attachDiagnostics)')&&source.includes("attachDiagnostics(routePage)"),"browser diagnostics must cover main and static-route pages");
} finally { rmSync(root,{recursive:true,force:true}); }
if(fail.length){console.error("[real-kernel-harness] FAIL"); for(const f of fail)console.error(" - "+f); process.exit(1);}
console.log("[real-kernel-harness] PASS https/profile/runtime/prebrowser invariants");
