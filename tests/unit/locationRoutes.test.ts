import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveCoordinateToRegion, searchAddress } = vi.hoisted(() => ({
  resolveCoordinateToRegion: vi.fn(),
  searchAddress: vi.fn(),
}))

vi.mock('../../src/server/location/geoService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/location/geoService')>()
  return { ...actual, resolveCoordinateToRegion, searchAddress }
})

import { AmapServiceError } from '../../src/server/location/geoService'
import { registerRegionRoutes } from '../../src/server/location/routes'

const app = express()
app.use(express.json())
registerRegionRoutes(app)

describe('高德地区路由', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('拒绝越界或缺失的坐标', async () => {
    await request(app).get('/api/regions/resolve').query({ lng: 181, lat: 39 }).expect(400)
    await request(app).get('/api/regions/resolve?lng=&lat=').expect(400)
    await request(app).post('/api/regions/resolve').send({ lng: 116 }).expect(400)
    expect(resolveCoordinateToRegion).not.toHaveBeenCalled()
  })

  it('地图服务未配置时返回 503', async () => {
    resolveCoordinateToRegion.mockRejectedValue(
      new AmapServiceError('not_configured', '高德地图服务未配置')
    )
    await request(app).get('/api/regions/resolve').query({ lng: 116, lat: 39 }).expect(503)
  })

  it('上游异常时返回 502 且不泄露原始错误', async () => {
    resolveCoordinateToRegion.mockRejectedValue(
      new AmapServiceError('upstream', 'INVALID_USER_KEY')
    )
    const response = await request(app)
      .get('/api/regions/resolve')
      .query({ lng: 116, lat: 39 })
      .expect(502)
    expect(response.body).toEqual({ error: '地图服务暂时不可用' })
  })

  it('规范搜索参数并返回兼容的结果结构', async () => {
    searchAddress.mockResolvedValue([])
    const response = await request(app)
      .get('/api/regions/search/address')
      .query({ q: '  故宫  ', city: '北京' })
      .expect(200)
    expect(searchAddress).toHaveBeenCalledWith('故宫', '北京')
    expect(response.body).toEqual({ results: [] })
  })

  it('空白或过长搜索词返回 400', async () => {
    await request(app).get('/api/regions/search/address').query({ q: '   ' }).expect(400)
    await request(app)
      .get('/api/regions/search/address')
      .query({ q: 'x'.repeat(101) })
      .expect(400)
  })
})
