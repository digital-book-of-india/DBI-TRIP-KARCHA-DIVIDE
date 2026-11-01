// BUG FIX: this used to construct its own separate `new PrismaClient()`
// singleton, independent from the one in `./db.ts`. Every ledger/settlement/
// notification/report module imported *this* client while expense routes and
// the test harness (`setPrismaClient` in `tests/testDb.ts`) only ever swapped
// the client in `./db.ts`. That meant: (1) two live connection pools against
// the same database in production, and (2) the Developer 3 ledger/settlement/
// notification modules were impossible to unit test, since mocking the
// Prisma client had no effect on them at all. Re-exporting the single
// `./db.ts` client fixes both.
export { prisma, prisma as default } from "./db";
