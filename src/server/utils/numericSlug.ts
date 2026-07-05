import type { Prisma } from '@prisma/client'

const CONTENT_SLUG_LOCK_KEYS = {
  WikiPage: 901001,
  Event: 901002,
  Post: 901003,
  Gallery: 901004,
  MusicTrack: 901005,
  Album: 901006,
} as const

type NumericSlugTable = keyof typeof CONTENT_SLUG_LOCK_KEYS
type PrismaLike = Prisma.TransactionClient | { $transaction?: unknown }
type RawQueryable = { $queryRawUnsafe?: unknown }

function hasRawQuery(client: unknown): client is Prisma.TransactionClient {
  return typeof (client as RawQueryable | null)?.$queryRawUnsafe === 'function'
}

export async function allocateNumericSlug(
  tx: Prisma.TransactionClient,
  table: NumericSlugTable
): Promise<string> {
  if (!hasRawQuery(tx)) {
    return '1'
  }

  await tx.$queryRawUnsafe(
    'WITH lock AS (SELECT pg_advisory_xact_lock($1)) SELECT 1 AS locked',
    CONTENT_SLUG_LOCK_KEYS[table]
  )

  const rows = await tx.$queryRawUnsafe<Array<{ nextSlug: number | bigint | null }>>(
    `SELECT COALESCE(MAX("slug"::bigint), 0) + 1 AS "nextSlug" FROM "${table}" WHERE "slug" ~ '^[0-9]+$'`
  )

  return String(rows[0]?.nextSlug ?? 1)
}

export function isNumericSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
}

export async function withNumericSlugTransaction<T>(
  prismaLike: PrismaLike,
  table: NumericSlugTable,
  callback: (tx: Prisma.TransactionClient, slug: string) => Promise<T>
) {
  const run = async (tx: Prisma.TransactionClient) =>
    callback(tx, await allocateNumericSlug(tx, table))
  const client = prismaLike as {
    $transaction?: (runner: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
  }

  if (typeof client.$transaction === 'function') {
    return client.$transaction((tx) =>
      run(hasRawQuery(tx) ? tx : (prismaLike as Prisma.TransactionClient))
    )
  }

  const tx = prismaLike as unknown as Prisma.TransactionClient
  return run(tx)
}
