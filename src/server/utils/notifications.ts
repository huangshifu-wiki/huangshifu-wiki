// 通知创建、浏览历史、搜索关键词计数

import { Prisma } from '@prisma/client';
import { prisma } from './config';
import { normalizeKeyword } from './parsers';
import type { BrowsingTargetType, NotificationType } from '../types';

export function toNotificationResponse(notification: {
  id: string;
  userUid: string;
  type: NotificationType;
  payload: unknown;
  isRead: boolean;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    userUid: notification.userUid,
    type: notification.type,
    payload: notification.payload,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  };
}

export async function createNotification(userUid: string, type: NotificationType, payload: Record<string, unknown>) {
  try {
    await prisma.notification.create({
      data: {
        userUid,
        type,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error('Create notification error:', error);
  }
}

// 评论回复通知：顶层评论通知内容作者，回复评论通知被回复者；不给自己发。
// 帖子与图集共用：payload 写入显式 targetType 与 parentId（回复信号），供前端按字段渲染。
export async function notifyCommentReply(options: {
  ownerUid: string;
  replyTargetUid: string | null;
  actorUid: string;
  actorName: string;
  commentId: string;
  content: string;
  parentId: string | null;
  target: { type: 'post' | 'gallery'; id: string };
}) {
  const recipientUid = options.replyTargetUid || options.ownerUid;
  if (!recipientUid || recipientUid === options.actorUid) return;

  const targetKey = options.target.type === 'gallery' ? 'galleryId' : 'postId';
  await createNotification(recipientUid, 'reply', {
    targetType: options.target.type,
    [targetKey]: options.target.id,
    parentId: options.parentId,
    commentId: options.commentId,
    actorUid: options.actorUid,
    actorName: options.actorName,
    preview: options.content.slice(0, 120),
  });
}

export async function recordBrowsingHistory(userUid: string, targetType: BrowsingTargetType, targetId: string) {
  const dedupeAfter = new Date(Date.now() - 30 * 60 * 1000);
  try {
    const existing = await prisma.browsingHistory.findFirst({
      where: {
        userUid,
        targetType,
        targetId,
        createdAt: {
          gte: dedupeAfter,
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!existing) {
      await prisma.browsingHistory.create({
        data: {
          userUid,
          targetType,
          targetId,
        },
      });
    }
  } catch (error) {
    console.error('Record browsing history error:', error);
  }
}

export async function increaseSearchKeywordCount(rawKeyword: string) {
  const keyword = normalizeKeyword(rawKeyword);
  if (!keyword) return;

  try {
    await prisma.searchKeyword.upsert({
      where: { keyword },
      update: {
        count: {
          increment: 1,
        },
      },
      create: {
        keyword,
        count: 1,
      },
    });
  } catch (error) {
    console.error('Increase search keyword count error:', error);
  }
}
