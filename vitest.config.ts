import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@adapters': fileURLToPath(new URL('./src/adapters', import.meta.url)),
  '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['tests/setup.ts'] },
      },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 30000 },
      },
    ],
  },
});
