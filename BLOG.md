# Wrangler ships your code. Something needs to wire your stack.

*A weekend project, an open question for Cloudflare.*

---

Claude Code can build a Cloudflare Worker in thirty seconds.

Wiring it up takes thirty minutes.

I want to talk about that gap. Where it comes from, why Agents Week 2026 didn't quite close it, and a small open-source tool I built — `binding-doctor` — that takes a stab at the missing piece.

## The setup

I'm a physics PhD turned data scientist. I love building things and I love Cloudflare. The agent-driven workflow Cloudflare has been pushing — Workers + Agents SDK + the API MCP server + the Skills plugin — feels like the right shape of the future. So I sat down this weekend with Claude Code and tried to build a small chat app on Workers using nothing but prompts.

The code came out clean. A `fetch` handler, a Durable Object, a few `env.X` references for D1, KV, R2, a queue. Three minutes.

Then came the part the agent couldn't do.

```
> wrangler deploy
✘ [ERROR] Database "CHAT_DB" missing database_id in wrangler.toml.
```

So I asked Claude. Claude told me to run `npx wrangler d1 create chat-db`, copy the UUID, paste it in. Then KV. Then R2. Then a queue. Then `wrangler secret put`. Each step a context switch. Each ID hand-carried from terminal to file. Twenty-five more minutes of plumbing.

The agent could *write the program*. It could not *finish the program*.

## What Cloudflare already shipped

Cloudflare Agents Week 2026 was a serious push at this whole problem space. Quick recap, because it's important — I'm not pitching against it, I'm pitching into one of the gaps it left:

- **Cloudflare API MCP** — agents can hit any of 2500+ endpoints via two tools, `search` and `execute`.
- **Skills plugin** — `wrangler` skill for command knowledge, `/cloudflare:build-agent` and `/cloudflare:build-mcp` slash-commands for scaffolding.
- **Stripe + Projects protocol** — agents can autonomously create a Cloudflare account, register a domain, get an API token, and deploy. No human needed at the *account* layer.
- **Project Think** — durable, actor-based primitives so agents *persist* across runs instead of being one-shot.
- **Durable Object Facets, Outbound Workers** — better isolation primitives.
- **Enterprise MCP + Code Mode** — observability, gateway, WAF wrapped around agent traffic at scale.

It's a remarkable amount of stuff in one week. Most of the friction I named — *account creation*, *payment*, *token issuance* — is solved.

But not the friction I hit.

## The shape of the remaining gap

There are three sources of truth in any Cloudflare Worker project:

1. The **code** — `env.CHAT_DB`, `env.UPLOADS_BUCKET`. *What the program needs.*
2. The **wrangler config** — `[[d1_databases]] binding = "CHAT_DB" database_id = "…"`. *What we've declared.*
3. The **account** — actual D1 databases, R2 buckets, KV namespaces, queues. *What's real.*

These three drift constantly. Code references something that isn't declared. Config declares something that doesn't exist. The account holds something nothing references. The agent can read all three. But nothing reconciles them.

Wrangler is the *build tool*. The 2500-endpoint API MCP is the *primitive layer*. The Skills plugin is the *recipe book*. There's no *reconciler* — no `git status` for bindings, no `kubectl apply` for a Worker project.

So the agent's loop is:

> write code → run wrangler → read error → call MCP to look up resource → call MCP to create resource → ask the human to paste the ID → wait → wait → wait

The wait is the failure. Every wait is the agent-flow leaking out into a human-flow.

## Binding Doctor

I wrote `binding-doctor` (`bdr`) over a weekend. It's tiny — six TypeScript files, ~600 lines — and it does exactly one thing:

```
$ bdr diff
BINDING         KIND     DECL  REF  LIVE  STATUS
--------------  -------  ----  ---  ----  ----------------
CHAT_DB         unknown  —     yes  —     missing-declared
SESSIONS_KV     unknown  —     yes  —     missing-declared
UPLOADS_BUCKET  unknown  —     yes  —     missing-declared
```

Three-way diff. Code says you need these. Config doesn't declare them. Account doesn't have them.

```
$ bdr apply --yes
  create d1   CHAT_DB        → my-app-chat-db-8i6x   (9c48b532-…)
  create kv   SESSIONS_KV    → my-app-sessions-kv-3h0f
  create r2   UPLOADS_BUCKET → my-app-uploads-bucket-s000

Wrote 3 bindings to wrangler.toml.
Migrations [CHAT_DB]: applied 0001_init.sql
```

90-second cast: [asciinema.org/a/dYDfRnAlD7Cdzsth](https://asciinema.org/a/dYDfRnAlD7Cdzsth).

It's idempotent. Re-run, zero diff. Delete the KV namespace from the dashboard, re-run, drift detected, drift healed. Same as Terraform — but for a Worker project, in one command, with no state file, because the wrangler config *is* the state file.

There's also an MCP server (`bdr-mcp`) that exposes `bdr_diff`, `bdr_plan`, `bdr_apply`, `bdr_migrate` as tools. Plug it into Claude Code, and now the agent's loop becomes:

> write code → call bdr_apply → ship

No human in the middle.

## Why it's small on purpose

`bdr` isn't a platform. It's not Pulumi. It's not a competitor to anything. It's the missing line between two existing primitives:

- the API MCP (which lets you create D1 databases imperatively)
- Wrangler (which deploys whatever's already declared)

The line in between — *figure out what's missing and fix it* — was the manual step. I closed it with a regex (`env\.([A-Z_]+)`), a TOML parser, a few `fetch` calls, and an inference table that maps `_DB → d1`, `_BUCKET → r2`, `_KV → kv`, `_QUEUE → queue`, `_INDEX → vectorize`.

That's the whole product.

## What I think Cloudflare should consider

This kind of thing should be in `wrangler` itself. Maybe `wrangler doctor`. Maybe a flag on `wrangler deploy` — `--auto-bind` — that does the same thing on the way to deploy. The MCP variant should ship as part of the Skills plugin.

Three reasons it belongs in the platform:

1. **It eliminates the most common agent-to-human handoff.** Every other agentic flow Cloudflare shipped this year converges on this same friction point.
2. **The data is all there.** `wrangler.toml` is structured. The API has list endpoints. The code is parseable. There's nothing exotic.
3. **It's a lever for adoption.** The story "Cloudflare is the only cloud where an agent ships an app without asking you for an ID" is a story.

## What's next

`bdr` is on GitHub: github.com/diogodebastos/binding-doctor. MIT-licensed. The 90-second demo is in the repo. PRs welcome — vectorize is functional but the dimensions/metric should come from a code annotation, queues should auto-wire consumers when a `queue` handler is found, secrets need a `.env.doctor` template path. All weekend-2 work.

I'd love to build the next version of this inside Cloudflare. The agent-first pitch I keep hearing in the keynotes is the pitch I want to ship. If anyone reading this knows the right person — DevRel, Workers, Agents — I'm at diogodebastos18@gmail.com.

---

*Thanks for reading. The repo: [github.com/diogodebastos/binding-doctor](https://github.com/diogodebastos/binding-doctor). The 90-second demo: [asciinema.org/a/dYDfRnAlD7Cdzsth](https://asciinema.org/a/dYDfRnAlD7Cdzsth).*
