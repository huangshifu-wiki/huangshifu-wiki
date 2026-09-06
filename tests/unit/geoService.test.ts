import { beforeEach, describe, expect, it, vi } from 'vitest'

const { axiosGet, getSecretsMock } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  getSecretsMock: vi.fn(),
}))

vi.mock('axios', () => ({ default: { get: axiosGet } }))

vi.mock('../../src/server/services/secretsConfig.service', () => ({
  secretsConfigService: { getSecrets: getSecretsMock },
}))

import { resolveCoordinateToRegion, searchAddress } from '../../src/server/location/geoService'

describe('geoService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSecretsMock.mockReturnValue({ amapApiKey: 'server-key' })
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
