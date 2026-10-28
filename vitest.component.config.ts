import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 加载测试环境变量
dotenv.config({ path: path.resolve(__dirname, '.env.test') })
dotenv.config({ path: path.resolve(__dirname, '.env.local') })
dotenv.config()

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
    },
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup/tests-setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'coverage/components',
      exclude: ['node_modules/', 'dist/', 'tests/', '**/*.config.*', '**/*.test.{ts,tsx}'],
    },
  },
})
