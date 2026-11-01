import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Broadcasts an in-app notification to every joined member of a trip except
 * the excluded user (normally the actor who triggered the event -- the PDF
 * spec calls for avoiding "notifying the actor about their own expense
 * unless they opted in", and the same principle is applied to the other
 * trip-wide events below). Pass `tx` to run inside an existing Prisma
 * transaction so the notification is atomic with the write that caused it.
 */
export async function notifyTripMembers(opts: {
  tripId: string;
  excludeUserId?: string | null;
  title: string;
  message: string;
  tx?: PrismaLike;
}): Promise<void> {
  const client = opts.tx || prisma;
  const members = await client.tripMember.findMany({
    where: { tripId: opts.tripId },
    select: { userId: true },
  });

  const recipients = members.map((m) => m.userId).filter((uid) => uid !== opts.excludeUserId);
  if (recipients.length === 0) return;

  await client.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      title: opts.title,
      message: opts.message,
      deliveryStatus: "SENT",
    })),
  });
}

/**
 * Sends each recipient a personalized notification (e.g. "your share: ₹X").
 * Used for new-expense notifications, where every participant's amount
 * differs.
 */
export async function notifyUsersIndividually(
  recipients: { userId: string; message: string }[],
  title: string,
  tx?: PrismaLike
): Promise<void> {
  if (recipients.length === 0) return;
  const client = tx || prisma;
  await client.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.userId,
      title,
      message: r.message,
      deliveryStatus: "SENT",
    })),
  });
}
