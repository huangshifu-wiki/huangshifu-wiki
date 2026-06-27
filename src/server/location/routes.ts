import { Router } from 'express';
import {
  searchRegions,
  getRegionByCode,
  getProvinces,
  getCitiesByProvince,
  getDistrictsByCity,
  fuzzyMatchRegion,
  suggestRegions,
  type RegionSearchResult,
} from './locationService';
import { resolveCoordinateToRegion, searchAddress, isAmapConfigured } from './geoService';
import { parseInteger } from '../utils/parsers';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { q, level, parentCode, limit: limitRaw } = req.query;
    const limit = parseInteger(limitRaw, 20, { min: 1, max: 100 });

    if (q && typeof q === 'string') {
      const results = await searchRegions(q, {
        limit,
        level: level ? parseInteger(level, 3, { min: 1, max: 4 }) : undefined,
        parentCode: parentCode as string | undefined,
      });
      res.json({ regions: results });
      return;
    }

    if (parentCode === undefined && !level) {
      const provinces = await getProvinces();
      res.json({ regions: provinces });
      return;
    }

    if (parentCode && typeof parentCode === 'string') {
      const cities = await getCitiesByProvince(parentCode);
      res.json({ regions: cities });
      return;
    }

    if (level) {
      const levelNum = parseInteger(level, 3, { min: 1, max: 4 });
      const regions = await searchRegions('', { level: levelNum, limit });
      res.json({ regions });
      return;
    }

    res.json({ regions: [] });
  } catch (error) {
    console.error('Get regions error:', error);
    res.status(500).json({ error: '获取地区失败' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const { q, limit: limitRaw } = req.query;
    const limit = parseInteger(limitRaw, 20, { min: 1, max: 100 });

    if (!q || typeof q !== 'string') {
      res.json({ regions: [] });
      return;
    }

    const regions = await fuzzyMatchRegion(q, limit);
    res.json({ regions });
  } catch (error) {
    console.error('Search regions error:', error);
    res.status(500).json({ error: '搜索地区失败' });
  }
});

router.get('/suggest', async (req, res) => {
  try {
    const { q, limit: limitRaw } = req.query;
    const limit = parseInteger(limitRaw, 5, { min: 1, max: 100 });

    if (!q || typeof q !== 'string') {
      res.json({ regions: [] });
      return;
    }

    const regions = await suggestRegions(q, limit);
    res.json({ regions });
  } catch (error) {
    console.error('Suggest regions error:', error);
    res.status(500).json({ error: '获取地区建议失败' });
  }
});

router.get('/provinces', async (_req, res) => {
  try {
    const provinces = await getProvinces();
    res.json({ provinces });
  } catch (error) {
    console.error('Get provinces error:', error);
    res.status(500).json({ error: '获取省份失败' });
  }
});

router.get('/cities/:provinceCode', async (req, res) => {
  try {
    const { provinceCode } = req.params;
    const cities = await getCitiesByProvince(provinceCode);
    res.json({ cities });
  } catch (error) {
    console.error('Get cities error:', error);
    res.status(500).json({ error: '获取城市失败' });
  }
});

router.get('/districts/:cityCode', async (req, res) => {
  try {
    const { cityCode } = req.params;
    const districts = await getDistrictsByCity(cityCode);
    res.json({ districts });
  } catch (error) {
    console.error('Get districts error:', error);
    res.status(500).json({ error: '获取区县失败' });
  }
});

// router.get('/path/:code', async (req, res) => {
//   try {
//     const { code } = req.params;
//     const path = await getFullRegionPath(code);
//     res.json({ path });
//   } catch (error) {
//     console.error('Get region path error:', error);
//     res.status(500).json({ error: '获取地区路径失败' });
//   }
// });

router.get('/resolve', async (req, res) => {
  try {
    if (!isAmapConfigured()) {
      res.status(503).json({ error: '地图服务未配置' });
      return;
    }

    const lng = parseFloat(req.query.lng as string);
    const lat = parseFloat(req.query.lat as string);

    if (isNaN(lng) || isNaN(lat)) {
      res.status(400).json({ error: '无效的坐标参数' });
      return;
    }

    const result = await resolveCoordinateToRegion(lng, lat);

    if (!result) {
      res.status(404).json({ error: '无法解析该坐标对应的行政区划' });
      return;
    }

    res.json({ result });
  } catch (error) {
    console.error('Resolve coordinate error:', error);
    res.status(500).json({ error: '解析坐标失败' });
  }
});

router.post('/resolve', async (req, res) => {
  try {
    if (!isAmapConfigured()) {
      res.status(503).json({ error: '地图服务未配置' });
      return;
    }

    const { lng, lat } = req.body as { lng?: number; lat?: number };

    if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) {
      res.status(400).json({ error: '无效的坐标参数' });
      return;
    }

    const result = await resolveCoordinateToRegion(lng, lat);

    if (!result) {
      res.status(404).json({ error: '无法解析该坐标对应的行政区划' });
      return;
    }

    res.json({ result });
  } catch (error) {
    console.error('Resolve coordinate error:', error);
    res.status(500).json({ error: '解析坐标失败' });
  }
});

router.get('/search/address', async (req, res) => {
  try {
    if (!isAmapConfigured()) {
      res.status(503).json({ error: '地图服务未配置' });
      return;
    }

    const { q, city } = req.query;

    if (!q || typeof q !== 'string') {
      res.json({ results: [] });
      return;
    }

    const results = await searchAddress(q, city as string | undefined);
    res.json({ results });
  } catch (error) {
    console.error('Search address error:', error);
    res.status(500).json({ error: '搜索地址失败' });
  }
});

router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const region = await getRegionByCode(code);

    if (!region) {
      res.status(404).json({ error: '地区不存在' });
      return;
    }

    res.json({ region });
  } catch (error) {
    console.error('Get region error:', error);
    res.status(500).json({ error: '获取地区详情失败' });
  }
});

export function registerRegionRoutes(app: Router) {
  app.use('/api/regions', router);
}

export default router;