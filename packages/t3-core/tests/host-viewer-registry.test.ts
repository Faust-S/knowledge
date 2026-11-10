import { describe, it, expect } from "vitest";
import { ViewerRegistry } from "@/workspace-host/registries";
import type { ViewerContribution } from "@/workspace-contract";

const v = (
  id: string,
  over: Partial<ViewerContribution>,
): ViewerContribution => ({
  kind: "viewer",
  id,
  moduleId: "m",
  requiredOperations: [],
  profileId: "generic",
  schemaId: "note",
  schemaVersionRange: "1.x",
  surface: "detail",
  loader: async () => ({ default: () => null }),
  ...over,
});

function makeReg(healthEnabled = false): ViewerRegistry {
  return new ViewerRegistry();
}

describe("ViewerRegistry — resolution", () => {
  it("prefers an exact profile match over the generic fallback", () => {
    const r = makeReg();
    r.registerMany("m", [
      {
        contributionId: "g",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("g", { profileId: "generic" }),
      },
      {
        contributionId: "p",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("p", { profileId: "personal" }),
      },
    ]);
    const hit = r.resolve({
      profileId: "personal",
      schemaId: "note",
      schemaVersion: "1.2.0",
      surface: "detail",
    });
    expect(hit).not.toBeNull();
    expect(hit!.isFallback).toBe(false);
    expect(hit!.entry.contributionId).toBe("p");
  });

  it("falls back to generic when no exact profile exists", () => {
    const r = makeReg();
    r.registerMany("m", [
      {
        contributionId: "g",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("g", { profileId: "generic" }),
      },
    ]);
    const hit = r.resolve({
      profileId: "personal",
      schemaId: "note",
      schemaVersion: "1.2.0",
      surface: "detail",
    });
    expect(hit).not.toBeNull();
    expect(hit!.isFallback).toBe(true);
  });

  it("returns null for unknown schema", () => {
    const r = makeReg();
    expect(
      r.resolve({
        profileId: "generic",
        schemaId: "unknown",
        schemaVersion: "1.0.0",
        surface: "detail",
      }),
    ).toBeNull();
  });

  it("resolves health-profile viewer without an automatic display ban", () => {
    const r = makeReg(false);
    r.registerMany("m", [
      {
        contributionId: "h",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("h", { profileId: "health" }),
      },
    ]);
    const hit = r.resolve({
      profileId: "health",
      schemaId: "note",
      schemaVersion: "1.0.0",
      surface: "detail",
    });
    expect(hit?.entry.contributionId).toBe("h");
  });

  it("resolves health-profile viewer when health build flag is on", () => {
    const r = makeReg(true);
    r.registerMany("m", [
      {
        contributionId: "h",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("h", { profileId: "health" }),
      },
    ]);
    const hit = r.resolve({
      profileId: "health",
      schemaId: "note",
      schemaVersion: "1.0.0",
      surface: "detail",
    });
    expect(hit).not.toBeNull();
  });

  it("rejects duplicate identical scope on registration", () => {
    const r = makeReg();
    const res = r.registerMany("m", [
      {
        contributionId: "a",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("a", {}),
      },
      {
        contributionId: "b",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("b", {}),
      },
    ]);
    expect(res.ok).toBe(false);
  });

  it("rejects invalid semver range", () => {
    const r = makeReg();
    const res = r.registerMany("m", [
      {
        contributionId: "a",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: v("a", { schemaVersionRange: "not-a-range" }),
      },
    ]);
    expect(res.ok).toBe(false);
  });
});


  it("does not resolve a viewer until its operation and capability requirements are satisfied", () => {
    const r = makeReg();
    r.registerMany("m", [{
      contributionId: "gated",
      ownerModuleId: "m",
      requiredOperations: ["t1.getObject"],
      requiredCapabilitiesAll: ["cap.viewer"],
      contribution: v("gated", {
        requiredOperations: ["t1.getObject"],
        requiredCapabilitiesAll: ["cap.viewer"],
      }),
    }]);
    const query = {
      profileId: "generic",
      schemaId: "note",
      schemaVersion: "1.0.0",
      surface: "detail" as const,
    };
    expect(r.resolve(query, [], [])).toBeNull();
    expect(r.resolve(query, ["t1.getObject"], [])).toBeNull();
    expect(r.resolve(query, ["t1.getObject"], ["cap.viewer"])?.entry.contributionId).toBe("gated");
  });
