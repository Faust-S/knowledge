/**
 * Prompt 13 acceptance tests: workspace error handling & safe degradation.
 *
 * Coverage:
 *   - every WorkspaceErrorCode has a descriptor (no missing entry);
 *   - no destructive action ever appears before `export_iwxa`;
 *   - unknown codes resolve *explicitly* to the `unknown` descriptor
 *     (not silently to another state);
 *   - every descriptor communicates a data-status verdict to the user;
 *   - kernel error codes classify onto the shell taxonomy correctly;
 *   - analytics events NEVER contain user content (message / stack / cause).
 */
import { describe, expect, it, vi } from "vitest";
import {
  ALL_ERROR_CODES,
  DESTRUCTIVE_ACTIONS,
  describeError,
  listErrorDescriptors,
  classifyError,
  buildSafeEvent,
  reportError,
  setAnalyticsSink,
  type SafeErrorEvent,
  type WorkspaceErrorCode,
} from "../src/errors";

describe("registry coverage", () => {
  it("has a descriptor for every code", () => {
    const codes = new Set(listErrorDescriptors().map((d) => d.code));
    for (const code of ALL_ERROR_CODES) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it.each(ALL_ERROR_CODES)("descriptor for %s is well-formed", (code) => {
    const d = describeError(code);
    expect(d.code).toBe(code);
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.safeMessage.length).toBeGreaterThan(0);
    expect(d.dataStatus).toBeDefined();
    expect(d.actions.length).toBeGreaterThan(0);
  });
});

describe("safe action ordering", () => {
  it.each(ALL_ERROR_CODES)(
    "%s never lists a destructive action before export_iwxa",
    (code) => {
      const { actions } = describeError(code);
      const exportIdx = actions.indexOf("export_iwxa");
      actions.forEach((a, i) => {
        if (DESTRUCTIVE_ACTIONS.has(a)) {
          expect(exportIdx).toBeGreaterThanOrEqual(0);
          expect(i).toBeGreaterThan(exportIdx);
        }
      });
    },
  );

  it("quota_exceeded specifically lists export_iwxa before clear_workspace", () => {
    const { actions } = describeError("quota_exceeded");
    expect(actions.indexOf("export_iwxa")).toBeLessThan(
      actions.indexOf("clear_workspace"),
    );
  });
});

describe("no silent fallback", () => {
  it("unknown string maps *explicitly* to the unknown descriptor", () => {
    const d = describeError("totally_made_up_code");
    expect(d.code).toBe("unknown");
    expect(d.dataStatus).toBe("unknown");
    // The unknown descriptor still surfaces export before any retry loop.
    expect(d.actions).toContain("export_iwxa");
  });

  it("null / undefined also resolve explicitly", () => {
    expect(describeError(null).code).toBe("unknown");
    expect(describeError(undefined).code).toBe("unknown");
  });
});

describe("data-status verdict is always present", () => {
  it.each(ALL_ERROR_CODES)("%s tells the user about their data", (code) => {
    const d = describeError(code);
    expect(["preserved", "unchanged", "at_risk", "unknown"]).toContain(
      d.dataStatus,
    );
  });
});

describe("classify kernel errors onto shell taxonomy", () => {
  const cases: Array<[string, WorkspaceErrorCode]> = [
    ["loader_unreachable", "kernel_unavailable"],
    ["loader_timeout", "kernel_unavailable"],
    ["kernel_missing", "kernel_unavailable"],
    ["connect_failed", "kernel_unavailable"],
    ["config_invalid", "config_invalid"],
    ["update_required", "migration_required"],
    ["quota_exceeded", "quota_exceeded"],
    ["conflict", "conflict"],
    ["unsupported_schema", "unsupported_schema"],
    ["package_corrupted", "package_corrupted"],
  ];
  it.each(cases)("kernel code %s -> workspace code %s", (input, expected) => {
    expect(classifyError({ code: input, message: "SENSITIVE" })).toBe(expected);
  });

  it("throwables without a code become unknown", () => {
    expect(classifyError(new Error("boom with secret_id=42"))).toBe("unknown");
    expect(classifyError("string throw")).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
  });
});

describe("analytics never leak user content", () => {
  it("safe event only contains the whitelisted fields", () => {
    const err = new Error("workspace 'Личные заметки' item #42 failed");
    (err as Error & { cause?: unknown }).cause = { secretToken: "xyz" };
    const evt = buildSafeEvent("quota_exceeded", err, () =>
      new Date("2026-01-01T00:00:00.000Z"),
    );

    // Whitelist check: keys are exactly the SafeErrorEvent shape.
    expect(Object.keys(evt).sort()).toEqual(
      ["at", "buildId", "code", "dev", "stackDigest"].sort(),
    );

    const serialized = JSON.stringify(evt);
    expect(serialized).not.toContain("Личные заметки");
    expect(serialized).not.toContain("secretToken");
    expect(serialized).not.toContain("xyz");
    expect(serialized).not.toContain("item #42");
  });

  it("reportError forwards only sanitized events to the sink", () => {
    const sink = vi.fn<(e: SafeErrorEvent) => void>();
    setAnalyticsSink(sink);
    try {
      const err = new Error("email=user@example.com leaked");
      reportError("conflict", err);
      expect(sink).toHaveBeenCalledTimes(1);
      const evt = sink.mock.calls[0][0];
      expect(evt.code).toBe("conflict");
      expect(JSON.stringify(evt)).not.toContain("user@example.com");
    } finally {
      setAnalyticsSink(null);
    }
  });

  it("reportError is a no-op when no sink is registered", () => {
    setAnalyticsSink(null);
    expect(() => reportError("unknown", new Error("x"))).not.toThrow();
  });
});
