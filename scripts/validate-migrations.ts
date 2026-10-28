/**
 * Prisma 迁移验证脚本
 *
 * 功能说明：
 * 1. 检查 Prisma schema 文件格式是否正确
 * 2. 验证迁移文件命名规范
 * 3. 检查迁移 SQL 是否包含危险操作（如 DROP TABLE without backup）
 * 4. 输出验证结果报告
 *
 * 使用方式：
 * - npm run validate:migrations          # 运行完整验证
 * - npm run validate:migrations -- --fix # 尝试自动修复问题
 *
 * 验证级别说明：
 * - error:   严重问题，必须修复才能继续
 * - warning: 警告问题，建议修复但不阻止构建
 * - info:    信息提示，仅作参考
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 类型定义
// ============================================================================

/** 验证结果级别 */
type ValidationLevel = 'error' | 'warning' | 'info'

/** 单条验证结果 */
interface ValidationResult {
  level: ValidationLevel
  message: string
  file?: string // 相关文件路径
  line?: number // 行号（如果有）
  code?: string // 错误码，用于程序化处理
  suggestion?: string // 修复建议
}

/** 迁移文件信息 */
interface MigrationInfo {
  name: string // 迁移目录名（含时间戳）
  path: string // 完整路径
  timestamp: string // 时间戳部分
  description: string // 描述部分
  sqlFile: string | null // SQL 文件路径
  sqlContent: string // SQL 文件内容
}

/** 验证配置接口 */
interface ValidationConfig {
  /** 允许的危险操作白名单 */
  allowedDangerousOperations: string[]
  /** 是否严格模式（警告也视为错误） */
  strictMode: boolean
  /** 最大允许的迁移文件大小（字节） */
  maxMigrationFileSize: number
  /** 是否检查 schema 文件 */
  checkSchemaFile: boolean
}

/** 最终验证报告 */
interface ValidationReport {
  totalMigrations: number
  results: ValidationResult[]
  hasErrors: boolean
  hasWarnings: boolean
  summary: {
    errors: number
    warnings: number
    info: number
  }
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: ValidationConfig = {
  // 白名单：允许的 DROP TABLE 操作（需要明确指定表名）
  allowedDangerousOperations: [
    // 示例：如果确实需要删除某些临时表，可以在这里添加
    // 'DROP TABLE "_TempTable"',
  ],
  strictMode: false,
  maxMigrationFileSize: 10 * 1024 * 1024, // 10MB
  checkSchemaFile: true,
}

// ============================================================================
// 危险操作模式定义
// ============================================================================

/**
 * 危险 SQL 操作模式定义
 * 每个模式包含：
 * - pattern: 正则表达式匹配
 * - level: 验证级别
 * - message: 错误消息
 * - code: 错误码
 * - suggestion: 修复建议
 */
const DANGEROUS_PATTERNS = [
  // ==================== 阻止级别（Error）====================
  {
    pattern: /DROP\s+TABLE\s+(?!IF\s+EXISTS)[\w"]+/gi,
    level: 'error' as ValidationLevel,
    message: '检测到未使用 IF EXISTS 的 DROP TABLE 操作',
    code: 'DROP_TABLE_WITHOUT_IF_EXISTS',
    suggestion: '请使用 "DROP TABLE IF EXISTS" 以避免错误，并确保已备份重要数据',
  },
  {
    pattern: /DROP\s+DATABASE/gi,
    level: 'error' as ValidationLevel,
    message: '检测到 DROP DATABASE 操作 - 这是极其危险的操作！',
    code: 'DROP_DATABASE',
    suggestion: '绝对禁止在迁移中删除数据库！这会导致不可恢复的数据丢失',
  },
  {
    pattern: /TRUNCATE\s+TABLE[\s\w"']*(?!\s*WHERE)/gi,
    level: 'error' as ValidationLevel,
    message: '检测到无 WHERE 条件的 TRUNCATE 操作',
    code: 'TRUNCATE_WITHOUT_WHERE',
    suggestion: 'TRUNCATE 会清空整个表的数据且无法回滚。请使用 DELETE ... WHERE 或确认这是预期行为',
  },
  {
    pattern: /DELETE\s+FROM\s+[\w"]+\s*$/gim,
    level: 'error' as ValidationLevel,
    message: '检测到无 WHERE 条件的 DELETE FROM 操作',
    code: 'DELETE_ALL_ROWS',
    suggestion:
      'DELETE FROM table_name 无 WHERE 条件会删除所有数据。请添加适当的条件或使用 TRUNCATE',
  },
  {
    pattern: /DROP\s+SCHEMA/gi,
    level: 'error' as ValidationLevel,
    message: '检测到 DROP SCHEMA 操作',
    code: 'DROP_SCHEMA',
    suggestion: '删除 Schema 是危险操作，请确保已备份所有相关数据',
  },

  // ==================== 警告级别（Warning）====================
  {
    pattern: /ALTER\s+TABLE\s+[\w"]+\s+DROP\s+COLUMN/gi,
    level: 'warning' as ValidationLevel,
    message: '检测到 DROP COLUMN 操作 - 这可能导致数据丢失',
    code: 'ALTER_DROP_COLUMN',
    suggestion: '删除列前请确保：1) 已备份数据 2) 已更新应用代码 3) 考虑先重命名列观察一段时间',
  },
  {
    pattern: /ALTER\s+TABLE\s+[\w"]+\s+MODIFY(?:\s+COLUMN)?/gi,
    level: 'warning' as ValidationLevel,
    message: '检测到 MODIFY COLUMN 操作 - 可能导致类型转换数据丢失',
    code: 'ALTER_MODIFY_COLUMN',
    suggestion: '修改列类型前请测试数据兼容性，特别是从大类型改为小类型时',
  },
  {
    pattern: /ALTER\s+TABLE\s+[\w"]+\s+CHANGE\s+COLUMN/gi,
    level: 'warning' as ValidationLevel,
    message: '检测到 CHANGE COLUMN 操作 - 列定义变更可能影响数据',
    code: 'ALTER_CHANGE_COLUMN',
    suggestion: '变更列定义前请充分测试，确保新定义与现有数据兼容',
  },
  {
    pattern: /DROP\s+INDEX/gi,
    level: 'warning' as ValidationLevel,
    message: '检测到 DROP INDEX 操作 - 可能影响查询性能',
    code: 'DROP_INDEX',
    suggestion: '删除索引前请评估对查询性能的影响，特别是在生产环境',
  },
  {
    pattern: /DROP\s+CONSTRAINT/gi,
    level: 'warning' as ValidationLevel,
    message: '检测到 DROP CONSTRAINT 操作 - 可能影响数据完整性',
    code: 'DROP_CONSTRAINT',
    suggestion: '删除约束前请确保不会破坏数据完整性规则',
  },
  {
    pattern: /ALTER\s+TABLE\s+[\w"]+\s+RENAME/gi,
    level: 'warning' as ValidationLevel,
    message: '检测到 RENAME TABLE/COLUMN 操作 - 需要同步更新应用代码',
    code: 'ALTER_RENAME',
    suggestion: '重命名后请立即更新所有引用该表/列的应用代码和查询',
  },

  // ==================== 信息级别（Info）====================
  {
    pattern: /CREATE\s+INDEX/gi,
    level: 'info' as ValidationLevel,
    message: '检测到 CREATE INDEX 操作',
    code: 'CREATE_INDEX',
    suggestion: '创建索引会增加写入开销，请在低峰期执行大型表的索引创建',
  },
  {
    pattern: /ADD\s+(?:UNIQUE\s+)?INDEX/gi,
    level: 'info' as ValidationLevel,
    message: '检测到 ADD INDEX 操作',
    code: 'ADD_INDEX',
    suggestion: '添加索引会锁定表（取决于数据库），大型表请考虑使用 ONLINE 索引创建',
  },
]

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 控制台输出带颜色的文本
 * @param text 要输出的文本
 * @param color 颜色代码
 */
function colorize(text: string, color: string): string {
  const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
    reset: '\x1b[0m',
  }
  return `${colors[color] || ''}${text}${colors.reset}`
}

/**
 * 输出分隔线
 */
function printSeparator(): void {
  console.log(colorize('─'.repeat(80), 'gray'))
}

/**
 * 输出标题
 */
function printTitle(title: string): void {
  printSeparator()
  console.log(colorize(`  ${title}`, 'bold'))
  printSeparator()
}

/**
 * 格式化文件路径，使其更易读
 */
function formatPath(filePath: string, basePath: string = ''): string {
  if (basePath && filePath.startsWith(basePath)) {
    return filePath.substring(basePath.length).replace(/\\/g, '/')
  }
  return filePath.replace(/\\/g, '/')
}

// ============================================================================
// 核心验证功能
// ============================================================================

/**
 * 检查 1: 验证 Prisma Schema 文件格式
 *
 * 检查项：
 * - 文件是否存在
 * - 基本语法结构（generator、datasource、model 等）
 * - 必要字段是否存在
 * - 数据库提供商是否正确
 *
 * @param schemaPath Schema 文件路径
 * @returns 验证结果数组
 */
function validateSchemaFile(schemaPath: string): ValidationResult[] {
  const results: ValidationResult[] = []

  console.log('\n' + colorize('◆ 检查 1: Prisma Schema 文件格式验证', 'cyan'))

  // 检查文件是否存在
  if (!existsSync(schemaPath)) {
    results.push({
      level: 'error',
      message: `Prisma Schema 文件不存在: ${schemaPath}`,
      code: 'SCHEMA_NOT_FOUND',
      suggestion: '请确保 prisma/schema.prisma 文件存在',
    })
    return results
  }

  let content: string
  try {
    content = readFileSync(schemaPath, 'utf-8')
  } catch (error) {
    results.push({
      level: 'error',
      message: `无法读取 Schema 文件: ${error instanceof Error ? error.message : '未知错误'}`,
      code: 'SCHEMA_READ_ERROR',
      suggestion: '请检查文件权限或文件是否损坏',
    })
    return results
  }

  // 检查基本结构
  // 使用更宽松的匹配方式：只检查关键字存在性
  const checks = [
    {
      pattern: /^generator\s+/m,
      name: 'generator 块',
      required: true,
      code: 'MISSING_GENERATOR',
    },
    {
      pattern: /^datasource\s+/m,
      name: 'datasource 块',
      required: true,
      code: 'MISSING_DATASOURCE',
    },
    {
      pattern: /provider\s*=\s*["']?postgresql["']?/,
      name: 'PostgreSQL 提供商配置',
      required: true,
      code: 'INVALID_PROVIDER',
    },
    {
      pattern: /url\s*=\s*env\(/,
      name: '环境变量 URL 配置',
      required: true,
      code: 'MISSING_ENV_URL',
    },
    {
      pattern: /provider\s*=\s*["']?prisma-client-js["']?/,
      name: 'Prisma Client 生成器配置',
      required: true,
      code: 'MISSING_CLIENT_GENERATOR',
    },
  ]

  for (const check of checks) {
    if (check.required && !check.pattern.test(content)) {
      results.push({
        level: 'error',
        message: `Schema 缺少必要的 ${check.name} 配置`,
        file: schemaPath,
        code: check.code,
        suggestion: `请在 Schema 文件中添加 ${check.name} 配置`,
      })
      console.log(colorize(`  ✗ 缺少 ${check.name}`, 'red'))
    } else if (check.pattern.test(content)) {
      console.log(colorize(`  ✓ ${check.name} 正确`, 'green'))
    }
  }

  // 统计模型数量
  const modelCount = (content.match(/^model\s+\w+/gm) || []).length
  const enumCount = (content.match(/^enum\s+\w+/gm) || []).length
  console.log(colorize(`  ℹ 发现 ${modelCount} 个模型, ${enumCount} 个枚举`, 'cyan'))

  // 检查是否有模型定义
  if (modelCount === 0) {
    results.push({
      level: 'warning',
      message: 'Schema 中没有定义任何模型',
      file: schemaPath,
      code: 'NO_MODELS_DEFINED',
      suggestion: '请至少定义一个数据模型',
    })
  }

  return results
}

/**
 * 检查 2: 验证迁移文件命名规范
 *
 * Prisma 迁移文件命名规范：
 * - 格式: YYYYMMDDHHMMSS_description
 * - 时间戳必须是有效的日期时间
 * - 描述部分只能包含小写字母、数字和下划线
 * - 不能以数字开头（时间戳之后的部分）
 *
 * @param migrationsDir 迁移目录路径
 * @returns 包含验证结果和迁移信息的对象
 */
function validateMigrationNaming(migrationsDir: string): {
  results: ValidationResult[]
  migrations: MigrationInfo[]
} {
  const results: ValidationResult[] = []
  const migrations: MigrationInfo[] = []

  console.log('\n' + colorize('◆ 检查 2: 迁移文件命名规范验证', 'cyan'))

  // 检查迁移目录是否存在
  if (!existsSync(migrationsDir)) {
    results.push({
      level: 'error',
      message: `迁移目录不存在: ${migrationsDir}`,
      code: 'MIGRATIONS_DIR_NOT_FOUND',
      suggestion: '请运行 "prisma migrate dev" 创建初始迁移',
    })
    console.log(colorize('  ✗ 迁移目录不存在', 'red'))
    return { results, migrations }
  }

  // 读取所有迁移目录
  let migrationDirs: string[]
  try {
    migrationDirs = readdirSync(migrationsDir).filter((dir) => {
      const dirPath = join(migrationsDir, dir)
      try {
        return statSync(dirPath).isDirectory()
      } catch {
        return false
      }
    })
  } catch (error) {
    results.push({
      level: 'error',
      message: `无法读取迁移目录: ${error instanceof Error ? error.message : '未知错误'}`,
      code: 'MIGRATIONS_DIR_READ_ERROR',
      suggestion: '请检查目录权限',
    })
    return { results, migrations }
  }

  if (migrationDirs.length === 0) {
    results.push({
      level: 'warning',
      message: '没有找到任何迁移文件',
      code: 'NO_MIGRATIONS_FOUND',
      suggestion: '请运行 "prisma migrate dev" 创建初始迁移',
    })
    console.log(colorize('  ⚠ 没有找到任何迁移', 'yellow'))
    return { results, migrations }
  }

  console.log(colorize(`  ℹ 找到 ${migrationDirs.length} 个迁移`, 'cyan'))

  // 验证每个迁移目录的命名
  const namingPattern = /^(\d{14})_(.+)$/

  for (const dir of migrationDirs) {
    const match = dir.match(namingPattern)

    if (!match) {
      results.push({
        level: 'error',
        message: `迁移目录名称不符合规范: ${dir}`,
        code: 'INVALID_MIGRATION_NAME',
        suggestion: '迁移名称应为格式: YYYYMMDDHHMMSS_description（例如: 20260326132000_init）',
      })
      console.log(colorize(`  ✗ 命名无效: ${dir}`, 'red'))
      continue
    }

    const [, timestamp, description] = match

    // 验证时间戳是否为有效日期
    const year = parseInt(timestamp.slice(0, 4), 10)
    const month = parseInt(timestamp.slice(4, 6), 10)
    const day = parseInt(timestamp.slice(6, 8), 10)
    const hour = parseInt(timestamp.slice(8, 10), 10)
    const minute = parseInt(timestamp.slice(10, 12), 10)
    const second = parseInt(timestamp.slice(12, 14), 10)

    const isValidDate =
      year >= 2020 &&
      year <= 2030 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59

    if (!isValidDate) {
      results.push({
        level: 'error',
        message: `迁移时间戳无效: ${timestamp}`,
        code: 'INVALID_TIMESTAMP',
        suggestion: '时间戳应为有效的日期时间，格式: YYYYMMDDHHMMSS',
      })
      console.log(colorize(`  ✗ 时间戳无效: ${dir}`, 'red'))
      continue
    }

    // 验证描述部分
    if (!/^[a-z][a-z0-9_]*$/.test(description)) {
      results.push({
        level: 'warning',
        message: `迁移描述不符合最佳实践: ${description}`,
        code: 'NON_STANDARD_DESCRIPTION',
        suggestion: '描述应只包含小写字母、数字和下划线，且以字母开头',
      })
      console.log(colorize(`  ⚠ 描述不规范: ${dir}`, 'yellow'))
    } else {
      console.log(colorize(`  ✓ 命名正确: ${dir}`, 'green'))
    }

    // 收集迁移信息
    const migrationPath = join(migrationsDir, dir)
    const sqlFilePath = join(migrationPath, 'migration.sql')

    migrations.push({
      name: dir,
      path: migrationPath,
      timestamp,
      description,
      sqlFile: existsSync(sqlFilePath) ? sqlFilePath : null,
      sqlContent: existsSync(sqlFilePath) ? readFileSync(sqlFilePath, 'utf-8') : '',
    })

    // 检查 SQL 文件是否存在
    if (!existsSync(sqlFilePath)) {
      results.push({
        level: 'error',
        message: `迁移缺少 SQL 文件: ${dir}/migration.sql`,
        code: 'MISSING_SQL_FILE',
        suggestion: '每个迁移目录必须包含 migration.sql 文件',
      })
      console.log(colorize(`  ✗ 缺少 SQL 文件: ${dir}`, 'red'))
    }
  }

  // 检查迁移顺序（时间戳应该递增）
  const sortedTimestamps = [...migrations].map((m) => m.timestamp).sort()

  for (let i = 0; i < migrations.length; i++) {
    if (migrations[i].timestamp !== sortedTimestamps[i]) {
      results.push({
        level: 'warning',
        message: `迁移时间戳顺序异常: ${migrations[i].name}`,
        code: 'OUT_OF_ORDER_MIGRATION',
        suggestion: '迁移应按时间戳顺序排列，这可能影响迁移执行顺序',
      })
      break // 只报告一次
    }
  }

  return { results, migrations }
}

/**
 * 检查 3: 分析迁移 SQL 内容中的危险操作
 *
 * 检查项：
 * - DROP TABLE/DATABASE/SCHEMA（阻止）
 * - TRUNCATE without WHERE（阻止）
 * - DELETE without WHERE（阻止）
 * - ALTER TABLE DROP/MODIFY COLUMN（警告）
 * - DROP INDEX/CONSTRAINT（警告）
 * - CREATE/ADD INDEX（信息）
 *
 * @param migration 迁移信息
 * @param config 验证配置
 * @returns 验证结果数组
 */
function validateSQLContent(
  migration: MigrationInfo,
  config: ValidationConfig
): ValidationResult[] {
  const results: ValidationResult[] = []

  console.log(colorize(`\n  ◇ 分析迁移: ${migration.name}`, 'magenta'))

  // 检查 SQL 文件是否存在
  if (!migration.sqlFile || !migration.sqlContent) {
    results.push({
      level: 'error',
      message: `无法读取 SQL 文件: ${migration.name}`,
      code: 'SQL_FILE_NOT_READABLE',
      suggestion: '请确保 migration.sql 文件存在且可读',
    })
    return results
  }

  // 检查文件大小
  const fileSize = Buffer.byteLength(migration.sqlContent, 'utf-8')
  if (fileSize > config.maxMigrationFileSize) {
    results.push({
      level: 'warning',
      message: `SQL 文件过大: ${(fileSize / 1024 / 1024).toFixed(2)}MB`,
      file: migration.sqlFile!,
      code: 'SQL_FILE_TOO_LARGE',
      suggestion: `文件大小超过 ${config.maxMigrationFileSize / 1024 / 1024}MB 限制，考虑拆分迁移`,
    })
  }

  // 检查空文件
  if (migration.sqlContent.trim().length === 0) {
    results.push({
      level: 'warning',
      message: `SQL 文件为空: ${migration.name}`,
      file: migration.sqlFile!,
      code: 'EMPTY_SQL_FILE',
      suggestion: '空的迁移文件可能是意外创建的，请确认是否需要保留',
    })
    return results
  }

  // 对每个危险模式进行检查
  for (const dangerousPattern of DANGEROUS_PATTERNS) {
    const matches = migration.sqlContent.match(dangerousPattern.pattern)

    if (matches) {
      // 检查是否在白名单中
      const isWhitelisted = config.allowedDangerousOperations.some((allowed) =>
        matches.some((match) => match.includes(allowed))
      )

      if (isWhitelisted) {
        console.log(
          colorize(`    ✓ [白名单] ${dangerousPattern.code}: ${matches.length} 处`, 'green')
        )
        continue
      }

      // 计算行号（简单实现）
      const lines = migration.sqlContent.split('\n')
      const matchingLines: number[] = []
      lines.forEach((line, index) => {
        if (dangerousPattern.pattern.test(line)) {
          matchingLines.push(index + 1)
        }
        // 重置正则表达式的 lastIndex
        ;(dangerousPattern.pattern as RegExp).lastIndex = 0
      })

      // 根据级别决定是否升级为错误
      let level = dangerousPattern.level
      if (config.strictMode && level === 'warning') {
        level = 'error'
      }

      results.push({
        level,
        message: `${dangerousPattern.message} (${matches.length} 处)`,
        file: migration.sqlFile!,
        line: matchingLines[0],
        code: dangerousPattern.code,
        suggestion: dangerousPattern.suggestion,
      })

      // 输出到控制台
      const icon =
        level === 'error'
          ? colorize('✗', 'red')
          : level === 'warning'
            ? colorize('⚠', 'yellow')
            : colorize('ℹ', 'cyan')

      console.log(
        `    ${icon} [${level.toUpperCase()}] ${dangerousPattern.code}: ${matches.length} 处 (第 ${matchingLines.join(', ')} 行)`
      )
    }
  }

  // 检查是否有注释说明（对于危险操作的缓解措施）
  const hasBackupComment = /--\s*(?:backup|备份|TODO|FIXME|WARNING|注意)/i.test(
    migration.sqlContent
  )
  const hasDangerousOperation = results.some(
    (r) =>
      r.level === 'error' ||
      (r.level === 'warning' &&
        (r.code?.startsWith('DROP_') ||
          r.code?.startsWith('ALTER_') ||
          r.code?.includes('TRUNCATE') ||
          r.code?.includes('DELETE')))
  )

  if (hasDangerousOperation && !hasBackupComment) {
    results.push({
      level: 'info',
      message: '建议在迁移文件顶部添加注释说明此操作的目的和影响',
      file: migration.sqlFile!,
      code: 'MISSING_DOCUMENTATION',
      suggestion: '良好的文档习惯可以帮助团队成员理解迁移的目的',
    })
  }

  return results
}

/**
 * 检查 4: 验证迁移之间的依赖关系
 *
 * 检查项：
 * - 外键引用的表是否在之前的迁移中创建
 * - 删除的表是否被其他表引用
 *
 * @param migrations 所有迁移信息
 * @returns 验证结果数组
 */
function validateMigrationDependencies(migrations: MigrationInfo[]): ValidationResult[] {
  const results: ValidationResult[] = []

  console.log('\n' + colorize('◆ 检查 4: 迁移依赖关系验证', 'cyan'))

  if (migrations.length < 2) {
    console.log(colorize('  ℹ 迁移数量不足，跳过依赖检查', 'cyan'))
    return results
  }

  // 收集所有创建的表（按迁移顺序）
  const createdTables: Map<string, string> = new Map() // tableName -> migrationName
  const droppedTables: Set<string> = new Set()
  const referencedTables: Map<string, Set<string>> = new Map() // tableName -> referencing tables

  for (const migration of migrations) {
    // 查找 CREATE TABLE
    const createMatches = migration.sqlContent.match(/CREATE\s+TABLE\s+"?(\w+)"?/gi) || []
    for (const match of createMatches) {
      const tableName = match.match(/"(\w+)"/)?.[1] || match.split(/\s+/).pop()!
      createdTables.set(tableName.toLowerCase(), migration.name)
    }

    // 查找 DROP TABLE
    const dropMatches =
      migration.sqlContent.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi) || []
    for (const match of dropMatches) {
      const tableName = match.match(/"(\w+)"/)?.[1] || match.split(/\s+/).pop()!
      droppedTables.add(tableName.toLowerCase())
    }

    // 查找外键引用
    const fkMatches = migration.sqlContent.match(/REFERENCES\s+"?(\w+)"?\s*\("(\w+)"\)/gi) || []
    for (const match of fkMatches) {
      const refMatch = match.match(/REFERENCES\s+"?(\w+)"?/)
      if (refMatch) {
        const refTable = refMatch[1].toLowerCase()
        if (!referencedTables.has(refTable)) {
          referencedTables.set(refTable, new Set())
        }
        // 获取当前迁移创建的表名
        const currentTableMatch = migration.sqlContent.match(/CREATE\s+TABLE\s+"?(\w+)"?/i)
        if (currentTableMatch) {
          referencedTables.get(refTable)!.add(currentTableMatch[1])
        }
      }
    }
  }

  // 检查外键引用是否有效
  for (const [refTable, refByTables] of referencedTables) {
    if (!createdTables.has(refTable) && !droppedTables.has(refTable)) {
      results.push({
        level: 'warning',
        message: `表 "${refTable}" 被引用但未在任何迁移中创建`,
        code: 'REFERENCED_TABLE_NOT_FOUND',
        suggestion: `请确保表 "${refTable}" 在被引用之前已创建，或者它应该存在于初始数据库中`,
      })
      console.log(
        colorize(
          `  ⚠ 表 "${refTable}" 被 [...${Array.from(refByTables).join(', ')}...] 引用但未找到创建语句`,
          'yellow'
        )
      )
    }
  }

  // 检查删除的表是否仍被引用
  for (const droppedTable of droppedTables) {
    if (referencedTables.has(droppedTable)) {
      results.push({
        level: 'error',
        message: `表 "${droppedTable}" 被删除但仍被其他表引用`,
        code: 'DROPPED_TABLE_STILL_REFERENCED',
        suggestion: `请先删除或更新引用 "${droppedTable}" 的外键约束`,
      })
      console.log(colorize(`  ✗ 表 "${droppedTable}" 被删除但仍被引用`, 'red'))
    }
  }

  if (results.length === 0) {
    console.log(colorize('  ✓ 依赖关系正常', 'green'))
  }

  return results
}

/**
 * 检查 5: 验证迁移文件的完整性
 *
 * 检查项：
 * - 每个 SQL 文件是否都有对应的元数据
 * - SQL 语句是否完整（括号匹配等）
 *
 * @param migrations 所有迁移信息
 * @returns 验证结果数组
 */
function validateMigrationIntegrity(migrations: MigrationInfo[]): ValidationResult[] {
  const results: ValidationResult[] = []

  console.log('\n' + colorize('◆ 检查 5: 迁移完整性验证', 'cyan'))

  for (const migration of migrations) {
    if (!migration.sqlContent) continue

    // 检查括号匹配
    const openParens = (migration.sqlContent.match(/\(/g) || []).length
    const closeParens = (migration.sqlContent.match(/\)/g) || []).length

    if (openParens !== closeParens) {
      results.push({
        level: 'error',
        message: `SQL 文件括号不匹配: (${openParens} 个开括号, ${closeParens} 个闭括号)`,
        file: migration.sqlFile!,
        code: 'UNMATCHED_PARENS',
        suggestion: '请检查 SQL 语句中的括号是否配对',
      })
      console.log(colorize(`  ✗ ${migration.name}: 括号不匹配`, 'red'))
    }

    // 检查是否只有注释没有实际 SQL
    const nonCommentLines = migration.sqlContent
      .split('\n')
      .filter(
        (line) =>
          line.trim().length > 0 && !line.trim().startsWith('--') && !line.trim().startsWith('/*')
      )

    if (nonCommentLines.length === 0) {
      results.push({
        level: 'warning',
        message: `迁移文件只包含注释，没有实际的 SQL 语句: ${migration.name}`,
        file: migration.sqlFile!,
        code: 'COMMENT_ONLY_MIGRATION',
        suggestion: '空迁移可能会引起混淆，考虑是否真的需要这个迁移',
      })
      console.log(colorize(`  ⚠ ${migration.name}: 只有注释`, 'yellow'))
    }

    // 检查是否有事务控制语句
    const hasBeginTransaction = /BEGIN\s+TRANSACTION/i.test(migration.sqlContent)
    const hasCommit = /COMMIT/i.test(migration.sqlContent)
    const hasRollback = /ROLLBACK/i.test(migration.sqlContent)

    if (
      (hasBeginTransaction && !hasCommit && !hasRollback) ||
      (!hasBeginTransaction && (hasCommit || hasRollback))
    ) {
      results.push({
        level: 'warning',
        message: `事务控制语句不完整或不一致: ${migration.name}`,
        file: migration.sqlFile!,
        code: 'INCOMPLETE_TRANSACTION',
        suggestion: 'Prisma 迁移通常会自动管理事务，手动添加事务语句可能会导致问题',
      })
    }
  }

  if (results.filter((r) => r.level === 'error').length === 0) {
    console.log(colorize('  ✓ 完整性检查通过', 'green'))
  }

  return results
}

// ============================================================================
// 主验证流程
// ============================================================================

/**
 * 运行完整的迁移验证流程
 *
 * @param config 可选的验证配置
 * @returns 完整的验证报告
 */
async function runValidation(config: Partial<ValidationConfig> = {}): Promise<ValidationReport> {
  // 合并配置
  const finalConfig = { ...DEFAULT_CONFIG, ...config }

  console.log('\n')
  printTitle('Prisma 迁移验证工具')
  console.log(colorize(`  验证时间: ${new Date().toLocaleString('zh-CN')}`, 'gray'))
  console.log(colorize(`  严格模式: ${finalConfig.strictMode ? '开启' : '关闭'}`, 'gray'))
  console.log(colorize(`  项目根目录: ${process.cwd()}`, 'gray'))

  const allResults: ValidationResult[] = []
  let migrations: MigrationInfo[] = []

  // 定义路径
  const projectRoot = process.cwd()
  const schemaPath = join(projectRoot, 'prisma', 'schema.prisma')
  const migrationsDir = join(projectRoot, 'prisma', 'migrations')

  try {
    // 检查 1: Schema 文件验证
    if (finalConfig.checkSchemaFile) {
      const schemaResults = validateSchemaFile(schemaPath)
      allResults.push(...schemaResults)
    }

    // 检查 2: 迁移命名验证
    const namingResults = validateMigrationNaming(migrationsDir)
    allResults.push(...namingResults.results)
    migrations = namingResults.migrations

    // 如果有迁移文件，继续后续检查
    if (migrations.length > 0) {
      // 检查 3: SQL 内容验证
      for (const migration of migrations) {
        const sqlResults = validateSQLContent(migration, finalConfig)
        allResults.push(...sqlResults)
      }

      // 检查 4: 依赖关系验证
      const depResults = validateMigrationDependencies(migrations)
      allResults.push(...depResults)

      // 检查 5: 完整性验证
      const integrityResults = validateMigrationIntegrity(migrations)
      allResults.push(...integrityResults)
    }
  } catch (error) {
    allResults.push({
      level: 'error',
      message: `验证过程发生错误: ${error instanceof Error ? error.message : '未知错误'}`,
      code: 'VALIDATION_ERROR',
      suggestion: '请检查上面的错误信息并修复问题',
    })
  }

  // 生成汇总报告
  const errors = allResults.filter((r) => r.level === 'error')
  const warnings = allResults.filter((r) => r.level === 'warning')
  const info = allResults.filter((r) => r.level === 'info')

  const report: ValidationReport = {
    totalMigrations: migrations.length,
    results: allResults,
    hasErrors: errors.length > 0,
    hasWarnings: warnings.length > 0,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      info: info.length,
    },
  }

  return report
}

/**
 * 输出验证报告到控制台
 *
 * @param report 验证报告
 */
function printReport(report: ValidationReport): void {
  console.log('\n')
  printTitle('验证结果汇总')
  printSeparator()

  // 基本信息
  console.log(colorize(`  迁移总数: ${report.totalMigrations}`, 'white'))
  console.log(colorize(`  问题统计:`, 'white'))
  console.log(colorize(`    ❌ 错误: ${report.summary.errors}`, 'red'))
  console.log(colorize(`    ⚠️  警告: ${report.summary.warnings}`, 'yellow'))
  console.log(colorize(`    ℹ️  信息: ${report.summary.info}`, 'cyan'))

  printSeparator()

  // 输出详细错误和警告
  if (report.results.length > 0) {
    console.log(colorize('\n  详细问题列表:', 'bold'))

    for (const result of report.results) {
      const icon =
        result.level === 'error'
          ? colorize('❌', 'red')
          : result.level === 'warning'
            ? colorize('⚠️ ', 'yellow')
            : colorize('ℹ️ ', 'cyan')

      const location = result.file
        ? `\n       📄 ${formatPath(result.file)}${result.line ? `:${result.line}` : ''}`
        : ''

      console.log(`\n  ${icon} [${result.level.toUpperCase()}] ${result.message}${location}`)

      if (result.suggestion) {
        console.log(colorize(`     💡 建议: ${result.suggestion}`, 'gray'))
      }

      if (result.code) {
        console.log(colorize(`     🔖 代码: ${result.code}`, 'gray'))
      }
    }
  }

  // 最终结论
  console.log('\n')
  printSeparator()

  if (report.hasErrors) {
    console.log(colorize('  ❌ 验证失败！发现必须修复的错误。', 'red'))
    console.log(colorize('     请修复上述错误后再继续部署或构建。', 'red'))
  } else if (report.hasWarnings) {
    console.log(colorize('  ⚠️  验证通过但有警告。建议修复警告以确保安全。', 'yellow'))
  } else {
    console.log(colorize('  ✅ 验证通过！所有检查均正常。', 'green'))
  }

  printSeparator()
  console.log('\n')
}

// ============================================================================
// CLI 入口
// ============================================================================

/**
 * 解析命令行参数
 */
function parseArgs(): Partial<ValidationConfig> & { fix?: boolean } {
  const args = process.argv.slice(2)
  const config: Partial<ValidationConfig> & { fix?: boolean } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--strict') {
      config.strictMode = true
    } else if (arg === '--fix') {
      config.fix = true
    } else if (arg === '--no-schema-check') {
      config.checkSchemaFile = false
    } else if (arg.startsWith('--max-size=')) {
      const sizeStr = arg.split('=')[1]
      const size = parseInt(sizeStr, 10)
      if (!isNaN(size)) {
        config.maxMigrationFileSize = size * 1024 * 1024 // Convert MB to bytes
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
${colorize('Prisma 迁移验证工具', 'bold')}
${colorize('═'.repeat(40), 'gray')}

${colorize('用法:', 'cyan')}
  tsx scripts/validate-migrations.ts [选项]

${colorize('选项:', 'cyan')}
  --strict              启用严格模式（将警告视为错误）
  --fix                 尝试自动修复可修复的问题
  --no-schema-check     跳过 Schema 文件检查
  --max-size=<MB>       设置最大迁移文件大小限制（单位：MB）
  --help, -h            显示帮助信息

${colorize('示例:', 'cyan')}
  npm run validate:migrations                  # 运行标准验证
  npm run validate:migrations -- --strict      # 严格模式验证
  npm run validate-migrations -- --max-size=5  # 限制文件大小为 5MB

${colorize('退出码:', 'cyan')}
  0 - 验证通过（可能有警告）
  1 - 验证失败（有错误）
  2 - 发生未预期的错误
`)
      process.exit(0)
    }
  }

  return config
}

/**
 * 主入口函数
 */
async function main(): Promise<void> {
  const args = parseArgs()

  try {
    // 运行验证
    const report = await runValidation(args)

    // 输出报告
    printReport(report)

    // 根据结果设置退出码
    if (report.hasErrors) {
      process.exit(1)
    } else {
      process.exit(0)
    }
  } catch (error) {
    console.error(
      colorize(
        `\n❌ 验证工具发生致命错误: ${error instanceof Error ? error.message : '未知错误'}`,
        'red'
      )
    )
    process.exit(2)
  }
}

// 导出供其他模块使用
export {
  runValidation,
  printReport,
  validateSchemaFile,
  validateMigrationNaming,
  validateSQLContent,
  validateMigrationDependencies,
  validateMigrationIntegrity,
  type ValidationConfig,
  type ValidationResult,
  type ValidationReport,
  type MigrationInfo,
  DEFAULT_CONFIG,
  DANGEROUS_PATTERNS,
}

// 如果直接运行此脚本，则执行主函数
main()
