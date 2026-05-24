import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    teardownTimeout: 10000,
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage/integration',
      include: ['src/**/*.ts'],
      exclude: [
        'tests/**',
        'scripts/**',
        'dist/**',
        '**/*.d.ts',
        '**/types/**',
      ],
      thresholds: {
        lines: 20,
        functions: 40,
        branches: 30,
        statements: 20,
      },
    },
  },
});
