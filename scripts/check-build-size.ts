/**
 * 构建产物大小检查脚本
 *
 * 功能：
 * - 检查 dist/ 目录是否存在
 * - 计算总构建大小
 * - 列出最大的 N 个文件
 * - 与阈值比较并输出警告或错误
 * - 提供优化建议
 *
 * 使用方式：
 *   npx tsx scripts/check-build-size.ts
 *
 * 环境变量配置（可选）：
 *   BUILD_WARN_THRESHOLD  - 警告阈值（字节），默认 50MB (52428800)
 *   BUILD_ERROR_THRESHOLD - 错误阈值（字节），默认 100MB (104857600)
 */

import fs from 'fs'
import path from 'path'

// ==================== 配置常量 ====================

/** 默认警告阈值：50MB */
const DEFAULT_WARN_THRESHOLD = 50 * 1024 * 1024

/** 默认错误阈值：100MB */
const DEFAULT_ERROR_THRESHOLD = 100 * 1024 * 1024

/** 最大文件列表数量 */
const MAX_FILE_LIST_COUNT = 10

/** 构建产物目录 */
const DIST_DIR = path.resolve(process.cwd(), 'dist')

// ==================== 类型定义 ====================

/** 文件信息接口 */
interface FileInfo {
  /** 文件相对路径 */
  relativePath: string
  /** 文件大小（字节） */
  size: number
}

/** 构建统计信息接口 */
interface BuildStats {
  /** 总大小（字节） */
  totalSize: number
  /** 文件总数 */
  fileCount: number
  /** 目录总数 */
  dirCount: number
  /** 最大的文件列表 */
  largestFiles: FileInfo[]
  /** 按扩展名分类的统计 */
  sizeByExtension: Map<string, number>
}

/** 阈值配置接口 */
interface ThresholdConfig {
  /** 警告阈值（字节） */
  warnThreshold: number
  /** 错误阈值（字节） */
  errorThreshold: number
}

// ==================== 工具函数 ====================

/**
 * 将字节数格式化为人类可读的字符串
 * @param bytes 字节数
 * @returns 格式化后的字符串，如 "1.5 MB"
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / Math.pow(k, i)

  // 根据单位选择小数位数：B和KB显示整数，MB和GB显示2位小数
  const decimalPlaces = i >= 2 ? 2 : 0
  return `${size.toFixed(decimalPlaces)} ${units[i]}`
}

/**
 * 解析环境变量中的阈值配置
 * @returns 阈值配置对象
 */
function parseThresholdConfig(): ThresholdConfig {
  // 从环境变量读取阈值，如果未设置则使用默认值
  const warnThresholdStr = process.env.BUILD_WARN_THRESHOLD
  const errorThresholdStr = process.env.BUILD_ERROR_THRESHOLD

  const warnThreshold = warnThresholdStr ? parseInt(warnThresholdStr, 10) : DEFAULT_WARN_THRESHOLD

  const errorThreshold = errorThresholdStr
    ? parseInt(errorThresholdStr, 10)
    : DEFAULT_ERROR_THRESHOLD

  return { warnThreshold, errorThreshold }
}

/**
 * 递归遍历目录，收集所有文件信息
 * @param dirPath 要遍历的目录路径
 * @returns 文件信息数组
 */
function collectFiles(dirPath: string): FileInfo[] {
  const files: FileInfo[] = []

  // 检查目录是否存在
  if (!fs.existsSync(dirPath)) {
    return files
  }

  // 递归遍历目录
  function traverse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        // 递归处理子目录
        traverse(fullPath)
      } else if (entry.isFile()) {
        // 收集文件信息
        try {
          const stats = fs.statSync(fullPath)
          files.push({
            relativePath: path.relative(DIST_DIR, fullPath),
            size: stats.size,
          })
        } catch {
          // 忽略无法访问的文件
          console.warn(`无法读取文件: ${fullPath}`)
        }
      }
    }
  }

  traverse(dirPath)
  return files
}

/**
 * 统计目录数量
 * @param dirPath 要统计的目录路径
 * @returns 目录数量
 */
function countDirectories(dirPath: string): number {
  let count = 0

  function traverse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        count++
        traverse(fullPath)
      }
    }
  }

  traverse(dirPath)
  return count
}

/**
 * 按文件扩展名分类统计大小
 * @param files 文件信息数组
 * @returns 扩展名到总大小的映射
 */
function categorizeByExtension(files: FileInfo[]): Map<string, number> {
  const sizeMap = new Map<string, number>()

  for (const file of files) {
    // 获取文件扩展名（转为小写）
    const ext = path.extname(file.relativePath).toLowerCase() || '(无扩展名)'

    // 累加该扩展名的文件大小
    const currentSize = sizeMap.get(ext) || 0
    sizeMap.set(ext, currentSize + file.size)
  }

  return sizeMap
}

// ==================== 核心分析函数 ====================

/**
 * 分析构建产物目录
 * @returns 构建统计信息
 */
function analyzeBuild(): BuildStats {
  console.log(`\n📊 开始分析构建产物目录: ${DIST_DIR}\n`)

  // 收集所有文件
  const files = collectFiles(DIST_DIR)

  // 如果没有找到文件，返回空统计
  if (files.length === 0) {
    return {
      totalSize: 0,
      fileCount: 0,
      dirCount: 0,
      largestFiles: [],
      sizeByExtension: new Map(),
    }
  }

  // 计算总大小
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  // 统计目录数量
  const dirCount = countDirectories(DIST_DIR)

  // 按文件大小降序排序，取前 N 个最大文件
  const sortedFiles = [...files].sort((a, b) => b.size - a.size)
  const largestFiles = sortedFiles.slice(0, MAX_FILE_LIST_COUNT)

  // 按扩展名分类统计
  const sizeByExtension = categorizeByExtension(files)

  return {
    totalSize,
    fileCount: files.length,
    dirCount,
    largestFiles,
    sizeByExtension,
  }
}

// ==================== 输出函数 ====================

/**
 * 在控制台打印分隔线
 */
function printSeparator(): void {
  console.log('─'.repeat(80))
}

/**
 * 打印构建概览表格
 * @param stats 构建统计信息
 */
function printOverviewTable(stats: BuildStats): void {
  console.log('\n📋 构建产物概览')
  printSeparator()

  // 使用简单的文本对齐来模拟表格效果
  const rows = [
    ['指标', '数值'],
    ['总大小', formatBytes(stats.totalSize)],
    ['文件总数', stats.fileCount.toString()],
    ['目录总数', stats.dirCount.toString()],
    [
      '平均文件大小',
      stats.fileCount > 0 ? formatBytes(Math.round(stats.totalSize / stats.fileCount)) : 'N/A',
    ],
  ]

  // 计算每列的最大宽度
  const colWidths = [20, 25]
  for (const row of rows) {
    colWidths[0] = Math.max(colWidths[0], row[0].length + 2)
    colWidths[1] = Math.max(colWidths[1], row[1].length + 2)
  }

  // 打印表头
  console.log(`│ ${rows[0][0].padEnd(colWidths[0])} │ ${rows[0][1].padStart(colWidths[1])} │`)
  console.log(`├${'─'.repeat(colWidths[0] + 2)}┼${'─'.repeat(colWidths[1] + 2)}┤`)

  // 打印数据行
  for (let i = 1; i < rows.length; i++) {
    console.log(`│ ${rows[i][0].padEnd(colWidths[0])} │ ${rows[i][1].padStart(colWidths[1])} │`)
  }

  printSeparator()
}

/**
 * 打印最大文件列表
 * @param files 文件信息数组（已按大小降序排列）
 */
function printLargestFilesTable(files: FileInfo[]): void {
  if (files.length === 0) {
    console.log('\n💾 未找到任何文件')
    return
  }

  console.log(`\n📦 最大的 ${files.length} 个文件`)
  printSeparator()

  // 表头
  console.log('│ 排名 │ 大小       │ 文件路径')
  console.log('├──────┼───────────┼──────────────────────────────────────────────────')

  // 数据行
  files.forEach((file, index) => {
    const rank = (index + 1).toString().padStart(2)
    const size = formatBytes(file.size).padEnd(9)
    // 截断过长的文件路径
    const displayPath =
      file.relativePath.length > 55 ? file.relativePath.slice(0, 52) + '...' : file.relativePath

    console.log(`│ ${rank}  │ ${size} │ ${displayPath}`)
  })

  printSeparator()
}

/**
 * 打印按扩展名分类的大小统计
 * @param sizeByExtension 扩展名到大小的映射
 * @param totalSize 总大小（用于计算百分比）
 */
function printExtensionStats(sizeByExtension: Map<string, number>, totalSize: number): void {
  if (sizeByExtension.size === 0) {
    return
  }

  console.log('\n📂 按文件类型分布')
  printSeparator()

  // 按大小降序排列
  const sortedEntries = [...sizeByExtension.entries()].sort((a, b) => b[1] - a[1])

  // 表头
  console.log('│ 文件类型 │ 大小       │ 占比   │')
  console.log('├──────────┼───────────┼────────┤')

  // 数据行
  for (const [ext, size] of sortedEntries) {
    const extDisplay = ext.padEnd(8)
    const sizeDisplay = formatBytes(size).padEnd(9)
    const percentage = ((size / totalSize) * 100).toFixed(1).padStart(5) + '%'
    console.log(`│ ${extDisplay} │ ${sizeDisplay} │ ${percentage} │`)
  }

  printSeparator()
}

/**
 * 检查是否超过阈值并输出相应提示
 * @param totalSize 总构建大小
 * @param thresholdConfig 阈值配置
 * @returns 是否超过错误阈值（用于决定退出码）
 */
function checkThresholds(totalSize: number, thresholdConfig: ThresholdConfig): boolean {
  const { warnThreshold, errorThreshold } = thresholdConfig

  console.log('\n⚠️  阈值检查')
  printSeparator()

  // 显示当前阈值配置
  console.log(`  警告阈值: ${formatBytes(warnThreshold)}`)
  console.log(`  错误阈值: ${formatBytes(errorThreshold)}`)
  console.log(`  当前大小: ${formatBytes(totalSize)}`)

  let hasError = false

  if (totalSize > errorThreshold) {
    // 超过错误阈值
    const excess = totalSize - errorThreshold
    const excessPercentage = ((excess / errorThreshold) * 100).toFixed(1)
    console.log(`\n  ❌ 错误: 构建产物超出错误阈值!`)
    console.log(`     超出: ${formatBytes(excess)} (${excessPercentage}%)`)
    hasError = true
  } else if (totalSize > warnThreshold) {
    // 超过警告阈值但未超过错误阈值
    const excess = totalSize - warnThreshold
    const excessPercentage = ((excess / warnThreshold) * 100).toFixed(1)
    console.log(`\n  ⚠️  警告: 构建产物超出警告阈值!`)
    console.log(`     超出: ${formatBytes(excess)} (${excessPercentage}%)`)
  } else {
    // 未超过任何阈值
    const margin = warnThreshold - totalSize
    const marginPercentage = ((margin / warnThreshold) * 100).toFixed(1)
    console.log(`\n  ✅ 通过: 构建产物在安全范围内`)
    console.log(`     距离警告阈值还有: ${formatBytes(margin)} (${marginPercentage}%)`)
  }

  printSeparator()

  return hasError
}

/**
 * 提供优化建议
 * @param stats 构建统计信息
 * @param hasError 是否超过错误阈值
 */
function printOptimizationSuggestions(stats: BuildStats, hasError: boolean): void {
  console.log('\n💡 优化建议')
  printSeparator()

  const suggestions: string[] = []

  // 基于总体大小的建议
  if (stats.totalSize > 50 * 1024 * 1024) {
    suggestions.push('• 考虑使用代码分割（Code Splitting）减少初始加载体积')
  }

  // 基于文件类型的建议
  const extensionSizes = stats.sizeByExtension

  // JS 文件优化
  const jsSize = extensionSizes.get('.js') || 0
  if (jsSize > 10 * 1024 * 1024) {
    suggestions.push('• JavaScript 文件较大，建议：')
    suggestions.push('  - 启用 Tree Shaking 移除未使用的代码')
    suggestions.push('  - 使用动态导入（dynamic import）实现懒加载')
    suggestions.push('  - 检查是否有重复依赖或过大的第三方库')
  }

  // CSS 文件优化
  const cssSize = extensionSizes.get('.css') || 0
  if (cssSize > 2 * 1024 * 1024) {
    suggestions.push('• CSS 文件较大，建议：')
    suggestions.push('  - 使用 PurgeCSS 或类似工具移除未使用的样式')
    suggestions.push('  - 将关键 CSS 内联，其余样式异步加载')
    suggestions.push('  - 检查是否有重复或冗余的样式定义')
  }

  // 图片资源优化
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']
  let totalImageSize = 0
  for (const ext of imageExts) {
    totalImageSize += extensionSizes.get(ext) || 0
  }
  if (totalImageSize > 5 * 1024 * 1024) {
    suggestions.push('• 图片资源占用较大，建议：')
    suggestions.push('  - 使用 WebP 或 AVIF 格式替代传统格式（可减少 30-70% 体积）')
    suggestions.push('  - 对图片进行压缩（使用 imagemin、sharp 等工具）')
    suggestions.push('  - 实现图片懒加载和响应式图片')
    suggestions.push('  - 考虑使用 CDN 加速图片分发')
  }

  // 字体文件优化
  const fontExts = ['.woff', '.woff2', '.ttf', '.otf', '.eot']
  let totalFontSize = 0
  for (const ext of fontExts) {
    totalFontSize += extensionSizes.get(ext) || 0
  }
  if (totalFontSize > 1 * 1024 * 1024) {
    suggestions.push('• 字体文件较大，建议：')
    suggestions.push('  - 使用 woff2 格式（比 woff 小约 30%）')
    suggestions.push('  - 只包含实际使用的字符子集（字体子集化）')
    suggestions.push('  - 使用系统字体作为后备方案')
  }

  // 地图文件（source map）建议
  const mapSize = extensionSizes.get('.map') || 0
  if (mapSize > 5 * 1024 * 1024) {
    suggestions.push('• Source Map 文件较大，生产环境建议禁用或仅保留在服务器端')
  }

  // 通用建议
  if (stats.largestFiles.length > 0) {
    const largestFile = stats.largestFiles[0]
    if (largestFile.size > stats.totalSize * 0.3) {
      suggestions.push(
        `• 单个文件 "${largestFile.relativePath}" 占比过高 (${(
          (largestFile.size / stats.totalSize) *
          100
        ).toFixed(1)}%)，考虑进一步拆分`
      )
    }
  }

  // 如果没有任何具体建议，给出通用建议
  if (suggestions.length === 0) {
    suggestions.push('• 当前构建产物大小合理，继续保持良好的代码实践')
    suggestions.push('• 定期监控构建大小变化趋势')
    suggestions.push('• 在引入新依赖时评估其对构建体积的影响')
  }

  // 如果超过错误阈值，添加额外建议
  if (hasError) {
    suggestions.push('')
    suggestions.push('🚨 由于构建产物超出错误阈值，强烈建议优先执行以下操作：')
    suggestions.push('  1. 运行 bundle 分析工具（如 rollup-plugin-visualizer）查看详细构成')
    suggestions.push('  2. 审查并移除不必要的依赖包')
    suggestions.push('  3. 优化或替换过大的第三方库')
  }

  // 输出所有建议
  for (const suggestion of suggestions) {
    console.log(`  ${suggestion}`)
  }

  printSeparator()
}

// ==================== 主函数 ====================

/**
 * 主函数：执行构建大小检查流程
 */
async function main(): Promise<void> {
  console.log('='.repeat(80))
  console.log('  构建产物大小检查工具 (Build Size Checker)')
  console.log('='.repeat(80))

  // 解析阈值配置
  const thresholdConfig = parseThresholdConfig()

  // 检查 dist/ 目录是否存在
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`\n❌ 错误: 构建产物目录不存在: ${DIST_DIR}`)
    console.error('请先运行 "npm run build" 命令生成构建产物\n')
    process.exit(1)
  }

  // 分析构建产物
  const stats = analyzeBuild()

  // 检查是否为空目录
  if (stats.fileCount === 0) {
    console.warn('\n⚠️  警告: 构建产物目录为空\n')
    process.exit(0)
  }

  // 输出分析结果
  printOverviewTable(stats)
  printLargestFilesTable(stats.largestFiles)
  printExtensionStats(stats.sizeByExtension, stats.totalSize)

  // 检查阈值并获取结果
  const hasError = checkThresholds(stats.totalSize, thresholdConfig)

  // 输出优化建议
  printOptimizationSuggestions(stats, hasError)

  // 输出最终状态
  console.log('\n' + '='.repeat(80))

  if (hasError) {
    console.error('  ❌ 检查失败: 构建产物超出错误阈值!')
    console.error('     请根据上述优化建议进行调整后重新构建\n')
    process.exit(1) // 返回非零退出码表示失败
  } else {
    console.log('  ✅ 检查通过: 构建产物大小符合要求\n')
    process.exit(0) // 返回零退出码表示成功
  }
}

// 执行主函数
main().catch((error) => {
  console.error('\n💥 脚本执行出错:', error)
  process.exit(1)
})
