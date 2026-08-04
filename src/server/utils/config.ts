import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

import { prisma } from '../prisma'
export { prisma }
import { enhancedCache, CACHE_KEYS } from './cache'
import { runtimeConfigService } from '../services/runtimeConfig.service'
import { isWechatLoginMockEnabled } from './runtimeEnv'
import type { MusicPlatform, PlayUrlCacheValue } from '../types'

// axios 默认配置
axios.defaults.timeout = parseInt(process.env.AXIOS_DEFAULT_TIMEOUT || '15000', 10)

// 文件路径常量
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const defaultUploadsDir = path.join(__dirname, '..', '..', '..', 'uploads')
export const uploadsDir = process.env.UPLOADS_PATH || defaultUploadsDir
fs.mkdirSync(uploadsDir, { recursive: true })

export const backupsDir =
  process.env.NODE_ENV === 'test'
    ? path.join(os.tmpdir(), 'huangshifu-wiki-test-backups')
    : path.join(__dirname, '..', '..', '..', 'backups')
fs.mkdirSync(backupsDir, { recursive: true })

// 环境变量常量（秘密与部署配置）
export const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD || ''
export const WECHAT_LOGIN_MOCK = isWechatLoginMockEnabled()
export const playUrlCache = new Map<string, PlayUrlCacheValue>()

// 音乐平台默认列表
export const DEFAULT_MUSIC_PLATFORMS: MusicPlatform[] = [
  'netease',
  'tencent',
  'kugou',
  'baidu',
  'kuwo',
]

export function isSemanticSearchEnabled() {
  return runtimeConfigService.getConfig().semanticSearchEnabled
}
