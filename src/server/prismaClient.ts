import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import os from 'os'
import { Client, type ClientConfig } from 'pg'

type PoolOptions = {
  connectionLimit?: number
  poolTimeout?: number
}

export function createPrismaClient(
  options: Omit<Prisma.PrismaClientOptions, 'adapter' | 'accelerateUrl'> = {},
  poolOptions: PoolOptions = {}
) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const url = new URL(connectionString)
  const schema = url.searchParams.get('schema') || 'public'
  const connectionLimit =
    poolOptions.connectionLimit ??
    (Number(url.searchParams.get('connection_limit')) || os.cpus().length * 2 + 1)
  const poolTimeout = poolOptions.poolTimeout ?? Number(url.searchParams.get('pool_timeout') ?? 10)
  const idleTimeout = Number(url.searchParams.get('max_idle_connection_lifetime') ?? 300)
  const connectTimeout = Number(url.searchParams.get('connect_timeout') ?? 5)
  const maxLifetime = Number(url.searchParams.get('max_connection_lifetime') ?? 0)

  // pg 不识别 Prisma 的 URL 参数；显式转换池大小、秒单位超时及目标 schema。
  for (const name of [
    'schema',
    'connection_limit',
    'pool_timeout',
    'connect_timeout',
    'max_idle_connection_lifetime',
    'max_connection_lifetime',
    'pgbouncer',
  ]) {
    url.searchParams.delete(name)
  }

  // 与旧引擎一致，让未限定表名的原始 SQL 也使用 URL 指定的 schema。
  const searchPath = `"${schema.replace(/"/g, '""')}"`.replace(/([\\\s])/g, '\\$1')
  const connectionOptions = url.searchParams.get('options')
  url.searchParams.set(
    'options',
    [connectionOptions, `-c search_path=${searchPath}`].filter(Boolean).join(' ')
  )

  // pg 的池等待与新连接默认共用超时；单独配置 Client 保留两者的既有语义。
  class DatabaseClient extends Client {
    constructor(config: ClientConfig = {}) {
      super({ ...config, connectionTimeoutMillis: connectTimeout * 1000 })
    }
  }

  const adapter = new PrismaPg(
    {
      connectionString: url.toString(),
      max: connectionLimit,
      Client: DatabaseClient,
      connectionTimeoutMillis: poolTimeout * 1000,
      idleTimeoutMillis: idleTimeout * 1000,
      maxLifetimeSeconds: maxLifetime,
    },
    { schema }
  )
  return new PrismaClient({ ...options, adapter })
}
