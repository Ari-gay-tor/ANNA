import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __annaPrisma?: PrismaClient };

/** One client per process, reused across Next dev hot reloads. DATABASE_URL comes from the environment. */
export function getPrisma(): PrismaClient {
  globalForPrisma.__annaPrisma ??= new PrismaClient();
  return globalForPrisma.__annaPrisma;
}

/** Separate client for an explicit URL (tests). Not cached. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
