import prisma from "../lib/prisma";
import {
  createSettlement,
  confirmSettlement,
  disputeSettlement,
  getTripSettlements,
} from "../lib/ledger/settlementService";
import { getTripBalances } from "../lib/ledger/balanceService";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${msg}`);
}

async function runPhase4LiveTest() {
  console.log("=================================================");
  console.log("🚀 TESTING PHASE 4: LIVE SETTLE-UP ENGINE & STATE MACHINE");
  console.log("=================================================\n");

  const timestamp = Date.now();

  // 1. Create 2 Users: Prabhjot (Receiver) and Rahul (Payer)
  console.log("1. Creating test users...");
  const [prabhjotUser, rahulUser] = await Promise.all([
    prisma.user.create({
      data: {
        displayName: "Prabhjot Singh",
        email: `prabhjot_${timestamp}@settle.test`,
        password_hash: "dummy_hash",
      },
    }),
    prisma.user.create({
      data: {
        displayName: "Rahul Verma",
        email: `rahul_${timestamp}@settle.test`,
        password_hash: "dummy_hash",
      },
    }),
  ]);

  // 2. Create Trip & Members
  console.log("2. Creating trip & members...");
  const trip = await prisma.trip.create({
    data: {
      name: "Phase 4 Settlement Test Trip",
      currency: "INR",
      createdBy: prabhjotUser.id,
    },
  });

  const [mPrabhjot, mRahul] = await Promise.all([
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: prabhjotUser.id, role: "ADMIN" },
    }),
    prisma.tripMember.create({
      data: { tripId: trip.id, userId: rahulUser.id, role: "MEMBER" },
    }),
  ]);

  // 3. Add Expense: Prabhjot paid ₹1,600, split ₹800 each. Rahul owes Prabhjot ₹800.
  console.log("3. Creating expense: Prabhjot paid ₹1,600, Rahul share ₹800...");
  await prisma.expense.create({
    data: {
      tripId: trip.id,
      title: "Shared Dinner",
      amountMinor: BigInt(160000),
      paidByMemberId: mPrabhjot.id,
      allocations: {
        create: [
          { tripMemberId: mPrabhjot.id, shareMinor: BigInt(80000) },
          { tripMemberId: mRahul.id, shareMinor: BigInt(80000) },
        ],
      },
    },
  });

  // Check initial balance
  const initialBal = await getTripBalances(trip.id, rahulUser.id);
  const rahulBalInitial = initialBal.balances.find((b) => b.memberId === mRahul.id)!;
  assert(rahulBalInitial.netBalance === -800, "Initial state: Rahul owes ₹800");

  // 4. Test Step 1: Rahul marks ₹800 as PENDING
  console.log("\n4. Testing Settlement Creation (PENDING)...");
  const settlement1 = await createSettlement({
    tripId: trip.id,
    actorUserId: rahulUser.id,
    fromMemberId: mRahul.id,
    toMemberId: mPrabhjot.id,
    amountMinor: 80000,
    paymentNote: "Sent via UPI ref #123456",
  });

  assert(settlement1.status === "PENDING", "Settlement status is PENDING");
  assert(settlement1.amount === 800, "Settlement amount is ₹800");

  // Check that Prabhjot received an in-app notification
  const notifForPrabhjot = await prisma.notification.findFirst({
    where: { userId: prabhjotUser.id },
    orderBy: { createdAt: "desc" },
  });
  assert(
    notifForPrabhjot?.message.includes("marked ₹800.00 as paid"),
    "Receiver Prabhjot received notification to confirm payment"
  );

  // Check balance while PENDING: Ledger must NOT reduce debt yet!
  const pendingBal = await getTripBalances(trip.id, rahulUser.id);
  const rahulBalPending = pendingBal.balances.find((b) => b.memberId === mRahul.id)!;
  assert(
    rahulBalPending.netBalance === -800,
    "PENDING status does NOT adjust ledger; Rahul still owes ₹800"
  );

  // 5. Test Step 2: Security check - Payer CANNOT confirm their own payment!
  console.log("\n5. Testing Security: Payer trying to confirm own payment...");
  let caughtSelfConfirm = false;
  try {
    await confirmSettlement(settlement1.id, rahulUser.id);
  } catch (err: unknown) {
    caughtSelfConfirm = true;
    assert((err as { status?: number }).status === 403, "Payer self-confirmation correctly blocked with 403 Forbidden");
  }
  assert(caughtSelfConfirm, "Payer must NEVER be able to confirm their own payment");

  // 6. Test Step 3: Receiver confirms payment (CONFIRMED)
  console.log("\n6. Testing Receiver Confirmation (CONFIRMED)...");
  const confirmed = await confirmSettlement(settlement1.id, prabhjotUser.id);
  assert(confirmed.status === "CONFIRMED", "Settlement transitioned to CONFIRMED");

  // Check Payer received confirmation notification
  const notifForRahul = await prisma.notification.findFirst({
    where: { userId: rahulUser.id },
    orderBy: { createdAt: "desc" },
  });
  assert(
    notifForRahul?.title === "Payment Confirmed",
    "Payer Rahul received payment confirmed notification"
  );

  // Check balance after CONFIRMED: Ledger must now be completely settled!
  const confirmedBal = await getTripBalances(trip.id, rahulUser.id);
  const rahulBalConfirmed = confirmedBal.balances.find((b) => b.memberId === mRahul.id)!;
  const prabhjotBalConfirmed = confirmedBal.balances.find((b) => b.memberId === mPrabhjot.id)!;

  assert(rahulBalConfirmed.netBalance === 0, "Rahul is now settled at ₹0");
  assert(prabhjotBalConfirmed.netBalance === 0, "Prabhjot is now settled at ₹0");
  assert(confirmedBal.isSettled === true, "Trip is marked fully settled");
  assert(confirmedBal.suggestedTransfers.length === 0, "0 suggested transfers remaining");

  // 7. Test Step 4: Dispute flow
  console.log("\n7. Testing Dispute Flow (DISPUTED)...");
  const settlement2 = await createSettlement({
    tripId: trip.id,
    actorUserId: rahulUser.id,
    fromMemberId: mRahul.id,
    toMemberId: mPrabhjot.id,
    amountMinor: 50000,
    paymentNote: "Second payment",
  });

  const disputed = await disputeSettlement(
    settlement2.id,
    prabhjotUser.id,
    "Payment not received in bank account"
  );
  assert(disputed.status === "DISPUTED", "Settlement transitioned to DISPUTED");

  // Verify Audit History
  const history = await getTripSettlements(trip.id, rahulUser.id);
  const disputedItem = history.find((h) => h.id === settlement2.id)!;
  assert(disputedItem.events.length === 2, "Disputed settlement has 2 audit events (CREATED + DISPUTED)");
  console.log("Audit log for disputed payment:");
  disputedItem.events.forEach((e) => console.log(`  📝 [${e.eventType}]: ${e.note}`));

  // 8. Clean up
  console.log("\n8. Cleaning up test records...");
  await prisma.trip.delete({ where: { id: trip.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [prabhjotUser.id, rahulUser.id] } },
  });

  console.log("\n🎉 ALL PHASE 4 SETTLE-UP & STATE MACHINE TESTS PASSED! 🚀\n");
}

runPhase4LiveTest()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

