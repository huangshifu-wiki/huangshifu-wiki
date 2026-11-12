import type { PrismaClient } from '@prisma/client'
import os from 'os'
import { isProductionRuntime, isTestRuntime } from './utils/runtimeEnv'
import { createPrismaClient } from './prismaClient'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const isDev = !isProductionRuntime()
const isTest = isTestRuntime()
const verboseIntegrationLogging = process.env.DEBUG_INTEGRATION === '1'

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient(
    {
      log:
        isTest && !verboseIntegrationLogging
          ? []
          : isTest
            ? ['error']
            : isDev
              ? ['query', 'error', 'warn']
              : ['error'],
    },
    {
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || os.cpus().length * 2 + 1,
      poolTimeout: Number(process.env.DB_POOL_TIMEOUT) || 10,
    }
  )

if (isDev) {
  globalForPrisma.prisma = prisma
}

export default prisma
