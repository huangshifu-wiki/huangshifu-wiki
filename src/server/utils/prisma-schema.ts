import { Prisma, type PrismaClient } from '@prisma/client'

type QueryablePrisma = Pick<PrismaClient, '$queryRaw'>

export async function doesPublicTableExist(
  prisma: QueryablePrisma,
  tableName: string
) {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS "exists"
  `

  return rows[0]?.exists === true
}

export function isPrismaTableMissingError(
  error: unknown,
  modelName?: string
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false
  }

  if (error.code !== 'P2021') {
    return false
  }

  if (!modelName) {
    return true
  }

  return error.meta?.modelName === modelName
}
