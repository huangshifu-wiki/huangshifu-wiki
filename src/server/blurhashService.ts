import fs from 'fs';
import { encode } from 'blurhash';
import sharp from 'sharp';

export interface BlurhashConfig {
  enabled: boolean;
  autoGenerate: boolean;
  componentsX: number;
  componentsY: number;
}

export interface BlurhashResult {
  blurhash?: string;
  thumbhash?: string;
}

const DEFAULT_BLURHASH_CONFIG: BlurhashConfig = {
  enabled: true,
  autoGenerate: true,
  componentsX: 4,
  componentsY: 3,
};

let cachedConfig: BlurhashConfig | null = null;

function getBlurhashConfig(): BlurhashConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const enabled = process.env.BLURHASH_ENABLED !== 'false';
  const autoGenerate = process.env.BLURHASH_AUTO_GENERATE !== 'false';
  const componentsX = parseInt(process.env.BLURHASH_COMPONENTS_X || '4', 10);
  const componentsY = parseInt(process.env.BLURHASH_COMPONENTS_Y || '3', 10);

  cachedConfig = {
    enabled,
    autoGenerate,
    componentsX: isNaN(componentsX) ? 4 : componentsX,
    componentsY: isNaN(componentsY) ? 3 : componentsY,
  };

  return cachedConfig;
}

export function isBlurhashEnabled(): boolean {
  return getBlurhashConfig().enabled;
}

export function shouldAutoGenerate(): boolean {
  return getBlurhashConfig().autoGenerate;
}

const blurhashCache = new Map<string, BlurhashResult>();
const BLURHASH_CACHE_TTL = 60 * 60 * 1000;

function getCachedBlurhash(key: string): BlurhashResult | null {
  const cached = blurhashCache.get(key);
  if (cached) {
    const timestamp = blurhashCache.get(`_timestamp_${key}`);
    if (timestamp && Date.now() - (timestamp as any) < BLURHASH_CACHE_TTL) {
      return cached;
    }
    blurhashCache.delete(key);
    blurhashCache.delete(`_timestamp_${key}`);
  }
  return null;
}

function setCachedBlurhash(key: string, result: BlurhashResult): void {
  blurhashCache.set(key, result);
  blurhashCache.set(`_timestamp_${key}`, Date.now() as any);
}

async function extractPixels(buffer: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const metadata = await sharp(buffer).metadata();

    // Downsize very large images to keep encoding fast
    const MAX_DIMENSION = 100;
    let targetWidth = metadata.width ?? 64;
    let targetHeight = metadata.height ?? 64;

    if (metadata.width && metadata.height) {
      const maxSide = Math.max(metadata.width, metadata.height);
      if (maxSide > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / maxSide;
        targetWidth = Math.max(1, Math.round(metadata.width * scale));
        targetHeight = Math.max(1, Math.round(metadata.height * scale));
      }
    }

    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .removeAlpha()
      .resize(targetWidth, targetHeight, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    console.error('[Blurhash] Failed to extract pixels:', error);
    return null;
  }
}

export async function generateBlurhashFromBuffer(buffer: Buffer): Promise<string | null> {
  if (!isBlurhashEnabled()) {
    console.log('[Blurhash] Blurhash is disabled');
    return null;
  }

  if (!buffer || buffer.length === 0) {
    console.warn('[Blurhash] Empty buffer provided');
    return null;
  }

  const config = getBlurhashConfig();

  try {
    const pixels = await extractPixels(buffer);
    if (!pixels) {
      return null;
    }

    const blurhash = encode(pixels.data, pixels.width, pixels.height, config.componentsX, config.componentsY);

    if (!blurhash || blurhash.length < 4) {
      console.warn('[Blurhash] Invalid blurhash generated');
      return null;
    }

    console.log(
      `[Blurhash] Generated blurhash (${pixels.width}x${pixels.height}): ${blurhash.substring(0, 20)}...`
    );
    return blurhash;
  } catch (error) {
    console.error('[Blurhash] Error generating blurhash from buffer:', error);
    return null;
  }
}

export async function generateBlurhashFromFile(filePath: string): Promise<string | null> {
  if (!isBlurhashEnabled()) {
    console.log('[Blurhash] Blurhash is disabled');
    return null;
  }

  if (!filePath) {
    console.warn('[Blurhash] File path is empty');
    return null;
  }

  const cacheKey = `blurhash_file_${filePath}`;
  const cached = getCachedBlurhash(cacheKey);
  if (cached?.blurhash) {
    console.log('[Blurhash] Using cached blurhash for:', filePath);
    return cached.blurhash;
  }

  try {
    const buffer = await fs.promises.readFile(filePath);
    const blurhash = await generateBlurhashFromBuffer(buffer);

    if (blurhash) {
      const result: BlurhashResult = { blurhash };
      setCachedBlurhash(cacheKey, result);
    }

    return blurhash;
  } catch (error) {
    console.error('[Blurhash] Error generating blurhash from file:', error);
    return null;
  }
}

export async function generateThumbhashFromFile(_filePath: string): Promise<string | null> {
  // Thumbhash generation is not prioritized; returning null as placeholder.
  console.log('[Thumbhash] Thumbhash generation not yet implemented');
  return null;
}

export async function generateImageHashesFromFile(filePath: string): Promise<BlurhashResult> {
  if (!isBlurhashEnabled()) {
    console.log('[Blurhash] Blurhash is disabled');
    return {};
  }

  const cacheKey = `hashes_file_${filePath}`;
  const cached = getCachedBlurhash(cacheKey);
  if (cached) {
    console.log('[Blurhash] Using cached hashes for:', filePath);
    return cached;
  }

  const config = getBlurhashConfig();
  const result: BlurhashResult = {};

  if (config.autoGenerate) {
    console.log('[Blurhash] Auto-generating hashes for:', filePath);

    const blurhash = await generateBlurhashFromFile(filePath);
    if (blurhash) {
      result.blurhash = blurhash;
    }

    if (Object.keys(result).length > 0) {
      setCachedBlurhash(cacheKey, result);
    }
  }

  return result;
}

export async function refreshImageHashesFromFile(filePath: string): Promise<BlurhashResult> {
  const cacheKey = `hashes_file_${filePath}`;
  blurhashCache.delete(cacheKey);
  blurhashCache.delete(`blurhash_file_${filePath}`);

  return generateImageHashesFromFile(filePath);
}

export function clearBlurhashCache(): void {
  blurhashCache.clear();
  console.log('[Blurhash] Cache cleared');
}

export function getBlurhashCacheSize(): number {
  return Math.floor(blurhashCache.size / 2);
}
