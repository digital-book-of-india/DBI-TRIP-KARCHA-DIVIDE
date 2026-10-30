import type {
  TripMemberInfo,
  LedgerExpenseItem,
  LedgerSettlementItem,
} from "../../types/ledger";
import { computeTripBalances } from "./balanceEngine";
import { simplifyDebts } from "./debtSimplifier";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

function runTests() {
  console.log("=================================================");
  console.log("🚀 RUNNING PHASE 1: LEDGER & BALANCE ENGINE TESTS");
  console.log("=================================================\n");

  // TEST 1: PDF Page 5 - Four-Person Trip Worked Example
  console.log("--- Test 1: PDF Page 5 Four-Person Trip Example ---");
  const members: TripMemberInfo[] = [
    { id: "mem_prabhjot", name: "Prabhjot" },
    { id: "mem_aman", name: "Aman" },
    { id: "mem_rahul", name: "Rahul" },
    { id: "mem_simran", name: "Simran" },
  ];

  const expenses: LedgerExpenseItem[] = [
    {
      id: "exp_hotel",
      title: "Hotel",
      amountMinor: 400000,
      paidByMemberId: "mem_prabhjot",
      status: "ACTIVE",
      allocations: [
        { tripMemberId: "mem_prabhjot", shareMinor: 100000 },
        { tripMemberId: "mem_aman", shareMinor: 100000 },
        { tripMemberId: "mem_rahul", shareMinor: 100000 },
        { tripMemberId: "mem_simran", shareMinor: 100000 },
      ],
    },
    {
      id: "exp_petrol",
      title: "Petrol",
      amountMinor: 200000,
      paidByMemberId: "mem_aman",
      status: "ACTIVE",
      allocations: [
        { tripMemberId: "mem_prabhjot", shareMinor: 50000 },
        { tripMemberId: "mem_aman", shareMinor: 50000 },
        { tripMemberId: "mem_rahul", shareMinor: 50000 },
        { tripMemberId: "mem_simran", shareMinor: 50000 },
      ],
    },
    {
      id: "exp_dinner",
      title: "Dinner",
      amountMinor: 120000,
      paidByMemberId: "mem_rahul",
      status: "ACTIVE",
      allocations: [
        { tripMemberId: "mem_prabhjot", shareMinor: 30000 },
        { tripMemberId: "mem_aman", shareMinor: 30000 },
        { tripMemberId: "mem_rahul", shareMinor: 30000 },
        { tripMemberId: "mem_simran", shareMinor: 30000 },
      ],
    },
    {
      id: "exp_snacks",
      title: "Snacks",
      amountMinor: 80000,
      paidByMemberId: "mem_simran",
      status: "ACTIVE",
      allocations: [
        { tripMemberId: "mem_prabhjot", shareMinor: 20000 },
        { tripMemberId: "mem_aman", shareMinor: 20000 },
        { tripMemberId: "mem_rahul", shareMinor: 20000 },
        { tripMemberId: "mem_simran", shareMinor: 20000 },
      ],
    },
  ];

  const emptySettlements: LedgerSettlementItem[] = [];

  const summary = computeTripBalances({
    tripId: "trip_manali_2026",
    members,
    expenses,
    settlements: emptySettlements,
  });

  assert(summary.totalTripExpenseMinor === 800000, "Total trip expense must be ₹8,000 (800,000 paise)");

  const prabhjot = summary.balances.find((b) => b.memberId === "mem_prabhjot")!;
  const aman = summary.balances.find((b) => b.memberId === "mem_aman")!;
  const rahul = summary.balances.find((b) => b.memberId === "mem_rahul")!;
  const simran = summary.balances.find((b) => b.memberId === "mem_simran")!;

  assert(prabhjot.netBalanceMinor === 200000, "Prabhjot must receive ₹2,000 (+200,000 paise)");
  assert(aman.netBalanceMinor === 0, "Aman must be settled at ₹0");
  assert(rahul.netBalanceMinor === -80000, "Rahul owes ₹800 (-80,000 paise)");
  assert(simran.netBalanceMinor === -120000, "Simran owes ₹1,200 (-120,000 paise)");

  // Check suggested transfers
  assert(summary.suggestedTransfers.length === 2, "There must be exactly 2 suggested transfers");
  
  const simranTransfer = summary.suggestedTransfers.find((t) => t.fromMemberId === "mem_simran");
  assert(simranTransfer?.amountMinor === 120000, "Simran must pay Prabhjot ₹1,200");

  const rahulTransfer = summary.suggestedTransfers.find((t) => t.fromMemberId === "mem_rahul");
  assert(rahulTransfer?.amountMinor === 80000, "Rahul must pay Prabhjot ₹800");

  console.log("\n🎉 ALL PHASE 1 LEDGER ENGINE TESTS PASSED SUCCESSFULLY! 🚀\n");
}

runTests();
