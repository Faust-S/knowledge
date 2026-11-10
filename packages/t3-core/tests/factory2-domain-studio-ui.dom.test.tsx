// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DomainStudioSurface, type Factory2StudioModel } from "../src/factory2/products/domain-studio/DomainStudioSurface";

const sourceSha256 = "1".repeat(64);

const model = (review = false): Factory2StudioModel => ({
  schema:"IWXA_T2_FACTORY2_DOMAIN_STUDIO_MODEL_V1",
  product:"domain-studio",
  generation:2,
  domainId:"D02",
  sourceSha256,
  sourceIdentityValidationScope:"DECLARED_FINGERPRINT_CONSISTENCY_ONLY",
  status:review?"CANDIDATE_ENGINEERING_READY":"ENGINEERING_BLOCKED",
  panels:[
    {id:"source",title:"Source",status:"DECLARED_FINGERPRINT_ONLY"},
    {id:"schema",title:"Schema adaptation",status:"COMPLETE"},
    {id:"owner-commands",title:"Owner commands",status:review?"COMPLETE":"PARTIAL"},
  ],
  blockers:review?[]:["OWNER_COMMAND_MAP_INCOMPLETE"],
  candidateRequirements:review?{}:{ownerCommandContractTargets:["orders"]},
  availableActions:review?["OPEN_HUMAN_REVIEW"]:[],
  humanReviewRequired:review,
  ownerApprovalGranted:false,
  genericWriteAuthority:false,
  productionActivation:false,
  directExecutionAllowed:false,
});

describe("Factory 2 Domain Studio surface",()=>{
  it("renders exact source identity and transformation state without execution/approval/deploy controls",()=>{
    render(<DomainStudioSurface model={model(false)} />);
    expect(screen.getByTestId("factory2-domain-studio")).toBeTruthy();
    expect(screen.getByTestId("studio-product-completion-status").textContent).toContain("not qualified");
    expect(screen.getByTestId("studio-product-completion").textContent).toContain("DOMAIN_T2_PRODUCT_COMPLETE");
    expect(screen.getByTestId("studio-source-identity").textContent).toContain(sourceSha256);
    expect(screen.getByText("declared fingerprint consistency only")).toBeTruthy();
    expect(screen.getByText("owner command map incomplete")).toBeTruthy();
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.queryByRole("button",{name:/execute|approve|deploy|запис|применить/i})).toBeNull();
  });
  it("offers only explicit human review when Engineering makes it available",()=>{
    const open=vi.fn();
    render(<DomainStudioSurface model={model(true)} onOpenHumanReview={open} />);
    const button=screen.getByRole("button",{name:"Открыть human review"});
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
