import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

dotenv.config({ path: '.env.local' });
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REGIONS_JSON_URL = 'https://raw.githubusercontent.com/slightlee/regions-data/main/data/processed/regions_20260304_173812.json';
const IMPORT_BATCH_SIZE = 1000;

interface RawRegion {
  code: string;
  name: string;
  level: number;
  depth: number;
  parent_code: string | null;
  path: string;
  type?: string;
}

interface RegionData {
  code: string;
  name: string;
  fullName: string;
  level: number;
  depth: number | null;
  parentCode: string | null;
  path: string | null;
  type: string | null;
  year: number;
  sortOrder: number;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function fetchRegionsJson(): Promise<RawRegion[]> {
  console.log('Fetching regions data from GitHub...');
  const json = await httpGet(REGIONS_JSON_URL);
  const parsed = JSON.parse(json);
  return parsed.data as RawRegion[];
}

function buildFullNameMap(regions: RawRegion[]): Map<string, string> {
  const codeMap = new Map<string, RawRegion>();
  regions.forEach(r => codeMap.set(r.code, r));

  const fullNameMap = new Map<string, string>();

  function getFullName(code: string): string {
    if (fullNameMap.has(code)) {
      return fullNameMap.get(code)!;
    }
    const region = codeMap.get(code);
    if (!region) {
      return '';
    }
    if (!region.parent_code) {
      const name = region.name;
      fullNameMap.set(code, name);
      return name;
    }
    const parentFullName = getFullName(region.parent_code);
    const fullName = parentFullName ? `${parentFullName}${region.name}` : region.name;
    fullNameMap.set(code, fullName);
    return fullName;
  }

  regions.forEach(r => getFullName(r.code));
  return fullNameMap;
}

function transformRegion(raw: RawRegion, fullName: string, sortOrder: number): RegionData {
  const LEVEL_TYPE_MAP: Record<number, string> = {
    1: '省级',
    2: '地级',
    3: '县级',
    4: '乡级',
  };

  return {
    code: raw.code,
    name: raw.name,
    fullName: fullName,
    level: raw.level,
    depth: raw.depth ?? null,
    parentCode: raw.parent_code,
    path: raw.path ?? null,
    type: raw.type || LEVEL_TYPE_MAP[raw.level] || null,
    year: 2026,
    sortOrder,
  };
}

async function importRegions() {
  console.log('Starting regions import...');

  const rawRegions = await fetchRegionsJson();
  console.log(`Fetched ${rawRegions.length} raw regions`);

  const fullNameMap = buildFullNameMap(rawRegions);

  const codeSet = new Set<string>();
  const regions: RegionData[] = rawRegions
    .filter(r => {
      if (codeSet.has(r.code)) {
        return false;
      }
      codeSet.add(r.code);
      return true;
    })
    .map((r, index) => transformRegion(r, fullNameMap.get(r.code) || r.name, index));

  console.log(`Transformed ${regions.length} unique regions`);

  await prisma.region.deleteMany({});
  console.log('Cleared existing regions');

  let imported = 0;
  for (let i = 0; i < regions.length; i += IMPORT_BATCH_SIZE) {
    const batch = regions.slice(i, i + IMPORT_BATCH_SIZE);
    await prisma.region.createMany({ data: batch });
    imported += batch.length;
    console.log(`Imported ${imported}/${regions.length} regions`);
  }

  console.log('Regions import completed!');

  const stats = await prisma.region.groupBy({
    by: ['level'],
    _count: { code: true },
  });

  console.log('\nImport statistics:');
  const levelNames: Record<number, string> = { 1: '省级', 2: '地级', 3: '县级', 4: '乡级' };
  stats.forEach(s => {
    console.log(`  ${levelNames[s.level] || `Level ${s.level}`}: ${s._count.code}`);
  });
}

async function main() {
  try {
    await importRegions();
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();