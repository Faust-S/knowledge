// @vitest-environment jsdom
// The token fragment must be erased before ANY application or owner
// dependency executes, not merely before React's first render.
import {afterEach,expect,it,vi} from "vitest";

const evidence=vi.hoisted(()=>({
  imports:[] as {module:string;hash:string}[],
  mounted:[] as {hash:string;token:string}[],
}));
vi.mock("../src/t3/control-loopback-owner.mjs",()=>{
  evidence.imports.push({module:"owner",hash:location.hash});
  return {createControlLoopbackOwner:({origin,token}:{
    origin:string;token:string;
  })=>{
    expect(origin).toBe(location.origin);
    return {requireSignedOwner:true,token};
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
  evidence.imports.length=0;
  evidence.mounted.length=0;
  document.body.innerHTML="";
  history.replaceState(null,"",location.pathname+location.search);
});

it("removes signed Control bearer from URL before evaluating any T3 module",async()=>{
  const token="T".repeat(44);
  document.body.innerHTML='<div id="root"></div>';
  location.hash="#"+token;
  expect(location.hash).toBe("#"+token);
  await import("../src/main-signed-workspace");
  await vi.waitFor(()=>expect(evidence.mounted).toHaveLength(1));
  expect(location.hash).toBe("");
  expect(evidence.imports.map(x=>x.module)).toEqual(["owner","app"]);
  expect(evidence.imports.every(x=>x.hash==="")).toBe(true);
  expect(evidence.mounted).toEqual([{hash:"",token}]);
  expect((window as unknown as Record<string,unknown>).signedKernelAccess)
    .toBeUndefined();
});
