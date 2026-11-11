import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  base: './',
  build: {
    outDir: resolve(root, 'dist-host-surface'),
    emptyOutDir: true,
    lib: {
      entry: resolve(root, 'src/host-surface.tsx'),
      formats: ['es'],
      fileName: 'iwxa-activity-host-surface',
      cssFileName: 'iwxa-activity-host-surface',
    },
    rollupOptions: {
      // Use the installed native Host's existing React runtime.
      external: ['react', 'react-dom/client', 'react/jsx-runtime'],
    },
  },
  clearScreen: false,
});
