import prisma from "../prisma";
import type { Prisma } from "@prisma/client";
import { HttpError } from "../apiError";

export interface GetNotificationsOptions {
  limit?: number;
  unreadOnly?: boolean;
}

export async function getUserNotifications(
  userId: string,
  options: GetNotificationsOptions = {}
) {
  const { limit = 50, unreadOnly = false } = options;

  const whereClause: Prisma.NotificationWhereInput = { userId };
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
    throw new HttpError("Notification not found", 404);
  }

  // Authorization: Only the owner of the notification can mark it read
  if (notification.userId !== userId) {
    throw new HttpError("Forbidden: You cannot modify another user's notifications", 403);
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

