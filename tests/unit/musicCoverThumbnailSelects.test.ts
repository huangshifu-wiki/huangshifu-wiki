import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

function expectSelectsThumbnail(source: string, anchor: string) {
  const start = source.indexOf(anchor)
  expect(start).toBeGreaterThanOrEqual(0)
  const coversStart = source.indexOf('covers:', start)
  expect(coversStart).toBeGreaterThanOrEqual(0)
  const snippet = source.slice(coversStart, coversStart + 360)
  expect(snippet).toContain('publicUrl: true')
  expect(snippet).toContain('thumbnailUrl: true')
  expect(snippet).toContain('isDefault: true')
}

describe('music cover thumbnail selects', () => {
  it('search and admin music queries select cover thumbnail urls', () => {
    const searchRoutes = fs.readFileSync(
      path.join(process.cwd(), 'src/server/routes/search.routes.ts'),
      'utf8'
    )
    const adminRoutes = fs.readFileSync(
      path.join(process.cwd(), 'src/server/routes/admin.routes.ts'),
      'utf8'
    )

    expectSelectsThumbnail(searchRoutes, 'const musicPromise = wantsMusic')
    expectSelectsThumbnail(searchRoutes, 'albumRelations: {\n              include:')
    expectSelectsThumbnail(searchRoutes, 'const albumsPromise = wantsAlbums')
    expectSelectsThumbnail(searchRoutes, 'songRelations: {\n              include:')
    expectSelectsThumbnail(adminRoutes, 'prisma.musicTrack.findMany({')
    expectSelectsThumbnail(adminRoutes, 'albumRelations: {\n                select:')
  })
})
