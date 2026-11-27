import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/mysql-migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.MYSQL_DATABASE_URL ?? env("DATABASE_URL"),
  },
});
