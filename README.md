# Binding Doctor

[![npm version](https://img.shields.io/npm/v/binding-doctor.svg)](https://www.npmjs.com/package/binding-doctor)
[![npm downloads](https://img.shields.io/npm/dm/binding-doctor.svg)](https://www.npmjs.com/package/binding-doctor)
[![license](https://img.shields.io/npm/l/binding-doctor.svg)](./LICENSE)

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

### Zero-install (recommended)

```sh
npx -p binding-doctor bdr diff
```

`bdr` and `bdr-mcp` both resolve via `npx` from the npm registry.

### Global install

```sh
npm install -g binding-doctor
bdr diff
```

### Credentials

Create an API token at <https://dash.cloudflare.com/profile/api-tokens> with these scopes:
**D1:Edit · R2:Edit · Workers KV Storage:Edit · Queues:Edit · Vectorize:Edit · Account Settings:Read**.

Drop into `.env` in your Worker project:

```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

## CLI

```sh
bdr diff [dir]            # three-way binding diff
bdr plan [dir]            # preview actions
bdr apply [dir] --yes     # create + writeback + run migrations
bdr migrate [dir]         # run pending D1 migrations only
```

## MCP — wire into Claude Code

Add to `.claude/mcp.json` (or your client's MCP config):

```jsonc
{
  "mcpServers": {
    "binding-doctor": {
      "command": "npx",
      "args": ["-y", "-p", "binding-doctor", "bdr-mcp"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "...",
        "CLOUDFLARE_ACCOUNT_ID": "..."
      }
    }
  }
}
```

Or, if globally installed:

```jsonc
{
  "mcpServers": {
    "binding-doctor": {
      "command": "bdr-mcp",
      "env": {
        "CLOUDFLARE_API_TOKEN": "...",
        "CLOUDFLARE_ACCOUNT_ID": "..."
      }
    }
  }
}
```

Tools exposed: `bdr_diff`, `bdr_plan`, `bdr_apply`, `bdr_migrate`.

The agent's loop becomes: **write code → bdr_apply → ship**. Zero human ID copying.

### Why local, not remote

The MCP runs on your machine because it reads your local `wrangler.toml` and scans your source tree — your code is the desired state. A hosted Worker can't see your filesystem. (See `BLOG.md` for the design rationale.)

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
