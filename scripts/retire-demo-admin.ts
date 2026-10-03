import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
async function main() {
  await db.$transaction(async (tx) => {
    const admin = await tx.user.findUnique({ where: { email: "admin.coinsecret@gmail.com" }, select: { id: true, role: true, emailVerified: true } });
    if (admin?.role !== "ADMIN" || !admin.emailVerified) throw new Error("The primary verified admin must exist before removing the demo admin.");
    const old = await tx.user.findUnique({ where: { email: "admin@coinsecret.local" }, select: { id: true, _count: { select: { payments: true, sessions: true } } } });
    console.log(JSON.stringify({ primaryAdmin: "admin.coinsecret@gmail.com", verified: true, demoAdminExists: !!old, demoSessions: old?._count.sessions ?? 0 }));
    if (!old || !process.argv.includes("--apply")) return;
    if (old._count.payments) throw new Error("Demo admin has payment history; deletion requires preserving that history first.");
    await tx.auditLog.create({ data: { actorId: admin.id, action: "admin.demo.retire", entityType: "User", entityId: old.id, metadata: { email: "admin@coinsecret.local" } } });
    await tx.user.delete({ where: { id: old.id } });
    console.log("Demo admin removed, including its sessions and credential accounts.");
  }, { isolationLevel: "Serializable" });
}
main().finally(() => db.$disconnect());
