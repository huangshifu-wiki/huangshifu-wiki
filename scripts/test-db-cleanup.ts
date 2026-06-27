#!/usr/bin/env tsx
/**
 * 测试数据库清理脚本
 *
 * 功能：
 * 1. 安全检查：确保只清理测试数据库
 * 2. 删除所有数据（保留表结构）
 * 3. 可选：完全删除数据库
 *
 * 使用方法：
 *   npm run test:db:cleanup
 *   或者：tsx scripts/test-db-cleanup.ts
 *
 * 参数：
 *   --drop-db: 完全删除数据库（危险操作）
 *   --force: 跳过确认提示
 *
 * 环境变量：
 *   - 从 .env.test 文件加载测试数据库配置
 */

import dotenv from 'dotenv';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 只加载测试环境变量，避免被 .env.local / .env 覆盖 DATABASE_URL
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
process.env.DOTENV_CONFIG_QUIET = 'true';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ 错误：未找到 DATABASE_URL 环境变量');
  console.error('请确保 .env.test 文件存在并包含 DATABASE_URL');
  process.exit(1);
}

// 解析数据库连接信息
function parseDatabaseUrl(url: string) {
  try {
    const regex = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
    const match = url.match(regex);

    if (!match) {
      throw new Error('无法解析 DATABASE_URL');
    }

    return {
      user: match[1],
      password: match[2],
      host: match[3],
      port: match[4],
      database: match[5],
    };
  } catch (error) {
    console.error('❌ 解析 DATABASE_URL 失败:', error);
    process.exit(1);
  }
}

const dbConfig = parseDatabaseUrl(DATABASE_URL);
const escapedDatabaseName = dbConfig.database.replace(/'/g, "''");

// 安全检查：数据库名称必须明确匹配测试环境命名约定
const isAllowedTestDatabase =
  dbConfig.database === 'huangshifu_wiki_test' ||
  dbConfig.database.startsWith('hsf_test_') ||
  dbConfig.database.endsWith('_test');

if (!isAllowedTestDatabase) {
  console.error('❌ 安全检查失败：数据库名称必须是受允许的测试数据库命名');
  console.error(`当前数据库名称: ${dbConfig.database}`);
  console.error('这可以防止意外清理生产或开发数据库');
  process.exit(1);
}

const shouldDropDb = process.argv.includes('--drop-db');
const shouldForce = process.argv.includes('--force');

console.log('========================================');
console.log('测试数据库清理脚本');
console.log('========================================');
console.log(`数据库主机: ${dbConfig.host}:${dbConfig.port}`);
console.log(`数据库名称: ${dbConfig.database}`);
console.log(`操作类型: ${shouldDropDb ? '删除数据库' : '清空数据'}`);
console.log('========================================\n');

// 用户确认
async function confirmAction(): Promise<boolean> {
  if (shouldForce) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const action = shouldDropDb ? '删除数据库' : '清空所有数据';
    rl.question(`⚠️  确定要${action}吗？此操作不可逆！(yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

// 清空所有表数据（保留表结构）
async function truncateAllTables() {
  console.log('📦 清空所有表数据...\n');

  try {
    // 使用 Prisma 的 executeRaw 来清空所有表
    // 注意：这需要按依赖顺序清空表

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    // 获取所有表名
    const tables: Array<{ tablename: string }> = await prisma.$queryRaw`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `;

    console.log(`找到 ${tables.length} 个表`);

    // 禁用外键检查，清空所有表
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);

    for (const { tablename } of tables) {
      console.log(`  清空表: ${tablename}`);
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
    }

    // 重新启用外键检查
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);

    await prisma.$disconnect();

    console.log('\n✅ 所有表数据已清空\n');
  } catch (error) {
    console.error('❌ 清空表数据失败:', error);
    process.exit(1);
  }
}

// 删除数据库
async function dropDatabase() {
  console.log('📦 删除测试数据库...\n');

  try {
    // 断开所有连接
    execFileSync('psql', [
      '-h', dbConfig.host,
      '-p', dbConfig.port,
      '-U', dbConfig.user,
      '-d', 'postgres',
      '-c', `SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '${escapedDatabaseName}' AND pid <> pg_backend_pid();`,
    ], {
      env: { ...process.env, PGPASSWORD: dbConfig.password },
      stdio: 'pipe',
    });

    // 删除数据库
    execFileSync('dropdb', [
      '-h', dbConfig.host,
      '-p', dbConfig.port,
      '-U', dbConfig.user,
      dbConfig.database,
    ], {
      env: { ...process.env, PGPASSWORD: dbConfig.password },
      stdio: 'inherit',
    });

    console.log(`\n✅ 数据库 "${dbConfig.database}" 已删除\n`);
  } catch (error) {
    console.error('❌ 删除数据库失败:', error);
    console.error('\n请确保：');
    console.error('1. PostgreSQL 服务正在运行');
    console.error('2. 数据库用户有删除数据库的权限');
    console.error('3. 没有其他连接正在使用该数据库');
    process.exit(1);
  }
}

// 主函数
async function main() {
  try {
    const confirmed = await confirmAction();

    if (!confirmed) {
      console.log('❌ 操作已取消\n');
      process.exit(0);
    }

    if (shouldDropDb) {
      await dropDatabase();
    } else {
      await truncateAllTables();
    }

    console.log('========================================');
    console.log('✅ 测试数据库清理完成！');
    console.log('========================================');

    if (!shouldDropDb) {
      console.log('\n提示：');
      console.log('  - 数据库表结构保留，仅清空数据');
      console.log('  - 使用 --drop-db 参数可以完全删除数据库');
      console.log('  - 使用 npm run test:db:init 重新初始化\n');
    }
  } catch (error) {
    console.error('❌ 清理失败:', error);
    process.exit(1);
  }
}

main();
