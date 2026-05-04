#!/usr/bin/env node
import "dotenv/config";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCT) { console.error("Need CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }

const PREFIXES = ["bdr-fixture-", "bdr-demo-"];
const matches = (name) => PREFIXES.some((p) => name?.startsWith(p));

const API = "https://api.cloudflare.com/client/v4";
async function req(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    const errs = body?.errors?.map((e) => `${e.code} ${e.message}`).join("; ") || res.statusText;
    throw new Error(`${res.status} ${path}: ${errs}`);
  }
  return body.result;
}

const apply = process.argv.includes("--apply");

async function run() {
  const deletes = [];

  // D1
  try {
    const d1s = await req(`/accounts/${ACCT}/d1/database?per_page=1000`);
    for (const d of d1s) if (matches(d.name)) deletes.push({ kind: "d1", name: d.name, id: d.uuid, path: `/accounts/${ACCT}/d1/database/${d.uuid}` });
  } catch (e) { console.error("d1 list:", e.message); }

  // R2
  try {
    const r = await req(`/accounts/${ACCT}/r2/buckets`);
    const list = r.buckets || r;
    for (const b of list) if (matches(b.name)) deletes.push({ kind: "r2", name: b.name, id: b.name, path: `/accounts/${ACCT}/r2/buckets/${b.name}` });
  } catch (e) { console.error("r2 list:", e.message); }

  // KV
  try {
    const ns = await req(`/accounts/${ACCT}/storage/kv/namespaces?per_page=100`);
    for (const k of ns) if (matches(k.title)) deletes.push({ kind: "kv", name: k.title, id: k.id, path: `/accounts/${ACCT}/storage/kv/namespaces/${k.id}` });
  } catch (e) { console.error("kv list:", e.message); }

  // Queues
  try {
    const qs = await req(`/accounts/${ACCT}/queues`);
    for (const q of qs) if (matches(q.queue_name)) deletes.push({ kind: "queue", name: q.queue_name, id: q.queue_id, path: `/accounts/${ACCT}/queues/${q.queue_id}` });
  } catch (e) { console.error("queue list:", e.message); }

  // Vectorize
  try {
    const vs = await req(`/accounts/${ACCT}/vectorize/v2/indexes`);
    for (const v of vs) if (matches(v.name)) deletes.push({ kind: "vectorize", name: v.name, id: v.name, path: `/accounts/${ACCT}/vectorize/v2/indexes/${v.name}` });
  } catch (e) { /* may lack scope */ }

  if (!deletes.length) { console.log("Nothing to clean up."); return; }

  console.log(`Found ${deletes.length} resource${deletes.length === 1 ? "" : "s"} matching prefixes:\n`);
  for (const d of deletes) console.log(`  ${d.kind.padEnd(10)} ${d.name}`);

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to delete.`);
    return;
  }

  console.log(`\nDeleting:`);
  for (const d of deletes) {
    try {
      await req(d.path, { method: "DELETE" });
      console.log(`  ok    ${d.kind.padEnd(10)} ${d.name}`);
    } catch (e) {
      console.log(`  fail  ${d.kind.padEnd(10)} ${d.name}: ${e.message}`);
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
