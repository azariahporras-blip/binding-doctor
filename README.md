# Binding Doctor

> Wrangler ships your code. Doctor wires your stack.

`bdr` is a CLI **and** an MCP server that reconciles Cloudflare bindings between your code, your `wrangler.toml`, and your account. It lets an AI agent (Claude Code, Codex, etc.) take a Worker from `env.CHAT_DB` to a deployed app **without ever asking you to copy a database ID**.

```
$ bdr diff
BINDING         KIND     DECL  REF  LIVE  STATUS
--------------  -------  ----  ---  ----  ----------------
CHAT_DB         unknown  —     yes  —     missing-declared
SESSIONS_KV     unknown  —     yes  —     missing-declared
UPLOADS_BUCKET  unknown  —     yes  —     missing-declared

$ bdr apply --yes
  create d1   CHAT_DB        → my-app-chat-db-8i6x   (9c48b532-…)
  create kv   SESSIONS_KV    → my-app-sessions-kv-3h0f (0230f531…)
  create r2   UPLOADS_BUCKET → my-app-uploads-bucket-s000

Wrote 3 bindings to wrangler.toml.
Migrations [CHAT_DB]: applied 0001_init.sql
```

Re-run = no-op. Delete a resource in the dashboard? `bdr apply` heals it.

---

## What it does

1. **Parses** `wrangler.toml` / `wrangler.jsonc` for declared bindings (`d1_databases`, `r2_buckets`, `kv_namespaces`, `queues`, `vectorize`).
2. **Scans** `src/**/*.{ts,tsx,js,mjs}` for `env.X` references.
3. **Lists** live resources in your Cloudflare account.
4. **Diffs** the three sources of truth.
5. **Applies** the diff: creates missing resources, writes IDs back to your wrangler config (with `.bak`), runs pending `migrations/*.sql` against new D1 dbs.

Idempotent. One command. No manual ID copying.

## Install

```sh
git clone https://github.com/diogodebastos/binding-doctor
cd binding-doctor
npm install
npm run build
npm link    # exposes `bdr` and `bdr-mcp` globally
```

Set credentials (token needs `D1:Edit`, `R2:Edit`, `Workers KV Storage:Edit`, `Queues:Edit`, `Vectorize:Edit`):

```sh
echo "CLOUDFLARE_API_TOKEN=…" >> .env
echo "CLOUDFLARE_ACCOUNT_ID=…" >> .env
```

## CLI

```sh
bdr diff [dir]      # show diff
bdr plan [dir]      # preview actions
bdr apply [dir] --yes
bdr migrate [dir]   # run pending D1 migrations only
```

## MCP

Wire into Claude Code (`.claude/mcp.json` or settings):

```json
{
  "mcpServers": {
    "binding-doctor": {
      "command": "bdr-mcp",
      "env": {
        "CLOUDFLARE_API_TOKEN": "…",
        "CLOUDFLARE_ACCOUNT_ID": "…"
      }
    }
  }
}
```

Tools exposed: `bdr_diff`, `bdr_plan`, `bdr_apply`, `bdr_migrate`.

Now Claude can write code referencing `env.NEW_THING`, call `bdr_apply`, and ship — zero human ID copying.

## Binding kind inference

When code references a binding not declared anywhere, kind is inferred from suffix:

| Suffix matches | Kind |
| --- | --- |
| `_DB`, `_D1`, `DB` | D1 |
| `_BUCKET`, `_R2`, `_STORAGE` | R2 |
| `_KV`, `_CACHE`, `_SESSIONS`, `_STATE` | KV |
| `_QUEUE`, `_JOBS`, `_EVENTS` | Queue |
| `_VEC`, `_VECTORIZE`, `_INDEX`, `_EMBEDDINGS` | Vectorize |

Unknown kinds emit a warning instead of silently picking wrong.

## Demo

```sh
bash demo/run.sh
```

## Why this exists

Cloudflare's Agents Week 2026 shipped most of the agentic stack: API MCP, Skills plugin, Stripe-funded auto-provisioning, Project Think. But when an agent generates a Worker that references `env.CHAT_DB`, the human still copy-pastes a D1 UUID. There is no `git status` for bindings; no reconciler.

Wrangler is the build tool. `bdr` is the reconciler. It treats your code as the desired state and your account as the actual state, and closes the gap idempotently.

## License

MIT.
