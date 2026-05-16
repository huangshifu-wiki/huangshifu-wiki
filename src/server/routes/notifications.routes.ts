import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { prisma, toNotificationResponse, parsePagination } from '../utils';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// List user notifications
router.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userUid = req.authUser!.uid;
    const { limit, page, offset: skip } = parsePagination(req.query);
    const unreadOnly = req.query.unread === 'true';
    const typeFilter = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;

    const where: Record<string, unknown> = {
      userUid,
      ...(unreadOnly ? { isRead: false } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userUid, isRead: false } }),
    ]);

    res.json({
      notifications: notifications.map(toNotificationResponse),
      total,
      unreadCount,
      page,
      limit,
    });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: '获取通知失败' });
  }
});

// Mark notification as read
router.post('/:id/read', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userUid = req.authUser!.uid;
    const notificationId = req.params.id;

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userUid: true, isRead: true },
    });

    if (!notification) {
      res.status(404).json({ error: '通知不存在' });
      return;
    }

    if (notification.userUid !== userUid) {
      res.status(403).json({ error: '无权操作该通知' });
      return;
    }

    if (!notification.isRead) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: '标记已读失败' });
  }
});

// Mark all notifications as read
router.post('/read-all', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userUid = req.authUser!.uid;

    await prisma.notification.updateMany({
      where: { userUid, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: '全部标记已读失败' });
  }
});

// Delete notification
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userUid = req.authUser!.uid;
    const notificationId = req.params.id;

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userUid: true },
    });

    if (!notification) {
      res.status(404).json({ error: '通知不存在' });
      return;
    }

    if (notification.userUid !== userUid) {
      res.status(403).json({ error: '无权操作该通知' });
      return;
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: '删除通知失败' });
  }
});

export function registerNotificationsRoutes(app: Router) {
  app.use('/api/notifications', router);
}
