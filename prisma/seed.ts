import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Plan, type UserRole } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL wajib untuk seed.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

interface SeedUser { email: string; name: string; password: string; role: UserRole; plan: Plan }

async function upsertUser(input: SeedUser) {
  const password = await hashPassword(input.password);
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: { email: input.email, name: input.name, emailVerified: true, role: input.role, plan: input.plan },
    update: { name: input.name, emailVerified: true, role: input.role, plan: input.plan },
  });
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: "credential", accountId: user.id } },
    create: { providerId: "credential", accountId: user.id, userId: user.id, password },
    update: { password },
  });
  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, provider: "seed", plan: input.plan, status: input.plan === "PREMIUM" ? "ACTIVE" : "INACTIVE" },
    update: { provider: "seed", plan: input.plan, status: input.plan === "PREMIUM" ? "ACTIVE" : "INACTIVE" },
  });
}

async function main() {
  const sharedPassword = process.env.SEED_USER_PASSWORD ?? "CoinSecret123!";
  await upsertUser({ email: "free@coinsecret.local", name: "Free User", password: sharedPassword, role: "USER", plan: "FREE" });
  await upsertUser({ email: "premium@coinsecret.local", name: "Premium User", password: sharedPassword, role: "USER", plan: "PREMIUM" });
  await upsertUser({ email: "admin@coinsecret.local", name: "Coin Secret Admin", password: process.env.SEED_ADMIN_PASSWORD ?? sharedPassword, role: "ADMIN", plan: "PREMIUM" });
  await prisma.featureGate.createMany({
    data: [
      { feature: "scannerExtended", free: false, premium: true },
      { feature: "signals", free: false, premium: true },
    ],
    skipDuplicates: true,
  });
}

main().finally(() => prisma.$disconnect());
