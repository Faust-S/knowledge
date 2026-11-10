/**
 * T2 UI boundary regression tests.
 *
 * These assertions guarantee that no T3 handoff/route UI leaks back into
 * the shell surface files, and that the trimmed prop shapes on
 * ObjectView / WorkspaceView do not re-grow.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN_STRINGS = [
  "Действия сервисов",
  "Переход в сервис",
  "Передача контекста между сервисами появится на уровне T3",
  "Текущее ядро не предоставляет безопасный intent-канал",
  "Descriptor.serviceHandoffs",
  "serviceHandoffs",
  "routeHints",
];

const FILES = [
  "src/modules/base/features/object/ObjectView.tsx",
  "src/modules/base/features/workspace/WorkspaceView.tsx",
];

describe("T2 UI boundary: no T3 placeholders in shell surfaces", () => {
  for (const f of FILES) {
    const src = readFileSync(path.resolve(f), "utf8");
    for (const s of FORBIDDEN_STRINGS) {
      it(`${f} does not contain "${s}"`, () => {
        expect(src).not.toContain(s);
      });
    }
  }
});

describe("ObjectViewProps gates via KernelFacade and carries no descriptor", () => {
  const src = readFileSync(
    path.resolve("src/modules/base/features/object/ObjectView.tsx"),
    "utf8",
  );
  const propsMatch = src.match(/export interface ObjectViewProps\s*\{[\s\S]*?\}/);
  it("declares ObjectViewProps", () => {
    expect(propsMatch).toBeTruthy();
  });
  const propsBlock = propsMatch?.[0] ?? "";
  it("declares a kernel: KernelFacade prop (T2-03C gating via facade)", () => {
    expect(propsBlock).toMatch(/\bkernel\s*:\s*KernelFacade\b/);
  });
  it("does not declare legacy session/capabilities props", () => {
    expect(propsBlock).not.toMatch(/\bcapabilities\b/);
    expect(propsBlock).not.toMatch(/\bsession\b/);
  });
  it("does not declare a descriptor prop", () => {
    expect(propsBlock).not.toMatch(/\bdescriptor\b/);
  });
});


describe("WorkspaceViewProps has no descriptor", () => {
  const src = readFileSync(
    path.resolve("src/modules/base/features/workspace/WorkspaceView.tsx"),
    "utf8",
  );
  const propsMatch = src.match(/export interface WorkspaceViewProps\s*\{[\s\S]*?\}/);
  it("declares WorkspaceViewProps", () => {
    expect(propsMatch).toBeTruthy();
  });
  const propsBlock = propsMatch?.[0] ?? "";
  it("does not declare a descriptor prop", () => {
    expect(propsBlock).not.toMatch(/\bdescriptor\b/);
  });
});

describe("no competing lockfiles at repository root", () => {
  const { existsSync } = require("node:fs");
  for (const lf of ["bun.lock", "yarn.lock", "pnpm-lock.yaml"]) {
    it(`${lf} is absent`, () => {
      expect(existsSync(path.resolve(lf))).toBe(false);
    });
  }
});
