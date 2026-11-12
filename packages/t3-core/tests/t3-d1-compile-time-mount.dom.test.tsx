// @vitest-environment jsdom
// No window/global-based Access injection: only compile-time owner callbacks
// supplied explicitly at the ONE original Workspace React root.
import {act,cleanup,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {createElement} from "react";
import {mountT3App} from "@/mount-t3-app";

const spy=vi.hoisted(()=>({seen:[] as Record<string,unknown>[]}));
vi.mock("@/App",()=>({
  default:(props:Record<string,unknown>)=>{
    spy.seen.push(props);
    return createElement("output",{"data-testid":"t3-one-root"},
      props.requireSignedOwner?"Подписанная Workspace":"Обычная Workspace");
  },
}));
afterEach(()=>{cleanup();spy.seen.length=0;document.body.innerHTML="";});

it("normal domain starts the original T2/T3 Host unchanged",async()=>{
  const target=document.createElement("div");
  document.body.append(target);
  let mounted:ReturnType<typeof mountT3App>|null=null;
  await act(async()=>{mounted=mountT3App(target);});
  expect(screen.getByTestId("t3-one-root").textContent).toBe("Обычная Workspace");
  expect(spy.seen).toHaveLength(1);
  expect(spy.seen[0]).toEqual({});
  await act(async()=>{mounted!.unmount();});
});

it("trusted compiler passes genuine owner callbacks to the same Host, never window",async()=>{
  const root=document.createElement("div");
  document.body.append(root);
  const signedKernelAccess=()=>null;
  const signedActivityAccess=()=>null;
  const subscribeSignedAccessInvalidation=()=>()=>{};
  const props={
    requireSignedOwner:true,
    signedKernelAccess,
    signedActivityAccess,
    subscribeSignedAccessInvalidation,
  };
  let mounted:ReturnType<typeof mountT3App>|null=null;
  await act(async()=>{mounted=mountT3App(root,props);});
  expect(screen.getByTestId("t3-one-root").textContent).toBe("Подписанная Workspace");
  expect(spy.seen).toHaveLength(1);
  expect(spy.seen[0].signedKernelAccess).toBe(signedKernelAccess);
  expect(spy.seen[0].signedActivityAccess).toBe(signedActivityAccess);
  expect(spy.seen[0].subscribeSignedAccessInvalidation)
    .toBe(subscribeSignedAccessInvalidation);
  expect(spy.seen[0].requireSignedOwner).toBe(true);
  expect((window as unknown as Record<string,unknown>).signedKernelAccess).toBeUndefined();
  await act(async()=>{mounted!.unmount();});
});
