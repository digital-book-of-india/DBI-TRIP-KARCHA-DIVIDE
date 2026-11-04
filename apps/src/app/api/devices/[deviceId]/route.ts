import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/authMiddleware";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/devices/[deviceId]
 * Toggles push-notification delivery for one device ("Group members can
 * mute a trip or choose fewer push notifications" / Settings > notification
 * controls in the PDF spec).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId } = await params;

  const device = await prisma.userDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== user.userId) {
    return NextResponse.json({ success: false, error: "Device not found" }, { status: 404 });
  }

  let body: { notificationsEnabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.notificationsEnabled !== "boolean") {
    return NextResponse.json({ success: false, error: "notificationsEnabled (boolean) is required" }, { status: 400 });
  }

  const updated = await prisma.userDevice.update({
    where: { id: deviceId },
    data: { notificationsEnabled: body.notificationsEnabled },
  });

  return NextResponse.json({
    success: true,
    data: { id: updated.id, notificationsEnabled: updated.notificationsEnabled },
  });
}

/**
 * DELETE /api/devices/[deviceId]
 * Unregisters a device (e.g. on logout / uninstall), so pushes stop and a
 * stale token is not retried indefinitely.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId } = await params;

  const device = await prisma.userDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== user.userId) {
    return NextResponse.json({ success: false, error: "Device not found" }, { status: 404 });
  }

  await prisma.userDevice.delete({ where: { id: deviceId } });

  return NextResponse.json({ success: true, message: "Device unregistered" });
}
