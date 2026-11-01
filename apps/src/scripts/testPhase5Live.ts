import prisma from "../lib/prisma";
import { getTripReports } from "../lib/ledger/reportService";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${msg}`);
}

async function runPhase5LiveTest() {
  console.log("=================================================");
  console.log("🚀 TESTING PHASE 5: LIVE TRIP REPORTS & ANALYTICS");
  console.log("=================================================\n");

  const timestamp = Date.now();

  // 1. Create 3 test users and 1 stranger
  console.log("1. Creating test users...");
  const [alice, bob, charlie, stranger] = await Promise.all([
    prisma.user.create({
      data: {
        displayName: "Alice Green",
        email: `alice_${timestamp}@report.test`,
        password_hash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Bob White",
        email: `bob_${timestamp}@report.test`,
        password_hash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Charlie Black",
        email: `charlie_${timestamp}@report.test`,
        password_hash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Stranger Sam",
        email: `stranger_${timestamp}@report.test`,
        password_hash: "hash",
      },
    }),
  ]);

  // 2. Create Trip
  console.log("2. Creating trip 'Goa Vacation'...");
  const trip = await prisma.trip.create({
    data: {
      name: "Goa Vacation",
      destination: "Goa",
      currency: "INR",
      createdBy: alice.id,
    },
  });

  const [mAlice, mBob, mCharlie] = await Promise.all([
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: alice.id, role: "ADMIN" },
    }),
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: bob.id, role: "MEMBER" },
    }),
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: charlie.id, role: "MEMBER" },
    }),
  ]);

  // 3. Create Expenses across categories
  // Total: ₹10,000 (1,000,000 paise)
  // - Stay: ₹6,000 (600,000 paise) paid by Alice
  // - Food: ₹3,000 (300,000 paise) paid by Bob
  // - Travel: ₹1,000 (100,000 paise) paid by Charlie
  console.log("3. Inserting categorized expenses...");
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Resort Stay",
      category: "stay",
      amountMinor: BigInt(600000),
      paidByMemberId: mAlice.id,
      allocations: {
        create: [
          { tripMemberId: mAlice.id, shareMinor: BigInt(200000) },
          { tripMemberId: mBob.id, shareMinor: BigInt(200000) },
          { tripMemberId: mCharlie.id, shareMinor: BigInt(200000) },
        ],
      },
    },
  });

  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Beach Dinner",
      category: "food",
      amountMinor: BigInt(300000),
      paidByMemberId: mBob.id,
      allocations: {
        create: [
          { tripMemberId: mAlice.id, shareMinor: BigInt(100000) },
          { tripMemberId: mBob.id, shareMinor: BigInt(100000) },
          { tripMemberId: mCharlie.id, shareMinor: BigInt(100000) },
        ],
      },
    },
  });

  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Airport Taxi",
      category: "travel",
      amountMinor: BigInt(100000),
      paidByMemberId: mCharlie.id,
      allocations: {
        create: [
          { tripMemberId: mAlice.id, shareMinor: BigInt(33334) },
          { tripMemberId: mBob.id, shareMinor: BigInt(33333) },
          { tripMemberId: mCharlie.id, shareMinor: BigInt(33333) },
        ],
      },
    },
  });

  // 4. Generate Reports
  console.log("\n4. Calling getTripReports...");
  const report = await getTripReports(trip.id, alice.id);

  // Validate Summary Card
  assert(report.summaryCard.totalSpent === 10000, "Summary card total spent is ₹10,000");
  assert(report.summaryCard.totalExpensesCount === 3, "Total expenses count is 3");
  assert(report.summaryCard.totalMembersCount === 3, "Total members count is 3");
  assert(report.summaryCard.isFullySettled === false, "Trip is not yet fully settled");

  console.log("\n--- Category Breakdown ---");
  report.categories.forEach((c) => {
    console.log(`  📊 ${c.category.toUpperCase()}: ₹${c.total} (${c.percentage}%) [${c.expenseCount} items]`);
  });

  const stayCategory = report.categories.find((c) => c.category === "stay")!;
  const foodCategory = report.categories.find((c) => c.category === "food")!;
  const travelCategory = report.categories.find((c) => c.category === "travel")!;

  assert(stayCategory.total === 6000 && stayCategory.percentage === 60, "Stay category is ₹6,000 (60%)");
  assert(foodCategory.total === 3000 && foodCategory.percentage === 30, "Food category is ₹3,000 (30%)");
  assert(travelCategory.total === 1000 && travelCategory.percentage === 10, "Travel category is ₹1,000 (10%)");

  console.log("\n--- Per-Person Spending ---");
  report.perPerson.forEach((p) => {
    console.log(
      `  👤 ${p.name}: Paid ₹${p.totalPaid} | Share ₹${p.totalPersonalShare} | Net ₹${p.netBalance} (${p.status})`
    );
  });

  const aliceSummary = report.perPerson.find((p) => p.memberId === mAlice.id)!;
  assert(aliceSummary.status === "RECEIVES", "Alice should receive money");

  // 5. Non-member Access Security Test
  console.log("\n5. Testing Security: Non-member Stranger Sam requesting reports...");
  let caughtSecurityError = false;
  try {
    await getTripReports(trip.id, stranger.id);
  } catch (err: unknown) {
    caughtSecurityError = true;
    assert((err as { status?: number }).status === 403, "Stranger access blocked with 403 Forbidden");
  }
  assert(caughtSecurityError, "Non-member report access was prevented");

  // 6. Clean up
  console.log("\n6. Cleaning up test data...");
  await prisma.trip.delete({ where: { id: trip.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [alice.id, bob.id, charlie.id, stranger.id] } },
  });

  console.log("\n🎉 ALL PHASE 5 REPORT & ANALYTICS TESTS PASSED! 🚀\n");
}

runPhase5LiveTest()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

