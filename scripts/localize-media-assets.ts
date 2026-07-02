#!/usr/bin/env tsx

import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config()

const VALID_TYPES = new Set(['all', 'song', 'album', 'gallery'])

type Options = {
  type: 'all' | 'song' | 'album' | 'gallery'
  dryRun: boolean
  limit: number | null
}

type LocalizeTarget =
  | {
      type: 'song'
      id: string
      url: string
      songDocId: string
    }
  | {
      type: 'album'
      id: string
      url: string
      albumDocId: string
    }
  | {
      type: 'gallery'
      id: string
      url: string
      galleryId: string
      name: string
    }

function parseArgs(args: string[]): Options {
  const typeArg = args.find((arg) => arg.startsWith('--type='))?.slice('--type='.length) || 'all'
  if (!VALID_TYPES.has(typeArg)) {
    throw new Error('--type 只能是 all、song、album 或 gallery')
  }

  const limitArg = args.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length)
  const limit = limitArg ? Number(limitArg) : null
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error('--limit 必须是正整数')
  }

  return {
    type: typeArg as Options['type'],
    dryRun: !args.includes('--yes'),
    limit,
  }
}

function isExternalUrl(url: string | null | undefined) {
  if (!url) return false
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) && !trimmed.includes('/uploads/')
}

function printUsage() {
  console.log(`用法:
  tsx scripts/localize-media-assets.ts --type=all
  tsx scripts/localize-media-assets.ts --type=song --yes

参数:
  --type=all|song|album|gallery  处理范围，默认 all
  --limit=<n>                    最多处理 n 条
  --yes                          实际写入；不加时只预览`)
}

async function collectTargets(
  prisma: typeof import('../src/server/utils').prisma,
  options: Options
) {
  const targets: LocalizeTarget[] = []
  const take = options.limit ?? undefined

  if (options.type === 'all' || options.type === 'song') {
    const covers = await prisma.songCover.findMany({
      where: {
        OR: [{ assetId: null }, { publicUrl: { startsWith: 'http' } }],
      },
      select: { id: true, songDocId: true, publicUrl: true },
      take,
      orderBy: { createdAt: 'asc' },
    })
    for (const cover of covers) {
      if (isExternalUrl(cover.publicUrl)) {
        targets.push({
          type: 'song',
          id: cover.id,
          url: cover.publicUrl,
          songDocId: cover.songDocId,
        })
      }
    }
  }

  if (options.type === 'all' || options.type === 'album') {
    const covers = await prisma.albumCover.findMany({
      where: {
        OR: [{ assetId: null }, { publicUrl: { startsWith: 'http' } }],
      },
      select: { id: true, albumDocId: true, publicUrl: true },
      take,
      orderBy: { createdAt: 'asc' },
    })
    for (const cover of covers) {
      if (isExternalUrl(cover.publicUrl)) {
        targets.push({
          type: 'album',
          id: cover.id,
          url: cover.publicUrl,
          albumDocId: cover.albumDocId,
        })
      }
    }
  }

  if (options.type === 'all' || options.type === 'gallery') {
    const images = await prisma.galleryImage.findMany({
      where: {
        OR: [{ assetId: null }, { url: { startsWith: 'http' } }],
      },
      select: { id: true, galleryId: true, url: true, name: true },
      take,
      orderBy: { id: 'asc' },
    })
    for (const image of images) {
      if (isExternalUrl(image.url)) {
        targets.push({
          type: 'gallery',
          id: image.id,
          url: image.url,
          galleryId: image.galleryId,
          name: image.name,
        })
      }
    }
  }

  return options.limit ? targets.slice(0, options.limit) : targets
}

async function localizeTarget(
  prisma: typeof import('../src/server/utils').prisma,
  localizeImageUrlAsMediaAsset: typeof import('../src/server/utils').localizeImageUrlAsMediaAsset,
  target: LocalizeTarget
) {
  const asset = await localizeImageUrlAsMediaAsset(target.url, {
    namespace:
      target.type === 'gallery'
        ? 'galleries/localized'
        : target.type === 'song'
          ? 'music-covers/songs'
          : 'music-covers/albums',
    fallbackName: `${target.type}-${target.id}.jpg`,
  })

  if (target.type === 'song') {
    await prisma.songCover.update({
      where: { id: target.id },
      data: {
        assetId: asset.assetId,
        storageKey: asset.storageKey,
        publicUrl: asset.publicUrl,
      },
    })
    return
  }

  if (target.type === 'album') {
    await prisma.albumCover.update({
      where: { id: target.id },
      data: {
        assetId: asset.assetId,
        storageKey: asset.storageKey,
        publicUrl: asset.publicUrl,
      },
    })
    return
  }

  await prisma.galleryImage.update({
    where: { id: target.id },
    data: {
      assetId: asset.assetId,
      url: asset.publicUrl,
      name: target.name || asset.fileName,
    },
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { prisma, localizeImageUrlAsMediaAsset } = await import('../src/server/utils')
  const targets = await collectTargets(prisma, options)

  console.log(`待处理外部资源：${targets.length}`)
  if (options.dryRun) {
    for (const target of targets) {
      console.log(`[dry-run] ${target.type} ${target.id}: ${target.url}`)
    }
    console.log('未写入数据库；加 --yes 执行本地化')
    await prisma.$disconnect()
    return
  }

  const failures: Array<{ target: LocalizeTarget; error: string }> = []
  let success = 0

  for (const target of targets) {
    try {
      await localizeTarget(prisma, localizeImageUrlAsMediaAsset, target)
      success += 1
      console.log(`[ok] ${target.type} ${target.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ target, error: message })
      console.log(`[failed] ${target.type} ${target.id}: ${message}`)
    }
  }

  console.log(`完成：成功 ${success}，失败 ${failures.length}`)
  if (failures.length) {
    console.log('\n失败清单：')
    for (const failure of failures) {
      console.log(
        `${failure.target.type} ${failure.target.id} ${failure.target.url}: ${failure.error}`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  printUsage()
  process.exitCode = 1
})
