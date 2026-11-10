/**
 * T2-02E component tests for CreateWorkspaceDialog focus semantics.
 *
 * jsdom-backed tests that exercise the real component:
 *   - Cancel via Escape / Cancel button returns focus to the trigger
 *     (via the parent's cancel handler using rAF).
 *   - Successful create does NOT return focus to the trigger.
 *   - Busy dialog does not close on Escape.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useRef, useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CreateWorkspaceDialog } from "../src/modules/base/features/workspaces/CreateWorkspaceDialog";

interface HarnessProps {
  onCreate: () => Promise<void>;
  onCreated?: () => void;
}
function Harness({ onCreate, onCreated }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancel = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const create = async () => {
    await onCreate();
    setOpen(false);
    onCreated?.();
  };
  return (
    <div>
      <button ref={triggerRef} data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <CreateWorkspaceDialog
        open={open}
        profileLabel="Generic"
        onCancel={cancel}
        onCreate={create}
      />
    </div>
  );
}

async function waitForFocus(el: HTMLElement, timeoutMs = 500) {
  const start = Date.now();
  while (document.activeElement !== el && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function openDialog(): Promise<HTMLElement> {
  const trigger = screen.getByTestId("trigger");
  act(() => trigger.click());
  return await screen.findByTestId("create-workspace-dialog");
}

describe("CreateWorkspaceDialog — focus semantics", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    if (typeof window.requestAnimationFrame !== "function") {
      (window as unknown as { requestAnimationFrame: typeof requestAnimationFrame })
        .requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0) as unknown as number;
    }
  });

  it("Cancel button returns focus to the trigger", async () => {
    render(<Harness onCreate={() => Promise.resolve()} />);
    await openDialog();
    const cancelBtn = screen
      .getByTestId("create-workspace-dialog")
      .querySelector("button") as HTMLButtonElement;
    expect(cancelBtn.textContent).toContain("Отмена");
    act(() => cancelBtn.click());
    const trigger = screen.getByTestId("trigger");
    await waitForFocus(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape returns focus to the trigger", async () => {
    render(<Harness onCreate={() => Promise.resolve()} />);
    await openDialog();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    const trigger = screen.getByTestId("trigger");
    await waitForFocus(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it("Successful create does NOT return focus to the trigger", async () => {
    const onCreated = vi.fn();
    render(<Harness onCreate={() => Promise.resolve()} onCreated={onCreated} />);
    await openDialog();
    const confirm = screen.getByTestId("create-workspace-confirm");
    await act(async () => {
      confirm.click();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    // Dialog is gone; and focus is not on the trigger — the parent left
    // focus management to the surrounding shell (AppShell moves focus
    // to <main> on route change in the real app).
    expect(screen.queryByTestId("create-workspace-dialog")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByTestId("trigger"));
  });

  it("Busy dialog does not close on Escape", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    render(<Harness onCreate={() => slow} />);
    await openDialog();
    const confirm = screen.getByTestId("create-workspace-confirm");
    act(() => confirm.click());
    // Now busy — Escape must be a no-op.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByTestId("create-workspace-dialog")).not.toBeNull();
    await act(async () => {
      release();
      await slow;
    });
  });
});
