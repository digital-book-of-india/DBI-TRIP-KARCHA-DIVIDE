/* eslint-disable @typescript-eslint/no-explicit-any */
import { setPrismaClient } from "../lib/db";
import { Prisma, PrismaClient } from "@prisma/client";

export function createTestId(): string {
  return "c" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

export const testDb = {
  users: new Map<string, any>(),
  trips: new Map<string, any>(),
  tripMembers: new Map<string, any>(),
  expenses: new Map<string, any>(),
  allocations: new Map<string, any>(),
  auditLogs: new Map<string, any>(),
  settlements: new Map<string, any>(),
  settlementEvents: new Map<string, any>(),
  notifications: new Map<string, any>(),

  clear() {
    this.users.clear();
    this.trips.clear();
    this.tripMembers.clear();
    this.expenses.clear();
    this.allocations.clear();
    this.auditLogs.clear();
    this.settlements.clear();
    this.settlementEvents.clear();
    this.notifications.clear();
  },

  addUser(user: { _id?: string; id?: string; name: string; email: string; passwordHash?: string }) {
    const id = user.id || user._id || createTestId();
    const doc = {
      id,
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, doc);
    return doc;
  },

  addTrip(trip: { _id?: string; id?: string; title: string; name?: string; createdBy?: string; createdById?: string; currency?: string }) {
    const id = trip.id || trip._id || createTestId();
    const createdById = trip.createdById || trip.createdBy || "";
    const doc = {
      id,
      title: trip.title,
      name: trip.name || trip.title,
      createdById,
      currency: trip.currency || "INR",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.trips.set(id, doc);
    return doc;
  },

  addTripMember(tripId: string, userId: string, role = "MEMBER") {
    const id = createTestId();
    const doc = {
      id,
      tripId,
      userId,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tripMembers.set(`${tripId}_${userId}`, doc);
    return doc;
  },
};

interface TransactionDeltaLog {
  created: { col: "expenses" | "allocations" | "auditLogs"; id: string }[];
  updated: { col: "expenses"; id: string; prev: any }[];
  deleted: { col: "allocations"; id: string; doc: any }[];
}

function createMockPrismaOperations(txLog?: TransactionDeltaLog): any {
  return {
    user: {
      async findUnique(args: any) {
        const id = args.where?.id;
        const email = args.where?.email;
        let found: any = null;
        if (id) {
          found = testDb.users.get(id);
        } else if (email) {
          for (const u of testDb.users.values()) {
            if (u.email.toLowerCase() === email.toLowerCase()) {
              found = u;
              break;
            }
          }
        }
        if (!found) return null;
        if (args.select) {
          const res: any = {};
          for (const [k, v] of Object.entries(args.select)) {
            if (v) res[k] = found[k];
          }
          return res;
        }
        return { ...found };
      },
      async findMany(args: any) {
        const ids = args?.where?.id?.in;
        const results: any[] = [];
        for (const u of testDb.users.values()) {
          if (ids && !ids.includes(u.id)) continue;
          if (args?.select) {
            const res: any = {};
            for (const [k, v] of Object.entries(args.select)) {
              if (v) res[k] = u[k];
            }
            results.push(res);
          } else {
            results.push({ ...u });
          }
        }
        return results;
      },
    },

    trip: {
      async findUnique(args: any) {
        const found = testDb.trips.get(args.where.id);
        if (!found) return null;
        if (args.select) {
          const res: any = {};
          for (const [k, v] of Object.entries(args.select)) {
            if (v) res[k] = found[k];
          }
          return res;
        }
        if (args.include?.members) {
          const res: any = { ...found };
          const members: any[] = [];
          for (const tm of testDb.tripMembers.values()) {
            if (tm.tripId !== found.id) continue;
            const mRes: any = { ...tm };
            if (args.include.members.include?.user) {
              const u = testDb.users.get(tm.userId);
              mRes.user = u ? { ...u } : null;
            }
            members.push(mRes);
          }
          res.members = members;
          return res;
        }
        return { ...found };
      },
    },

    tripMember: {
      async create(args: any) {
        const id = args.data.id || createTestId();
        const doc = {
          id,
          tripId: args.data.tripId,
          userId: args.data.userId,
          role: args.data.role ?? "MEMBER",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        testDb.tripMembers.set(`${doc.tripId}_${doc.userId}`, doc);
        return { ...doc };
      },

      async findUnique(args: any) {
        const key = args.where?.tripId_userId;
        let found: any = null;
        if (key) {
          found = testDb.tripMembers.get(`${key.tripId}_${key.userId}`);
        } else if (args.where?.id) {
          found = [...testDb.tripMembers.values()].find((m) => m.id === args.where.id);
        }
        if (!found) return null;
        if (args.select) {
          const res: any = {};
          for (const [k, v] of Object.entries(args.select)) {
            if (v) res[k] = found[k];
          }
          return res;
        }
        const res: any = { ...found };
        if (args.include?.user) {
          const u = testDb.users.get(found.userId);
          res.user = u ? { ...u } : null;
        }
        return res;
      },
      async findMany(args: any) {
        const tripId = args?.where?.tripId;
        const userIds = args?.where?.userId?.in;
        const results: any[] = [];
        for (const tm of testDb.tripMembers.values()) {
          if (tripId && tm.tripId !== tripId) continue;
          if (userIds && !userIds.includes(tm.userId)) continue;
          if (args?.select) {
            const res: any = {};
            for (const [k, v] of Object.entries(args.select)) {
              if (v) res[k] = tm[k];
            }
            results.push(res);
          } else {
            const res: any = { ...tm };
            if (args?.include?.user) {
              const u = testDb.users.get(tm.userId);
              if (u && args.include.user.select) {
                const uRes: any = {};
                for (const [k, v] of Object.entries(args.include.user.select)) {
                  if (v) uRes[k] = (u as any)[k === "displayName" ? "name" : k] ?? (u as any)[k];
                }
                res.user = uRes;
              } else {
                res.user = u ? { ...u } : null;
              }
            }
            results.push(res);
          }
        }
        return results;
      },
    },

    expense: {
      async create(args: any) {
        const id = args.data.id || createTestId();
        const doc = {
          id,
          tripId: args.data.tripId,
          payerId: args.data.payerId,
          title: args.data.title,
          note: args.data.note ?? null,
          receiptUrl: args.data.receiptUrl ?? null,
          idempotencyKey: args.data.idempotencyKey ?? null,
          amountMinor: args.data.amountMinor,
          category: args.data.category,
          splitType: args.data.splitType,
          version: args.data.version ?? 1,
          isVoid: args.data.isVoid ?? false,
          voidReason: args.data.voidReason ?? undefined,
          voidedById: args.data.voidedById ?? undefined,
          voidedBy: args.data.voidedById ?? undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        testDb.expenses.set(id, doc);
        if (txLog) {
          txLog.created.push({ col: "expenses", id });
        }

        if (args.data.allocations?.createMany?.data) {
          for (const a of args.data.allocations.createMany.data) {
            const allocId = a.id || createTestId();
            const allocDoc = {
              id: allocId,
              expenseId: id,
              userId: a.userId,
              amountMinor: a.amountMinor,
              percentage: a.percentage ?? null,
              shares: a.shares ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            testDb.allocations.set(allocId, allocDoc);
            if (txLog) {
              txLog.created.push({ col: "allocations", id: allocId });
            }
          }
        }

        return { ...doc };
      },

      async findUnique(args: any) {
        let found: any = null;
        if (args.where?.id) {
          found = testDb.expenses.get(args.where.id);
        } else if (args.where?.tripId_idempotencyKey) {
          const { tripId, idempotencyKey } = args.where.tripId_idempotencyKey;
          found = [...testDb.expenses.values()].find(
            (e: any) => e.tripId === tripId && e.idempotencyKey === idempotencyKey && idempotencyKey != null
          );
        }
        if (!found) return null;
        const res: any = { ...found };

        if (args.include?.allocations) {
          const allocs: any[] = [];
          for (const a of testDb.allocations.values()) {
            if (a.expenseId === found.id) {
              const aDoc: any = { ...a };
              if (args.include.allocations.include?.user) {
                const u = testDb.users.get(a.userId);
                aDoc.user = u ? { id: u.id, name: u.name, email: u.email } : null;
              }
              allocs.push(aDoc);
            }
          }
          res.allocations = allocs;
        }

        if (args.include?.payer) {
          const p = testDb.users.get(found.payerId);
          res.payer = p ? { id: p.id, name: p.name, email: p.email } : null;
        }

        if (args.include?.voidedBy) {
          const vId = found.voidedById || found.voidedBy;
          const v = vId ? testDb.users.get(vId) : null;
          res.voidedBy = v ? { id: v.id, name: v.name, email: v.email } : null;
        }

        if (args.include?.auditLogs) {
          const logs: any[] = [];
          for (const l of testDb.auditLogs.values()) {
            if (l.expenseId === found.id) {
              const lDoc: any = { ...l };
              if (args.include.auditLogs.include?.changedBy) {
                const cId = l.changedById || l.changedBy;
                const c = cId ? testDb.users.get(cId) : null;
                lDoc.changedBy = c ? { id: c.id, name: c.name, email: c.email } : null;
              }
              logs.push(lDoc);
            }
          }
          if (args.include.auditLogs.orderBy?.timestamp === "asc") {
            logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
          }
          res.auditLogs = logs;
        }

        return res;
      },

      async findUniqueOrThrow(args: any) {
        const found = await this.findUnique(args);
        if (!found) throw new Error("Record not found");
        return found;
      },

      async findMany(args: any) {
        const where = args?.where || {};
        const results: any[] = [];

        for (const exp of testDb.expenses.values()) {
          let match = true;
          if (where.tripId && exp.tripId !== where.tripId) match = false;
          if (where.isVoid !== undefined && exp.isVoid !== where.isVoid) match = false;
          if (where.category?.equals) {
            if (exp.category.toLowerCase() !== where.category.equals.toLowerCase()) match = false;
          }
          if (match) {
            const expDoc: any = { ...exp };
            if (args?.include?.payer) {
              const p = testDb.users.get(exp.payerId);
              expDoc.payer = p ? { id: p.id, name: p.name, email: p.email } : null;
            }
            if (args?.include?.allocations) {
              const allocs: any[] = [];
              for (const a of testDb.allocations.values()) {
                if (a.expenseId === exp.id) allocs.push({ ...a });
              }
              expDoc.allocations = allocs;
            }
            results.push(expDoc);
          }
        }

        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        const skip = args?.skip || 0;
        const take = args?.take || results.length;
        return results.slice(skip, skip + take);
      },

      async count(args: any) {
        const where = args?.where || {};
        let cnt = 0;
        for (const exp of testDb.expenses.values()) {
          let match = true;
          if (where.tripId && exp.tripId !== where.tripId) match = false;
          if (where.isVoid !== undefined && exp.isVoid !== where.isVoid) match = false;
          if (where.category?.equals) {
            if (exp.category.toLowerCase() !== where.category.equals.toLowerCase()) match = false;
          }
          if (match) cnt++;
        }
        return cnt;
      },

      async updateMany(args: any) {
        const where = args.where;
        const data = args.data;
        const exp = testDb.expenses.get(where.id);
        if (!exp) return { count: 0 };

        if (where.version !== undefined && exp.version !== where.version) {
          return { count: 0 };
        }
        if (where.isVoid !== undefined && exp.isVoid !== where.isVoid) {
          return { count: 0 };
        }

        if (txLog) {
          txLog.updated.push({
            col: "expenses",
            id: where.id,
            prev: JSON.parse(JSON.stringify(exp)),
          });
        }

        // Apply data
        for (const [k, v] of Object.entries(data)) {
          if (k === "version" && typeof v === "object" && v !== null && (v as any).increment) {
            exp.version += (v as any).increment;
          } else {
            exp[k] = v;
          }
        }
        if (data.voidedById !== undefined) {
          exp.voidedBy = data.voidedById;
          exp.voidedById = data.voidedById;
        }
        exp.updatedAt = new Date();
        testDb.expenses.set(where.id, exp);
        return { count: 1 };
      },
    },

    expenseAllocation: {
      async createMany(args: any) {
        let count = 0;
        for (const d of args.data) {
          const id = d.id || createTestId();
          const doc = {
            id,
            expenseId: d.expenseId,
            userId: d.userId,
            amountMinor: d.amountMinor,
            percentage: d.percentage ?? null,
            shares: d.shares ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          testDb.allocations.set(id, doc);
          if (txLog) {
            txLog.created.push({ col: "allocations", id });
          }
          count++;
        }
        return { count };
      },

      async findMany(args: any) {
        const expenseId = args?.where?.expenseId;
        const results: any[] = [];
        for (const a of testDb.allocations.values()) {
          if (expenseId && a.expenseId !== expenseId) continue;
          results.push({ ...a });
        }
        return results;
      },

      async deleteMany(args: any) {
        const expenseId = args?.where?.expenseId;
        let count = 0;
        const toDelete: string[] = [];
        for (const [id, a] of testDb.allocations.entries()) {
          if (expenseId && a.expenseId === expenseId) {
            toDelete.push(id);
          }
        }
        for (const id of toDelete) {
          const doc = testDb.allocations.get(id);
          if (txLog && doc) {
            txLog.deleted.push({ col: "allocations", id, doc: { ...doc } });
          }
          testDb.allocations.delete(id);
          count++;
        }
        return { count };
      },
    },

    expenseAuditLog: {
      async create(args: any) {
        const id = args.data.id || createTestId();
        const prev = args.data.previousSnapshot;
        const prevSnap =
          prev === undefined ||
          prev === null ||
          prev === Prisma.JsonNull ||
          prev === Prisma.DbNull ||
          (prev as any)?.constructor?.name === "JsonNull" ||
          (prev as any)?.constructor?.name === "DbNull"
            ? null
            : prev;
        const doc = {
          id,
          expenseId: args.data.expenseId,
          action: args.data.action,
          changedById: args.data.changedById,
          changedBy: args.data.changedById,
          previousSnapshot: prevSnap,
          newSnapshot: args.data.newSnapshot ?? null,
          timestamp: new Date(),
        };
        testDb.auditLogs.set(id, doc);
        if (txLog) {
          txLog.created.push({ col: "auditLogs", id });
        }
        return { ...doc };
      },

      async findMany(args: any) {
        const expenseId = args?.where?.expenseId;
        const results: any[] = [];
        for (const l of testDb.auditLogs.values()) {
          if (expenseId && l.expenseId !== expenseId) continue;
          results.push({ ...l });
        }
        if (args?.orderBy?.timestamp === "asc") {
          results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        } else {
          results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        }
        return results;
      },
    },

    settlement: {
      async create(args: any) {
        const id = args.data.id || createTestId();
        const doc = {
          id,
          tripId: args.data.tripId,
          fromMemberId: args.data.fromMemberId,
          toMemberId: args.data.toMemberId,
          amountMinor: BigInt(args.data.amountMinor),
          status: args.data.status ?? "PENDING",
          paymentNote: args.data.paymentNote ?? null,
          createdBy: args.data.createdBy ?? null,
          createdAt: new Date(),
        };
        testDb.settlements.set(id, doc);
        return { ...doc };
      },
      async findUnique(args: any) {
        const found = testDb.settlements.get(args.where.id);
        if (!found) return null;
        const res: any = { ...found };
        if (args.include?.fromMember) {
          const fm = testDb.tripMembers.get(`${found.tripId}_${found.fromMemberId}`) ||
            [...testDb.tripMembers.values()].find((m) => m.id === found.fromMemberId);
          res.fromMember = fm ? { ...fm, user: testDb.users.get(fm.userId) ? { ...testDb.users.get(fm.userId) } : null } : null;
        }
        if (args.include?.toMember) {
          const tm = [...testDb.tripMembers.values()].find((m) => m.id === found.toMemberId);
          res.toMember = tm ? { ...tm, user: testDb.users.get(tm.userId) ? { ...testDb.users.get(tm.userId) } : null } : null;
        }
        if (args.include?.events) {
          res.events = [...testDb.settlementEvents.values()]
            .filter((e) => e.settlementId === found.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return res;
      },
      async findMany(args: any) {
        const where = args?.where || {};
        const results: any[] = [];
        for (const s of testDb.settlements.values()) {
          if (where.tripId && s.tripId !== where.tripId) continue;
          if (where.status && s.status !== where.status) continue;
          const res: any = { ...s };
          if (args?.include?.fromMember) {
            const fm = [...testDb.tripMembers.values()].find((m) => m.id === s.fromMemberId);
            res.fromMember = fm ? { ...fm, user: testDb.users.get(fm.userId) ? { ...testDb.users.get(fm.userId) } : null } : null;
          }
          if (args?.include?.toMember) {
            const tm = [...testDb.tripMembers.values()].find((m) => m.id === s.toMemberId);
            res.toMember = tm ? { ...tm, user: testDb.users.get(tm.userId) ? { ...testDb.users.get(tm.userId) } : null } : null;
          }
          if (args?.include?.events) {
            res.events = [...testDb.settlementEvents.values()].filter((e) => e.settlementId === s.id);
          }
          results.push(res);
        }
        if (args?.orderBy?.createdAt === "desc") {
          results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return results;
      },
      async update(args: any) {
        const found = testDb.settlements.get(args.where.id);
        if (!found) throw new Error("Settlement not found");
        Object.assign(found, args.data);
        testDb.settlements.set(found.id, found);
        return { ...found };
      },
    },

    settlementEvent: {
      async create(args: any) {
        const id = args.data.id || createTestId();
        const doc = {
          id,
          settlementId: args.data.settlementId,
          actorUserId: args.data.actorUserId ?? null,
          eventType: args.data.eventType,
          note: args.data.note ?? null,
          createdAt: new Date(),
        };
        testDb.settlementEvents.set(id, doc);
        return { ...doc };
      },
    },

    notification: {
      async create(args: any) {
        const id = args.data.id || createTestId();
        const doc = {
          id,
          userId: args.data.userId,
          activityEventId: args.data.activityEventId ?? null,
          title: args.data.title,
          message: args.data.message,
          readAt: args.data.readAt ?? null,
          deliveryStatus: args.data.deliveryStatus ?? "SENT",
          createdAt: new Date(),
        };
        testDb.notifications.set(id, doc);
        return { ...doc };
      },
      async createMany(args: any) {
        let count = 0;
        for (const d of args.data) {
          const id = d.id || createTestId();
          const doc = {
            id,
            userId: d.userId,
            activityEventId: d.activityEventId ?? null,
            title: d.title,
            message: d.message,
            readAt: d.readAt ?? null,
            deliveryStatus: d.deliveryStatus ?? "SENT",
            createdAt: new Date(),
          };
          testDb.notifications.set(id, doc);
          count++;
        }
        return { count };
      },
      async findMany(args: any) {
        const where = args?.where || {};
        let results = [...testDb.notifications.values()].filter((n) => {
          if (where.userId && n.userId !== where.userId) return false;
          if ("readAt" in where && where.readAt === null && n.readAt !== null) return false;
          return true;
        });
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (args?.take) results = results.slice(0, args.take);
        return results.map((n) => ({ ...n }));
      },
      async findUnique(args: any) {
        const found = testDb.notifications.get(args.where.id);
        return found ? { ...found } : null;
      },
      async count(args: any) {
        const where = args?.where || {};
        return [...testDb.notifications.values()].filter((n) => {
          if (where.userId && n.userId !== where.userId) return false;
          if ("readAt" in where && where.readAt === null && n.readAt !== null) return false;
          return true;
        }).length;
      },
      async update(args: any) {
        const found = testDb.notifications.get(args.where.id);
        if (!found) throw new Error("Notification not found");
        Object.assign(found, args.data);
        testDb.notifications.set(found.id, found);
        return { ...found };
      },
      async updateMany(args: any) {
        const where = args?.where || {};
        let count = 0;
        for (const n of testDb.notifications.values()) {
          if (where.userId && n.userId !== where.userId) continue;
          if ("readAt" in where && where.readAt === null && n.readAt !== null) continue;
          Object.assign(n, args.data);
          count++;
        }
        return { count };
      },
    },

    async $transaction(fnOrArray: any) {
      if (typeof fnOrArray === "function") {
        const deltaLog: TransactionDeltaLog = {
          created: [],
          updated: [],
          deleted: [],
        };
        try {
          const tx = createMockPrismaOperations(deltaLog);
          return await fnOrArray(tx);
        } catch (err) {
          // Revert created docs
          for (const c of deltaLog.created) {
            if (c.col === "expenses") testDb.expenses.delete(c.id);
            else if (c.col === "allocations") testDb.allocations.delete(c.id);
            else if (c.col === "auditLogs") testDb.auditLogs.delete(c.id);
          }
          // Revert updated docs
          for (const u of deltaLog.updated) {
            if (u.col === "expenses") testDb.expenses.set(u.id, u.prev);
          }
          // Restore deleted docs
          for (const d of deltaLog.deleted) {
            if (d.col === "allocations") testDb.allocations.set(d.id, d.doc);
          }
          throw err;
        }
      }
      return Promise.all(fnOrArray);
    },
  };
}

export function setupTestDb() {
  testDb.clear();
  const mockPrisma = createMockPrismaOperations() as PrismaClient;
  setPrismaClient(mockPrisma);
}

export function teardownTestDb() {
  testDb.clear();
}
