import { defineConfig } from "vitest/config";
import path from "node:path";

// The original T2 vitest suite remains intact. Only archive/source-document
// bindings that require T2 repo paths are outside the product-only T3 lane.
const ARCHIVAL_SOURCE_TESTS = [
  "tests/architecture-lock-current.test.ts",
  "tests/contract-readme.test.ts",
  "tests/runtime-1.3.0-source-subject.test.ts",
];
const tests = ["tests/**/*.test.ts","tests/**/*.test.tsx","tests/**/*.e2e.ts","tests/**/*.e2e.tsx"];
export default defineConfig({
  test: {
    maxWorkers: 2,
    setupFiles: ["tests/setup-jsdom.ts"],
    projects: [
      {extends:true,test:{
        name:"t3-product-node",environment:"node",
        include:tests,
        exclude:["tests/**/*.dom.test.tsx","tests/integration/real-kernel.e2e.ts",...ARCHIVAL_SOURCE_TESTS],
      }},
      {extends:true,test:{
        name:"t3-product-dom",environment:"jsdom",
        include:["tests/**/*.dom.test.tsx"],
      }},
    ],
    reporters:["default",["json",{outputFile:"artifacts/t3-product-test-report.json"}]],
  },
  resolve:{alias:{"@":path.resolve(import.meta.dirname,"src")}},
});
