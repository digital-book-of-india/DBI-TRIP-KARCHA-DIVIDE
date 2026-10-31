/* eslint-disable @typescript-eslint/no-require-imports */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/test_dbi_trip?schema=public";
process.env.NODE_ENV = "test";

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
  "./expenseCreation.test.ts",
  "./expenseFeed.test.ts",
  "./expenseDetail.test.ts",
  "./expenseApiRoutes.test.ts",
  "./expenseEdit.test.ts",
  "./concurrentEdit.test.ts",
  "./softVoid.test.ts",
  "./phase3Rollback.test.ts",
];

for (const file of testFiles) {
  jiti(path.resolve(__dirname, file));
}
