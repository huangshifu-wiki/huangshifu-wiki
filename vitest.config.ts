import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载测试环境变量（优先级：.env.test > .env.local > .env）
dotenv.config({ path: path.resolve(__dirname, '.env.test') });
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
dotenv.config();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    testTimeout: 30000,
    environmentMatchGlobs: [
      // 非 UI 测试使用 node 环境
      ['tests/unit/!(*components*)/**/*.test.{ts,tsx}', 'node'],
      ['tests/unit/*.test.ts', 'node'],
    ],
    deps: {
      optimizer: {
        web: {
          include: [
            'react-dom',
            'react-dom/server',
            'react-dom/test-utils',
          ],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        // 路由文件 - 更适合集成测试
        'src/server/routes/**/*.ts',
        // 中间件 - 更适合集成测试
        'src/server/middleware/**/*.ts',
        // 工具函数聚合文件 - 只是导出
        'src/server/utils/index.ts',
        'src/server/types/index.ts',
        // 服务入口文件
        'src/server/**/routes.ts',
      ],
      thresholds: {
        lines: 25,
        functions: 55,
        branches: 70,
        statements: 25,
      },
    },
  },
});
