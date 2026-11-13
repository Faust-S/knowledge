// @vitest-environment jsdom
// No T3 React/Kernel import until the existing Control SSE has answered.
import {afterEach,expect,it,vi} from "vitest";

const evidence=vi.hoisted(()=>({
  imports:[] as {module:string;hash:string}[],
  mounted:[] as {hash:string;token:string}[],
  probes:0,closed:0,preflightDenied:false,
}));
vi.mock("../src/t3/control-loopback-owner.mjs",()=>{
  evidence.imports.push({module:"owner",hash:location.hash});
  return {createControlLoopbackOwner:({origin,token}:{
    origin:string;token:string;
  })=>{
    expect(origin).toBe(location.origin);
    return {
      requireSignedOwner:true,token,
      subscribeSignedAccessInvalidation:()=>{
        evidence.probes++;
        return ()=>{evidence.closed++;};
      },
      signedKernelAccess:async()=>{
        if(evidence.preflightDenied)throw new Error("CONTROL_OFFLINE");
        return {currentContext:()=>({workspace_id:"ws:ready"})};
      },
    };
  }};
});
vi.mock("../src/mount-t3-app",()=>{
  evidence.imports.push({module:"app",hash:location.hash});
  return {mountT3App:(_root:HTMLElement,props:{token:string})=>{
    evidence.mounted.push({hash:location.hash,token:props.token});
  }};
});
afterEach(()=>{
  vi.resetModules();
  evidence.imports.length=0;evidence.mounted.length=0;
  evidence.probes=0;evidence.closed=0;evidence.preflightDenied=false;
  document.body.innerHTML="";
  history.replaceState(null,"",location.pathname+location.search);
});

it("clears the bearer and confirms Control before evaluating any T3 application module",async()=>{
  const token="T".repeat(44);
  document.body.innerHTML='<div id="root"></div>';
  location.hash="#"+token;
  await import("../src/main-signed-workspace");
  await vi.waitFor(()=>expect(evidence.mounted).toHaveLength(1));
  expect(location.hash).toBe("");
  expect(evidence.imports.map(x=>x.module)).toEqual(["owner","app"]);
  expect(evidence.imports.every(x=>x.hash==="")).toBe(true);
  expect(evidence.mounted).toEqual([{hash:"",token}]);
  expect(evidence.probes).toBe(1);
  expect(evidence.closed).toBe(1);
  expect((window as unknown as Record<string,unknown>).signedKernelAccess)
    .toBeUndefined();
});
it("does not load React or original Kernel when Control preflight fails",async()=>{
  evidence.preflightDenied=true;
  document.body.innerHTML='<div id="root"></div>';
  location.hash="#"+("X".repeat(44));
  await import("../src/main-signed-workspace");
  await vi.waitFor(()=>expect(document.getElementById("root")?.textContent)
    .toMatch(/Не удалось подключить локальный подписанный Control/));
  expect(location.hash).toBe("");
  expect(evidence.imports.map(x=>x.module)).toEqual(["owner"]);
  expect(evidence.mounted).toHaveLength(0);
  expect(evidence.probes).toBe(1);
  expect(evidence.closed).toBe(1);
  expect(document.getElementById("root")?.getAttribute("data-testid"))
    .toBe("t3-signed-control-reconnect");
});
