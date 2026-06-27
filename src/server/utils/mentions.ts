import { Prisma } from '@prisma/client'
import { extractMentionMatches, type MentionTarget } from '../../lib/mentions'
import { prisma } from './config'
import { createNotification } from './notifications'

type MentionTargetRef =
  | { type: 'post'; id: string; commentId?: string | null }
  | { type: 'gallery'; id: string; commentId?: string | null }

type MentionUser = MentionTarget & {
  displayNameKey: string
}

type MentionMatch = ReturnType<typeof extractMentionMatches>[number]

function normalizeMentionName(name: string) {
  return name.trim().toLowerCase()
}

async function findMentionUsersByNames(names: string[]) {
  const normalizedNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 50)
  if (!normalizedNames.length) return new Map<string, MentionUser[]>()

  const users = await prisma.user.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      OR: normalizedNames.map((name) => ({
        displayName: { equals: name, mode: 'insensitive' as Prisma.QueryMode },
      })),
    },
    select: {
      uid: true,
      displayName: true,
      photoURL: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const usersByName = new Map<string, MentionUser[]>()
  for (const user of users) {
    const key = normalizeMentionName(user.displayName)
    const list = usersByName.get(key) ?? []
    list.push({ ...user, displayNameKey: key })
    usersByName.set(key, list)
  }

  return usersByName
}

function collectCandidateNames(matches: MentionMatch[]) {
  const names = new Set<string>()
  for (const match of matches) {
    for (const candidate of match.candidates) {
      if (candidate.name.trim()) names.add(candidate.name)
    }
  }
  return [...names]
}

function toMentionTarget(user: MentionUser): MentionTarget {
  return {
    uid: user.uid,
    displayName: user.displayName,
    photoURL: user.photoURL,
  }
}

function resolveMentionTargetForMatch(
  match: MentionMatch,
  usersByName: Map<string, MentionUser[]>
) {
  for (const candidate of match.candidates) {
    const users = usersByName.get(normalizeMentionName(candidate.name)) ?? []
    if (users.length === 1) {
      return toMentionTarget(users[0])
    }
    if (users.length > 1) {
      return null
    }
  }

  return null
}

function uniqueMentionTargets(targets: Array<MentionTarget | null>) {
  const result: MentionTarget[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    if (!target || seen.has(target.uid)) continue
    result.push(target)
    seen.add(target.uid)
  }
  return result
}

async function resolveMentionTargetsForMatches(matches: MentionMatch[]) {
  if (!matches.length) return []

  const usersByName = await findMentionUsersByNames(collectCandidateNames(matches))
  return uniqueMentionTargets(
    matches.map((match) => resolveMentionTargetForMatch(match, usersByName))
  )
}

export async function resolveMentionTargetsForNames(names: string[]) {
  const usersByName = await findMentionUsersByNames(names)
  const targets: MentionTarget[] = []

  for (const users of usersByName.values()) {
    if (users.length !== 1) continue
    const user = users[0]
    targets.push(toMentionTarget(user))
  }

  return targets
}

export async function resolveMentionTargetsForText(content: string) {
  return resolveMentionTargetsForMatches(extractMentionMatches(content))
}

export async function buildMentionTargetsByTextKey(contents: Array<{ key: string; content: string }>) {
  const matchesByKey = new Map<string, MentionMatch[]>()
  const allNames = new Set<string>()

  for (const item of contents) {
    const matches = extractMentionMatches(item.content)
    matchesByKey.set(item.key, matches)
    collectCandidateNames(matches).forEach((name) => allNames.add(name))
  }

  const usersByName = await findMentionUsersByNames([...allNames])
  const result = new Map<string, MentionTarget[]>()

  for (const [key, matches] of matchesByKey.entries()) {
    result.set(
      key,
      uniqueMentionTargets(
        matches.map((match) => resolveMentionTargetForMatch(match, usersByName))
      )
    )
  }

  return result
}

export async function notifyMentionUsers(options: {
  content: string
  previousContent?: string | null
  mentionTargets?: MentionTarget[]
  previousMentionTargets?: MentionTarget[]
  actorUid: string
  actorName: string
  target: MentionTargetRef
  excludeUserUids?: string[]
}) {
  const targets = options.mentionTargets ?? (await resolveMentionTargetsForText(options.content))
  if (!targets.length) return

  const previousTargets =
    options.previousMentionTargets ?? (await resolveMentionTargetsForText(options.previousContent ?? ''))
  const previousUserUids = new Set(previousTargets.map((target) => target.uid))

  const excludeUserUids = new Set([options.actorUid, ...(options.excludeUserUids ?? [])])
  const notifiedUserUids = new Set<string>()

  const targetKey = options.target.type === 'gallery' ? 'galleryId' : 'postId'
  const payloadBase = {
    targetType: options.target.type,
    [targetKey]: options.target.id,
    commentId: options.target.commentId ?? null,
    actorUid: options.actorUid,
    actorName: options.actorName,
    preview: options.content.slice(0, 120),
  }

  for (const target of targets) {
    if (
      previousUserUids.has(target.uid) ||
      excludeUserUids.has(target.uid) ||
      notifiedUserUids.has(target.uid)
    ) {
      continue
    }
    notifiedUserUids.add(target.uid)
    await createNotification(target.uid, 'mention', payloadBase)
  }
}
