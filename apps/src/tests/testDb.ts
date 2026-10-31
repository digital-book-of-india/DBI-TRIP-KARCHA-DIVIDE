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

  clear() {
    this.users.clear();
    this.trips.clear();
    this.tripMembers.clear();
    this.expenses.clear();
    this.allocations.clear();
    this.auditLogs.clear();
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

  addTrip(trip: { _id?: string; id?: string; title: string; createdBy?: string; createdById?: string; currency?: string }) {
    const id = trip.id || trip._id || createTestId();
    const createdById = trip.createdById || trip.createdBy || "";
    const doc = {
      id,
      title: trip.title,
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
        return found ? { ...found } : null;
      },
    },

    tripMember: {
      async findUnique(args: any) {
        const key = args.where?.tripId_userId;
        if (key) {
          const found = testDb.tripMembers.get(`${key.tripId}_${key.userId}`);
          if (!found) return null;
          if (args.select) {
            const res: any = {};
            for (const [k, v] of Object.entries(args.select)) {
              if (v) res[k] = found[k];
            }
            return res;
          }
          return { ...found };
        }
        return null;
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
            results.push({ ...tm });
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
        const found = testDb.expenses.get(args.where.id);
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
