import { defineConfig } from "vitest/config";
import path from "node:path";

const realKernelOnly = process.env.IWXA_REAL_KERNEL_TEST === "1";
const workspaceTests = ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.e2e.ts", "tests/**/*.e2e.tsx"];

export default defineConfig({
  test: {
    maxWorkers: 2,
    setupFiles: ["tests/setup-jsdom.ts"],
    // Vitest 4 removed environmentMatchGlobs. Separate projects preserve the
    // donor's node/DOM split without allowing DOM tests to silently use node.
    projects: realKernelOnly ? [{
      extends: true,
      test: { name: "real-kernel", environment: "node", include: ["tests/integration/real-kernel.e2e.ts"] },
    }] : [{
      extends: true,
      test: { name: "workspace-node", environment: "node", include: workspaceTests, exclude: ["tests/**/*.dom.test.tsx", "tests/integration/real-kernel.e2e.ts"] },
    }, {
      extends: true,
      test: { name: "workspace-dom", environment: "jsdom", include: ["tests/**/*.dom.test.tsx"] },
    }],
    reporters: ["default", ["json", { outputFile: "artifacts/test-report.json" }]],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
