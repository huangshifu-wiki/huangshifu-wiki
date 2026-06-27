import { Router } from 'express';
import {
  extractGpsFromImageUrl,
  extractGpsFromMultipleImages,
  findMostFrequentGpsCoordinates,
  type GpsCoordinate,
} from './exifService';
import { resolveCoordinateToRegion, isAmapConfigured } from './geoService';
import { findMostCommonRegion, type RegionSearchResult } from './locationService';
import { requireAuth, requireActiveUser } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types';

const router = Router();

router.post('/extract-gps', requireAuth, requireActiveUser, async (req, res) => {
  try {
    const { imageUrls } = req.body as { imageUrls?: string[] };

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      res.status(400).json({ error: '请提供图片 URL 列表' });
      return;
    }

    const gpsResults = await extractGpsFromMultipleImages(imageUrls);

    const validResults = gpsResults.filter((r) => r.gps !== null);

    if (validResults.length === 0) {
      res.json({
        success: true,
        data: {
          hasGps: false,
          gpsResults: [],
          mostFrequentGps: null,
          regionSuggestion: null,
        },
      });
      return;
    }

    const mostFrequentGps = findMostFrequentGpsCoordinates(gpsResults);

    res.json({
      success: true,
      data: {
        hasGps: true,
        gpsResults,
        mostFrequentGps,
        regionSuggestion: null,
      },
    });
  } catch (error) {
    console.error('Extract GPS error:', error);
    res.status(500).json({ error: '提取 GPS 信息失败' });
  }
});

router.post('/extract-gps-with-region', requireAuth, requireActiveUser, async (req, res) => {
  try {
    if (!isAmapConfigured()) {
      res.status(503).json({ error: '地图服务未配置，无法解析行政区划' });
      return;
    }

    const { imageUrls } = req.body as { imageUrls?: string[] };

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      res.status(400).json({ error: '请提供图片 URL 列表' });
      return;
    }

    const gpsResults = await extractGpsFromMultipleImages(imageUrls);
    const validResults = gpsResults.filter((r) => r.gps !== null);

    if (validResults.length === 0) {
      res.json({
        success: true,
        data: {
          hasGps: false,
          gpsResults: [],
          mostFrequentGps: null,
          regionSuggestion: null,
        },
      });
      return;
    }

    const mostFrequentGps = findMostFrequentGpsCoordinates(gpsResults);
    let regionSuggestion: RegionSearchResult | null = null;

    if (mostFrequentGps) {
      const regionResolve = await resolveCoordinateToRegion(
        mostFrequentGps.longitude,
        mostFrequentGps.latitude
      );

      if (regionResolve) {
        const districtCode = regionResolve.districtCode;
        regionSuggestion = await findMostCommonRegion([districtCode]);

        if (!regionSuggestion && regionResolve.cityCode) {
          regionSuggestion = await findMostCommonRegion([regionResolve.cityCode]);
        }
      }
    }

    res.json({
      success: true,
      data: {
        hasGps: true,
        gpsResults,
        mostFrequentGps,
        regionSuggestion,
      },
    });
  } catch (error) {
    console.error('Extract GPS with region error:', error);
    res.status(500).json({ error: '提取 GPS 信息并解析行政区划失败' });
  }
});

router.get('/extract-single', requireAuth, requireActiveUser, async (req, res) => {
  try {
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: '请提供图片 URL' });
      return;
    }

    const gps = await extractGpsFromImageUrl(url);

    res.json({
      success: true,
      data: {
        url,
        gps,
      },
    });
  } catch (error) {
    console.error('Extract single GPS error:', error);
    res.status(500).json({ error: '提取单张图片 GPS 信息失败' });
  }
});

export function registerExifRoutes(app: Router) {
  app.use('/api/exif', router);
}

export default router;