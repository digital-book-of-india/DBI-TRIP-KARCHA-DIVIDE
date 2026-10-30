/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

let activePrisma: PrismaClient =
  global.prismaGlobal ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = activePrisma;
}

export function getPrisma(): PrismaClient {
  return activePrisma;
}

export function setPrismaClient(client: PrismaClient) {
  activePrisma = client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    return (activePrisma as any)[prop];
  },
});

export async function connectDB(): Promise<PrismaClient> {
  return activePrisma;
}

export default prisma;
