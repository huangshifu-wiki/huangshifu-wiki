import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Prisma, UserRole as PrismaUserRole } from '@prisma/client';

import { prisma } from '../prisma';
export { prisma };
import { enhancedCache, CACHE_KEYS } from './cache';
import type { MusicPlatform, PlayUrlCacheValue } from '../types';

// axios 默认配置
axios.defaults.timeout = parseInt(process.env.AXIOS_DEFAULT_TIMEOUT || '15000', 10);

// 文件路径常量
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const defaultUploadsDir = path.join(__dirname, '..', '..', '..', 'uploads');
export const uploadsDir = process.env.UPLOADS_PATH || defaultUploadsDir;
fs.mkdirSync(uploadsDir, { recursive: true });

export const backupsDir = path.join(__dirname, '..', '..', '..', 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

// 环境变量常量
export const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || '';
export const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD || '';
export const BACKUP_RETAIN_COUNT = Math.max(1, Number(process.env.BACKUP_RETAIN_COUNT || 20));
export const WECHAT_MP_APPID = process.env.WECHAT_MP_APPID || process.env.WECHAT_APP_ID || '';
export const WECHAT_MP_APP_SECRET =
  process.env.WECHAT_MP_APP_SECRET || process.env.WECHAT_MP_APPSECRET || process.env.WECHAT_APP_SECRET || '';
export const WECHAT_LOGIN_MOCK = process.env.NODE_ENV !== 'production' && process.env.WECHAT_LOGIN_MOCK === 'true';
export const UPLOAD_SESSION_TTL_MINUTES = Math.max(5, Number(process.env.UPLOAD_SESSION_TTL_MINUTES || 45));
export const PLAY_URL_CACHE_TTL_MS = Math.max(60, Number(process.env.MUSIC_PLAY_URL_CACHE_TTL_SECONDS || 600)) * 1000;

// Prisma 实例和缓存
export const playUrlCache = new Map<string, PlayUrlCacheValue>();

// 音乐平台默认列表
export const DEFAULT_MUSIC_PLATFORMS: MusicPlatform[] = ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'];
