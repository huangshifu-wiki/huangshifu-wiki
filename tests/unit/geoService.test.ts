import { beforeEach, describe, expect, it, vi } from 'vitest'

const { axiosGet } = vi.hoisted(() => ({ axiosGet: vi.fn() }))

vi.mock('axios', () => ({ default: { get: axiosGet } }))

import {
  addressToCoordinate,
  coordinateToAddress,
  resolveCoordinateToRegion,
  searchAddress,
} from '../../src/server/location/geoService'

describe('geoService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AMAP_API_KEY = 'server-key'
  })

  it('未配置服务端 Key 时返回明确错误且不发请求', async () => {
    delete process.env.AMAP_API_KEY

    await expect(addressToCoordinate('北京市')).rejects.toMatchObject({
      kind: 'not_configured',
    })
    expect(axiosGet).not.toHaveBeenCalled()
  })

  it('地理编码请求统一注入 Key、超时和 JSON 输出参数', async () => {
    axiosGet.mockResolvedValue({
      data: { status: '1', geocodes: [{ location: '116.397428,39.90923' }] },
    })

    await expect(addressToCoordinate('北京市东城区')).resolves.toEqual({
      lng: 116.397428,
      lat: 39.90923,
    })
    expect(axiosGet).toHaveBeenCalledWith(
      'https://restapi.amap.com/v3/geocode/geo',
      expect.objectContaining({
        params: { address: '北京市东城区', output: 'json', key: 'server-key' },
        timeout: 10000,
      })
    )
  })

  it('拒绝畸形地理编码坐标', async () => {
    axiosGet.mockResolvedValue({
      data: { status: '1', geocodes: [{ location: 'invalid' }] },
    })
    await expect(addressToCoordinate('未知地址')).resolves.toBeNull()
  })

  it('规范逆地理编码中的直辖市空 city 字段', async () => {
    axiosGet.mockResolvedValue({
      data: {
        status: '1',
        regeocode: {
          formatted_address: '北京市东城区东华门街道',
          addressComponent: {
            province: '北京市',
            city: [],
            district: '东城区',
            township: '东华门街道',
            adcode: '110101',
          },
        },
      },
    })

    await expect(coordinateToAddress(116.397428, 39.90923)).resolves.toMatchObject({
      city: '',
      province: '北京市',
      adcode: '110101',
    })
    await expect(resolveCoordinateToRegion(116.397428, 39.90923)).resolves.toMatchObject({
      provinceCode: '110000',
      cityCode: '110100',
      city: '北京市',
    })
  })

  it('地址搜索过滤缺失名称或非法坐标的 POI', async () => {
    axiosGet.mockResolvedValue({
      data: {
        status: '1',
        pois: [
          {
            name: '故宫博物院',
            address: '景山前街4号',
            location: '116.397,39.917',
            adcode: '110101',
          },
          { name: '坏数据', address: [], location: 'bad', adcode: '110101' },
          { address: '无名称', location: '116,39', adcode: '110101' },
        ],
      },
    })

    await expect(searchAddress('故宫', '北京')).resolves.toEqual([
      {
        name: '故宫博物院',
        address: '景山前街4号',
        coordinate: { lng: 116.397, lat: 39.917 },
        adcode: '110101',
      },
    ])
  })

  it('将高德业务错误与网络错误区分为稳定错误类型', async () => {
    axiosGet.mockResolvedValueOnce({
      data: { status: '0', info: 'INVALID_USER_KEY', infocode: '10001' },
    })
    await expect(searchAddress('故宫')).rejects.toMatchObject({ kind: 'upstream' })

    axiosGet.mockRejectedValueOnce(new Error('timeout'))
    await expect(searchAddress('故宫')).rejects.toMatchObject({ kind: 'network' })
  })
})
