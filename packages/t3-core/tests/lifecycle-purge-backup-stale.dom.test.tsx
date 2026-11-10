// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { hostRouteRefs } from "@/workspace-host/router";
import type { RouteRef } from "@/workspace-contract";
import { makeKernel, makeWorkspace, makePreview, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("purge backup=stale exposes exchange handoff", () => {
  it("stale banner rendered and 'Создать новую резервную копию' navigates to exchange.home", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-s", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-s", { backup: "stale" }),
    });
    let target: RouteRef | null = null;
    renderTrash(kernel, { navigate: (r) => { target = r; } });
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-s"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-s"));
    await waitFor(() => screen.getByTestId("lifecycle-backup-banner-stale"));
    fireEvent.click(screen.getByTestId("lifecycle-open-exchange-for-backup"));
    await waitFor(() => expect(target).toBe(hostRouteRefs.exchange.home));
  });
});
