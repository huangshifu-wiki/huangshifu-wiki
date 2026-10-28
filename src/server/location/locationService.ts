import { Region } from '@prisma/client'
import { prisma } from '../prisma'

export interface RegionSearchResult {
  code: string
  name: string
  fullName: string
  level: number
  levelName: string
  parentCode: string | null
}

const LEVEL_NAMES: Record<number, string> = {
  1: '省级',
  2: '地级',
  3: '县级',
  4: '乡级',
}

function formatRegion(region: Region): RegionSearchResult {
  return {
    code: region.code,
    name: region.name,
    fullName: region.fullName,
    level: region.level,
    levelName: LEVEL_NAMES[region.level] || `Level ${region.level}`,
    parentCode: region.parentCode,
  }
}

export async function searchRegions(
  query: string,
  options: {
    limit?: number
    level?: number
    parentCode?: string
  } = {}
): Promise<RegionSearchResult[]> {
  const { limit = 20, level, parentCode } = options

  const where: Parameters<typeof prisma.region.findMany>[0]['where'] = {
    OR: [
      { name: { contains: query, mode: 'insensitive' } },
      { fullName: { contains: query, mode: 'insensitive' } },
    ],
  }

  if (level !== undefined) {
    where.level = level
  }

  if (parentCode !== undefined) {
    where.parentCode = parentCode
  }

  const regions = await prisma.region.findMany({
    where,
    take: limit,
    orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
  })

  return regions.map(formatRegion)
}

export async function getRegionByCode(code: string): Promise<RegionSearchResult | null> {
  const region = await prisma.region.findUnique({
    where: { code },
  })

  if (!region) return null
  return formatRegion(region)
}

export async function getProvinces(): Promise<RegionSearchResult[]> {
  const regions = await prisma.region.findMany({
    where: { level: 1 },
    orderBy: { sortOrder: 'asc' },
  })
  return regions.map(formatRegion)
}

export async function getCitiesByProvince(provinceCode: string): Promise<RegionSearchResult[]> {
  const regions = await prisma.region.findMany({
    where: { level: 2, parentCode: provinceCode },
    orderBy: { sortOrder: 'asc' },
  })
  return regions.map(formatRegion)
}

export async function getDistrictsByCity(cityCode: string): Promise<RegionSearchResult[]> {
  const regions = await prisma.region.findMany({
    where: { level: 3, parentCode: cityCode },
    orderBy: { sortOrder: 'asc' },
  })
  return regions.map(formatRegion)
}

export async function findMostCommonRegion(codes: string[]): Promise<RegionSearchResult | null> {
  if (codes.length === 0) return null

  const codeCounts = new Map<string, number>()
  codes.forEach((code) => {
    const count = codeCounts.get(code) || 0
    codeCounts.set(code, count + 1)
  })

  let mostCommonCode = codes[0]
  let maxCount = 0
  codeCounts.forEach((count, code) => {
    if (count > maxCount) {
      maxCount = count
      mostCommonCode = code
    }
  })

  return getRegionByCode(mostCommonCode)
}

export async function fuzzyMatchRegion(
  query: string,
  limit: number = 10
): Promise<RegionSearchResult[]> {
  if (!query || query.length < 2) {
    return []
  }

  const regions = await prisma.region.findMany({
    where: {
      OR: [
        { name: { startsWith: query, mode: 'insensitive' } },
        { fullName: { startsWith: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: limit,
    orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
  })

  return regions.map(formatRegion)
}

export async function suggestRegions(
  query: string,
  limit: number = 5
): Promise<RegionSearchResult[]> {
  if (!query || query.length < 1) {
    return []
  }

  const regions = await prisma.region.findMany({
    where: {
      OR: [
        { name: { startsWith: query, mode: 'insensitive' } },
        { fullName: { startsWith: query, mode: 'insensitive' } },
      ],
    },
    take: limit,
    orderBy: { level: 'asc' },
  })

  return regions.map(formatRegion)
}
