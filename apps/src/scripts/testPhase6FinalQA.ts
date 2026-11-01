import prisma from "../lib/prisma";
import { getTripBalances } from "../lib/ledger/balanceService";
import {
  createSettlement,
  confirmSettlement,
  getTripSettlements,
} from "../lib/ledger/settlementService";
import { getTripReports } from "../lib/ledger/reportService";
import {
  getUserNotifications,
  markNotificationAsRead,
} from "../lib/notifications/notificationService";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${msg}`);
}

async function runFinalQAAcceptanceTest() {
  console.log("======================================================================");
  console.log("🏆 DEVELOPER 3: FINAL QA ACCEPTANCE & END-TO-END VERIFICATION SUITE");
  console.log("======================================================================\n");

  const timestamp = Date.now();

  // 1. SETUP: 4 Users + 1 Stranger
  console.log("Step 1: Setting up users in Supabase...");
  const [prabhjot, aman, rahul, simran, stranger] = await Promise.all([
    prisma.user.create({
      data: { displayName: "Prabhjot", email: `prabhjot_${timestamp}@qa.test`, password_hash: "hash" },
    }),
    prisma.user.create({
      data: { displayName: "Aman", email: `aman_${timestamp}@qa.test`, password_hash: "hash" },
    }),
    prisma.user.create({
      data: { displayName: "Rahul", email: `rahul_${timestamp}@qa.test`, password_hash: "hash" },
    }),
    prisma.user.create({
      data: { displayName: "Simran", email: `simran_${timestamp}@qa.test`, password_hash: "hash" },
    }),
    prisma.user.create({
      data: { displayName: "Stranger Bob", email: `stranger_${timestamp}@qa.test`, password_hash: "hash" },
    }),
  ]);

  // 2. SETUP: Trip & 4 Members
  console.log("Step 2: Creating Trip and 4 Members...");
  const trip = await prisma.trip.create({
    data: {
      name: "Manali Official MVP Verification Trip",
      destination: "Manali",
      currency: "INR",
      createdBy: prabhjot.id,
    },
  });

  const [mPrabhjot, mAman, mRahul, mSimran] = await Promise.all([
    prisma.tripMember.create({ data: { tripId: trip.id, userId: prabhjot.id, role: "ADMIN" } }),
    prisma.tripMember.create({ data: { tripId: trip.id, userId: aman.id, role: "MEMBER" } }),
    prisma.tripMember.create({ data: { tripId: trip.id, userId: rahul.id, role: "MEMBER" } }),
    prisma.tripMember.create({ data: { tripId: trip.id, userId: simran.id, role: "MEMBER" } }),
  ]);

  // 3. SETUP: 4 Expenses from PDF Page 5
  console.log("Step 3: Creating 4 standard expenses (Hotel, Petrol, Dinner, Snacks)...");
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Hotel",
      category: "stay",
      amountMinor: BigInt(400000),
      paidByMemberId: mPrabhjot.id,
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

  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Petrol",
      category: "travel",
      amountMinor: BigInt(200000),
      paidByMemberId: mAman.id,
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

  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Dinner",
      category: "food",
      amountMinor: BigInt(120000),
      paidByMemberId: mRahul.id,
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

  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Snacks",
      category: "food",
      amountMinor: BigInt(80000),
      paidByMemberId: mSimran.id,
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

  // 4. VERIFY: Net Balances & Zero-Sum Invariant
  console.log("\n--- Verification 1: Net Balances & Min-Cash-Flow ---");
  const balances = await getTripBalances(trip.id, prabhjot.id);

  assert(balances.totalTripExpense === 8000, "Trip total expense is ₹8,000");

  const pBal = balances.balances.find((b) => b.memberId === mPrabhjot.id)!;
  const aBal = balances.balances.find((b) => b.memberId === mAman.id)!;
  const rBal = balances.balances.find((b) => b.memberId === mRahul.id)!;
  const sBal = balances.balances.find((b) => b.memberId === mSimran.id)!;

  assert(pBal.netBalance === 2000, "Prabhjot should receive ₹2,000");
  assert(aBal.netBalance === 0, "Aman is settled at ₹0");
  assert(rBal.netBalance === -800, "Rahul owes ₹800");
  assert(sBal.netBalance === -1200, "Simran owes ₹1,200");

  const totalSum = balances.balances.reduce((acc, curr) => acc + curr.netBalanceMinor, 0);
  assert(totalSum === 0, "Zero-Sum Invariant verified: Sum of all net balances is strictly 0");

  assert(balances.suggestedTransfers.length === 2, "Min-Cash-Flow generated exactly 2 transfers");
  console.log("Min-Cash-Flow Transfers:");
  balances.suggestedTransfers.forEach((t) => {
    console.log(`  👉 ${t.fromMemberName} -> ${t.toMemberName}: ₹${t.amount}`);
  });

  // 5. VERIFY: Notification Stream & Settle-up
  console.log("\n--- Verification 2: Settlement Life Cycle & In-App Notifications ---");
  
  // Rahul pays Prabhjot ₹800
  const settlement1 = await createSettlement({
    tripId: trip.id,
    actorUserId: rahul.id,
    fromMemberId: mRahul.id,
    toMemberId: mPrabhjot.id,
    amountMinor: 80000,
    paymentNote: "GPay ref #776655",
  });
  assert(settlement1.status === "PENDING", "Settlement 1 status is PENDING");

  // Check Prabhjot's notifications
  const prabhjotNotifs = await getUserNotifications(prabhjot.id);
  assert(prabhjotNotifs.unreadCount >= 1, "Prabhjot has at least 1 unread notification");
  
  const paymentNotif = prabhjotNotifs.notifications[0];
  assert(paymentNotif.message.includes("marked ₹800.00 as paid"), "Notification text matches payment");

  // Unauthorized read attempt: Simran trying to mark Prabhjot's notification as read
  let caughtNotifHack = false;
  try {
    await markNotificationAsRead(paymentNotif.id, simran.id);
  } catch (err: unknown) {
    caughtNotifHack = true;
    assert((err as { status?: number }).status === 403, "Stranger blocked from marking another user's notification as read (403)");
  }
  assert(caughtNotifHack, "Notification privacy guard verified");

  // Prabhjot marks notification as read
  const readResult = await markNotificationAsRead(paymentNotif.id, prabhjot.id);
  assert(readResult.isRead === true, "Notification successfully marked as READ");

  // Prabhjot confirms payment
  await confirmSettlement(settlement1.id, prabhjot.id);

  // Check Rahul is settled
  const midBalances = await getTripBalances(trip.id, rahul.id);
  const rBalMid = midBalances.balances.find((b) => b.memberId === mRahul.id)!;
  assert(rBalMid.netBalance === 0, "Rahul is now fully settled (₹0)");
  assert(midBalances.suggestedTransfers.length === 1, "Only 1 transfer remains: Simran -> Prabhjot ₹1,200");

  // 6. VERIFY: Simran Settle-Up & Final Trip State
  console.log("\n--- Verification 3: Full Trip Settlement ---");
  const settlement2 = await createSettlement({
    tripId: trip.id,
    actorUserId: simran.id,
    fromMemberId: mSimran.id,
    toMemberId: mPrabhjot.id,
    amountMinor: 120000,
  });
  await confirmSettlement(settlement2.id, prabhjot.id);

  const finalBalances = await getTripBalances(trip.id, prabhjot.id);
  assert(finalBalances.isSettled === true, "Trip is marked as isSettled: TRUE");
  assert(finalBalances.suggestedTransfers.length === 0, "0 suggested transfers remaining");
  finalBalances.balances.forEach((b) => {
    assert(b.netBalance === 0, `Member ${b.name} net balance is ₹0`);
  });

  // 7. VERIFY: Analytics & Reports
  console.log("\n--- Verification 4: Reports & Analytics ---");
  const report = await getTripReports(trip.id, prabhjot.id);

  assert(report.summaryCard.totalSpent === 8000, "Report total spent is ₹8,000");
  assert(report.summaryCard.isFullySettled === true, "Report summary reflects isFullySettled: TRUE");
  assert(report.summaryCard.settlementProgressPercentage === 100, "Settlement progress is 100%");

  console.log("Trip Category Breakdown:");
  report.categories.forEach((c) => {
    console.log(`  📊 ${c.category.toUpperCase()}: ₹${c.total} (${c.percentage}%)`);
  });

  const stayCat = report.categories.find((c) => c.category === "stay")!;
  const travelCat = report.categories.find((c) => c.category === "travel")!;
  const foodCat = report.categories.find((c) => c.category === "food")!;

  assert(stayCat.total === 4000 && stayCat.percentage === 50, "Stay is ₹4,000 (50%)");
  assert(travelCat.total === 2000 && travelCat.percentage === 25, "Travel is ₹2,000 (25%)");
  assert(foodCat.total === 2000 && foodCat.percentage === 25, "Food is ₹2,000 (25%)");

  // 8. VERIFY: Non-Member Access Guard across all endpoints
  console.log("\n--- Verification 5: Non-Member Access Security ---");
  let caughtBal = false;
  let caughtReport = false;
  let caughtSettlements = false;

  try { await getTripBalances(trip.id, stranger.id); } catch (err: unknown) { caughtBal = (err as { status?: number }).status === 403; }
  try { await getTripReports(trip.id, stranger.id); } catch (err: unknown) { caughtReport = (err as { status?: number }).status === 403; }
  try { await getTripSettlements(trip.id, stranger.id); } catch (err: unknown) { caughtSettlements = (err as { status?: number }).status === 403; }

  assert(caughtBal, "Non-member blocked from trip balances (403)");
  assert(caughtReport, "Non-member blocked from trip reports (403)");
  assert(caughtSettlements, "Non-member blocked from trip settlements (403)");

  // 9. CLEANUP
  console.log("\nCleaning up verification records...");
  await prisma.trip.delete({ where: { id: trip.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [prabhjot.id, aman.id, rahul.id, simran.id, stranger.id] } },
  });

  console.log("\n======================================================================");
  console.log("🎉 ALL DEVELOPER 3 ACCEPTANCE CRITERIA PASSED WITH 100% SUCCESS! 🚀");
  console.log("======================================================================\n");
}

runFinalQAAcceptanceTest()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

