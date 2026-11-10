import assert from "node:assert/strict";
import test from "node:test";
import { get } from "node:https";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serveRealKernelHost } from "../scripts/real-kernel-e2e.mjs";

test("T2 Host uses ephemeral TLS for real local HTTPS without a bundled private key", async () => {
  const root = mkdtempSync(join(tmpdir(), "iwxa-t3-tls-test-"));
  writeFileSync(join(root, "index.html"), "T3-REAL-HTTPS");
  let server;
  try {
    const host = await serveRealKernelHost(root);
    server = host.server;
    const body = await new Promise((resolve, reject) => {
      get(host.origin + "/index.html", { rejectUnauthorized: false }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      }).on("error", reject);
    });
    assert.equal(body, "T3-REAL-HTTPS");
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
