import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAuthenticatedUser, isTripMember, isValidId } from "@/lib/auth/authMiddleware";
import { getS3Config, presignPutUrl } from "@/lib/storage/s3Presign";

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB cap, per spec "file-size/type limits"

interface SignRequestBody {
  tripId: string;
  contentType: string;
  fileSizeBytes?: number;
}

/**
 * POST /api/uploads/receipts/sign
 * Returns a short-lived, signed PUT URL for the client to upload a receipt
 * image/PDF directly to S3-compatible storage (AWS S3 or Cloudflare R2, per
 * the PDF spec's architecture table), plus the resulting public object URL
 * to pass back as an expense's `receiptUrl`. Receipts are private by
 * default: this endpoint does not expose the bucket publicly -- pair it
 * with a private bucket and short-lived GET presigning for viewing if the
 * bucket is not meant to be public.
 *
 * Requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY
 * to be configured. Returns 501 with a clear message if storage is not set
 * up, rather than silently pretending uploads work.
 */
export async function POST(req: NextRequest) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: SignRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { tripId, contentType, fileSizeBytes } = body;

  if (!tripId || !isValidId(tripId)) {
    return NextResponse.json({ success: false, error: "Valid tripId is required" }, { status: 400 });
  }

  const isMember = await isTripMember(tripId, user.userId);
  if (!isMember) {
    return NextResponse.json({ success: false, error: "Forbidden: you are not a member of this trip" }, { status: 403 });
  }

  const extension = ALLOWED_CONTENT_TYPES[contentType];
  if (!extension) {
    return NextResponse.json(
      { success: false, error: `Unsupported contentType. Allowed: ${Object.keys(ALLOWED_CONTENT_TYPES).join(", ")}` },
      { status: 400 }
    );
  }

  if (fileSizeBytes !== undefined && (typeof fileSizeBytes !== "number" || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE_BYTES)) {
    return NextResponse.json(
      { success: false, error: `fileSizeBytes must be between 1 and ${MAX_FILE_SIZE_BYTES} bytes` },
      { status: 400 }
    );
  }

  const s3Config = getS3Config();
  if (!s3Config) {
    return NextResponse.json(
      {
        success: false,
        error:
          "File storage is not configured on this server. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to enable receipt uploads.",
      },
      { status: 501 }
    );
  }

  const key = `receipts/${tripId}/${user.userId}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  const { uploadUrl, publicUrl } = presignPutUrl(s3Config, key, 300);

  return NextResponse.json({
    success: true,
    data: {
      uploadUrl,
      receiptUrl: publicUrl,
      expiresInSeconds: 300,
      method: "PUT",
    },
  });
}
