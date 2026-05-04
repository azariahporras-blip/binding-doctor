import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import TOML from "@iarna/toml";
import * as JSONC from "jsonc-parser";
import type { DeclaredBinding, ReferencedBinding, WranglerConfig } from "./types.js";

export function loadWranglerConfig(projectDir: string): WranglerConfig {
  const tomlPath = join(projectDir, "wrangler.toml");
  const jsoncPath = join(projectDir, "wrangler.jsonc");
  const jsonPath = join(projectDir, "wrangler.json");

  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, "utf8");
    return { path: tomlPath, format: "toml", raw, parsed: TOML.parse(raw) };
  }
  for (const p of [jsoncPath, jsonPath]) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      return { path: p, format: "jsonc", raw, parsed: JSONC.parse(raw) };
    }
  }
  throw new Error(`No wrangler.{toml,jsonc,json} in ${projectDir}`);
}

export function extractDeclared(cfg: WranglerConfig): DeclaredBinding[] {
  const p = cfg.parsed ?? {};
  const out: DeclaredBinding[] = [];

  for (const d of p.d1_databases ?? []) {
    out.push({ kind: "d1", binding: d.binding, name: d.database_name, id: d.database_id });
  }
  for (const r of p.r2_buckets ?? []) {
    out.push({ kind: "r2", binding: r.binding, name: r.bucket_name });
  }
  for (const k of p.kv_namespaces ?? []) {
    out.push({ kind: "kv", binding: k.binding, id: k.id });
  }
  const queueProducers = p.queues?.producers ?? [];
  for (const q of queueProducers) {
    out.push({ kind: "queue", binding: q.binding, name: q.queue });
  }
  for (const v of p.vectorize ?? []) {
    out.push({ kind: "vectorize", binding: v.binding, name: v.index_name });
  }
  return out;
}

const ENV_REF = /env\.([A-Z][A-Z0-9_]*)/g;

export function scanReferences(projectDir: string): ReferencedBinding[] {
  const map = new Map<string, Set<string>>();
  const roots = ["src"]
    .map((d) => join(projectDir, d))
    .filter((p) => existsSync(p) && statSync(p).isDirectory());

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
        const txt = readFileSync(full, "utf8");
        let m: RegExpExecArray | null;
        ENV_REF.lastIndex = 0;
        while ((m = ENV_REF.exec(txt))) {
          const name = m[1];
          if (!map.has(name)) map.set(name, new Set());
          map.get(name)!.add(full);
        }
      }
    }
  };
  for (const r of roots) walk(r);

  return [...map.entries()].map(([binding, files]) => ({
    binding,
    files: [...files],
  }));
}

export function projectName(cfg: WranglerConfig): string {
  return cfg.parsed?.name ?? "worker";
}

export function resolveProjectDir(input?: string): string {
  return resolve(input ?? process.cwd());
}
