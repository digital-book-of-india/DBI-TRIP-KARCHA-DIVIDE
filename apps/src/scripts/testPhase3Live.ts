import prisma from "../lib/prisma";
import { getTripBalances } from "../lib/ledger/balanceService";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${msg}`);
}

async function runLiveTest() {
  console.log("=================================================");
  console.log("🚀 TESTING PHASE 3: LIVE BALANCES API WITH SUPABASE");
  console.log("=================================================\n");

  const timestamp = Date.now();

  // 1. Create 4 Test Users in Supabase
  console.log("Creating 4 test users in Supabase...");
  const [prabhjotUser, amanUser, rahulUser, simranUser, strangerUser] = await Promise.all([
    prisma.user.create({
      data: {
        displayName: "Prabhjot Singh",
        email: `prabhjot_${timestamp}@example.com`,
        password_hash: "hashed_pwd",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Aman Sharma",
        email: `aman_${timestamp}@example.com`,
        password_hash: "hashed_pwd",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Rahul Verma",
        email: `rahul_${timestamp}@example.com`,
        password_hash: "hashed_pwd",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Simran Kaur",
        email: `simran_${timestamp}@example.com`,
        password_hash: "hashed_pwd",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Stranger Bob",
        email: `stranger_${timestamp}@example.com`,
        password_hash: "hashed_pwd",
      },
    }),
  ]);

  // 2. Create a Test Trip
  console.log("Creating Test Trip...");
  const trip = await prisma.trip.create({
    data: {
      name: "Manali Live Verification Trip",
      destination: "Manali",
      currency: "INR",
      createdBy: prabhjotUser.id,
      status: "ACTIVE",
    },
  });

  // 3. Add Members to the Trip
  console.log("Adding 4 members to the trip...");
  const [mPrabhjot, mAman, mRahul, mSimran] = await Promise.all([
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: prabhjotUser.id, role: "ADMIN" },
    }),
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: amanUser.id, role: "MEMBER" },
    }),
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: rahulUser.id, role: "MEMBER" },
    }),
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: simranUser.id, role: "MEMBER" },
    }),
  ]);

  // 4. Create 4 Expenses from PDF Page 5 with Allocations
  console.log("Inserting 4 real expenses into Supabase PostgreSQL...");

  // Hotel: 4,000 INR (400,000 paise) paid by Prabhjot
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Hotel",
      amountMinor: BigInt(400000),
      currency: "INR",
      paidByMemberId: mPrabhjot.id,
      category: "stay",
      splitType: "EQUAL",
      allocations: {
        create: [
          { tripMemberId: mPrabhjot.id, shareMinor: BigInt(100000) },
          { tripMemberId: mAman.id, shareMinor: BigInt(100000) },
          { tripMemberId: mRahul.id, shareMinor: BigInt(100000) },
          { tripMemberId: mSimran.id, shareMinor: BigInt(100000) },
        ],
      },
    },
  });

  // Petrol: 2,000 INR (200,000 paise) paid by Aman
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Petrol",
      amountMinor: BigInt(200000),
      currency: "INR",
      paidByMemberId: mAman.id,
      category: "travel",
      splitType: "EQUAL",
      allocations: {
        create: [
          { tripMemberId: mPrabhjot.id, shareMinor: BigInt(50000) },
          { tripMemberId: mAman.id, shareMinor: BigInt(50000) },
          { tripMemberId: mRahul.id, shareMinor: BigInt(50000) },
          { tripMemberId: mSimran.id, shareMinor: BigInt(50000) },
        ],
      },
    },
  });

  // Dinner: 1,200 INR (120,000 paise) paid by Rahul
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Dinner",
      amountMinor: BigInt(120000),
      currency: "INR",
      paidByMemberId: mRahul.id,
      category: "food",
      splitType: "EQUAL",
      allocations: {
        create: [
          { tripMemberId: mPrabhjot.id, shareMinor: BigInt(30000) },
          { tripMemberId: mAman.id, shareMinor: BigInt(30000) },
          { tripMemberId: mRahul.id, shareMinor: BigInt(30000) },
          { tripMemberId: mSimran.id, shareMinor: BigInt(30000) },
        ],
      },
    },
  });

  // Snacks: 800 INR (80,000 paise) paid by Simran
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Snacks",
      amountMinor: BigInt(80000),
      currency: "INR",
      paidByMemberId: mSimran.id,
      category: "food",
      splitType: "EQUAL",
      allocations: {
        create: [
          { tripMemberId: mPrabhjot.id, shareMinor: BigInt(20000) },
          { tripMemberId: mAman.id, shareMinor: BigInt(20000) },
          { tripMemberId: mRahul.id, shareMinor: BigInt(20000) },
          { tripMemberId: mSimran.id, shareMinor: BigInt(20000) },
        ],
      },
    },
  });

  // 5. Test getTripBalances Service with Authorized Member
  console.log("\nCalling getTripBalances for authorized member Prabhjot...");
  const result = await getTripBalances(trip.id, prabhjotUser.id);

  assert(result.totalTripExpense === 8000, "Total trip expense is ₹8,000");
  assert(result.totalTripExpenseMinor === 800000, "Total minor units is 800,000 paise");

  const prabhjotBal = result.balances.find((b) => b.memberId === mPrabhjot.id)!;
  const amanBal = result.balances.find((b) => b.memberId === mAman.id)!;
  const rahulBal = result.balances.find((b) => b.memberId === mRahul.id)!;
  const simranBal = result.balances.find((b) => b.memberId === mSimran.id)!;

  assert(prabhjotBal.netBalance === 2000, "Prabhjot receives +₹2,000");
  assert(amanBal.netBalance === 0, "Aman is settled at ₹0");
  assert(rahulBal.netBalance === -800, "Rahul owes -₹800");
  assert(simranBal.netBalance === -1200, "Simran owes -₹1,200");

  assert(result.suggestedTransfers.length === 2, "Exactly 2 suggested transfers generated");
  console.log("\nTransfers calculated by Min-Cash-Flow engine:");
  result.suggestedTransfers.forEach((t) => {
    console.log(`  👉 ${t.fromMemberName} pays ${t.toMemberName}: ₹${t.amount}`);
  });

  // 6. Test Non-Member Authorization Guard
  console.log("\nTesting Security Guard: Non-member Stranger Bob trying to access balances...");
  let caughtAuthError = false;
  try {
    await getTripBalances(trip.id, strangerUser.id);
  } catch (err: any) {
    caughtAuthError = true;
    assert(err.status === 403, "Correctly rejected non-member with 403 Forbidden");
  }
  assert(caughtAuthError, "Non-member must never access trip balance data");

  // 7. Clean up test data
  console.log("\nCleaning up test data...");
  await prisma.trip.delete({ where: { id: trip.id } });
  await prisma.user.deleteMany({
    where: {
      id: { in: [prabhjotUser.id, amanUser.id, rahulUser.id, simranUser.id, strangerUser.id] },
    },
  });

  console.log("\n🎉 ALL PHASE 3 LIVE TESTS PASSED AGAINST SUPABASE POSTGRESQL! 🚀\n");
}

runLiveTest()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

