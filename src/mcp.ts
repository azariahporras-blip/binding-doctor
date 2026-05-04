#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  extractDeclared,
  loadWranglerConfig,
  projectName,
  resolveProjectDir,
  scanReferences,
} from "./parser.js";
import { ctxFromEnv, listAll } from "./cf.js";
import { buildDiff, formatDiff } from "./diff.js";
import { buildPlan, executePlan, writeBack } from "./apply.js";
import { applyMigrations } from "./migrations.js";
import type { LiveResource } from "./types.js";

const server = new Server(
  { name: "binding-doctor", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "bdr_diff",
    description:
      "Show three-way diff of Cloudflare bindings: declared in wrangler config vs referenced in code vs live on the account. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Path to Worker project (default cwd)" },
      },
    },
  },
  {
    name: "bdr_plan",
    description:
      "Preview what bdr_apply would do: list of resources to create or link. Read-only.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string" } },
    },
  },
  {
    name: "bdr_apply",
    description:
      "Reconcile bindings: create missing D1/R2/KV/Queue/Vectorize, write IDs back to wrangler config, run pending D1 migrations. Idempotent. Mutates account state.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string" } },
    },
  },
  {
    name: "bdr_migrate",
    description: "Apply pending migrations/*.sql to all declared D1 databases.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string" } },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as { projectDir?: string };
  const projectDir = resolveProjectDir(args.projectDir);

  try {
    if (name === "bdr_diff") {
      const cfg = loadWranglerConfig(projectDir);
      const declared = extractDeclared(cfg);
      const referenced = scanReferences(projectDir);
      const ctx = ctxFromEnv();
      const live = await listAll(ctx);
      const rows = buildDiff(declared, referenced, live);
      return { content: [{ type: "text", text: formatDiff(rows) }] };
    }
    if (name === "bdr_plan") {
      const cfg = loadWranglerConfig(projectDir);
      const declared = extractDeclared(cfg);
      const referenced = scanReferences(projectDir);
      const ctx = ctxFromEnv();
      const live = await listAll(ctx);
      const rows = buildDiff(declared, referenced, live);
      const { plan, warnings } = buildPlan(rows, projectName(cfg));
      const text =
        formatDiff(rows) +
        "\n\n" +
        (warnings.length ? "Warnings:\n" + warnings.map((w) => "  ! " + w).join("\n") + "\n\n" : "") +
        (plan.length
          ? "Plan:\n" +
            plan
              .map((p) => `  ${p.action.padEnd(6)} ${p.kind.padEnd(10)} ${p.binding} → ${p.name}`)
              .join("\n")
          : "Plan: nothing to do.");
      return { content: [{ type: "text", text }] };
    }
    if (name === "bdr_apply") {
      const cfg = loadWranglerConfig(projectDir);
      const declared = extractDeclared(cfg);
      const referenced = scanReferences(projectDir);
      const ctx = ctxFromEnv();
      const live = await listAll(ctx);
      const rows = buildDiff(declared, referenced, live);
      const { plan, warnings } = buildPlan(rows, projectName(cfg));
      const log: string[] = [formatDiff(rows), ""];
      for (const w of warnings) log.push("  ! " + w);
      if (!plan.length) {
        log.push("Nothing to apply.");
        return { content: [{ type: "text", text: log.join("\n") }] };
      }
      log.push("Plan:");
      for (const p of plan) log.push(`  ${p.action.padEnd(6)} ${p.kind.padEnd(10)} ${p.binding} → ${p.name}`);

      const created: LiveResource[] = [];
      const origLog = console.log;
      console.log = (...a: unknown[]) => log.push(a.join(" "));
      try {
        const c = await executePlan(ctx, plan, live);
        created.push(...c);
      } finally {
        console.log = origLog;
      }

      const resolved = plan
        .map((p) => {
          const r = created.find((c) => c.kind === p.kind && c.name === p.name);
          return r ? { binding: p.binding, resource: r } : null;
        })
        .filter((x): x is { binding: string; resource: LiveResource } => !!x);

      writeBack(cfg, resolved);
      log.push(`Wrote ${resolved.length} bindings to ${cfg.path} (backup: ${cfg.path}.bak)`);

      const d1s = resolved.filter((r) => r.resource.kind === "d1");
      for (const { binding, resource } of d1s) {
        const r = await applyMigrations(ctx, resource.id, projectDir);
        if (r.applied.length || r.skipped.length) {
          log.push(`Migrations [${binding} ← ${resource.name}]:`);
          for (const a of r.applied) log.push(`  applied  ${a}`);
          for (const s of r.skipped) log.push(`  skipped  ${s}`);
        }
      }
      return { content: [{ type: "text", text: log.join("\n") }] };
    }
    if (name === "bdr_migrate") {
      const cfg = loadWranglerConfig(projectDir);
      const declared = extractDeclared(cfg);
      const ctx = ctxFromEnv();
      const d1s = declared.filter((d) => d.kind === "d1" && d.id);
      const log: string[] = [];
      for (const d of d1s) {
        const r = await applyMigrations(ctx, d.id!, projectDir);
        log.push(`[${d.binding} ← ${d.name}]`);
        for (const a of r.applied) log.push(`  applied  ${a}`);
        for (const s of r.skipped) log.push(`  skipped  ${s}`);
        if (!r.applied.length && !r.skipped.length) log.push("  (no migrations/)");
      }
      return { content: [{ type: "text", text: log.join("\n") || "No D1 with IDs declared." }] };
    }
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
