import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const defer = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const turn = () => new Promise(r => setImmediate(r));
const chunk = content => ({ choices: [{ delta: { content } }] });

// Exercise the exact production adapter and policy. Replace only the GPU
// engine/Worker transport with a controllable, deliberately slow stream.
async function fixture(t, create) {
  const dir = await mkdtemp(join(tmpdir(), "t3-live-generation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const src = new URL("../integration-sources/bli1/", import.meta.url);
  for (const name of ["engine.mjs", "catalog.mjs", "policy.mjs", "cache-readiness.mjs"])
    await copyFile(new URL(name, src), join(dir, name));
  const mod = join(dir, "node_modules", "@mlc-ai", "web-llm");
  await mkdir(mod, { recursive: true });
  await writeFile(join(mod, "package.json"), JSON.stringify({ type: "module", exports: "./index.mjs" }));
  await writeFile(join(mod, "index.mjs"), `
import { MODELS } from "../../../catalog.mjs";
export const prebuiltAppConfig = { model_list: MODELS.map(m => ({
  model_id: m.upstreamId ?? m.id, model: m.upstreamModelSource ?? m.modelSource,
  model_lib: m.upstreamModelLib ?? m.modelLib
})) };
export const hasModelInCache = async () => false;
export const deleteModelInCache = async () => {};
export const deleteChatConfigInCache = async () => {};
export const CreateWebWorkerMLCEngine = async () => globalThis.__t3TestEngine;
`);
  let worker;
  class WorkerStub extends EventTarget {
    constructor() { super(); worker = this; this.terminated = false; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const before = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: WorkerStub });
  globalThis.__t3TestEngine = { chat: { completions: { create } }, unload: async () => {} };
  t.after(() => {
    delete globalThis.__t3TestEngine;
    if (before) Object.defineProperty(globalThis, "Worker", before);
    else delete globalThis.Worker;
  });
  const { BrowserLocalRuntimeAdapter } = await import(pathToFileURL(join(dir, "engine.mjs")).href);
  const adapter = new BrowserLocalRuntimeAdapter();
  adapter.probe = async () => ({ gpu: true, cache: true });
  await adapter.load({ networkConsent: true });
  t.after(() => adapter.dispose());
  return { adapter, worker };
}

test("live generation survives the former first-token and inter-token deadlines", async t => {
  const first = defer(), second = defer();
  const { adapter, worker } = await fixture(t, async () => (async function* () {
    await first.promise; yield chunk("Первый");
    await second.promise; yield chunk(" ответ");
  })());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = [];
  const pending = adapter.invoke("Тест", { onChunk: v => seen.push(v) });
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(121000);
  await turn();
  assert.equal(worker.terminated, false);
  assert.equal(adapter.ready, true);
  first.resolve();
  await turn();
  assert.deepEqual(seen, ["Первый"]);
  t.mock.timers.tick(61000);
  await turn();
  assert.equal(worker.terminated, false);
  second.resolve();
  assert.deepEqual(await outcome, { value: "Первый ответ" });
  assert.equal(adapter.ready, true);
});

test("explicit Stop still releases a Worker stalled before the first token", async t => {
  const { adapter, worker } = await fixture(t, () => new Promise(() => {}));
  const pending = adapter.invoke("Тест");
  const rejected = assert.rejects(pending, { code: "CANCELLED" });
  adapter.cancel();
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(adapter.ready, false);
});

test("real Worker error still rejects generation and clears readiness", async t => {
  const { adapter, worker } = await fixture(t, () => new Promise(() => {}));
  const pending = adapter.invoke("Тест");
  const rejected = assert.rejects(pending, { code: "WORKER_FAILED" });
  worker.dispatchEvent(new Event("error"));
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(adapter.ready, false);
});
