import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { markNotificationAsRead } from "@/lib/notifications/notificationService";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = getAuthenticatedUser(req);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    const updated = await markNotificationAsRead(id, user.userId);

    return NextResponse.json({
      success: true,
      data: updated,
      message: "Notification marked as read",
    });
  } catch (err: any) {
    const status = err.status || 500;
    return NextResponse.json(
      { success: false, error: err.message || "Failed to mark notification as read" },
      { status }
    );
  }
}

