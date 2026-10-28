import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export type UploadStorageInfo = {
  storageKey: string
  absoluteDir: string
  fileName: string
}

function normalizeNamespace(namespace: string) {
  const normalized = namespace
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  return normalized.replace(/[^a-zA-Z0-9/_-]/g, '-').replace(/\/+/g, '/') || 'general'
}

export function createUploadStorageInfo(
  uploadsDir: string,
  namespace: string,
  originalName: string,
  now = new Date()
): UploadStorageInfo {
  const normalizedNamespace = normalizeNamespace(namespace)
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const ext = path.extname(originalName).toLowerCase()
  const fileName = `${crypto.randomUUID()}${ext || ''}`
  const storageKey = path.posix.join(normalizedNamespace, year, month, fileName)
  const absoluteDir = path.join(uploadsDir, normalizedNamespace, year, month)

  fs.mkdirSync(absoluteDir, { recursive: true })

  return { storageKey, absoluteDir, fileName }
}

export function buildUploadPublicUrl(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '')
  const encoded = normalized
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')

  return `/uploads/${encoded}`
}

export function resolveUploadPathByStorageKey(storageKey: string, uploadsDir: string) {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '')
  const base = path.resolve(uploadsDir)
  const target = path.resolve(base, normalized)

  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null
  }

  return target
}

export function extractStorageKeyFromUploadUrl(url: string) {
  if (!url) return null

  if (url.startsWith('/uploads/')) {
    return decodeURIComponent(url.slice('/uploads/'.length))
  }

  try {
    const parsed = new URL(url)
    if (parsed.pathname.startsWith('/uploads/')) {
      return decodeURIComponent(parsed.pathname.slice('/uploads/'.length))
    }
  } catch {
    return null
  }

  return null
}

export function safeDeleteUploadFileByStorageKey(storageKey: string, uploadsDir: string) {
  const target = resolveUploadPathByStorageKey(storageKey, uploadsDir)
  if (!target) return false

  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true })
    }
    return true
  } catch {
    return false
  }
}

export function getStorageKeyFromFilePath(filePath: string, uploadsDir: string) {
  const base = path.resolve(uploadsDir)
  const resolved = path.resolve(filePath)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    return null
  }

  return path.relative(base, resolved).split(path.sep).join('/')
}
