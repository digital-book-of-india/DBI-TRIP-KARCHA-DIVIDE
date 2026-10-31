import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Checking Supabase PostgreSQL connection...");
  const usersCount = await prisma.user.count();
  const tripsCount = await prisma.trip.count();
  const settlementsCount = await prisma.settlement.count();

  console.log("✅ Supabase PostgreSQL is connected successfully!");
  console.log(`📊 Current Users in DB: ${usersCount}`);
  console.log(`📊 Current Trips in DB: ${tripsCount}`);
  console.log(`📊 Settlements Table initialized with count: ${settlementsCount}`);
}

main()
  .catch((e) => {
    console.error("❌ Connection failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

