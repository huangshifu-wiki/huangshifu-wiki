#!/usr/bin/env tsx

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Prisma, PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

import { replaceMarkdownLinks, scanMarkdownLinks } from '../src/lib/markdownLinkReplacer'
import {
  buildUploadPublicUrl,
  extractStorageKeyFromUploadUrl,
  resolveUploadPathByStorageKey,
  resolveUploadPathByUrl,
} from '../src/server/utils/upload'
import { uploadsDir as configuredUploadsDir } from '../src/server/utils/config'

dotenv.config({ path: '.env.local' })
dotenv.config()

const prisma = new PrismaClient()
const uploadsDir = process.env.UPLOADS_PATH || configuredUploadsDir

export type ReconcileOptions = { dryRun: boolean }

export type ReconcileReport = {
  dryRun: boolean
  linked: number
  merged: number
  markdownReplacements: number
  deferredReclaims: string[]
  missingFiles: string[]
  unableToDetermine: string[]
  userAvatarsLinked: number
  errors: string[]
}

function parseOptions(args: string[]): ReconcileOptions {
  return { dryRun: !args.includes('--apply') }
}

function emptyReport(dryRun: boolean): ReconcileReport {
  return {
    dryRun,
    linked: 0,
    merged: 0,
    markdownReplacements: 0,
    deferredReclaims: [],
    missingFiles: [],
    unableToDetermine: [],
    userAvatarsLinked: 0,
    errors: [],
  }
}

function localPathForAsset(asset: { storageKey: string | null; publicUrl: string | null }) {
  if (asset.storageKey) {
    const filePath = resolveUploadPathByStorageKey(asset.storageKey)
    if (filePath) return { filePath, localUrl: buildUploadPublicUrl(asset.storageKey) }
  }
  if (asset.publicUrl) {
    const filePath = resolveUploadPathByUrl(asset.publicUrl)
    const storageKey = extractStorageKeyFromUploadUrl(asset.publicUrl)
    if (filePath && storageKey) return { filePath, localUrl: buildUploadPublicUrl(storageKey) }
  }
  return null
}

async function md5ForFile(filePath: string) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('md5').update(data).digest('hex')
}

async function rewriteTextFields(
  tx: Prisma.TransactionClient | PrismaClient,
  mappings: Array<{ oldUrl: string; newUrl: string }>,
  report: ReconcileReport,
  apply: boolean
) {
  if (!mappings.length) return
  const updateRows = async (
    delegate: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>
      update: (args: unknown) => Promise<unknown>
    },
    field: string
  ) => {
    const rows = await delegate.findMany({ select: { id: true, [field]: true } })
    for (const row of rows) {
      const content = row[field]
      if (typeof content !== 'string') continue
      const scanned = scanMarkdownLinks(content)
      if (!scanned.images.length && !scanned.links.length && !scanned.references.length) continue
      const replacement = replaceMarkdownLinks(content, mappings)
      if (!replacement.replaced) continue
      report.markdownReplacements += replacement.replaceCount
      if (apply)
        await delegate.update({ where: { id: row.id }, data: { [field]: replacement.content } })
    }
  }

  await updateRows(tx.wikiPage, 'content')
  await updateRows(tx.wikiRevision, 'content')
  await updateRows(tx.post, 'content')
  await updateRows(tx.event, 'content')
  await updateRows(tx.postComment, 'content')
  await updateRows(tx.wikiPullRequestComment, 'content')
  await updateRows(tx.wikiPullRequest, 'description')
  await updateRows(tx.announcement, 'content')
  await updateRows(tx.announcement, 'link')
}

async function reconcileAsset(
  asset: {
    id: string
    ownerUid: string
    imageMapId: string | null
    storageKey: string | null
    publicUrl: string | null
    fileName: string
  },
  report: ReconcileReport,
  options: ReconcileOptions
) {
  const local = localPathForAsset(asset)
  let md5: string | null = null
  let assetLocalUrl: string | null = local?.localUrl || null

  if (local) {
    try {
      await fs.access(local.filePath)
      md5 = await md5ForFile(local.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') report.missingFiles.push(asset.id)
      else
        report.errors.push(
          `${asset.id}: ${error instanceof Error ? error.message : '读取文件失败'}`
        )
    }
  }

  if (!md5 && asset.imageMapId) {
    const existing = await prisma.imageMap.findUnique({
      where: { id: asset.imageMapId },
      select: { md5: true, localUrl: true },
    })
    if (existing) {
      md5 = existing.md5
      assetLocalUrl = existing.localUrl
    }
  }
  if (!md5) {
    report.unableToDetermine.push(asset.id)
    return []
  }
  if (options.dryRun) {
    const existing = await prisma.imageMap.findUnique({
      where: { md5 },
      select: { id: true, localUrl: true },
    })
    const canonicalLocalUrl = existing?.localUrl || assetLocalUrl
    if (!canonicalLocalUrl) {
      report.unableToDetermine.push(asset.id)
      return []
    }
    const oldUrls = [asset.publicUrl, assetLocalUrl].filter(
      (value): value is string => Boolean(value) && value !== canonicalLocalUrl
    )
    report.linked++
    if (existing) report.merged++
    if (local && canonicalLocalUrl !== local.localUrl) report.deferredReclaims.push(local.filePath)
    return oldUrls.map((oldUrl) => ({ oldUrl, newUrl: canonicalLocalUrl }))
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${md5}, 0))`)
      const existing = await tx.imageMap.findUnique({ where: { md5 } })
      const imageMap = await tx.imageMap.upsert({
        where: { md5 },
        update: { deletedAt: null, deletedBy: null, retiredAt: null },
        create: {
          id: crypto.randomUUID(),
          md5,
          localUrl: assetLocalUrl || '',
          storageType: 'local',
        },
        select: { id: true, md5: true, localUrl: true, externalUrl: true, s3Url: true },
      })
      if (!imageMap.localUrl) throw new Error('规范 ImageMap 缺少 localUrl')

      const oldUrls = [asset.publicUrl, assetLocalUrl].filter(
        (value): value is string => Boolean(value) && value !== imageMap.localUrl
      )
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          imageMapId: imageMap.id,
          storageKey: extractStorageKeyFromUploadUrl(imageMap.localUrl),
          publicUrl: imageMap.localUrl,
        },
      })
      await tx.galleryImage.updateMany({
        where: { url: { in: oldUrls } },
        data: { url: imageMap.localUrl },
      })
      await tx.event.updateMany({
        where: { coverUrl: { in: oldUrls } },
        data: { coverUrl: imageMap.localUrl },
      })
      await tx.eventPoster.updateMany({
        where: { url: { in: oldUrls } },
        data: { url: imageMap.localUrl },
      })
      await tx.songCover.updateMany({
        where: { publicUrl: { in: oldUrls } },
        data: { publicUrl: imageMap.localUrl },
      })
      await tx.albumCover.updateMany({
        where: { publicUrl: { in: oldUrls } },
        data: { publicUrl: imageMap.localUrl },
      })
      await tx.user.updateMany({
        where: { photoURL: { in: oldUrls } },
        data: { photoURL: imageMap.localUrl },
      })
      return {
        existing: Boolean(existing),
        localUrl: imageMap.localUrl,
        mappings: oldUrls.map((oldUrl) => ({ oldUrl, newUrl: imageMap.localUrl })),
      }
    })

    report.linked++
    if (result.existing) report.merged++
    if (local && result.localUrl !== local.localUrl) report.deferredReclaims.push(local.filePath)
    return result.mappings
  } catch (error) {
    report.errors.push(`${asset.id}: ${error instanceof Error ? error.message : '绑定失败'}`)
    return []
  }
}

async function linkUserAvatars(report: ReconcileReport, options: ReconcileOptions) {
  const users = await prisma.user.findMany({
    where: { photoURL: { startsWith: '/uploads/' }, photoAssetId: null },
    select: { uid: true, photoURL: true },
  })
  for (const user of users) {
    if (!user.photoURL) continue
    const asset = await prisma.mediaAsset.findFirst({
      where: {
        ownerUid: user.uid,
        status: 'ready',
        publicUrl: user.photoURL,
        imageMapId: { not: null },
      },
      select: { id: true },
    })
    if (!asset) continue
    report.userAvatarsLinked++
    if (!options.dryRun) {
      await prisma.user.update({ where: { uid: user.uid }, data: { photoAssetId: asset.id } })
    }
  }
}

export async function reconcileMediaAssets(options: ReconcileOptions): Promise<ReconcileReport> {
  const report = emptyReport(options.dryRun)
  const assets = await prisma.mediaAsset.findMany({
    where: { status: { not: 'deleted' } },
    select: {
      id: true,
      ownerUid: true,
      imageMapId: true,
      storageKey: true,
      publicUrl: true,
      fileName: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const mappings: Array<{ oldUrl: string; newUrl: string }> = []
  for (const asset of assets) {
    mappings.push(...(await reconcileAsset(asset, report, options)))
  }
  const uniqueMappings = [...new Map(mappings.map((mapping) => [mapping.oldUrl, mapping])).values()]
  await rewriteTextFields(prisma, uniqueMappings, report, !options.dryRun)
  await linkUserAvatars(report, options)
  return report
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const report = await reconcileMediaAssets(options)
  console.log(JSON.stringify(report, null, 2))
}

const isExecutedAsScript =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (isExecutedAsScript) {
  main()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
