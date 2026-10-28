import type { Prisma } from '@prisma/client'
import { isNumericSlug } from './numericSlug'

const USER_PUBLIC_ID_SEQUENCE_NAME = '"User_publicId_seq"'
const USER_PUBLIC_ID_SEQUENCE_LOCK_KEY = 902001

async function userPublicIdSequenceExists(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRawUnsafe<Array<{ sequenceName: string | null }>>(
    `SELECT to_regclass('${USER_PUBLIC_ID_SEQUENCE_NAME}')::text AS "sequenceName"`
  )

  return Boolean(rows[0]?.sequenceName)
}

async function ensureUserPublicIdSequence(tx: Prisma.TransactionClient) {
  await tx.$queryRawUnsafe(
    'WITH lock AS (SELECT pg_advisory_xact_lock($1)) SELECT 1 AS locked',
    USER_PUBLIC_ID_SEQUENCE_LOCK_KEY
  )

  if (await userPublicIdSequenceExists(tx)) {
    return
  }

  await tx.$executeRawUnsafe(`CREATE SEQUENCE ${USER_PUBLIC_ID_SEQUENCE_NAME}`)
  await tx.$queryRawUnsafe(`
    SELECT setval(
      '${USER_PUBLIC_ID_SEQUENCE_NAME}',
      COALESCE(
        (SELECT MAX("publicId"::bigint) FROM "User" WHERE "publicId" ~ '^[0-9]+$'),
        0
      ) + 1,
      false
    )
  `)
}

export async function allocateUserPublicId(tx: Prisma.TransactionClient): Promise<string> {
  await ensureUserPublicIdSequence(tx)

  const rows = await tx.$queryRawUnsafe<Array<{ nextPublicId: number | bigint | null }>>(
    'SELECT nextval(\'"User_publicId_seq"\') AS "nextPublicId"'
  )

  return String(rows[0]?.nextPublicId ?? 1)
}

export function isUserPublicId(value: unknown): value is string {
  return isNumericSlug(value)
}
