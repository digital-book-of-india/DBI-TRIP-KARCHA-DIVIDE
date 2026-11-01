import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/authMiddleware";
import { prisma } from "@/lib/db";

const VALID_PLATFORMS = ["android", "ios"];

/**
 * POST /api/devices
 * Registers (or refreshes) the caller's push-notification device token, as
 * required by the PDF spec's notification architecture ("Store device
 * tokens per user/device; handle token refresh and invalid tokens").
 * Idempotent per (userId, fcmToken): re-registering the same token just
 * updates lastSeenAt instead of creating a duplicate row.
 */
export async function POST(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { platform?: string; fcmToken?: string; notificationsEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { platform, fcmToken, notificationsEnabled } = body;

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { success: false, error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!fcmToken || typeof fcmToken !== "string" || fcmToken.trim().length === 0) {
    return NextResponse.json({ success: false, error: "fcmToken is required" }, { status: 400 });
  }

  const existing = await prisma.userDevice.findFirst({
    where: { userId: user.userId, fcmToken: fcmToken.trim() },
  });

  const device = existing
    ? await prisma.userDevice.update({
        where: { id: existing.id },
        data: {
          platform,
          lastSeenAt: new Date(),
          notificationsEnabled: notificationsEnabled ?? existing.notificationsEnabled,
        },
      })
    : await prisma.userDevice.create({
        data: {
          userId: user.userId,
          platform,
          fcmToken: fcmToken.trim(),
          notificationsEnabled: notificationsEnabled ?? true,
        },
      });

  return NextResponse.json(
    {
      success: true,
      data: {
        id: device.id,
        platform: device.platform,
        notificationsEnabled: device.notificationsEnabled,
        lastSeenAt: device.lastSeenAt,
      },
    },
    { status: existing ? 200 : 201 }
  );
}

/**
 * GET /api/devices
 * Lists the caller's registered devices (for the Settings screen's
 * notification controls).
 */
export async function GET(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const devices = await prisma.userDevice.findMany({
    where: { userId: user.userId },
    orderBy: { lastSeenAt: "desc" },
  });

  return NextResponse.json({
    success: true,
    data: {
      devices: devices.map((d) => ({
        id: d.id,
        platform: d.platform,
        notificationsEnabled: d.notificationsEnabled,
        lastSeenAt: d.lastSeenAt,
      })),
    },
  });
}
