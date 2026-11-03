export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be configured");
  }
  return secret;
}

export function getIntegrationJwtSecret(): string {
  const secret = process.env.TRIP_KHARCHA_INTEGRATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("TRIP_KHARCHA_INTEGRATION_SECRET must be configured with at least 32 bytes");
  }
  return secret;
}
