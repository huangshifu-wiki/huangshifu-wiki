#!/usr/bin/env tsx

import type { PrismaClient, UserRole } from '@prisma/client'
import dotenv from 'dotenv'
import path from 'path'
import { pathToFileURL } from 'url'

dotenv.config({ path: '.env.local' })
dotenv.config()

type Action = 'list' | 'promote' | 'demote'

type Options =
  | {
      action: 'list'
      yes: false
    }
  | {
      action: 'promote' | 'demote'
      email?: string
      uid?: string
      yes: boolean
    }

type UserRecord = {
  uid: string
  email: string
  displayName: string | null
  role: UserRole
  status: string
  deletedAt: Date | null
}

type ManageSuperAdminPrisma = {
  user: {
    findMany: PrismaClient['user']['findMany']
    findFirst: PrismaClient['user']['findFirst']
    count: PrismaClient['user']['count']
    update: PrismaClient['user']['update']
  }
}

const USER_SELECT = {
  uid: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  deletedAt: true,
} as const

function getArgValue(args: string[], name: string) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)

  const index = args.indexOf(name)
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1]
  }

  return undefined
}

function requireSingleTarget(email?: string, uid?: string) {
  if (email && uid) {
    throw new Error('--email 和 --uid 只能传一个')
  }
  if (!email && !uid) {
    throw new Error('promote/demote 必须传 --email 或 --uid')
  }
}

export function parseArgs(args: string[]): Options {
  const action = args[0] as Action | undefined
  if (!action || args.includes('--help') || args.includes('-h')) {
    throw new Error('缺少操作')
  }
  if (!['list', 'promote', 'demote'].includes(action)) {
    throw new Error('操作只能是 list、promote 或 demote')
  }

  if (action === 'list') {
    return { action, yes: false }
  }

  const email = getArgValue(args, '--email')?.trim()
  const uid = getArgValue(args, '--uid')?.trim()
  requireSingleTarget(email, uid)

  return {
    action,
    email,
    uid,
    yes: args.includes('--yes'),
  }
}

function formatUser(user: Pick<UserRecord, 'email' | 'uid' | 'displayName' | 'role' | 'status'>) {
  return `${user.email} (${user.uid}) ${user.displayName || '-'} role=${user.role} status=${user.status}`
}

function printUsage() {
  console.log(`用法:
  npm run super-admin:manage -- list
  npm run super-admin:manage -- promote --email user@example.com --yes
  npm run super-admin:manage -- promote --uid <uid> --yes
  npm run super-admin:manage -- demote --email user@example.com --yes
  npm run super-admin:manage -- demote --uid <uid> --yes

说明:
  写操作必须加 --yes。
  该脚本直接操作数据库，不受 ALLOW_SUPER_ADMIN_MANAGE_SUPER_ADMINS 限制。`)
}

async function findTargetUser(
  prisma: ManageSuperAdminPrisma,
  options: Extract<Options, { uid?: string }>
) {
  const user = (await prisma.user.findFirst({
    where: options.uid ? { uid: options.uid } : { email: options.email },
    select: USER_SELECT,
  })) as UserRecord | null

  if (!user || user.deletedAt) {
    throw new Error('目标用户不存在或已删除')
  }

  return user
}

async function countActiveSuperAdmins(prisma: ManageSuperAdminPrisma) {
  return prisma.user.count({
    where: {
      role: 'super_admin',
      status: 'active',
      deletedAt: null,
    },
  })
}

export async function runManageSuperAdmin(prisma: ManageSuperAdminPrisma, options: Options) {
  if (options.action === 'list') {
    const users = (await prisma.user.findMany({
      where: { role: 'super_admin', deletedAt: null },
      select: USER_SELECT,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    })) as UserRecord[]

    if (users.length === 0) {
      console.log('未找到超级管理员')
      return
    }

    for (const user of users) {
      console.log(formatUser(user))
    }
    return
  }

  if (!options.yes) {
    throw new Error('写操作必须加 --yes')
  }

  const target = await findTargetUser(prisma, options)
  const nextRole: UserRole = options.action === 'promote' ? 'super_admin' : 'admin'

  if (target.role === nextRole) {
    const remaining = await countActiveSuperAdmins(prisma)
    console.log(
      `no-op: ${target.email} (${target.uid}) role=${target.role}, activeSuperAdmins=${remaining}`
    )
    return
  }

  if (options.action === 'demote') {
    if (target.role !== 'super_admin') {
      const remaining = await countActiveSuperAdmins(prisma)
      console.log(
        `no-op: ${target.email} (${target.uid}) role=${target.role}, activeSuperAdmins=${remaining}`
      )
      return
    }

    const remainingWithoutTarget = await prisma.user.count({
      where: {
        role: 'super_admin',
        status: 'active',
        deletedAt: null,
        uid: { not: target.uid },
      },
    })
    if (target.status === 'active' && remainingWithoutTarget < 1) {
      throw new Error('不能降级最后一名 active 超级管理员')
    }
  }

  const updated = (await prisma.user.update({
    where: { uid: target.uid },
    data: { role: nextRole },
    select: USER_SELECT,
  })) as UserRecord
  const remaining = await countActiveSuperAdmins(prisma)

  console.log(
    `ok: ${updated.email} (${updated.uid}) ${target.role} -> ${updated.role}, activeSuperAdmins=${remaining}`
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    await runManageSuperAdmin(prisma, options)
  } finally {
    await prisma.$disconnect()
  }
}

if (
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    printUsage()
    process.exitCode = 1
  })
}
