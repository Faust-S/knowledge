import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  base: './',
  build: {outDir: resolve(root, 'dist'), emptyOutDir: true},
  server: {host: '127.0.0.1', port: 1420, strictPort: true,
    open: false, fs: {allow: [resolve(root, '..')]}},
  clearScreen: false,
});