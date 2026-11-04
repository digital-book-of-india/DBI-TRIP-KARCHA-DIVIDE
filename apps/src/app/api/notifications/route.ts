import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  getUserNotifications,
  markAllNotificationsAsRead,
} from "@/lib/notifications/notificationService";
import { errorResponse } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const unreadOnlyParam = searchParams.get("unreadOnly");

    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const unreadOnly = unreadOnlyParam === "true";

    const data = await getUserNotifications(user.userId, { limit, unreadOnly });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to fetch notifications");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    const result = await markAllNotificationsAsRead(user.userId);

    return NextResponse.json({
      success: true,
      data: result,
      message: `Marked ${result.markedReadCount} notifications as read`,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to mark notifications as read");
  }
}

