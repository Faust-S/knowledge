// @vitest-environment jsdom
// The protected T3 user route must never fall back to T2's independent
// first-run provisioner, even when that provisioner exists in domain config.
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import type {KernelSession} from "@/kernel-client/types";
import type {DomainConfigDoc} from "@/config/host-config";
import {FirstRunWorkspaceGate} from "@/workspace-host/bootstrap/FirstRunWorkspaceGate";

const blocked=vi.hoisted(()=>({
  discover:vi.fn(),
  provision:vi.fn(),
  select:vi.fn(),
}));
vi.mock("../src/workspace-host/bootstrap/first-run-workspace",()=>({
  selectFirstRunProvisioner:(...args:unknown[])=>{
    blocked.select(...args);
    return {status:"enabled",serviceId:"iwxa.workspace.provisioner"};
  },
  findExistingFirstRunWorkspace:blocked.discover,
  provisionFirstRunWorkspace:blocked.provision,
}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

it("signed D1 Host opens its own Workspace without unsigned discovery or provisioning",()=>{
  const session={
    contract_version:"1.3.0",
    granted_operations:["t1.listWorkspaces","t1.createWorkspace"],
    t1:{listWorkspaces:vi.fn(),createWorkspace:vi.fn()},
  } as unknown as KernelSession;
  render(<FirstRunWorkspaceGate session={session}
    domain={{domain_id:"t3.signed.local",origin:"https://t3.example.test"} as DomainConfigDoc}
    workspaceServiceId="iwxa.workspace.integration"
    profileId="generic" profileFallback={false} signedOwnerRequired
  ><p data-testid="signed-workspace-visible">Выбранная подписанная Workspace</p></FirstRunWorkspaceGate>);
  expect(screen.getByTestId("signed-workspace-visible").textContent)
    .toContain("подписанная Workspace");
  expect(blocked.discover).not.toHaveBeenCalled();
  expect(blocked.provision).not.toHaveBeenCalled();
  expect((session.t1.listWorkspaces as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  expect((session.t1.createWorkspace as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
});
