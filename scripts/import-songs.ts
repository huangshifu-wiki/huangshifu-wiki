import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import { stdin as input, stdout as output } from 'process'
import readline from 'readline/promises'
import type {
  SongDuplicateAction,
  SongImportPreview,
  SongImportPreviewItem,
} from '../src/server/services/songJsonImport.service'

dotenv.config({ path: '.env.local' })
dotenv.config()

interface CliOptions {
  filePath: string
  dryRun: boolean
  yes: boolean
  duplicates: SongDuplicateAction | null
  previewFormat: 'table' | 'markdown'
  resolveCovers: boolean
}

const DUPLICATE_ACTIONS = new Set<SongDuplicateAction>(['fill', 'overwrite', 'skip'])

type SongImportService = typeof import('../src/server/services/songJsonImport.service')
type PrismaClientSingleton = typeof import('../src/server/utils').prisma

let prisma: PrismaClientSingleton | null = null

async function loadRuntimeDependencies(): Promise<SongImportService> {
  const [utils, service] = await Promise.all([
    import('../src/server/utils'),
    import('../src/server/services/songJsonImport.service'),
  ])
  prisma = utils.prisma
  return service
}

function printUsage() {
  console.log(`用法:
  npm run songs:import -- ./huangshifu-songs.json
  npm run songs:import -- ./huangshifu-songs.json --dry-run
  npm run songs:import -- ./huangshifu-songs.json --dry-run --markdown
  npm run songs:import -- ./huangshifu-songs.json --yes --duplicates=fill
  npm run songs:import -- ./huangshifu-songs.json --yes --duplicates=fill --resolve-covers

参数:
  --dry-run                 只预览，不写入数据库
  --yes                     跳过确认，必须配合 --duplicates
  --duplicates=<action>     重复歌曲策略：fill | overwrite | skip
  --resolve-covers          写入时按平台 ID 解析封面并本地保存，dry-run 不解析
  --preview-format=<format> 预览表格格式：table | markdown
  --markdown                等同于 --preview-format=markdown`)
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv]
  const options: CliOptions = {
    filePath: '',
    dryRun: false,
    yes: false,
    duplicates: null,
    previewFormat: 'table',
    resolveCovers: false,
  }

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--yes') {
      options.yes = true
      continue
    }
    if (arg === '--resolve-covers') {
      options.resolveCovers = true
      continue
    }
    if (arg.startsWith('--duplicates=')) {
      const value = arg.slice('--duplicates='.length)
      if (!DUPLICATE_ACTIONS.has(value as SongDuplicateAction)) {
        throw new Error('--duplicates 只能是 fill、overwrite 或 skip')
      }
      options.duplicates = value as SongDuplicateAction
      continue
    }
    if (arg.startsWith('--preview-format=')) {
      const value = arg.slice('--preview-format='.length)
      if (value !== 'table' && value !== 'markdown') {
        throw new Error('--preview-format 只能是 table 或 markdown')
      }
      options.previewFormat = value
      continue
    }
    if (arg === '--markdown') {
      options.previewFormat = 'markdown'
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`未知参数：${arg}`)
    }
    if (!options.filePath) {
      options.filePath = arg
      continue
    }
    throw new Error(`多余参数：${arg}`)
  }

  if (!options.filePath) {
    throw new Error('请提供 JSON 文件路径')
  }
  if (options.yes && !options.duplicates) {
    throw new Error('--yes 必须配合 --duplicates=<fill|overwrite|skip>')
  }

  return options
}

async function readJsonFile(filePath: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  const raw = await fs.readFile(resolvedPath, 'utf8')
  return JSON.parse(raw)
}

function formatArtists(artists: string[]) {
  return artists.length ? artists.join(' / ') : '-'
}

function formatMatch(item: SongImportPreviewItem) {
  if (item.validationErrors.length) return 'invalid'
  if (item.existingSong) {
    return `${item.matchType}:${item.existingSong.docId}`
  }
  if (item.sourceConflicts.length) return 'conflict'
  return 'new'
}

function previewRows(preview: SongImportPreview) {
  return preview.items.map((item) => ({
    '#': item.input.index + 1,
    title: item.input.title || '(无标题)',
    artists: formatArtists(item.input.artists),
    match: formatMatch(item),
    action: item.suggestedAction,
    errors: item.validationErrors.join('；'),
  }))
}

function markdownCell(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
}

function printMarkdownPreview(preview: SongImportPreview) {
  const rows = previewRows(preview)
  const headers = ['#', 'title', 'artists', 'match', 'action', 'errors'] as const

  console.log('| # | title | artists | match | action | errors |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    console.log(`| ${headers.map((header) => markdownCell(row[header])).join(' | ')} |`)
  }
}

function printPreview(preview: SongImportPreview, format: CliOptions['previewFormat']) {
  console.log('\n导入预览')
  if (format === 'markdown') {
    printMarkdownPreview(preview)
  } else {
    console.table(previewRows(preview))
  }
  console.log(
    `统计：新建 ${preview.createCount}，重复 ${preview.duplicateCount}，校验失败 ${preview.invalidItems.length}，来源冲突 ${preview.conflictCount}`
  )

  const conflicts = preview.items.filter((item) => item.sourceConflicts.length)
  if (conflicts.length) {
    console.log(format === 'markdown' ? '\n### 来源冲突' : '\n来源冲突：')
    for (const item of conflicts) {
      for (const conflict of item.sourceConflicts) {
        console.log(
          `${format === 'markdown' ? '- ' : '  '}#${item.input.index + 1} ${item.input.title}: ${conflict.platform}/${conflict.sourceId} 已属于 ${conflict.title} (${conflict.songDocId})`
        )
      }
    }
  }
}

function duplicateItems(preview: SongImportPreview) {
  return preview.items.filter((item) => item.existingSong && !item.validationErrors.length)
}

function fillDuplicateActions(preview: SongImportPreview, action: SongDuplicateAction) {
  return new Map(duplicateItems(preview).map((item) => [item.input.index, action]))
}

async function askDuplicateActions(preview: SongImportPreview) {
  const duplicates = duplicateItems(preview)
  if (!duplicates.length) return new Map<number, SongDuplicateAction>()

  const rl = readline.createInterface({ input, output })
  try {
    while (true) {
      const answer = (await rl.question('\n重复歌曲策略 [fill/overwrite/skip/review]，默认 fill：'))
        .trim()
        .toLowerCase()

      if (!answer || answer === 'fill' || answer === 'overwrite' || answer === 'skip') {
        return fillDuplicateActions(preview, (answer || 'fill') as SongDuplicateAction)
      }

      if (answer === 'review') {
        const actions = new Map<number, SongDuplicateAction>()
        for (const item of duplicates) {
          while (true) {
            const itemAnswer = (
              await rl.question(
                `#${item.input.index + 1} ${item.input.title} -> ${item.existingSong?.docId} [fill/overwrite/skip]，默认 fill：`
              )
            )
              .trim()
              .toLowerCase()
            if (!itemAnswer || DUPLICATE_ACTIONS.has(itemAnswer as SongDuplicateAction)) {
              actions.set(item.input.index, (itemAnswer || 'fill') as SongDuplicateAction)
              break
            }
            console.log('请输入 fill、overwrite 或 skip')
          }
        }
        return actions
      }

      console.log('请输入 fill、overwrite、skip 或 review')
    }
  } finally {
    rl.close()
  }
}

async function confirmExecution() {
  const rl = readline.createInterface({ input, output })
  try {
    const answer = (await rl.question('\n确认写入数据库？输入 yes 继续：')).trim().toLowerCase()
    return answer === 'yes'
  } finally {
    rl.close()
  }
}

async function main() {
  const { executeSongJsonImport, previewSongJsonImport } = await loadRuntimeDependencies()
  const options = parseArgs(process.argv.slice(2))
  const payload = await readJsonFile(options.filePath)
  const preview = await previewSongJsonImport(payload)
  printPreview(preview, options.previewFormat)

  if (options.dryRun) {
    console.log('\n--dry-run 已启用，未写入数据库')
    return
  }

  const actions = options.duplicates
    ? fillDuplicateActions(preview, options.duplicates)
    : await askDuplicateActions(preview)

  if (!options.yes) {
    const confirmed = await confirmExecution()
    if (!confirmed) {
      console.log('已取消，未写入数据库')
      return
    }
  }

  const result = await executeSongJsonImport(preview, actions, {
    resolveCovers: options.resolveCovers,
  })
  console.log('\n导入完成')
  console.table(result.summary)

  const failed = result.items.filter(
    (item) => item.action === 'failed' || item.action === 'invalid'
  )
  if (failed.length) {
    console.log('\n失败或无效项目：')
    for (const item of failed) {
      console.log(`#${item.index + 1} ${item.title || '(无标题)'}: ${item.error || item.action}`)
    }
  }

  const coverFailed = result.items.filter((item) => item.coverError)
  if (coverFailed.length) {
    console.log('\n封面处理失败项目：')
    for (const item of coverFailed) {
      console.log(`#${item.index + 1} ${item.title || '(无标题)'}: ${item.coverError}`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    printUsage()
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma?.$disconnect()
  })
