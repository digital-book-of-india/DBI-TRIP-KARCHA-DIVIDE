import crypto from "crypto";

/**
 * Minimal, dependency-free AWS SigV4 presigned-URL generator for S3-compatible
 * object storage (works against AWS S3 and Cloudflare R2, per the PDF spec's
 * "S3-compatible storage / Cloudflare R2 ... use signed URLs" requirement).
 * Implemented by hand instead of pulling in an SDK, since only PUT-presign
 * is needed here.
 */
export interface S3Config {
  endpoint: string; // e.g. https://<account_id>.r2.cloudflarestorage.com (no trailing slash)
  bucket: string;
  region: string; // R2 uses "auto"
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string; // optional CDN/public URL prefix, if different from endpoint
}

/** Reads S3/R2 credentials from the environment. Returns null if not configured. */
export function getS3Config(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    region: process.env.S3_REGION || "auto",
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, ""),
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Generates a time-limited presigned PUT URL (path-style:
 * `${endpoint}/${bucket}/${key}`) the client uploads directly to, plus the
 * resulting public object URL to store as the expense's receiptUrl.
 */
export function presignPutUrl(
  config: S3Config,
  key: string,
  expiresInSeconds = 300
): { uploadUrl: string; publicUrl: string } {
  const host = new URL(config.endpoint).host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = `/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const uploadUrl = `${config.endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const publicBase = config.publicBaseUrl || config.endpoint;
  const publicUrl = `${publicBase}${canonicalUri}`;
  return { uploadUrl, publicUrl };
}
