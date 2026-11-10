// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, makeReceipt, renderTrash } from "./lifecycle/_helpers";
import { CommandInvocationError } from "@/workspace-host/registries/CommandRegistry";

afterEach(() => cleanup());

describe("lifecycle route DOM basics + secret hygiene", () => {
  it("sorts trash by deleted_at desc, workspace_id asc; challenge input safe attrs; token never in DOM", async () => {
    const kernel = makeKernel({
      workspaces: [
        makeWorkspace("ws-b", { deletedAt: "2026-07-01T00:00:00Z" }),
        makeWorkspace("ws-a", { deletedAt: "2026-07-03T00:00:00Z" }),
        makeWorkspace("ws-c", { deletedAt: "2026-07-03T00:00:00Z" }),
        makeWorkspace("ws-alive"),
      ],
      preview: makePreview("ws-a"),
    });
    renderTrash(kernel);
    const list = await waitFor(() => screen.getByTestId("lifecycle-trash-list"));
    const rows = list.querySelectorAll("li");
    const ids = Array.from(rows).map((li) => li.getAttribute("data-testid"));
    expect(ids).toEqual([
      "lifecycle-trash-row-ws-a",
      "lifecycle-trash-row-ws-c",
      "lifecycle-trash-row-ws-b",
    ]);
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-a"));
    const input = await waitFor(() =>
      screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement,
    );
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.value).toBe("");
    expect(document.body.textContent ?? "").not.toContain("tok-ws-a");
  });
});

it("shows the exact issued challenge but commits only after manual exact input", async () => {
  const challenge = "PURGE ws-exact CaSe  ";
  const token = "secret-purge-token-ws-exact";
  const kernel = makeKernel({
    workspaces: [makeWorkspace("ws-exact", { deletedAt: "2026-07-01T00:00:00Z" })],
    preview: makePreview("ws-exact", { challenge, token }),
    commit: makeReceipt("ws-exact"),
  });
  renderTrash(kernel);

  fireEvent.click(await screen.findByTestId("lifecycle-purge-open-ws-exact"));
  const challengeElement = await screen.findByTestId("lifecycle-challenge-to-type");
  expect(challengeElement.textContent).toBe(challenge);
  expect(challengeElement.tagName).toBe("CODE");

  const input = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
  const commit = screen.getByTestId("lifecycle-purge-commit") as HTMLButtonElement;
  expect(input.value).toBe("");
  expect(commit.disabled).toBe(true);
  expect(document.body.innerHTML).not.toContain(token);

  fireEvent.change(input, { target: { value: "PURGE ws-exact CaSe" } });
  expect(commit.disabled).toBe(true);
  expect(kernel.purgeCommit).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: challenge } });
  expect(commit.disabled).toBe(false);
  fireEvent.click(commit);
  await waitFor(() => expect(kernel.purgeCommit).toHaveBeenCalledWith({
    purge_token: token,
    confirmation: challenge,
  }));
  const receipt = await screen.findByTestId("lifecycle-purge-receipt");
  expect(receipt.textContent).toContain("ws-exact");
  expect(document.body.innerHTML).not.toContain(token);
});

it("does not reveal a challenge until the separate missing-backup acknowledgement", async () => {
  const kernel = makeKernel({
    workspaces: [makeWorkspace("ws-no-backup", { deletedAt: "2026-07-01T00:00:00Z" })],
    previewImpl: async ({ acknowledge_no_backup }) =>
      makePreview("ws-no-backup", {
        backup: "missing",
        acknowledged: Boolean(acknowledge_no_backup),
        challenge: acknowledge_no_backup
          ? "PURGE ws-no-backup SECOND"
          : "PURGE ws-no-backup FIRST",
        token: acknowledge_no_backup ? "token-second" : "token-first",
      }),
  });
  renderTrash(kernel);

  fireEvent.click(await screen.findByTestId("lifecycle-purge-open-ws-no-backup"));
  await screen.findByTestId("lifecycle-missing-backup-panel");
  expect(screen.queryByTestId("lifecycle-challenge-to-type")).toBeNull();
  expect(screen.queryByTestId("lifecycle-purge-commit")).toBeNull();
  expect(kernel.purgePreview).toHaveBeenCalledWith({
    workspace_id: "ws-no-backup",
    acknowledge_no_backup: false,
  });

  fireEvent.click(screen.getByTestId("lifecycle-ack-no-backup"));
  const challengeElement = await screen.findByTestId("lifecycle-challenge-to-type");
  expect(challengeElement.textContent).toBe("PURGE ws-no-backup SECOND");
  expect(kernel.purgePreview).toHaveBeenCalledWith({
    workspace_id: "ws-no-backup",
    acknowledge_no_backup: true,
  });
  expect((screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement).value).toBe("");
  expect((screen.getByTestId("lifecycle-purge-commit") as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.innerHTML).not.toContain("token-first");
  expect(document.body.innerHTML).not.toContain("token-second");

  fireEvent.click(screen.getByTestId("lifecycle-purge-cancel"));
  await waitFor(() => expect(screen.queryByTestId("lifecycle-challenge-to-type")).toBeNull());
  expect(kernel.purgeCommit).not.toHaveBeenCalled();
});


describe("Lifecycle purge token hygiene in error output", () => {
  const token = "sensitive-token-from-runtime-issue-8";
  const error = () => new Error(`Kernel failure leaked ${token}`);
  const assertNoLeak = () => {
    expect(document.body.innerHTML).not.toContain(token);
    expect(window.location.href).not.toContain(token);
  };

  it("does not display untrusted list errors", async () => {
    const kernel = makeKernel();
    vi.spyOn(kernel, "listWorkspaces").mockRejectedValue(error());
    renderTrash(kernel);
    await screen.findByRole("alert");
    assertNoLeak();
  });

  it("does not display untrusted restore errors", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-restore", { deletedAt: "2026-07-01T00:00:00Z" })],
      restoreImpl: async () => { throw error(); },
    });
    renderTrash(kernel);
    fireEvent.click(await screen.findByTestId("lifecycle-restore-ws-restore"));
    await screen.findByRole("alert");
    assertNoLeak();
  });

  it("does not display untrusted first-preview errors", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-preview", { deletedAt: "2026-07-01T00:00:00Z" })],
      previewImpl: async () => { throw error(); },
    });
    renderTrash(kernel);
    fireEvent.click(await screen.findByTestId("lifecycle-purge-open-ws-preview"));
    await screen.findByRole("alert");
    assertNoLeak();
    expect(kernel.purgeCommit).not.toHaveBeenCalled();
  });

  it("does not display untrusted second-preview errors", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-ack", { deletedAt: "2026-07-01T00:00:00Z" })],
      previewImpl: async ({ acknowledge_no_backup }) => {
        if (acknowledge_no_backup) throw error();
        return makePreview("ws-ack", { backup: "missing", token });
      },
    });
    renderTrash(kernel);
    fireEvent.click(await screen.findByTestId("lifecycle-purge-open-ws-ack"));
    await screen.findByTestId("lifecycle-missing-backup-panel");
    fireEvent.click(screen.getByTestId("lifecycle-ack-no-backup"));
    await screen.findByRole("alert");
    assertNoLeak();
    expect(kernel.purgeCommit).not.toHaveBeenCalled();
  });

  it("does not display untrusted commit errors and never treats them as success", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-commit", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-commit", { token }),
      commitImpl: async () => { throw error(); },
    });
    renderTrash(kernel);
    fireEvent.click(await screen.findByTestId("lifecycle-purge-open-ws-commit"));
    const input = await screen.findByTestId("lifecycle-challenge-input");
    fireEvent.change(input, { target: { value: "PURGE ws-commit" } });
    fireEvent.click(screen.getByTestId("lifecycle-purge-commit"));
    await screen.findByRole("alert");
    assertNoLeak();
    expect(screen.queryByTestId("lifecycle-purge-receipt")).toBeNull();
    expect(kernel.purgeCommit).toHaveBeenCalledOnce();
  });
});


it("keeps the manual retry path when CommandRegistry wraps a challenge mismatch", async () => {
  const token = "secret-token-wrapped-mismatch";
  const preview = makePreview("ws-wrapped", { token });
  const kernel = makeKernel({
    workspaces: [makeWorkspace("ws-wrapped", { deletedAt: "2026-07-01T00:00:00Z" })],
    preview,
    commitImpl: async () => {
      throw new CommandInvocationError(
        "handler-threw",
        "lifecycle.purge-commit",
        "handler threw",
        { code: "PURGE_CHALLENGE_MISMATCH", message: `do not show ${token}` },
      );
    },
  });
  renderTrash(kernel);
  fireEvent.click(await screen.findByTestId("lifecycle-purge-open-ws-wrapped"));
  const input = await screen.findByTestId("lifecycle-challenge-input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: preview.challenge } });
  fireEvent.click(screen.getByTestId("lifecycle-purge-commit"));
  await waitFor(() => expect(kernel.purgeCommit).toHaveBeenCalledOnce());
  // Committing unmounts the challenge panel. On a retry React mounts a new
  // input, so assert against the currently rendered control, not the stale
  // element captured before the commit attempt.
  await waitFor(() => {
    const retryInput = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
    expect(retryInput.value).toBe("");
    expect((screen.getByTestId("lifecycle-purge-commit") as HTMLButtonElement).disabled).toBe(true);
  });
  expect(screen.getByTestId("lifecycle-challenge-to-type").textContent).toBe(preview.challenge);
  expect(screen.queryByTestId("lifecycle-purge-receipt")).toBeNull();
  expect(kernel.purgeCancel).not.toHaveBeenCalled();
  expect(document.body.innerHTML).not.toContain(token);
});
