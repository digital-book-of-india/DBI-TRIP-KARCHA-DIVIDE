import prisma from "../prisma";

export interface GetNotificationsOptions {
  limit?: number;
  unreadOnly?: boolean;
}

export async function getUserNotifications(
  userId: string,
  options: GetNotificationsOptions = {}
) {
  const { limit = 50, unreadOnly = false } = options;

  const whereClause: any = { userId };
  if (unreadOnly) {
    whereClause.readAt = null;
  }

  const [notifications, unreadCount, totalCount] = await Promise.all([
    prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
    prisma.notification.count({
      where: { userId },
    }),
  ]);

  return {
    unreadCount,
    totalCount,
    notifications: notifications.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      activityEventId: n.activityEventId,
      readAt: n.readAt,
      isRead: !!n.readAt,
      deliveryStatus: n.deliveryStatus,
      createdAt: n.createdAt,
    })),
  };
}

export async function markNotificationAsRead(notificationId: string, userId: string) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    const error: any = new Error("Notification not found");
    error.status = 404;
    throw error;
  }

  // Authorization: Only the owner of the notification can mark it read
  if (notification.userId !== userId) {
    const error: any = new Error("Forbidden: You cannot modify another user's notifications");
    error.status = 403;
    throw error;
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      readAt: new Date(),
      deliveryStatus: "READ",
    },
  });

  return {
    id: updated.id,
    title: updated.title,
    message: updated.message,
    readAt: updated.readAt,
    isRead: true,
    deliveryStatus: updated.deliveryStatus,
  };
}

export async function markAllNotificationsAsRead(userId: string) {
  const now = new Date();
  const updateResult = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
    },
    data: {
      readAt: now,
      deliveryStatus: "READ",
    },
  });

  return {
    success: true,
    markedReadCount: updateResult.count,
  };
}

