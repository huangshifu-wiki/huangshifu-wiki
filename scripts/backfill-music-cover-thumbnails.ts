import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config()

type BackfillType = 'all' | 'song' | 'album'
type GenerateMusicCoverThumbnail =
  typeof import('../src/server/services/musicCoverThumbnail.service').generateMusicCoverThumbnail

interface CliOptions {
  type: BackfillType
  dryRun: boolean
  yes: boolean
}

const TYPES = new Set<BackfillType>(['all', 'song', 'album'])

function printUsage() {
  console.log(`用法:
  npm run music-covers:thumbnails -- --dry-run
  npm run music-covers:thumbnails -- --type=song --yes

参数:
  --type=all|song|album  处理范围，默认 all
  --dry-run              只统计，不生成文件、不写入数据库
  --yes                  确认执行写入`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    type: 'all',
    dryRun: false,
    yes: false,
  }

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--yes') {
      options.yes = true
      continue
    }
    if (arg.startsWith('--type=')) {
      const type = arg.slice('--type='.length)
      if (!TYPES.has(type as BackfillType)) {
        throw new Error('--type 只能是 all、song 或 album')
      }
      options.type = type as BackfillType
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    throw new Error(`未知参数：${arg}`)
  }

  if (!options.dryRun && !options.yes) {
    throw new Error('实际写入前请加 --yes；如需预览请使用 --dry-run')
  }

  return options
}

async function backfillSongCovers(
  prisma: typeof import('../src/server/utils').prisma,
  generateMusicCoverThumbnail: GenerateMusicCoverThumbnail,
  dryRun: boolean
) {
  const covers = await prisma.songCover.findMany({
    where: { thumbnailUrl: null },
    select: { id: true, songDocId: true, storageKey: true },
    orderBy: { createdAt: 'asc' },
  })

  let updated = 0
  let failed = 0

  for (const cover of covers) {
    if (dryRun) continue

    try {
      const thumbnailUrl = await generateMusicCoverThumbnail(cover.storageKey)
      if (!thumbnailUrl) {
        failed += 1
        continue
      }
      await prisma.songCover.update({
        where: { id: cover.id },
        data: { thumbnailUrl },
      })
      updated += 1
    } catch (error) {
      failed += 1
      console.warn(`歌曲封面 ${cover.id} (${cover.songDocId}) 缩略图生成失败：`, error)
    }
  }

  return { total: covers.length, updated, failed }
}

async function backfillAlbumCovers(
  prisma: typeof import('../src/server/utils').prisma,
  generateMusicCoverThumbnail: GenerateMusicCoverThumbnail,
  dryRun: boolean
) {
  const covers = await prisma.albumCover.findMany({
    where: { thumbnailUrl: null },
    select: { id: true, albumDocId: true, storageKey: true },
    orderBy: { createdAt: 'asc' },
  })

  let updated = 0
  let failed = 0

  for (const cover of covers) {
    if (dryRun) continue

    try {
      const thumbnailUrl = await generateMusicCoverThumbnail(cover.storageKey)
      if (!thumbnailUrl) {
        failed += 1
        continue
      }
      await prisma.albumCover.update({
        where: { id: cover.id },
        data: { thumbnailUrl },
      })
      updated += 1
    } catch (error) {
      failed += 1
      console.warn(`专辑封面 ${cover.id} (${cover.albumDocId}) 缩略图生成失败：`, error)
    }
  }

  return { total: covers.length, updated, failed }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [{ prisma }, { generateMusicCoverThumbnail }] = await Promise.all([
    import('../src/server/utils'),
    import('../src/server/services/musicCoverThumbnail.service'),
  ])

  const songResult =
    options.type === 'all' || options.type === 'song'
      ? await backfillSongCovers(prisma, generateMusicCoverThumbnail, options.dryRun)
      : { total: 0, updated: 0, failed: 0 }
  const albumResult =
    options.type === 'all' || options.type === 'album'
      ? await backfillAlbumCovers(prisma, generateMusicCoverThumbnail, options.dryRun)
      : { total: 0, updated: 0, failed: 0 }

  console.log(options.dryRun ? '音乐封面缩略图补齐预览' : '音乐封面缩略图补齐完成')
  console.table([
    { type: 'song', ...songResult },
    { type: 'album', ...albumResult },
  ])

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
