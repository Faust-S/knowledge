import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * Multi-entry static build.
 *
 * Workspace entries use the Host shell. Factory 2 Studio is deliberately
 * a separate application entry and does not mount the domain Workspace AppShell.
 */
export default defineConfig({
  base: "/workspace/",
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { host: "0.0.0.0", port: 8080, strictPort: false },
  preview: { host: "0.0.0.0", port: 8080, strictPort: false },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        signedWorkspace: path.resolve(__dirname, "signed-workspace.html"),
        isolatedSignedWorkspace: path.resolve(__dirname, "isolated-signed-workspace.html"),
        trustedKernelRealm: path.resolve(__dirname, "trusted-kernel-realm.html"),
        exchange: path.resolve(__dirname, "exchange.html"),
        lifecycle: path.resolve(__dirname, "lifecycle.html"),
        studio: path.resolve(__dirname, "studio.html"),
      },
    },
  },
});
