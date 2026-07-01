import { Router } from 'express'
import { prisma, resolveMusicPlayUrl, toSongResponse, normalizeMusicImportTracks } from '../utils'
import {
  getMusicResourcePreview,
  resolveAudioUrl as resolveMetingAudioUrl,
  resolveLyric as resolveMetingLyric,
} from '../music/metingService'
const router = Router()

router.get('/song/:id', async (req, res) => {
  const { id } = req.params

  try {
    const existingSource = await prisma.musicExternalSource.findFirst({
      where: {
        resourceType: 'song',
        sourceId: id,
      },
      include: {
        song: {
          include: {
            covers: {
              orderBy: { sortOrder: 'asc' },
            },
            albumRelations: {
              include: {
                album: {
                  include: {
                    covers: {
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                },
              },
              orderBy: [{ discNumber: 'asc' }, { trackOrder: 'asc' }],
            },
            instrumentalLinks: {
              select: {
                targetSongDocId: true,
              },
            },
            externalSources: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    })
    const existing = existingSource?.song || null

    if (existing && !existing.deletedAt) {
      const resolved = await resolveMusicPlayUrl(existing)
      const song = toSongResponse(existing)
      res.json({
        ...song,
        playUrl: resolved.playUrl || song.audioUrl,
        playMeta: {
          platform: resolved.platform,
          sourceId: resolved.sourceId,
          cached: resolved.cached,
          cacheExpiresAt: resolved.cacheExpiresAt,
          fallback: Boolean((resolved as { fallback?: boolean }).fallback),
        },
      })
      return
    }

    const preview = await getMusicResourcePreview('netease', 'song', id)
    const track = normalizeMusicImportTracks(preview.songs)[0]
    if (!track) {
      res.status(404).json({ error: '未找到歌曲信息' })
      return
    }

    const audioUrl = await resolveMetingAudioUrl('netease', track.urlId)
    const lyric = await resolveMetingLyric('netease', track.lyricId)

    res.json({
      docId: null,
      title: track.title || preview.title,
      artists: track.artists.length ? track.artists : [preview.artist],
      lyricists: [],
      composers: [],
      arrangers: [],
      vocals: [],
      album: track.album || preview.title,
      description: null,
      releaseDate: null,
      durationMs: null,
      cover: track.cover || preview.cover,
      audioUrl: audioUrl || '',
      playUrl: audioUrl || '',
      lyric: lyric || null,
      sources: [
        {
          id: `preview-netease-${track.sourceId}`,
          resourceType: 'song',
          platform: 'netease',
          sourceId: track.sourceId,
          sourceUrl: track.sourceUrl,
          isPrimary: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      playable: Boolean(audioUrl),
      customPlatformLinks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching song metadata:', error)
    res.status(500).json({ error: 'Failed to fetch song metadata' })
  }
})

export function registerMusicSongRoutes(app: Router) {
  app.use('/api/music', router)
}
