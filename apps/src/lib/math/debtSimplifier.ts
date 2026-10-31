export interface MemberNetBalance {
  memberId: string;
  netBalanceMinor: number;
}

export interface SuggestedTransfer {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
}

export function simplifyDebts(balances: MemberNetBalance[]): SuggestedTransfer[] {
  const sum = balances.reduce((acc, curr) => acc + curr.netBalanceMinor, 0);
  if (Math.abs(sum) > 0) {
    throw new Error("Zero-Sum Invariant Violated: Sum of all net balances must equal zero");
  }

  const debtors = balances
    .filter((b) => b.netBalanceMinor < 0)
    .map((b) => ({ ...b, amount: Math.abs(b.netBalanceMinor) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = balances
    .filter((b) => b.netBalanceMinor > 0)
    .map((b) => ({ ...b, amount: b.netBalanceMinor }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SuggestedTransfer[] = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const settlementAmount = Math.min(debtor.amount, creditor.amount);

    if (settlementAmount > 0) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amountMinor: settlementAmount,
      });
    }

    debtor.amount -= settlementAmount;
    creditor.amount -= settlementAmount;

    if (debtor.amount === 0) dIdx++;
    if (creditor.amount === 0) cIdx++;
  }

  return transfers;
}
