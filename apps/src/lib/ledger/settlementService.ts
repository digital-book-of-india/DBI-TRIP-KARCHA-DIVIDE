import prisma from "../prisma";

export interface CreateSettlementInput {
  tripId: string;
  actorUserId: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
  paymentNote?: string;
}

export interface SettlementResult {
  id: string;
  tripId: string;
  fromMemberId: string;
  fromMemberName?: string;
  toMemberId: string;
  toMemberName?: string;
  amountMinor: number;
  amount: number;
  status: string;
  paymentNote?: string | null;
  createdBy: string | null;
  createdAt: Date | null;
}

/**
 * Creates a new settlement record with status 'PENDING'.
 * Enforces:
 * 1. Both members belong to the trip.
 * 2. Actor is either the payer (fromMember) or a trip admin.
 * 3. Amount must be positive.
 * 4. Logs SettlementEvent (CREATED).
 * 5. Creates in-app Notification for the receiver.
 */
export async function createSettlement(input: CreateSettlementInput): Promise<SettlementResult> {
  const { tripId, actorUserId, fromMemberId, toMemberId, amountMinor, paymentNote } = input;

  if (amountMinor <= 0) {
    const error: any = new Error("Settlement amount must be greater than zero");
    error.status = 400;
    throw error;
  }

  if (fromMemberId === toMemberId) {
    const error: any = new Error("Sender and receiver cannot be the same member");
    error.status = 400;
    throw error;
  }

  // 1. Verify trip and members
  const [fromMember, toMember] = await Promise.all([
    prisma.tripMember.findUnique({
      where: { id: fromMemberId },
      include: { user: true },
    }),
    prisma.tripMember.findUnique({
      where: { id: toMemberId },
      include: { user: true },
    }),
  ]);

  if (!fromMember || fromMember.tripId !== tripId) {
    const error: any = new Error("Invalid sender member for this trip");
    error.status = 400;
    throw error;
  }

  if (!toMember || toMember.tripId !== tripId) {
    const error: any = new Error("Invalid receiver member for this trip");
    error.status = 400;
    throw error;
  }

  // Verify actor permission: Must be the payer or an admin
  const isPayer = fromMember.userId === actorUserId;
  const isAdmin = fromMember.role === "ADMIN";

  if (!isPayer && !isAdmin) {
    // Check if actor is an admin of the trip
    const actorMembership = await prisma.tripMember.findUnique({
      where: {
        tripId_userId: {
          tripId,
          userId: actorUserId,
        },
      },
    });

    if (!actorMembership || actorMembership.role !== "ADMIN") {
      const error: any = new Error("Forbidden: Only the sender or a trip admin can record this payment");
      error.status = 403;
      throw error;
    }
  }

  // 2. Atomic Database Transaction: Settlement + Event + Notification
  const formattedAmount = (amountMinor / 100).toFixed(2);
  const senderName = fromMember.user?.displayName || "A member";

  const settlement = await prisma.$transaction(async (tx) => {
    // Create Settlement
    const newSettlement = await tx.settlement.create({
      data: {
        tripId,
        fromMemberId,
        toMemberId,
        amountMinor: BigInt(amountMinor),
        status: "PENDING",
        paymentNote: paymentNote || null,
        createdBy: actorUserId,
      },
    });

    // Create Audit Event
    await tx.settlementEvent.create({
      data: {
        settlementId: newSettlement.id,
        actorUserId,
        eventType: "CREATED",
        note: `Settlement initiated for ₹${formattedAmount}. Status: PENDING`,
      },
    });

    // Notify the Receiver
    if (toMember.userId) {
      await tx.notification.create({
        data: {
          userId: toMember.userId,
          title: "Payment Received Notification",
          message: `${senderName} marked ₹${formattedAmount} as paid to you. Please confirm when received.`,
          deliveryStatus: "SENT",
        },
      });
    }

    return newSettlement;
  });

  return {
    id: settlement.id,
    tripId: settlement.tripId,
    fromMemberId: settlement.fromMemberId,
    fromMemberName: fromMember.user?.displayName,
    toMemberId: settlement.toMemberId,
    toMemberName: toMember.user?.displayName,
    amountMinor: Number(settlement.amountMinor),
    amount: Number(settlement.amountMinor) / 100,
    status: settlement.status || "PENDING",
    paymentNote: settlement.paymentNote,
    createdBy: settlement.createdBy,
    createdAt: settlement.createdAt,
  };
}

/**
 * Receiver confirms payment. Transitions status to 'CONFIRMED'.
 * Enforces:
 * 1. Only receiver (toMember) or a trip admin can confirm (payer CANNOT confirm their own payment!).
 * 2. Settlement cannot already be CONFIRMED.
 * 3. Logs SettlementEvent (CONFIRMED).
 * 4. Notifies payer.
 */
export async function confirmSettlement(settlementId: string, actorUserId: string): Promise<SettlementResult> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      fromMember: { include: { user: true } },
      toMember: { include: { user: true } },
    },
  });

  if (!settlement) {
    const error: any = new Error("Settlement not found");
    error.status = 404;
    throw error;
  }

  if (settlement.status === "CONFIRMED") {
    const error: any = new Error("Settlement is already confirmed");
    error.status = 400;
    throw error;
  }

  // Authorization check: Only receiver or trip admin can confirm
  const isReceiver = settlement.toMember?.userId === actorUserId;
  let isTripAdmin = false;

  if (!isReceiver) {
    const actorMembership = await prisma.tripMember.findUnique({
      where: {
        tripId_userId: {
          tripId: settlement.tripId,
          userId: actorUserId,
        },
      },
    });
    isTripAdmin = actorMembership?.role === "ADMIN";
  }

  if (!isReceiver && !isTripAdmin) {
    const error: any = new Error("Forbidden: Only the receiving member or trip admin can confirm this payment");
    error.status = 403;
    throw error;
  }

  const formattedAmount = (Number(settlement.amountMinor) / 100).toFixed(2);
  const receiverName = settlement.toMember?.user?.displayName || "Receiver";

  const updatedSettlement = await prisma.$transaction(async (tx) => {
    const updated = await tx.settlement.update({
      where: { id: settlementId },
      data: { status: "CONFIRMED" },
    });

    await tx.settlementEvent.create({
      data: {
        settlementId,
        actorUserId,
        eventType: "CONFIRMED",
        note: `Payment of ₹${formattedAmount} confirmed by ${receiverName}.`,
      },
    });

    // Notify the Payer that payment was confirmed
    if (settlement.fromMember?.userId) {
      await tx.notification.create({
        data: {
          userId: settlement.fromMember.userId,
          title: "Payment Confirmed",
          message: `${receiverName} confirmed receiving your payment of ₹${formattedAmount}.`,
          deliveryStatus: "SENT",
        },
      });
    }

    return updated;
  });

  return {
    id: updatedSettlement.id,
    tripId: updatedSettlement.tripId,
    fromMemberId: updatedSettlement.fromMemberId,
    fromMemberName: settlement.fromMember?.user?.displayName,
    toMemberId: updatedSettlement.toMemberId,
    toMemberName: settlement.toMember?.user?.displayName,
    amountMinor: Number(updatedSettlement.amountMinor),
    amount: Number(updatedSettlement.amountMinor) / 100,
    status: updatedSettlement.status || "CONFIRMED",
    paymentNote: updatedSettlement.paymentNote,
    createdBy: updatedSettlement.createdBy,
    createdAt: updatedSettlement.createdAt,
  };
}

/**
 * Receiver disputes payment. Transitions status to 'DISPUTED'.
 */
export async function disputeSettlement(
  settlementId: string,
  actorUserId: string,
  reason?: string
): Promise<SettlementResult> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      fromMember: { include: { user: true } },
      toMember: { include: { user: true } },
    },
  });

  if (!settlement) {
    const error: any = new Error("Settlement not found");
    error.status = 404;
    throw error;
  }

  // Authorization check: Only receiver or trip admin can dispute
  const isReceiver = settlement.toMember?.userId === actorUserId;
  let isTripAdmin = false;

  if (!isReceiver) {
    const actorMembership = await prisma.tripMember.findUnique({
      where: {
        tripId_userId: {
          tripId: settlement.tripId,
          userId: actorUserId,
        },
      },
    });
    isTripAdmin = actorMembership?.role === "ADMIN";
  }

  if (!isReceiver && !isTripAdmin) {
    const error: any = new Error("Forbidden: Only the receiving member or trip admin can dispute this payment");
    error.status = 403;
    throw error;
  }

  const formattedAmount = (Number(settlement.amountMinor) / 100).toFixed(2);
  const receiverName = settlement.toMember?.user?.displayName || "Receiver";
  const disputeReason = reason || "Payment not received or amount mismatch";

  const updatedSettlement = await prisma.$transaction(async (tx) => {
    const updated = await tx.settlement.update({
      where: { id: settlementId },
      data: { status: "DISPUTED" },
    });

    await tx.settlementEvent.create({
      data: {
        settlementId,
        actorUserId,
        eventType: "DISPUTED",
        note: `Dispute raised: ${disputeReason}`,
      },
    });

    // Notify the Payer that payment was disputed
    if (settlement.fromMember?.userId) {
      await tx.notification.create({
        data: {
          userId: settlement.fromMember.userId,
          title: "Payment Disputed",
          message: `${receiverName} disputed your payment of ₹${formattedAmount}. Reason: ${disputeReason}`,
          deliveryStatus: "SENT",
        },
      });
    }

    return updated;
  });

  return {
    id: updatedSettlement.id,
    tripId: updatedSettlement.tripId,
    fromMemberId: updatedSettlement.fromMemberId,
    fromMemberName: settlement.fromMember?.user?.displayName,
    toMemberId: updatedSettlement.toMemberId,
    toMemberName: settlement.toMember?.user?.displayName,
    amountMinor: Number(updatedSettlement.amountMinor),
    amount: Number(updatedSettlement.amountMinor) / 100,
    status: updatedSettlement.status || "DISPUTED",
    paymentNote: updatedSettlement.paymentNote,
    createdBy: updatedSettlement.createdBy,
    createdAt: updatedSettlement.createdAt,
  };
}

/**
 * Lists all settlements for a trip with their audit events.
 */
export async function getTripSettlements(tripId: string, actorUserId: string) {
  // Verify actor is a member of the trip
  const membership = await prisma.tripMember.findUnique({
    where: {
      tripId_userId: {
        tripId,
        userId: actorUserId,
      },
    },
  });

  if (!membership) {
    const error: any = new Error("Access Denied: You are not a member of this trip");
    error.status = 403;
    throw error;
  }

  const settlements = await prisma.settlement.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
    include: {
      fromMember: { include: { user: { select: { displayName: true, avatarUrl: true } } } },
      toMember: { include: { user: { select: { displayName: true, avatarUrl: true } } } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });

  return settlements.map((st) => ({
    id: st.id,
    tripId: st.tripId,
    fromMemberId: st.fromMemberId,
    fromMemberName: st.fromMember?.user?.displayName,
    toMemberId: st.toMemberId,
    toMemberName: st.toMember?.user?.displayName,
    amountMinor: Number(st.amountMinor),
    amount: Number(st.amountMinor) / 100,
    status: st.status,
    paymentNote: st.paymentNote,
    createdAt: st.createdAt,
    events: st.events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      note: e.note,
      createdAt: e.createdAt,
    })),
  }));
}

