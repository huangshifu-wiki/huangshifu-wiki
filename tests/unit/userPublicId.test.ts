import { describe, expect, it, vi } from 'vitest'

import { allocateUserPublicId, isUserPublicId } from '../../src/server/utils/userPublicId'

function createTx(sequenceExists: boolean, nextPublicId: number | bigint | null = 7) {
  const tx = {
    $queryRawUnsafe: vi.fn(async (query: string, ..._params: unknown[]) => {
      if (query.includes('to_regclass')) {
        return [{ sequenceName: sequenceExists ? '"User_publicId_seq"' : null }]
      }

      if (query.includes('nextval')) {
        return [{ nextPublicId }]
      }

      return []
    }),
    $executeRawUnsafe: vi.fn(async () => 0),
  }

  return tx
}

describe('userPublicId', () => {
  it('allocates from the existing sequence', async () => {
    const tx = createTx(true, 12)

    await expect(allocateUserPublicId(tx as never)).resolves.toBe('12')

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      'WITH lock AS (SELECT pg_advisory_xact_lock($1)) SELECT 1 AS locked',
      902001
    )
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
    expect(tx.$queryRawUnsafe).toHaveBeenLastCalledWith(
      'SELECT nextval(\'"User_publicId_seq"\') AS "nextPublicId"'
    )
  })

  it('creates and initializes the sequence when db push did not create it', async () => {
    const tx = createTx(false, 1)

    await expect(allocateUserPublicId(tx as never)).resolves.toBe('1')

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('CREATE SEQUENCE "User_publicId_seq"')
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('SELECT setval('))
    expect(tx.$queryRawUnsafe).toHaveBeenLastCalledWith(
      'SELECT nextval(\'"User_publicId_seq"\') AS "nextPublicId"'
    )
  })

  it('validates positive numeric public ids', () => {
    expect(isUserPublicId('1')).toBe(true)
    expect(isUserPublicId('42')).toBe(true)
    expect(isUserPublicId('0')).toBe(false)
    expect(isUserPublicId('abc')).toBe(false)
  })
})
