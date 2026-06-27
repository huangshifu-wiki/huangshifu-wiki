import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Prisma - must be defined before imports
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function MockPrismaClient() {
    return {
      region: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    }
  }),
  Region: {},
}));

// Import after mocking
import {
  searchRegions,
  getRegionByCode,
  getRegionTree,
  getProvinces,
  getCitiesByProvince,
  getDistrictsByCity,
  getFullRegionPath,
  findMostCommonRegion,
  fuzzyMatchRegion,
  suggestRegions,
  type RegionSearchResult,
  type RegionTreeNode,
} from '../../src/server/location/locationService';

describe('locationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchRegions', () => {
    it('is a function', () => {
      expect(typeof searchRegions).toBe('function');
    });
  });

  describe('getRegionByCode', () => {
    it('is a function', () => {
      expect(typeof getRegionByCode).toBe('function');
    });
  });

  describe('getRegionTree', () => {
    it('is a function', () => {
      expect(typeof getRegionTree).toBe('function');
    });
  });

  describe('getProvinces', () => {
    it('is a function', () => {
      expect(typeof getProvinces).toBe('function');
    });
  });

  describe('getCitiesByProvince', () => {
    it('is a function', () => {
      expect(typeof getCitiesByProvince).toBe('function');
    });
  });

  describe('getDistrictsByCity', () => {
    it('is a function', () => {
      expect(typeof getDistrictsByCity).toBe('function');
    });
  });

  describe('getFullRegionPath', () => {
    it('is a function', () => {
      expect(typeof getFullRegionPath).toBe('function');
    });
  });

  describe('findMostCommonRegion', () => {
    it('is a function', () => {
      expect(typeof findMostCommonRegion).toBe('function');
    });

    it('returns null for empty array', async () => {
      const result = await findMostCommonRegion([]);
      expect(result).toBeNull();
    });
  });

  describe('fuzzyMatchRegion', () => {
    it('is a function', () => {
      expect(typeof fuzzyMatchRegion).toBe('function');
    });

    it('returns empty array for short query', async () => {
      const result = await fuzzyMatchRegion('a');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty query', async () => {
      const result = await fuzzyMatchRegion('');
      expect(result).toEqual([]);
    });
  });

  describe('suggestRegions', () => {
    it('is a function', () => {
      expect(typeof suggestRegions).toBe('function');
    });

    it('returns empty array for empty query', async () => {
      const result = await suggestRegions('');
      expect(result).toEqual([]);
    });
  });

  describe('RegionSearchResult type', () => {
    it('accepts valid result', () => {
      const result: RegionSearchResult = {
        code: '110000',
        name: '北京市',
        fullName: '北京市',
        level: 1,
        levelName: '省级',
        parentCode: null,
      };
      expect(result.code).toBe('110000');
      expect(result.levelName).toBe('省级');
    });
  });

  describe('RegionTreeNode type', () => {
    it('accepts valid node', () => {
      const node: RegionTreeNode = {
        code: '110000',
        name: '北京市',
        fullName: '北京市',
        level: 1,
        levelName: '省级',
      };
      expect(node.code).toBe('110000');
    });

    it('accepts node with children', () => {
      const node: RegionTreeNode = {
        code: '110000',
        name: '北京市',
        fullName: '北京市',
        level: 1,
        levelName: '省级',
        children: [
          {
            code: '110100',
            name: '北京市',
            fullName: '北京市',
            level: 2,
            levelName: '地级',
          },
        ],
      };
      expect(node.children).toHaveLength(1);
    });
  });
});
