import type { PrismaClient } from "@prisma/client";
import type { SettingsRepository } from "../core/ports";

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  async delete(key: string): Promise<void> {
    await this.db.setting.deleteMany({ where: { key } });
  }
}
