import { writeFileSync, copyFileSync } from "node:fs";
import TOML from "@iarna/toml";
import * as JSONC from "jsonc-parser";
import type { DiffRow, LiveResource, ResourceKind, WranglerConfig } from "./types.js";
import {
  CfCtx,
  createD1,
  createKV,
  createQueue,
  createR2,
  createVectorize,
} from "./cf.js";

export function inferKind(binding: string): ResourceKind | null {
  const b = binding.toUpperCase();
  if (/(^|_)(DB|D1)(_|$)/.test(b)) return "d1";
  if (/(^|_)(BUCKET|R2|STORAGE)(_|$)/.test(b)) return "r2";
  if (/(^|_)(KV|CACHE|SESSIONS?|STATE)(_|$)/.test(b)) return "kv";
  if (/(^|_)(QUEUE|JOBS?|EVENTS?)(_|$)/.test(b)) return "queue";
  if (/(^|_)(VEC|VECTORIZE|INDEX|EMBEDDINGS?)(_|$)/.test(b)) return "vectorize";
  return null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function proposeName(projectName: string, binding: string, kind: ResourceKind): string {
  return `${slug(projectName)}-${slug(binding)}-${suffix()}`;
}

export interface PlanItem {
  binding: string;
  kind: ResourceKind;
  action: "create" | "link";
  name: string;
  reason: string;
}

export function buildPlan(
  rows: DiffRow[],
  projectName: string
): { plan: PlanItem[]; warnings: string[] } {
  const plan: PlanItem[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    if (row.status === "ok" || row.status === "unreferenced") continue;

    let kind: ResourceKind | null = (row.kind === "unknown" ? null : row.kind);
    if (!kind) kind = inferKind(row.binding);
    if (!kind) {
      warnings.push(
        `${row.binding}: could not infer kind. Add a hint suffix (e.g. ${row.binding}_DB / _BUCKET / _KV / _QUEUE / _VEC).`
      );
      continue;
    }

    if (row.status === "missing-live" || row.status === "missing-id" || row.status === "missing-declared") {
      const name = row.declared?.name ?? proposeName(projectName, row.binding, kind);
      plan.push({
        binding: row.binding,
        kind,
        action: row.live ? "link" : "create",
        name: row.live?.name ?? name,
        reason: row.status,
      });
    }
  }

  return { plan, warnings };
}

export async function executePlan(
  ctx: CfCtx,
  plan: PlanItem[],
  existingLive: LiveResource[]
): Promise<LiveResource[]> {
  const created: LiveResource[] = [];
  for (const item of plan) {
    if (item.action === "link") {
      const match = existingLive.find((l) => l.kind === item.kind && l.name === item.name);
      if (match) {
        created.push(match);
        console.log(`  link  ${item.kind.padEnd(10)} ${item.binding} → ${match.id}`);
      }
      continue;
    }
    let res: LiveResource;
    try {
      switch (item.kind) {
        case "d1": res = await createD1(ctx, item.name); break;
        case "r2": res = await createR2(ctx, item.name); break;
        case "kv": res = await createKV(ctx, item.name); break;
        case "queue": res = await createQueue(ctx, item.name); break;
        case "vectorize": res = await createVectorize(ctx, item.name); break;
      }
    } catch (e: any) {
      console.log(`  fail   ${item.kind.padEnd(9)} ${item.binding}: ${e.message}`);
      continue;
    }
    created.push(res);
    console.log(`  create ${item.kind.padEnd(9)} ${item.binding} → ${res.name} (${res.id})`);
  }
  return created;
}

export function writeBack(
  cfg: WranglerConfig,
  resolved: { binding: string; resource: LiveResource }[]
): void {
  copyFileSync(cfg.path, cfg.path + ".bak");

  if (cfg.format === "toml") {
    const parsed: any = cfg.parsed ?? {};
    const upsert = (
      arr: any[] | undefined,
      key: string,
      match: (x: any) => boolean,
      build: () => any
    ) => {
      const list = arr ?? [];
      const idx = list.findIndex(match);
      if (idx >= 0) list[idx] = { ...list[idx], ...build() };
      else list.push(build());
      parsed[key] = list;
    };

    for (const { binding, resource } of resolved) {
      switch (resource.kind) {
        case "d1":
          upsert(parsed.d1_databases, "d1_databases", (x) => x.binding === binding, () => ({
            binding, database_name: resource.name, database_id: resource.id,
          }));
          break;
        case "r2":
          upsert(parsed.r2_buckets, "r2_buckets", (x) => x.binding === binding, () => ({
            binding, bucket_name: resource.name,
          }));
          break;
        case "kv":
          upsert(parsed.kv_namespaces, "kv_namespaces", (x) => x.binding === binding, () => ({
            binding, id: resource.id,
          }));
          break;
        case "queue": {
          const producers = parsed.queues?.producers ?? [];
          const idx = producers.findIndex((q: any) => q.binding === binding);
          const entry = { binding, queue: resource.name };
          if (idx >= 0) producers[idx] = entry;
          else producers.push(entry);
          parsed.queues = { ...(parsed.queues ?? {}), producers };
          break;
        }
        case "vectorize":
          upsert(parsed.vectorize, "vectorize", (x) => x.binding === binding, () => ({
            binding, index_name: resource.name,
          }));
          break;
      }
    }

    writeFileSync(cfg.path, TOML.stringify(parsed));
    return;
  }

  let raw = cfg.raw;
  for (const { binding, resource } of resolved) {
    const sectionPath: (string | number)[] = (() => {
      switch (resource.kind) {
        case "d1": return ["d1_databases"];
        case "r2": return ["r2_buckets"];
        case "kv": return ["kv_namespaces"];
        case "queue": return ["queues", "producers"];
        case "vectorize": return ["vectorize"];
      }
    })();

    const tree = JSONC.parseTree(raw);
    if (!tree) continue;
    const arr: any[] = JSONC.parse(raw, [], { allowTrailingComma: true });
    const cursor = sectionPath.reduce((a: any, k) => (a ? a[k as any] : undefined), arr);
    const list: any[] = Array.isArray(cursor) ? cursor : [];
    const idx = list.findIndex((x) => x.binding === binding);
    const entry = (() => {
      switch (resource.kind) {
        case "d1": return { binding, database_name: resource.name, database_id: resource.id };
        case "r2": return { binding, bucket_name: resource.name };
        case "kv": return { binding, id: resource.id };
        case "queue": return { binding, queue: resource.name };
        case "vectorize": return { binding, index_name: resource.name };
      }
    })();

    const editPath = idx >= 0 ? [...sectionPath, idx] : [...sectionPath, -1];
    const edits = JSONC.modify(raw, editPath as any, entry, {
      isArrayInsertion: idx < 0,
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    raw = JSONC.applyEdits(raw, edits);
  }
  writeFileSync(cfg.path, raw);
}
