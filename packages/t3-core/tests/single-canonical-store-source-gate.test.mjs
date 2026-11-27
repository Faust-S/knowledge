import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const gate = readFileSync(new URL("../scripts/check-active-runtime-contract.mjs", import.meta.url), "utf8");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "iwxa-single-store-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content));
  };
  put("scripts/check-active-runtime-contract.mjs", gate);
  for (const id of ["base", "exchange", "lifecycle", "view-state"]) {
    put(`src/modules/${id}/manifest.json`, {compatibility:{runtime_contract:"1.3.0"}});
  }
  put("src/config/schemas/keys-2.0/workspace-module-manifest.schema.json",
    {properties:{compatibility:{properties:{runtime_contract:{const:"1.3.0"}}}}});
  put("src/config/schemas/keys-2.0/workspace-config.schema.json",
    {properties:{host:{properties:{
      required_contract_version:{const:"1.3.0"},required_runtime_version:{const:"0.3.6"}
    }}}});
  put("fixtures/host-configs/domain/workspace.config.json",
    {host:{required_contract_version:"1.3.0",required_runtime_version:"0.3.6"}});
  put("fixtures/host-configs/domain/domain.json", {runtime:{runtime_version:"0.3.6"}});
  put("src/persistence/canonical-persistence.mjs",
    'export class IndexedDbCanonicalAdapter { constructor(){ this.name="iwxa-t2-canonical"; } }');
  return {put, run: () => spawnSync(process.execPath, [join(root,"scripts/check-active-runtime-contract.mjs")], {encoding:"utf8"})};
}

test("single Store gate retains original adapter evidence and accepts Kernel-backed product", t => {
  const f = fixture(t);
  f.put("src/domain/save.ts", 'export const save=(kernel,input)=>kernel.t1.putObject(input);');
  f.put("src/domain/cache.mjs", 'export const cacheName="program-local-thumbnail-cache";');
  f.put("src/factory2/archive.mjs", 'new IndexedDbCanonicalAdapter();');
  f.put("src/kernel-client/contracts/runtime-1.2.0/history.ts", 'new IndexedDbCanonicalAdapter();');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /T2_ACTIVE_RUNTIME_CONTRACT_SOURCE_PASS/);
});

for (const ext of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) {
  test(`single Store gate rejects explicit alternate adapter binding in .${ext}`, t => {
    const f = fixture(t);
    f.put(`src/domain/save.${ext}`, 'import { IndexedDbCanonicalAdapter as Adapter } from "../persistence/index.mjs";');
    const r = f.run();
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`separate canonical Store reference: src/domain/save.${ext}`), r.stderr);
  });
}
test("single Store gate rejects direct use of the separate database name", t => {
  const f = fixture(t);
  f.put("src/domain/extra-store.mjs", 'indexedDB.open("iwxa-t2-canonical");');
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /separate canonical Store reference: src\/domain\/extra-store\.mjs/);
});
test("runtime contract gate continues rejecting obsolete TS imports", t => {
  const f = fixture(t);
  f.put("src/domain/old.ts", 'import { value } from "../kernel-client/contracts/runtime-1.2.0";');
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /obsolete contract import: src\/domain\/old\.ts/);
});
test("runtime contract gate continues rejecting mismatched staged domains", t => {
  const f = fixture(t);
  f.put("fixtures/host-configs/domain/domain.json", {runtime:{runtime_version:"0.3.5"}});
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /active Host fixture domain is not on the single runtime/);
});
