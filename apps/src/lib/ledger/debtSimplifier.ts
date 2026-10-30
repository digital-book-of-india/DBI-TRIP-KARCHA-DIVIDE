import type { MemberNetBalance, SuggestedTransfer } from "../../types/ledger";

/**
 * Min-Cash-Flow Algorithm (Greedy Debt Simplification)
 * 
 * Takes an array of MemberNetBalance and returns the minimum number of
 * direct transfers needed to settle all debts.
 * 
 * Invariant Rule:
 * Sum of all netBalanceMinor MUST equal zero (Zero-Sum Invariant).
 */
export function simplifyDebts(
  balances: MemberNetBalance[]
): SuggestedTransfer[] {
  // 1. Verify Zero-Sum Invariant
  const totalNetSum = balances.reduce((sum, b) => sum + b.netBalanceMinor, 0);
  if (totalNetSum !== 0) {
    throw new Error(
      `Zero-Sum Invariant Violated: Sum of all net balances must be 0, but got ${totalNetSum} paise.`
    );
  }

  // Map to easily look up member names
  const nameMap = new Map<string, string | undefined>();
  for (const b of balances) {
    nameMap.set(b.memberId, b.name);
  }

  // 2. Separate into Debtors (<0) and Creditors (>0)
  // Debtors owe money (amount they need to pay)
  const debtors = balances
    .filter((b) => b.netBalanceMinor < 0)
    .map((b) => ({
      memberId: b.memberId,
      name: b.name,
      amount: Math.abs(b.netBalanceMinor),
    }))
    .sort((a, b) => b.amount - a.amount);

  // Creditors are owed money (amount they need to receive)
  const creditors = balances
    .filter((b) => b.netBalanceMinor > 0)
    .map((b) => ({
      memberId: b.memberId,
      name: b.name,
      amount: b.netBalanceMinor,
    }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SuggestedTransfer[] = [];

  let dIndex = 0;
  let cIndex = 0;

  // 3. Greedily match the largest debtor with the largest creditor
  while (dIndex < debtors.length && cIndex < creditors.length) {
    const debtor = debtors[dIndex];
    const creditor = creditors[cIndex];

    const transferAmount = Math.min(debtor.amount, creditor.amount);

    if (transferAmount > 0) {
      transfers.push({
        fromMemberId: debtor.memberId,
        fromMemberName: debtor.name,
        toMemberId: creditor.memberId,
        toMemberName: creditor.name,
        amountMinor: transferAmount,
      });
    }

    debtor.amount -= transferAmount;
    creditor.amount -= transferAmount;

    if (debtor.amount === 0) {
      dIndex++;
    }
    if (creditor.amount === 0) {
      cIndex++;
    }
  }

  return transfers;
}
