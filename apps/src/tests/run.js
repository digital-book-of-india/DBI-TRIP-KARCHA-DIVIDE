/* eslint-disable @typescript-eslint/no-require-imports */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/test_dbi_trip?schema=public";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-only-jwt-secret";
process.env.TRIP_KHARCHA_INTEGRATION_SECRET = "unit-test-only-trip-integration-secret-32-bytes";

const path = require("path");
const { createJiti } = require("jiti");

const jiti = createJiti(__dirname);

const testFiles = [
  "./currency.test.ts",
  "./equalSplit.test.ts",
  "./exactSplit.test.ts",
  "./percentageSplit.test.ts",
  "./integrity.test.ts",
  "./models.test.ts",
  "./authMiddleware.test.ts",
  "./expenseCreation.test.ts",
  "./expenseFeed.test.ts",
  "./expenseDetail.test.ts",
  "./expenseApiRoutes.test.ts",
  "./expenseEdit.test.ts",
  "./concurrentEdit.test.ts",
  "./softVoid.test.ts",
  "./phase3Rollback.test.ts",
  "./balanceEngine.test.ts",
  "./balanceService.test.ts",
  "./expenseNotifications.test.ts",
  "./expenseFieldsAndIdempotency.test.ts",
  "./reportCsv.test.ts",
];

for (const file of testFiles) {
  jiti(path.resolve(__dirname, file));
}
