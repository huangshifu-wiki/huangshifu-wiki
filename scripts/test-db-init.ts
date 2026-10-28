#!/usr/bin/env tsx
/**
 * 测试数据库初始化脚本
 *
 * 功能：
 * 1. 创建测试数据库（如果不存在）
 * 2. 运行数据库迁移
 * 3. 可选：运行种子数据
 *
 * 使用方法：
 *   npm run test:db:init
 *   或者：tsx scripts/test-db-init.ts
 *
 * 环境变量：
 *   - 从 .env.test 文件加载测试数据库配置
 *   - 确保测试数据库与开发数据库隔离
 */

import dotenv from 'dotenv'
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 以 .env.test 提供默认值，但保留调用方显式传入的 DATABASE_URL
dotenv.config({ path: path.resolve(__dirname, '../.env.test') })

const DATABASE_URL = process.env.DATABASE_URL
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

if (!DATABASE_URL) {
  console.error('❌ 错误：未找到 DATABASE_URL 环境变量')
  console.error('请确保 .env.test 文件存在并包含 DATABASE_URL')
  process.exit(1)
}

interface DatabaseConfig {
  user: string
  password: string
  host: string
  port: string
  database: string
  adminUrl: string
}

// 解析数据库连接信息
function parseDatabaseUrl(url: string): DatabaseConfig {
  try {
    const parsedUrl = new URL(url)
    const database = parsedUrl.pathname.replace(/^\/+/, '')
    if (!database) {
      throw new Error('DATABASE_URL 缺少数据库名称')
    }

    const adminUrl = new URL(url)
    adminUrl.pathname = '/postgres'

    return {
      user: decodeURIComponent(parsedUrl.username),
      password: decodeURIComponent(parsedUrl.password),
      host: parsedUrl.hostname,
      port: parsedUrl.port || '5432',
      database,
      adminUrl: adminUrl.toString(),
    }
  } catch (error) {
    console.error('❌ 解析 DATABASE_URL 失败:', error)
    process.exit(1)
  }
}

const dbConfig = parseDatabaseUrl(DATABASE_URL)

function getExecErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'stderr' in error &&
    Buffer.isBuffer((error as { stderr?: unknown }).stderr)
  ) {
    return ((error as { stderr: Buffer }).stderr.toString() || '').trim()
  }

  return error instanceof Error ? error.message : String(error)
}

function runPrismaCommand(
  args: string[],
  options?: { stdio?: 'inherit' | 'pipe'; input?: string }
) {
  execFileSync(npxCommand, ['prisma', ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: options?.stdio ?? 'inherit',
    input: options?.input,
  })
}

// 检查数据库名称是否包含 "test"
if (!dbConfig.database.includes('test')) {
  console.error('❌ 安全检查失败：数据库名称必须包含 "test"')
  console.error(`当前数据库名称: ${dbConfig.database}`)
  console.error('这可以防止意外操作生产或开发数据库')
  process.exit(1)
}

console.log('========================================')
console.log('测试数据库初始化脚本')
console.log('========================================')
console.log(`数据库主机: ${dbConfig.host}:${dbConfig.port}`)
console.log(`数据库名称: ${dbConfig.database}`)
console.log('========================================\n')

// 创建数据库（如果不存在）
function createDatabaseIfNotExists() {
  console.log('📦 步骤 1: 检查并创建测试数据库...')

  try {
    const escapedDatabaseName = dbConfig.database.replace(/"/g, '""')

    console.log(`📝 创建数据库 "${dbConfig.database}"（若不存在）...`)
    runPrismaCommand(['db', 'execute', '--stdin', '--url', dbConfig.adminUrl], {
      stdio: 'pipe',
      input: `CREATE DATABASE "${escapedDatabaseName}";`,
    })
    console.log(`✅ 数据库 "${dbConfig.database}" 创建成功\n`)
  } catch (error) {
    const message = getExecErrorMessage(error)
    if (message.includes('already exists')) {
      console.log(`✅ 数据库 "${dbConfig.database}" 已存在\n`)
      return
    }

    console.error('❌ 创建数据库失败:', error)
    console.error('\n请确保：')
    console.error('1. PostgreSQL 服务正在运行')
    console.error('2. 数据库用户有创建数据库的权限')
    console.error('3. 能够连接到 postgres 管理库')
    process.exit(1)
  }
}

// 运行数据库迁移
function runMigrations() {
  console.log('📦 步骤 2: 运行数据库迁移...')

  try {
    runPrismaCommand(['migrate', 'deploy'])
    console.log('✅ 数据库迁移完成\n')
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error)
    process.exit(1)
  }
}

// 生成 Prisma Client
function generatePrismaClient() {
  console.log('📦 步骤 3: 生成 Prisma Client...')

  try {
    runPrismaCommand(['generate'])
    console.log('✅ Prisma Client 生成完成\n')
  } catch (error) {
    console.error('❌ Prisma Client 生成失败:', error)
    process.exit(1)
  }
}

// 可选：运行种子数据
function runSeed() {
  const shouldSeed = process.argv.includes('--seed')

  if (!shouldSeed) {
    console.log('ℹ️  跳过种子数据（使用 --seed 参数运行种子数据）\n')
    return
  }

  console.log('📦 步骤 4: 运行种子数据...')

  try {
    runPrismaCommand(['db', 'seed'])
    console.log('✅ 种子数据完成\n')
  } catch (error) {
    console.error('❌ 种子数据失败:', error)
    process.exit(1)
  }
}

// 主函数
async function main() {
  try {
    createDatabaseIfNotExists()
    generatePrismaClient()
    runMigrations()
    runSeed()

    console.log('========================================')
    console.log('✅ 测试数据库初始化完成！')
    console.log('========================================')
    console.log('\n下一步：')
    console.log('  - 运行测试: npm run test')
    console.log('  - 运行测试（监视模式）: npm run test:watch')
    console.log('  - 清理测试数据库: npm run test:db:cleanup\n')
  } catch (error) {
    console.error('❌ 初始化失败:', error)
    process.exit(1)
  }
}

main()
