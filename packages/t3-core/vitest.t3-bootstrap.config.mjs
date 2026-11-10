import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const dir=dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  resolve:{alias:{"@":resolve(dir,"src")}},
  test:{environment:"node",include:["tests/runtime-1.3.0-successor-facade.test.ts","tests/host-facade-gating.test.ts","tests/host-router-facade.test.ts","tests/module-kernel-facade.test.ts"],maxWorkers:2}
});
