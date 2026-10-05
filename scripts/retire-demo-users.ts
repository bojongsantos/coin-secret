import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const targets = ["free@coinsecret.local", "premium@coinsecret.local", "free@chartsense.local"];
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL required.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  await db.$transaction(async (tx) => {
    const admin = await tx.user.findUnique({ where: { email: "admin.coinsecret@gmail.com" }, select: { id: true, role: true, emailVerified: true } });
    if (admin?.role !== "ADMIN" || !admin.emailVerified) throw new Error("Verified primary admin required.");
    const users = await tx.user.findMany({ where: { email: { in: targets } }, select: { id: true, email: true, role: true, payments: { where: { status: "SETTLED" }, select: { id: true } } } });
    if (users.some(user => user.role !== "USER" || user.payments.length > 0)) throw new Error("Unexpected privileged or paid demo account; manual review required.");
    console.log(JSON.stringify({ databaseHost: new URL(connectionString!).hostname, mode: process.argv.includes("--apply") ? "apply" : "dry-run", users: users.map(user => user.email), preservesPaymentHistory: true }));
    if (!process.argv.includes("--apply")) return;
    for (const user of users) {
      const now = new Date();
      await tx.account.updateMany({ where: { userId: user.id }, data: { password: null, accessToken: null, refreshToken: null, idToken: null } });
      await tx.session.updateMany({ where: { userId: user.id }, data: { expiresAt: now } });
      await tx.user.update({ where: { id: user.id }, data: { emailVerified: false, plan: "FREE" } });
      await tx.subscription.updateMany({ where: { userId: user.id }, data: { plan: "FREE", status: "CANCELED", currentPeriodEnd: now } });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "admin.demo.deactivate", entityType: "User", entityId: user.id, metadata: { email: user.email, preservesPaymentHistory: true } } });
    }
    console.log("Demo access deactivated; account and payment history retained.");
  }, { isolationLevel: "Serializable" });
}
main().finally(() => db.$disconnect());
