// @vitest-environment jsdom
// A trusted Control-injected kernel origin MUST never downgrade to a loader
// attached by domain scripts in the less-trusted UI origin.
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,renderHook,waitFor} from "@testing-library/react";
import type {KernelBootstrap,KernelSession} from "@/kernel-client";
vi.mock("../src/kernel-client/loader",()=>({
  loadBootstrap:vi.fn(),resetLoaderCache:vi.fn(),
}));
import {loadBootstrap} from "../src/kernel-client/loader";
import {connectKernel} from "../src/kernel-client/connect";
import {useKernel} from "../src/kernel-client/useKernel";

afterEach(()=>{cleanup();vi.clearAllMocks();});
const session={
  contract_version:"1.3.0",runtime_version:"0.3.6",
  service:{service_id:"iwxa.test",base_path:"/workspace",service_version:"1.0.0"},
  mode:"full",granted_levels:["T0","T1","T2"],granted_operations:["t1.getWorkspace"],
} as KernelSession;
const bootstrap=():KernelBootstrap=>({version:1,connect:vi.fn(async()=>session)});

it("trusted original Kernel bootstrap is used without importing the raw T2 loader",async()=>{
  const trusted=bootstrap();
  const state=await connectKernel({serviceId:"iwxa.test",bootstrap:trusted});
  expect(state.status).toBe("ready");
  expect(trusted.connect).toHaveBeenCalledOnce();
  expect(loadBootstrap).not.toHaveBeenCalled();
});
it("trusted Kernel error remains unavailable instead of downgrading to unsigned raw T2",async()=>{
  const rejected:KernelBootstrap={
    version:1,
    connect:vi.fn(async()=>{throw Object.assign(
      new Error("T3_D1_ORIGINAL_KERNEL_REALM_REQUIRED"),
      {code:"T3_D1_ORIGINAL_KERNEL_REALM_REQUIRED"});}),
  };
  const state=await connectKernel({serviceId:"iwxa.test",bootstrap:rejected});
  expect(state.status).toBe("kernel-unavailable");
  expect(rejected.connect).toHaveBeenCalledOnce();
  expect(loadBootstrap).not.toHaveBeenCalled();
});
it("the production-capable trusted bootstrap takes priority over DEV mock inside useKernel",async()=>{
  const trusted=bootstrap(),dev=bootstrap();
  const {result}=renderHook(()=>useKernel({
    serviceId:"iwxa.test",trustedBootstrap:trusted,devBootstrap:dev,
  }));
  await waitFor(()=>expect(result.current.state.status).toBe("ready"));
  expect(trusted.connect).toHaveBeenCalled();
  expect(dev.connect).not.toHaveBeenCalled();
  expect(loadBootstrap).not.toHaveBeenCalled();
});
it("ordinary T2/domain bootstrap continues using its original loader",async()=>{
  vi.mocked(loadBootstrap).mockResolvedValue(bootstrap());
  const state=await connectKernel({serviceId:"iwxa.test"});
  expect(state.status).toBe("ready");
  expect(loadBootstrap).toHaveBeenCalledOnce();
});