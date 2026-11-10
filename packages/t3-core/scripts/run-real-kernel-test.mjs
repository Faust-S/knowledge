#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const runNode = (script, args = [], extraEnv = {}) => {
  const path = resolve(root, script);
  if (!existsSync(path)) throw new Error(`REAL_KERNEL_RUNNER_MISSING: ${script}`);
  const r = spawnSync(process.execPath, [path, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
};

runNode("node_modules/vite/bin/vite.js", ["build"]);
runNode("scripts/materialize-static-routes.mjs");
runNode("node_modules/vitest/vitest.mjs", ["run", "tests/integration/real-kernel.e2e.ts"], {
  IWXA_REAL_KERNEL_REQUIRED: "1",
  IWXA_REAL_KERNEL_TEST: "1",
});
