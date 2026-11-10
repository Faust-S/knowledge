/** §14 — cancel from any state yields a clean cancelled state. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_IMPORT_STATE, importReducer,
} from "@/modules/exchange/features/state/import-machine";

describe("import cancel idempotency (§14)", () => {
  it("cancel from idle stays cancelled with no handle/receipt", () => {
    const s = importReducer(INITIAL_IMPORT_STATE, { type: "cancel", reason: "explicit" });
    expect(s.status).toBe("cancelled");
    expect(s.handle).toBeNull();
    expect(s.receipt).toBeNull();
  });
  it("cancel again is a no-state-drift", () => {
    let s = importReducer(INITIAL_IMPORT_STATE, { type: "cancel", reason: "explicit" });
    s = importReducer(s, { type: "cancel", reason: "unmount" });
    expect(s.status).toBe("cancelled");
    expect(s.handle).toBeNull();
  });
});
