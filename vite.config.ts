/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves project sites from /<repo-name>/. Override with BASE_PATH.
const base = process.env.BASE_PATH ?? '/brain-harness/';

export default defineConfig({
  base,
  plugins: [react()],
  // React + router + Dexie ≈ 165 kB gzipped; the graph view (dagre) is split out.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/data/**/*.test.ts'],
    environment: 'node',
  },
});
