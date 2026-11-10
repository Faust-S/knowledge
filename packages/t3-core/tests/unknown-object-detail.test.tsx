// @vitest-environment jsdom
/**
 * T2-03C — SafeJsonViewer + UnknownObjectDetail behaviour.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SafeJsonViewer } from "../src/modules/base/features/object/SafeJsonViewer";
import { UnknownObjectDetail } from "../src/modules/base/features/object/UnknownObjectDetail";
import type { ObjectRecord } from "../src/kernel-client";

function obj(schema: string, data: unknown): ObjectRecord {
  return {
    workspace_id: "w", object_id: "o-1",
    schema_id: schema, schema_version: "1",
    created_by_service: "svc", updated_by_service: "svc",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    revision: 1, data, deleted: false, deleted_at: undefined,
  };
}

afterEach(() => cleanup());

describe("SafeJsonViewer", () => {
  it("serialises plain values to a <pre>", () => {
    const { container } = render(<SafeJsonViewer value={{ a: 1 }} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('"a": 1');
  });

  it("handles cyclic values without throwing", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    render(<SafeJsonViewer value={a} />);
    expect(
      screen.getByTestId("safe-json-viewer-unserialisable").textContent,
    ).toContain("невозможно представить в JSON");
  });

  it("does not use dangerouslySetInnerHTML — HTML strings render literally", () => {
    const { container } = render(<SafeJsonViewer value={{ html: "<script>x</script>" }} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>x</script>");
  });
});

describe("UnknownObjectDetail", () => {
  it("keeps the JSON section closed by default", () => {
    render(
      <UnknownObjectDetail object={obj("mystery", { a: 1 })} profileLabel="Универсальный" />,
    );
    const summary = screen.getByTestId("unknown-object-detail-json-toggle");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it("mentions the schema id and profile label", () => {
    render(
      <UnknownObjectDetail object={obj("mystery", {})} profileLabel="Личный" />,
    );
    expect(screen.getByText(/mystery/)).toBeTruthy();
    expect(screen.getByText(/Личный/)).toBeTruthy();
  });
});
