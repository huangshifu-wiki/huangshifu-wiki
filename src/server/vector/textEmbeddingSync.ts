import { EmbeddingStatus, PrismaClient } from '@prisma/client'

import { generateTextEmbedding, getEmbeddingModelName, getEmbeddingVectorSize } from './clipEmbedding'
import { upsertTextEmbeddingPoint, deleteTextEmbeddingPoint, deleteTextEmbeddingPointsBySource } from './qdrantService'

export function chunkText(text: string, maxChars: number = 150, overlapChars: number = 30): string[] {
  if (!text || text.trim().length === 0) {
    return []
  }

  if (text.length <= maxChars) {
    return [text]
  }

  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)
  const chunks: string[] = []
  let currentChunk = ''

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk)
        currentChunk = ''
      }

      const sentences = paragraph.split(/([。！？；])/)
      let sentenceChunk = ''

      for (let i = 0; i < sentences.length; i++) {
        const part = sentences[i]
        if (!part) continue

        sentenceChunk += part

        if (/[。！？；]/.test(part) || i === sentences.length - 1) {
          if (sentenceChunk.length > maxChars) {
            if (sentenceChunk.length > 0) {
              chunks.push(sentenceChunk)
              const overlapText = sentenceChunk.slice(-overlapChars)
              sentenceChunk = overlapText
            }
          } else if ((sentenceChunk + (sentences.slice(i + 1).join('') || '')).length > maxChars) {
            chunks.push(sentenceChunk)
            const overlapText = sentenceChunk.slice(-overlapChars)
            sentenceChunk = overlapText
          }
        }
      }

      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk
      }

      continue
    }

    if (currentChunk.length + paragraph.length + 2 > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk)
        const overlapText = currentChunk.slice(-overlapChars)
        currentChunk = overlapText
      }
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk)
  }

  const finalChunks: string[] = []
  for (const chunk of chunks) {
    if (chunk.length > maxChars) {
      for (let i = 0; i < chunk.length; i += maxChars - overlapChars) {
        finalChunks.push(chunk.slice(i, i + maxChars))
      }
    } else {
      finalChunks.push(chunk)
    }
  }

  return finalChunks
}

export function stripMarkdown(text: string): string {
  if (!text || typeof text !== 'string') return ''
  let result = text
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/gi, '')
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/gi, '$1')
  result = result.replace(/#{1,6}\s+/g, '')
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
  result = result.replace(/<[^>]+>/g, '')
  result = result.replace(/^(-{3,}|\*{3,})$/gm, '')
  result = result.replace(/\s+/g, ' ')
  return result.trim()
}

export function prepareEntityText(
  entity: Record<string, unknown>,
  sourceType: 'wiki' | 'post' | 'music' | 'album',
): string {
  switch (sourceType) {
    case 'wiki':
      return stripMarkdown(`${entity.title || ''}\n\n${entity.content || ''}`)
    case 'post':
      return stripMarkdown(`${entity.title || ''}\n\n${entity.content || ''}`)
    case 'music': {
      const parts = [`${entity.title || ''} - ${entity.artist || ''} | ${entity.album || ''}`]
      const lyric = entity.lyric as string | null | undefined
      if (lyric) {
        parts.push(lyric.slice(0, 500))
      }
      return parts.join('\n\n')
    }
    case 'album': {
      const parts = [`${entity.title || ''} - ${entity.artist || ''}`]
      const description = entity.description as string | null | undefined
      if (description) {
        parts.push(description)
      }
      return parts.join('\n\n')
    }
    default:
      return ''
  }
}

export async function enqueueWikiTextEmbeddings(
  prisma: PrismaClient,
  slugs: string[],
): Promise<{ requested: number; queued: number }> {
  const uniqueSlugs = Array.from(new Set(slugs.map((s) => s.trim()).filter(Boolean)))
  if (uniqueSlugs.length === 0) {
    return { requested: 0, queued: 0 }
  }

  const wikiPages = await prisma.wikiPage.findMany({
    where: { slug: { in: uniqueSlugs }, status: 'published' },
    select: { slug: true, title: true, content: true },
  })

  let queued = 0
  const modelName = getEmbeddingModelName()
  const vectorSize = getEmbeddingVectorSize()

  for (const page of wikiPages) {
    await prisma.textEmbeddingChunk.deleteMany({
      where: { sourceType: 'wiki', sourceId: page.slug },
    })
    await deleteTextEmbeddingPointsBySource('wiki', page.slug)

    const text = prepareEntityText(page as unknown as Record<string, unknown>, 'wiki')
    const chunks = chunkText(text)

    for (let i = 0; i < chunks.length; i++) {
      await prisma.textEmbeddingChunk.upsert({
        where: {
          sourceType_sourceId_chunkIndex: {
            sourceType: 'wiki',
            sourceId: page.slug,
            chunkIndex: i,
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
        },
        create: {
          sourceType: 'wiki',
          sourceId: page.slug,
          chunkIndex: i,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
          modelName,
          vectorSize,
          status: EmbeddingStatus.pending,
        },
      })
      queued += 1
    }
  }

  return { requested: uniqueSlugs.length, queued }
}

export async function enqueuePostTextEmbeddings(
  prisma: PrismaClient,
  postIds: string[],
): Promise<{ requested: number; queued: number }> {
  const uniqueIds = Array.from(new Set(postIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { requested: 0, queued: 0 }
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: uniqueIds }, status: 'published' },
    select: { id: true, title: true, content: true },
  })

  let queued = 0
  const modelName = getEmbeddingModelName()
  const vectorSize = getEmbeddingVectorSize()

  for (const post of posts) {
    await prisma.textEmbeddingChunk.deleteMany({
      where: { sourceType: 'post', sourceId: post.id },
    })
    await deleteTextEmbeddingPointsBySource('post', post.id)

    const text = prepareEntityText(post as unknown as Record<string, unknown>, 'post')
    const chunks = chunkText(text)

    for (let i = 0; i < chunks.length; i++) {
      await prisma.textEmbeddingChunk.upsert({
        where: {
          sourceType_sourceId_chunkIndex: {
            sourceType: 'post',
            sourceId: post.id,
            chunkIndex: i,
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
        },
        create: {
          sourceType: 'post',
          sourceId: post.id,
          chunkIndex: i,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
          modelName,
          vectorSize,
          status: EmbeddingStatus.pending,
        },
      })
      queued += 1
    }
  }

  return { requested: uniqueIds.length, queued }
}

export async function enqueueMusicTextEmbeddings(
  prisma: PrismaClient,
  musicIds: string[],
): Promise<{ requested: number; queued: number }> {
  const uniqueIds = Array.from(new Set(musicIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { requested: 0, queued: 0 }
  }

  const tracks = await prisma.musicTrack.findMany({
    where: { docId: { in: uniqueIds } },
    select: { docId: true, title: true, artist: true, album: true, lyric: true },
  })

  let queued = 0
  const modelName = getEmbeddingModelName()
  const vectorSize = getEmbeddingVectorSize()

  for (const track of tracks) {
    const text = prepareEntityText(track as unknown as Record<string, unknown>, 'music')
    const chunks = chunkText(text)

    for (let i = 0; i < chunks.length; i++) {
      await prisma.textEmbeddingChunk.upsert({
        where: {
          sourceType_sourceId_chunkIndex: {
            sourceType: 'music',
            sourceId: track.docId,
            chunkIndex: i,
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
        },
        create: {
          sourceType: 'music',
          sourceId: track.docId,
          chunkIndex: i,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
          modelName,
          vectorSize,
          status: EmbeddingStatus.pending,
        },
      })
      queued += 1
    }
  }

  return { requested: uniqueIds.length, queued }
}

export async function enqueueAlbumTextEmbeddings(
  prisma: PrismaClient,
  albumIds: string[],
): Promise<{ requested: number; queued: number }> {
  const uniqueIds = Array.from(new Set(albumIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { requested: 0, queued: 0 }
  }

  const albums = await prisma.album.findMany({
    where: { docId: { in: uniqueIds } },
    select: { docId: true, title: true, artist: true, description: true },
  })

  let queued = 0
  const modelName = getEmbeddingModelName()
  const vectorSize = getEmbeddingVectorSize()

  for (const album of albums) {
    const text = prepareEntityText(album as unknown as Record<string, unknown>, 'album')
    const chunks = chunkText(text)

    for (let i = 0; i < chunks.length; i++) {
      await prisma.textEmbeddingChunk.upsert({
        where: {
          sourceType_sourceId_chunkIndex: {
            sourceType: 'album',
            sourceId: album.docId,
            chunkIndex: i,
          },
        },
        update: {
          status: EmbeddingStatus.pending,
          lastError: null,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
        },
        create: {
          sourceType: 'album',
          sourceId: album.docId,
          chunkIndex: i,
          chunkText: chunks[i],
          chunkPreview: chunks[i].slice(0, 200),
          modelName,
          vectorSize,
          status: EmbeddingStatus.pending,
        },
      })
      queued += 1
    }
  }

  return { requested: uniqueIds.length, queued }
}

export async function enqueueMissingTextEmbeddings(
  prisma: PrismaClient,
  sourceType?: 'wiki' | 'post' | 'music' | 'album',
  limit: number = 100,
): Promise<{ queued: number }> {
  const types: Array<'wiki' | 'post' | 'music' | 'album'> = sourceType ? [sourceType] : ['wiki', 'post', 'music', 'album']
  let totalQueued = 0

  for (const type of types) {
    const existingChunks = await prisma.textEmbeddingChunk.findMany({
      where: { sourceType: type },
      select: { sourceId: true },
      distinct: ['sourceId'],
    })
    const existingSourceIds = Array.from(new Set(existingChunks.map((c) => c.sourceId)))

    const remaining = limit - totalQueued
    if (remaining <= 0) break

    let result = { requested: 0, queued: 0 }

    switch (type) {
      case 'wiki': {
        const missing = await prisma.wikiPage.findMany({
          where: { slug: { notIn: existingSourceIds }, status: 'published' },
          select: { slug: true },
          take: remaining,
          orderBy: { updatedAt: 'asc' },
        })
        if (missing.length > 0) {
          result = await enqueueWikiTextEmbeddings(prisma, missing.map((w) => w.slug))
        }
        break
      }
      case 'post': {
        const missing = await prisma.post.findMany({
          where: { id: { notIn: existingSourceIds }, status: 'published' },
          select: { id: true },
          take: remaining,
          orderBy: { updatedAt: 'asc' },
        })
        if (missing.length > 0) {
          result = await enqueuePostTextEmbeddings(prisma, missing.map((p) => p.id))
        }
        break
      }
      case 'music': {
        const missing = await prisma.musicTrack.findMany({
          where: { docId: { notIn: existingSourceIds } },
          select: { docId: true },
          take: remaining,
          orderBy: { updatedAt: 'asc' },
        })
        if (missing.length > 0) {
          result = await enqueueMusicTextEmbeddings(prisma, missing.map((m) => m.docId))
        }
        break
      }
      case 'album': {
        const missing = await prisma.album.findMany({
          where: { docId: { notIn: existingSourceIds } },
          select: { docId: true },
          take: remaining,
          orderBy: { updatedAt: 'asc' },
        })
        if (missing.length > 0) {
          result = await enqueueAlbumTextEmbeddings(prisma, missing.map((a) => a.docId))
        }
        break
      }
    }

    totalQueued += result.queued
  }

  return { queued: totalQueued }
}

export async function syncTextEmbeddingBatch(
  prisma: PrismaClient,
  options: { limit?: number; includeFailed?: boolean } = {},
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const limit = Math.max(1, options.limit ?? 100)

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
  await prisma.textEmbeddingChunk.updateMany({
    where: {
      status: EmbeddingStatus.processing,
      updatedAt: { lt: thirtyMinutesAgo },
    },
    data: {
      status: EmbeddingStatus.pending,
      lastError: null,
    },
  })

  const acceptedStatuses: EmbeddingStatus[] = [EmbeddingStatus.pending]
  if (options.includeFailed) {
    acceptedStatuses.push(EmbeddingStatus.failed)
  }

  const candidates = await prisma.textEmbeddingChunk.findMany({
    where: { status: { in: acceptedStatuses } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })

  if (candidates.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  await prisma.textEmbeddingChunk.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: {
      status: EmbeddingStatus.processing,
      lastError: null,
    },
  })

  let succeeded = 0
  let failed = 0

  for (const chunk of candidates) {
    try {
      if (chunk.qdrantPointId) {
        await deleteTextEmbeddingPoint(chunk.qdrantPointId).catch(() => {})
      }

      const vector = await generateTextEmbedding(chunk.chunkText)
      const qdrantPointId = crypto.randomUUID()

      await upsertTextEmbeddingPoint({
        pointId: qdrantPointId,
        vector,
        sourceType: chunk.sourceType,
        sourceId: chunk.sourceId,
        chunkIndex: chunk.chunkIndex,
        chunkPreview: chunk.chunkPreview || chunk.chunkText.slice(0, 200),
        updatedAt: new Date().toISOString(),
      })

      await prisma.textEmbeddingChunk.update({
        where: { id: chunk.id },
        data: {
          status: EmbeddingStatus.ready,
          qdrantPointId,
          embeddedAt: new Date(),
          lastError: null,
          modelName: getEmbeddingModelName(),
          vectorSize: getEmbeddingVectorSize(),
        },
      })

      succeeded += 1
    } catch (error) {
      const reason = (error as Error).message
      await prisma.textEmbeddingChunk.update({
        where: { id: chunk.id },
        data: {
          status: EmbeddingStatus.failed,
          lastError: reason,
        },
      })
      failed += 1
    }
  }

  return { processed: candidates.length, succeeded, failed }
}

export async function deleteTextEmbeddingsForSource(
  prisma: PrismaClient,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  const chunks = await prisma.textEmbeddingChunk.findMany({
    where: { sourceType, sourceId },
    select: { id: true, qdrantPointId: true },
  })

  for (const chunk of chunks) {
    if (chunk.qdrantPointId) {
      try {
        await deleteTextEmbeddingPoint(chunk.qdrantPointId)
      } catch (error) {
        console.warn(
          `[TextEmbeddingSync] 删除 Qdrant 点失败: pointId=${chunk.qdrantPointId}, error=${(error as Error).message}`,
        )
      }
    }
  }

  await prisma.textEmbeddingChunk.deleteMany({
    where: { sourceType, sourceId },
  })
}

export async function retryFailedTextEmbeddings(
  prisma: PrismaClient,
  options: { limit?: number; sourceType?: 'wiki' | 'post' | 'music' | 'album' } = {},
): Promise<{ resetCount: number; processedCount: number } & Awaited<ReturnType<typeof syncTextEmbeddingBatch>>> {
  const limit = options.limit ?? 100
  const where: { status: EmbeddingStatus; sourceType?: string } = { status: EmbeddingStatus.failed }
  if (options.sourceType) {
    where.sourceType = options.sourceType
  }

  const failedIds = await prisma.textEmbeddingChunk.findMany({
    where,
    select: { id: true },
    take: limit,
  })
  const updated = await prisma.textEmbeddingChunk.updateMany({
    where: { id: { in: failedIds.map((r) => r.id) } },
    data: { status: EmbeddingStatus.pending, lastError: null },
  })

  const syncResult = await syncTextEmbeddingBatch(prisma, {
    limit,
    includeFailed: true,
  })

  return { resetCount: updated.count, processedCount: syncResult.processed, ...syncResult }
}

export async function rebuildAllTextEmbeddings(
  prisma: PrismaClient,
  options: { limit?: number; sourceType?: 'wiki' | 'post' | 'music' | 'album' } = {},
): Promise<{ resetCount: number } & Awaited<ReturnType<typeof syncTextEmbeddingBatch>>> {
  const where: { sourceType?: string } = {}
  if (options.sourceType) {
    where.sourceType = options.sourceType
  }

  const updated = await prisma.textEmbeddingChunk.updateMany({
    where,
    data: { status: EmbeddingStatus.pending, lastError: null },
  })

  const syncResult = await syncTextEmbeddingBatch(prisma, {
    limit: options.limit ?? 100,
    includeFailed: true,
  })

  return { resetCount: updated.count, ...syncResult }
}
