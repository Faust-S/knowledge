// @vitest-environment jsdom
/**
 * T2-03A — useWorkspaceProfile activation matrix.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useWorkspaceProfile } from "../src/modules/base/features/workspace/useWorkspaceProfile";
import { isKnownWorkspaceProfileId } from "../src/modules/base/features/workspace/workspace-profile";

describe("isKnownWorkspaceProfileId", () => {
  it("accepts every known profile id", () => {
    for (const id of ["generic", "learning", "personal", "organization", "health"]) {
      expect(isKnownWorkspaceProfileId(id)).toBe(true);
    }
  });
  it("rejects unknown ids", () => {
    expect(isKnownWorkspaceProfileId("mystery")).toBe(false);
    expect(isKnownWorkspaceProfileId("")).toBe(false);
  });
});

describe("useWorkspaceProfile", () => {
  const originalFlag = import.meta.env.VITE_ENABLE_HEALTH_PROFILE;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = originalFlag;
  });

  it("known profile → status ready with matching definition", async () => {
    const { result } = renderHook(() => useWorkspaceProfile("personal"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.activeProfileId).toBe("personal");
    expect(result.current.definition?.id).toBe("personal");
    expect(result.current.requestedProfile).toBe("personal");
  });

  it("unknown profile → fallback preserves raw string", async () => {
    const { result } = renderHook(() => useWorkspaceProfile("wildcat"));
    await waitFor(() => expect(result.current.status).toBe("fallback"));
    expect(result.current.activeProfileId).toBe("generic");
    expect(result.current.requestedProfile).toBe("wildcat");
    expect(result.current.definition?.id).toBe("generic");
  });

  it("health uses the same ordinary profile activation as others", async () => {
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = undefined;
    const { result } = renderHook(() => useWorkspaceProfile("health"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.definition?.id).toBe("health");
    expect(result.current.requestedProfile).toBe("health");
  });

  it("null → idle", () => {
    const { result } = renderHook(() => useWorkspaceProfile(null));
    expect(result.current.status).toBe("idle");
  });
});
