// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DomainStudioRouteShell } from "../src/factory2/apps/domain-studio/DomainStudioRouteShell";
import type { Factory2StudioModel } from "../src/factory2/products/domain-studio/DomainStudioSurface";

const model: Factory2StudioModel = {
  schema:"IWXA_T2_FACTORY2_DOMAIN_STUDIO_MODEL_V1",
  product:"domain-studio",
  generation:2,
  domainId:"NEUTRAL-CANARY",
  sourceSha256:"2".repeat(64),
  sourceIdentityValidationScope:"DECLARED_FINGERPRINT_CONSISTENCY_ONLY",
  status:"ENGINEERING_BLOCKED",
  panels:[{id:"source",title:"Source",status:"DECLARED_FINGERPRINT_ONLY"}],
  blockers:["SCHEMA_MAP_INCOMPLETE"],
  candidateRequirements:{schemaAdaptationTargets:["neutral"]},
  availableActions:[],
  humanReviewRequired:false,
  ownerApprovalGranted:false,
  genericWriteAuthority:false,
  productionActivation:false,
  directExecutionAllowed:false,
};

describe("Factory 2 Domain Studio dedicated application shell",()=>{
  it("mounts independently with an authority-safe empty state",()=>{
    render(<DomainStudioRouteShell />);
    expect(screen.getByTestId("factory2-domain-studio-app")).toBeTruthy();
    expect(screen.getByTestId("factory2-domain-studio-empty")).toBeTruthy();
    expect(screen.getByText(/owner-supplied current domain source/i)).toBeTruthy();
    expect(screen.queryByRole("button",{name:/execute|approve|deploy|запис|применить/i})).toBeNull();
  });

  it("hosts the DomainStudioSurface without becoming a Workspace shell",()=>{
    render(<DomainStudioRouteShell model={model} />);
    expect(screen.getByTestId("factory2-domain-studio")).toBeTruthy();
    expect(screen.getByTestId("factory2-domain-studio-app").getAttribute("data-kernel-target")).toBe("0.3.5");
    expect(screen.getByText("NEUTRAL-CANARY")).toBeTruthy();
  });
});

it("loads an Engineering session file and opens local human-review guidance without granting authority", async () => {
  const engineering = {schema:"IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1",product:"domain-engineering",generation:2,domainId:"D03",sourceOrigin:"OWNER_SUPPLIED_AT_TEST_TIME",sourceSha256:"3".repeat(64),status:"CANDIDATE_ENGINEERING_READY",candidateBuildAllowed:true,candidateValidationAllowed:true,candidateValidation:{status:"READY_FOR_HUMAN_REVIEW",evidenceRefs:["evidence:test"],rollbackRef:"rollback:test"},blockers:[],candidateRequirements:{schemaAdaptationTargets:[],ownerCommandContractTargets:[],resultAcceptanceContractTargets:[],compatibilityQualificationSubjects:[]},derived:{schemaMapStatus:"COMPLETE",ownerCommandMapStatus:"COMPLETE",processResultMapStatus:"COMPLETE",compatibilityMapStatus:"COMPLETE",rollbackPlanStatus:"COMPLETE"},sourceBytesVerified:false,sourceIdentityValidationScope:"DECLARED_FINGERPRINT_CONSISTENCY_ONLY",genericWriteAuthority:false,ownerApprovalGranted:false,productionActivation:false};
  render(<DomainStudioRouteShell />);
  const file = new File([JSON.stringify(engineering)], "ENGINEERING_SESSION.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(engineering) });
  fireEvent.change(screen.getByTestId("factory2-studio-session-file"), { target: { files: [file] } });
  expect(await screen.findByText("D03")).toBeTruthy();
  const review = screen.getByRole("button", { name: /открыть human review/i });
  expect(review.hasAttribute("disabled")).toBe(false);
  fireEvent.click(review);
  expect(await screen.findByTestId("factory2-studio-human-review")).toBeTruthy();
  expect(screen.getByText(/не создаёт Owner approval/i)).toBeTruthy();
});
