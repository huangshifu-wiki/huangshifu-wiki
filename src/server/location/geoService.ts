import axios from 'axios'
import { logger } from '../utils/logger'

const AMAP_BASE_URL = 'https://restapi.amap.com/v3'
const AMAP_TIMEOUT_MS = 10000

interface AmapBaseResponse {
  status: string
  infocode?: string
}

type AmapServiceErrorKind = 'not_configured' | 'upstream' | 'network'

export class AmapServiceError extends Error {
  constructor(
    public readonly kind: AmapServiceErrorKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AmapServiceError'
  }
}

export interface Coordinate {
  lng: number
  lat: number
}

export interface GeocodingResult {
  coordinate: Coordinate
  address: string
  province: string
  city: string
  district: string
  township?: string
  adcode: string
}

export interface RegionResolveResult {
  coordinate: Coordinate
  province: string
  provinceCode: string
  city: string
  cityCode: string
  district: string
  districtCode: string
  adcode: string
  formattedAddress: string
}

export interface AddressSearchResult {
  name: string
  address: string
  coordinate: Coordinate
  adcode: string
}

function getAmapKey(): string {
  return process.env.AMAP_API_KEY?.trim() || ''
}

async function amapGet<T extends AmapBaseResponse>(
  endpoint: string,
  params: Record<string, string>
): Promise<T> {
  const key = getAmapKey()
  if (!key) throw new AmapServiceError('not_configured', '高德地图服务未配置')

  try {
    const response = await axios.get<T>(`${AMAP_BASE_URL}${endpoint}`, {
      params: { ...params, key },
      timeout: AMAP_TIMEOUT_MS,
    })

    if (response.data.status !== '1') {
      logger.warn(
        { endpoint, infocode: response.data.infocode },
        'Amap Web Service rejected request'
      )
      throw new AmapServiceError('upstream', '高德地图服务返回错误')
    }

    return response.data
  } catch (error) {
    if (error instanceof AmapServiceError) throw error
    logger.warn({ err: error, endpoint }, 'Amap Web Service request failed')
    throw new AmapServiceError('network', '高德地图服务请求失败', { cause: error })
  }
}

function parseCoordinate(value: string | undefined): Coordinate | null {
  if (!value) return null
  const parts = value.split(',')
  if (parts.length !== 2) return null
  const lng = Number(parts[0])
  const lat = Number(parts[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { lng, lat }
}

export async function addressToCoordinate(address: string): Promise<Coordinate | null> {
  interface GeocodeResponse extends AmapBaseResponse {
    geocodes?: Array<{ location?: string }>
  }

  const data = await amapGet<GeocodeResponse>('/geocode/geo', { address, output: 'json' })
  return parseCoordinate(data.geocodes?.[0]?.location)
}

export async function coordinateToAddress(
  lng: number,
  lat: number
): Promise<GeocodingResult | null> {
  interface RegeoResponse extends AmapBaseResponse {
    regeocode?: {
      addressComponent?: {
        province?: string
        city?: string | string[]
        district?: string
        township?: string
        adcode?: string
      }
      formatted_address?: string
    }
  }

  const data = await amapGet<RegeoResponse>('/geocode/regeo', {
    location: `${lng},${lat}`,
    extensions: 'base',
    output: 'json',
  })
  const component = data.regeocode?.addressComponent
  const adcode = component?.adcode
  if (!component || !adcode || !data.regeocode?.formatted_address) return null

  return {
    coordinate: { lng, lat },
    address: data.regeocode.formatted_address,
    province: component.province || '',
    city: typeof component.city === 'string' ? component.city : '',
    district: component.district || '',
    township: component.township || undefined,
    adcode,
  }
}

export async function resolveCoordinateToRegion(
  lng: number,
  lat: number
): Promise<RegionResolveResult | null> {
  const result = await coordinateToAddress(lng, lat)
  if (!result) return null

  return {
    coordinate: { lng, lat },
    province: result.province,
    provinceCode: `${result.adcode.slice(0, 2)}0000`,
    city: result.city || result.province,
    cityCode: `${result.adcode.slice(0, 4)}00`,
    district: result.district,
    districtCode: result.adcode,
    adcode: result.adcode,
    formattedAddress: result.address,
  }
}

export async function searchAddress(
  keyword: string,
  city?: string
): Promise<AddressSearchResult[]> {
  interface TextSearchResponse extends AmapBaseResponse {
    pois?: Array<{
      name?: string
      location?: string
      address?: string | string[]
      adcode?: string
    }>
  }

  const data = await amapGet<TextSearchResponse>('/place/text', {
    keywords: keyword,
    output: 'json',
    ...(city ? { city } : {}),
  })

  return (data.pois || []).flatMap((poi) => {
    const coordinate = parseCoordinate(poi.location)
    if (!coordinate || !poi.name) return []
    return [
      {
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        coordinate,
        adcode: poi.adcode || '',
      },
    ]
  })
}

export function isAmapConfigured(): boolean {
  return Boolean(getAmapKey())
}
