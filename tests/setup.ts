import { beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  // HARD SAFETY CHECK
  if (!dbUrl.includes("_test")) {
    throw new Error(`CRITICAL: Test suite attempted to run against production database! DATABASE_URL must end with '_test' (e.g. prospectpilot_test). Current: ${dbUrl}`);
  }

  // Safe to reset test DB if needed, but for now we just verify the URL
});

afterAll(async () => {
  await prisma.$disconnect();
});
