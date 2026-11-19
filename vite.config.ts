import { defineConfig } from 'vite';

// The page is always served from the root of its own address: no `base`, no source maps in the bundle.
export default defineConfig({
    server: { port: 5180, host: 'localhost' },
    build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
