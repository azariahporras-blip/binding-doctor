#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { extractDeclared, loadWranglerConfig, projectName, resolveProjectDir, scanReferences } from "./parser.js";
import { ctxFromEnv, listAll } from "./cf.js";
import { buildDiff, formatDiff } from "./diff.js";
import { buildPlan, executePlan, writeBack } from "./apply.js";
import { applyMigrations } from "./migrations.js";
import type { LiveResource } from "./types.js";

const program = new Command();
program.name("bdr").description("Binding Doctor — reconcile Cloudflare bindings").version("0.1.0");

program
  .command("diff")
  .argument("[dir]", "project dir", ".")
  .description("show declared/referenced/live binding diff")
  .action(async (dir: string) => {
    const projectDir = resolveProjectDir(dir);
    const cfg = loadWranglerConfig(projectDir);
    const declared = extractDeclared(cfg);
    const referenced = scanReferences(projectDir);
    const ctx = ctxFromEnv();
    const live = await listAll(ctx);
    const rows = buildDiff(declared, referenced, live);
    console.log(formatDiff(rows));
  });

program
  .command("plan")
  .argument("[dir]", "project dir", ".")
  .description("preview actions without executing")
  .action(async (dir: string) => {
    const projectDir = resolveProjectDir(dir);
    const cfg = loadWranglerConfig(projectDir);
    const declared = extractDeclared(cfg);
    const referenced = scanReferences(projectDir);
    const ctx = ctxFromEnv();
    const live = await listAll(ctx);
    const rows = buildDiff(declared, referenced, live);
    const { plan, warnings } = buildPlan(rows, projectName(cfg));
    console.log(formatDiff(rows));
    console.log();
    if (warnings.length) {
      console.log("Warnings:");
      for (const w of warnings) console.log("  ! " + w);
      console.log();
    }
    if (!plan.length) console.log("Plan: nothing to do.");
    else {
      console.log("Plan:");
      for (const p of plan) console.log(`  ${p.action.padEnd(6)} ${p.kind.padEnd(10)} ${p.binding} → ${p.name}`);
    }
  });

program
  .command("apply")
  .argument("[dir]", "project dir", ".")
  .option("--yes", "skip confirmation", false)
  .description("create missing resources and write IDs back to wrangler config")
  .action(async (dir: string, opts: { yes: boolean }) => {
    const projectDir = resolveProjectDir(dir);
    const cfg = loadWranglerConfig(projectDir);
    const declared = extractDeclared(cfg);
    const referenced = scanReferences(projectDir);
    const ctx = ctxFromEnv();
    const live = await listAll(ctx);
    const rows = buildDiff(declared, referenced, live);
    const { plan, warnings } = buildPlan(rows, projectName(cfg));

    console.log(formatDiff(rows));
    console.log();
    for (const w of warnings) console.log("  ! " + w);
    if (!plan.length) {
      console.log("Nothing to apply.");
      return;
    }
    console.log("Plan:");
    for (const p of plan) console.log(`  ${p.action.padEnd(6)} ${p.kind.padEnd(10)} ${p.binding} → ${p.name}`);

    if (!opts.yes) {
      console.log("\nRe-run with --yes to execute.");
      return;
    }

    console.log("\nExecuting:");
    const created = await executePlan(ctx, plan, live);

    const resolved: { binding: string; resource: LiveResource }[] = plan
      .map((p) => {
        const r = created.find((c) => c.kind === p.kind && c.name === p.name);
        return r ? { binding: p.binding, resource: r } : null;
      })
      .filter((x): x is { binding: string; resource: LiveResource } => !!x);

    writeBack(cfg, resolved);
    console.log(`\nWrote ${resolved.length} bindings to ${cfg.path} (backup: ${cfg.path}.bak)`);

    const d1s = resolved.filter((r) => r.resource.kind === "d1");
    for (const { binding, resource } of d1s) {
      const r = await applyMigrations(ctx, resource.id, projectDir);
      if (r.applied.length || r.skipped.length) {
        console.log(`\nMigrations [${binding} ← ${resource.name}]:`);
        for (const a of r.applied) console.log(`  applied  ${a}`);
        for (const s of r.skipped) console.log(`  skipped  ${s}`);
      }
    }
  });

program
  .command("migrate")
  .argument("[dir]", "project dir", ".")
  .description("apply migrations/*.sql to all declared D1 databases")
  .action(async (dir: string) => {
    const projectDir = resolveProjectDir(dir);
    const cfg = loadWranglerConfig(projectDir);
    const declared = extractDeclared(cfg);
    const ctx = ctxFromEnv();
    const d1s = declared.filter((d) => d.kind === "d1" && d.id);
    if (!d1s.length) {
      console.log("No D1 databases with IDs declared.");
      return;
    }
    for (const d of d1s) {
      const r = await applyMigrations(ctx, d.id!, projectDir);
      console.log(`[${d.binding} ← ${d.name}]`);
      for (const a of r.applied) console.log(`  applied  ${a}`);
      for (const s of r.skipped) console.log(`  skipped  ${s}`);
      if (!r.applied.length && !r.skipped.length) console.log("  (no migrations/)");
    }
  });

program.parseAsync().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
