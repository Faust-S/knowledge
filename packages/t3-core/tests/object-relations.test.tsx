// @vitest-environment jsdom
/**
 * T2-03C — RelationList validity/decoration behaviour.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RelationList } from "../src/modules/base/features/object/relations/RelationList";
import { adapter } from "../src/kernel-client";
import type { RelationRecord } from "../src/kernel-client";

function rel(overrides: Partial<RelationRecord> & { relation_id: string }): RelationRecord {
  return {
    workspace_id: "w",
    from_object_id: "o-src",
    to_object_id: "o-dst",
    kind: "linked-to",
    created_at: "2026-01-01T00:00:00Z",
    created_by_service: "svc",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

beforeEach(() => {
  vi.spyOn(adapter, "getObject").mockRejectedValue(new Error("noop"));
});

const noopSession = { service: { service_id: "s" } } as never;

describe("RelationList", () => {
  it("does not attempt to load previews for cross-workspace relations", async () => {
    const spy = vi.spyOn(adapter, "getObject");
    spy.mockClear();
    render(
      <RelationList
        direction="outgoing"
        relations={[rel({ relation_id: "r1", workspace_id: "OTHER" })]}
        workspaceId="w"
        currentObjectId="o-src"
        session={noopSession}
        profileId="generic"
        previewsEnabled={true}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByTestId("relation-card");
    expect(card.getAttribute("data-validity")).toBe("cross-workspace");
    // No preview call because validity !== "valid"
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
    // Open button is disabled
    const btn = screen.getByTestId("relation-open-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("flags unsafe opaque ids and disables the open button", async () => {
    const spy = vi.spyOn(adapter, "getObject");
    spy.mockClear();
    render(
      <RelationList
        direction="outgoing"
        relations={[rel({ relation_id: "r2", to_object_id: "bad id!" })]}
        workspaceId="w"
        currentObjectId="o-src"
        session={noopSession}
        profileId="generic"
        previewsEnabled={true}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByTestId("relation-card");
    expect(card.getAttribute("data-validity")).toBe("unsafe-id");
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
    const btn = screen.getByTestId("relation-open-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("splits outgoing and incoming and does not mix them", () => {
    const { rerender } = render(
      <RelationList
        direction="outgoing"
        relations={[rel({ relation_id: "o1", to_object_id: "o-to" })]}
        workspaceId="w"
        currentObjectId="o-src"
        session={noopSession}
        profileId="generic"
        previewsEnabled={false}
        onOpen={() => {}}
      />,
    );
    let card = screen.getByTestId("relation-card");
    expect(card.getAttribute("data-direction")).toBe("outgoing");
    rerender(
      <RelationList
        direction="incoming"
        relations={[rel({ relation_id: "i1", from_object_id: "o-from" })]}
        workspaceId="w"
        currentObjectId="o-src"
        session={noopSession}
        profileId="generic"
        previewsEnabled={false}
        onOpen={() => {}}
      />,
    );
    card = screen.getByTestId("relation-card");
    expect(card.getAttribute("data-direction")).toBe("incoming");
  });

  it("paginates at 10 per page", () => {
    const relations = Array.from({ length: 25 }, (_, i) =>
      rel({ relation_id: `r${i}`, to_object_id: `o${i}` }),
    );
    render(
      <RelationList
        direction="outgoing"
        relations={relations}
        workspaceId="w"
        currentObjectId="o-src"
        session={noopSession}
        profileId="generic"
        previewsEnabled={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getAllByTestId("relation-card").length).toBe(10);
  });
});
