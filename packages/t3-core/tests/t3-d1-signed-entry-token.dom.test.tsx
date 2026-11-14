// @vitest-environment jsdom
// The legacy entry is forwarding-only. Real positive signed onboarding is
// exercised in the existing original-Kernel browser integration scenario.
import {afterEach,expect,it,vi} from "vitest";

const evidence=vi.hoisted(()=>({kernelImports:0,reactImports:0}));
vi.mock("../src/t3/control-loopback-owner.mjs",()=>{
  evidence.kernelImports++;
  return {createControlLoopbackOwner:()=>{throw Error("LEGACY_KERNEL_FORBIDDEN");}};
});
vi.mock("../src/mount-t3-app",()=>{
  evidence.reactImports++;
  return {mountT3App:()=>{throw Error("LEGACY_REACT_FORBIDDEN");}};
});
afterEach(()=>{
  vi.resetModules();
  vi.unstubAllGlobals();
  evidence.kernelImports=0;
  evidence.reactImports=0;
  document.body.innerHTML="";
  history.replaceState(null,"",location.pathname+location.search);
});

it("legacy signed entry refuses an unavailable isolated Host without loading Kernel or React",async()=>{
  const fetchHost=vi.fn();
  vi.stubGlobal("fetch",fetchHost);
  document.body.innerHTML='<div id="root"></div>';
  location.hash="#"+("T".repeat(44));
  await import("../src/main-signed-workspace");
  await vi.waitFor(()=>expect(document.getElementById("root")?.textContent)
    .toMatch(/изолированную подписанную Workspace/));
  expect(location.hash).toBe("");
  expect(evidence.kernelImports).toBe(0);
  expect(evidence.reactImports).toBe(0);
  expect(document.getElementById("root")?.getAttribute("data-testid"))
    .toBe("t3-signed-control-reconnect");
  // The test origin is not a trusted 127.0.0.1 loopback Host.
  expect(fetchHost).not.toHaveBeenCalled();
});

it("missing signed bearer cannot initialize any previous same-origin authority",async()=>{
  const fetchHost=vi.fn();
  vi.stubGlobal("fetch",fetchHost);
  document.body.innerHTML='<div id="root"></div>';
  location.hash="";
  await import("../src/main-signed-workspace");
  await vi.waitFor(()=>expect(document.getElementById("root")?.getAttribute("role"))
    .toBe("alert"));
  expect(fetchHost).not.toHaveBeenCalled();
  expect(evidence.kernelImports).toBe(0);
  expect(evidence.reactImports).toBe(0);
});
