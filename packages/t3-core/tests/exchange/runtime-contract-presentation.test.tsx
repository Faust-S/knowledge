import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "../../src/kernel-client/contracts/runtime-1.3.0";
import { ExportView } from "../../src/modules/exchange/features/packages/ExportView";
import type { KernelFacade } from "../../src/workspace-contract";
import { EXPECTED_RUNTIME_CONTRACT_VERSION } from "../../src/workspace-contract/version";

describe("Exchange Runtime Contract presentation", () => {
  it("renders the active Runtime Contract version instead of a hard-coded label", () => {
    const kernel = { hasOperation: () => false } as unknown as KernelFacade;
    const html = renderToStaticMarkup(createElement(ExportView, { kernel }));
    expect(EXPECTED_RUNTIME_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
    expect(html).toContain(`Runtime Contract ${EXPECTED_RUNTIME_CONTRACT_VERSION}`);
    expect(html).not.toMatch(/Runtime Contract 1\.0\.0/);
  });

  it("keeps static Exchange metadata independent of Runtime Contract releases", () => {
    const html = readFileSync(path.resolve("exchange.html"), "utf8");
    const description = html.match(/<meta name="description" content="([^"]+)"\s*\/>/)?.[1];
    expect(description).toContain(".iwxa");
    expect(description).not.toMatch(/Runtime Contract\s+\d+\.\d+\.\d+/);
  });
});
