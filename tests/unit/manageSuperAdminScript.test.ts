import { beforeEach, describe, expect, it, vi } from 'vitest'

type Role = 'user' | 'admin' | 'super_admin'

const buildUser = (overrides: Partial<User> = {}): User => ({
  uid: 'user-1',
  email: 'user@example.com',
  displayName: '用户',
  role: 'user',
  status: 'active',
  deletedAt: null,
  ...overrides,
})

type User = {
  uid: string
  email: string
  displayName: string | null
  role: Role
  status: string
  deletedAt: Date | null
}

const mockPrisma = () => ({
  user: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
})

describe('manage-super-admin script', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('parses list and write commands', async () => {
    const { parseArgs } = await import('../../scripts/manage-super-admin')

    expect(parseArgs(['list'])).toEqual({ action: 'list', yes: false })
    expect(parseArgs(['promote', '--email', 'user@example.com', '--yes'])).toEqual({
      action: 'promote',
      email: 'user@example.com',
      uid: undefined,
      yes: true,
    })
    expect(parseArgs(['demote', '--uid=user-1', '--yes'])).toEqual({
      action: 'demote',
      email: undefined,
      uid: 'user-1',
      yes: true,
    })
  })

  it('rejects invalid arguments', async () => {
    const { parseArgs } = await import('../../scripts/manage-super-admin')

    expect(() => parseArgs([])).toThrow('缺少操作')
    expect(() => parseArgs(['delete'])).toThrow('操作只能是 list、promote 或 demote')
    expect(() => parseArgs(['promote'])).toThrow('promote/demote 必须传 --email 或 --uid')
    expect(() => parseArgs(['promote', '--email', 'a@example.com', '--uid', 'u1'])).toThrow(
      '--email 和 --uid 只能传一个'
    )
  })

  it('lists active and banned super admins', async () => {
    const prisma = mockPrisma()
    prisma.user.findMany.mockResolvedValue([
      buildUser({ uid: 'super-1', email: 'super@example.com', role: 'super_admin' }),
    ])
    const { runManageSuperAdmin } = await import('../../scripts/manage-super-admin')

    await runManageSuperAdmin(prisma, { action: 'list', yes: false })

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'super_admin', deletedAt: null },
      })
    )
    expect(console.log).toHaveBeenCalledWith(
      'super@example.com (super-1) 用户 role=super_admin status=active'
    )
  })

  it('promotes a regular user to super admin', async () => {
    const prisma = mockPrisma()
    prisma.user.findFirst.mockResolvedValue(buildUser())
    prisma.user.update.mockResolvedValue(buildUser({ role: 'super_admin' }))
    prisma.user.count.mockResolvedValue(2)
    const { runManageSuperAdmin } = await import('../../scripts/manage-super-admin')

    await runManageSuperAdmin(prisma, {
      action: 'promote',
      email: 'user@example.com',
      yes: true,
    })

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'user@example.com' } })
    )
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uid: 'user-1' },
        data: { role: 'super_admin' },
      })
    )
    expect(console.log).toHaveBeenCalledWith(
      'ok: user@example.com (user-1) user -> super_admin, activeSuperAdmins=2'
    )
  })

  it('does not update when promoting an existing super admin', async () => {
    const prisma = mockPrisma()
    prisma.user.findFirst.mockResolvedValue(buildUser({ role: 'super_admin' }))
    prisma.user.count.mockResolvedValue(1)
    const { runManageSuperAdmin } = await import('../../scripts/manage-super-admin')

    await runManageSuperAdmin(prisma, {
      action: 'promote',
      uid: 'user-1',
      yes: true,
    })

    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(
      'no-op: user@example.com (user-1) role=super_admin, activeSuperAdmins=1'
    )
  })

  it('demotes another super admin to admin', async () => {
    const prisma = mockPrisma()
    prisma.user.findFirst.mockResolvedValue(buildUser({ role: 'super_admin' }))
    prisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
    prisma.user.update.mockResolvedValue(buildUser({ role: 'admin' }))
    const { runManageSuperAdmin } = await import('../../scripts/manage-super-admin')

    await runManageSuperAdmin(prisma, {
      action: 'demote',
      uid: 'user-1',
      yes: true,
    })

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        role: 'super_admin',
        status: 'active',
        deletedAt: null,
        uid: { not: 'user-1' },
      },
    })
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uid: 'user-1' },
        data: { role: 'admin' },
      })
    )
  })

  it('rejects demoting the last active super admin', async () => {
    const prisma = mockPrisma()
    prisma.user.findFirst.mockResolvedValue(buildUser({ role: 'super_admin' }))
    prisma.user.count.mockResolvedValue(0)
    const { runManageSuperAdmin } = await import('../../scripts/manage-super-admin')

    await expect(
      runManageSuperAdmin(prisma, {
        action: 'demote',
        uid: 'user-1',
        yes: true,
      })
    ).rejects.toThrow('不能降级最后一名 active 超级管理员')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('requires confirmation and an existing non-deleted target for writes', async () => {
    const prisma = mockPrisma()
    const { runManageSuperAdmin } = await import('../../scripts/manage-super-admin')

    await expect(
      runManageSuperAdmin(prisma, {
        action: 'promote',
        uid: 'user-1',
        yes: false,
      })
    ).rejects.toThrow('写操作必须加 --yes')

    prisma.user.findFirst.mockResolvedValue(buildUser({ deletedAt: new Date() }))
    await expect(
      runManageSuperAdmin(prisma, {
        action: 'promote',
        uid: 'user-1',
        yes: true,
      })
    ).rejects.toThrow('目标用户不存在或已删除')
  })
})
