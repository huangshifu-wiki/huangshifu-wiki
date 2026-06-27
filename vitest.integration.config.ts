import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '.env.test') });

const testUploadsPath =
  process.env.UPLOADS_PATH || path.join(os.tmpdir(), 'huangshifu-wiki-test-uploads');
process.env.UPLOADS_PATH = testUploadsPath;

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"test"',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    env: {
      NODE_ENV: 'test',
      UPLOADS_PATH: testUploadsPath,
    },
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    fileParallelism: false,
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
