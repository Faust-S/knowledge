#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const env = { ...process.env, VITE_ENABLE_HEALTH_PROFILE: "true" };
const steps = [
  [process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build"]],
  [process.execPath, [resolve(root, "scripts/materialize-static-routes.mjs")]],
];
for (const [cmd, args] of steps) {
  const out = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (out.error) throw out.error;
  if ((out.status ?? 1) !== 0) process.exit(out.status ?? 1);
}
