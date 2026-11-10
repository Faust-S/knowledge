/**
 * T2-03C — object history filtering by the Runtime Contract 1.3.0 event identity.
 */
import { describe, expect, it } from "vitest";
import { filterObjectEvents, OBJECT_HISTORY_LIMIT } from "../src/modules/base/features/object/object-history";
import type { EventRecord } from "../src/kernel-client";

function ev(
  overrides: Partial<EventRecord> & { event_id: string },
): EventRecord {
  return {
    object_id: "o",
    workspace_id: "w",
    service_id: "svc",
    event_type: "t",
    payload: { calculator_id: "uchebnaya-emkost", source: null },
    occurred_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as EventRecord;
}

describe("filterObjectEvents", () => {
  it("matches the top-level object_id and workspace, not service payload", () => {
    const es = [
      ev({ event_id: "1" }),
      ev({ event_id: "2", workspace_id: "other" }),
      ev({ event_id: "3", object_id: "different" }),
      ev({ event_id: "4", payload: null }),
      ev({ event_id: "5", payload: "string" }),
      ev({ event_id: "6", payload: [1, 2, 3] }),
      ev({ event_id: "7", payload: { object_id: "different" } }),
      ev({ event_id: "8", object_id: undefined, payload: { object_id: "o" } }),
      ev({ event_id: "9", object_id: "different", payload: { object_id: "o" } }),
    ];
    expect(filterObjectEvents(es, "w", "o").map(e => e.event_id).sort())
      .toEqual(["1", "4", "5", "6", "7"]);
  });

  it("shows Kernel Calculator revisions and Career history with subject payloads", () => {
    const calculatorId = "calc_30d4c2fbfe514f2ebf49d580";
    const es = [
      ev({ event_id: "calc-1", workspace_id: "learn-a", object_id: calculatorId,
        event_type: "calculator.snapshot.saved", revision: 1,
        occurred_at: "2026-10-25T07:00:00Z" }),
      ev({ event_id: "calc-2", workspace_id: "learn-a", object_id: calculatorId,
        event_type: "calculator.snapshot.updated", revision: 2,
        occurred_at: "2026-10-26T07:00:00Z" }),
      ev({ event_id: "career", workspace_id: "learn-a", object_id: "career-root",
        event_type: "career.workspace.updated", revision: 753,
        payload: { source: "career-map" } }),
      ev({ event_id: "other-workspace", workspace_id: "learn-b", object_id: calculatorId }),
    ];
    expect(filterObjectEvents(es, "learn-a", calculatorId).map(e => e.event_id))
      .toEqual(["calc-2", "calc-1"]);
    expect(filterObjectEvents(es, "learn-a", "career-root").map(e => e.event_id))
      .toEqual(["career"]);
    expect(filterObjectEvents(es, "learn-b", calculatorId).map(e => e.event_id))
      .toEqual(["other-workspace"]);
  });

  it("sorts newest first and tolerates bad dates", () => {
    const es = [
      ev({ event_id: "old", occurred_at: "2020-01-01T00:00:00Z" }),
      ev({ event_id: "bad", occurred_at: "not-a-date" }),
      ev({ event_id: "new", occurred_at: "2026-06-01T00:00:00Z" }),
    ];
    const out = filterObjectEvents(es, "w", "o");
    expect(out[0].event_id).toBe("new");
    expect(out[out.length - 1].event_id).toBe("bad");
  });

  it("caps at OBJECT_HISTORY_LIMIT", () => {
    const es: EventRecord[] = [];
    for (let i = 0; i < OBJECT_HISTORY_LIMIT + 5; i++) {
      es.push(ev({ event_id: `e${i}` }));
    }
    expect(filterObjectEvents(es, "w", "o").length).toBe(OBJECT_HISTORY_LIMIT);
  });
});
