import type { Memory as DbMemory, PrismaClient } from "@prisma/client";
import { MEMORY_ORIGINS, MEMORY_SOURCE_KINDS, MEMORY_TYPES, type Memory } from "../core/domain/memory";
import type { MemoryPatch, MemoryRepository, NewMemory } from "../core/ports";

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(private readonly db: PrismaClient) {}

  async list(): Promise<Memory[]> {
    const rows = await this.db.memory.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return rows.map(toMemory);
  }

  async get(id: string): Promise<Memory | null> {
    const row = await this.db.memory.findUnique({ where: { id } });
    return row && toMemory(row);
  }

  async create(input: NewMemory): Promise<Memory> {
    return toMemory(await this.db.memory.create({ data: input }));
  }

  async update(id: string, patch: MemoryPatch): Promise<Memory> {
    return toMemory(await this.db.memory.update({ where: { id }, data: patch }));
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.db.memory.deleteMany({ where: { id } });
    return count > 0;
  }
}

/** Enum-like columns are plain strings; an unreadable value is a corrupt row, so fail loudly rather than guess. */
function toMemory(row: DbMemory): Memory {
  const type = MEMORY_TYPES.find((t) => t === row.type);
  const origin = MEMORY_ORIGINS.find((o) => o === row.origin);
  if (!type || !origin) throw new Error(`Memory ${row.id} has an unknown type or origin.`);
  // null (a row from before Slice 9) means chat; a value this version does not know is treated the same way.
  const sourceKind = MEMORY_SOURCE_KINDS.find((k) => k === row.sourceKind) ?? null;
  return { ...row, type, origin, sourceKind };
}
