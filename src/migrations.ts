import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CfCtx } from "./cf.js";
import { d1Query } from "./cf.js";

const TABLE = "_bdr_migrations";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function applyMigrations(
  ctx: CfCtx,
  dbId: string,
  projectDir: string
): Promise<MigrationResult> {
  const dir = join(projectDir, "migrations");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { applied: [], skipped: [] };
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await d1Query(
    ctx,
    dbId,
    `CREATE TABLE IF NOT EXISTS ${TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );

  const existing = await d1Query(ctx, dbId, `SELECT name FROM ${TABLE}`);
  const done = new Set<string>(
    (existing?.[0]?.results ?? []).map((r: any) => r.name)
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (done.has(f)) {
      skipped.push(f);
      continue;
    }
    const sql = readFileSync(join(dir, f), "utf8");
    await d1Query(ctx, dbId, sql);
    await d1Query(
      ctx,
      dbId,
      `INSERT INTO ${TABLE}(name, applied_at) VALUES (?, ?)`,
      [f, new Date().toISOString()]
    );
    applied.push(f);
  }
  return { applied, skipped };
}
