# Launch Kit

Three artifacts: X thread, cold email, GitHub discussion post. Edit `<links>` before sending.

---

## X / Twitter thread (8 posts)

**1/**
Claude Code can build a Cloudflare Worker in 30 seconds.

Wiring it up takes 30 minutes.

I spent the weekend trying to close that gap. Here's what came out → 🧵

**2/**
Every Worker has 3 sources of truth:

• your code (`env.CHAT_DB`)
• your wrangler.toml (declared bindings)
• your Cloudflare account (live D1, R2, KV, Queues, Vectorize)

These drift constantly. Nothing reconciles them. The agent has to ask you for IDs.

**3/**
Cloudflare's Agents Week 2026 was massive. API MCP, Skills, Stripe-funded auto-provisioning, Project Think.

Account creation, payments, tokens — solved.

But when an agent writes `env.CHAT_DB`, you still copy-paste a UUID. There's no reconciler.

**4/**
So I built one. `binding-doctor`:

```
$ bdr diff
CHAT_DB         missing-declared
SESSIONS_KV     missing-declared
UPLOADS_BUCKET  missing-declared
```

```
$ bdr apply --yes
  create d1   CHAT_DB → my-app-chat-db-8i6x
  create kv   SESSIONS_KV → ...
  create r2   UPLOADS_BUCKET → ...
Wrote 3 bindings to wrangler.toml.
Migrations [CHAT_DB]: applied 0001_init.sql
```

**5/**
It's idempotent. Re-run = no-op.

Delete a resource in the dashboard? `bdr apply` heals the drift.

It's `git status` and `kubectl apply`, but for a Worker project. No state file — `wrangler.toml` *is* the state.

**6/**
Also ships as an MCP server.

Plug `bdr-mcp` into Claude Code → the agent's loop becomes:

  write code → call bdr_apply → ship

Zero human in the middle. Zero ID copying.

90s demo: https://asciinema.org/a/dYDfRnAlD7Cdzsth

**7/**
This belongs in `wrangler` itself. Maybe `wrangler doctor`. Maybe `wrangler deploy --auto-bind`.

It eliminates the most common agent-to-human handoff in the entire Cloudflare stack. The data is all there — config + code + API.

**8/**
Repo: github.com/diogodebastos/binding-doctor
Blog: <blog link>

I'd love to build the next version of this inside Cloudflare. If you're at @Cloudflare or know someone there — DM open. 🙌

cc @CloudflareDev @rita3ko @threepointone @ashleygwilliams

---

## Cold email / DM

**Subject:** A weekend project for Cloudflare's agentic stack — `binding-doctor`

Hi <name>,

I'm Diogo de Bastos — physics PhD, data scientist, building on Cloudflare. I spent this weekend on a small open-source tool that closes one specific gap in the agentic developer flow your team shipped at Agents Week 2026, and I'd love your eyes on it.

**The gap.** When Claude Code (or any agent) writes a Worker referencing `env.CHAT_DB`, the human still has to run `wrangler d1 create`, copy the UUID, paste it into `wrangler.toml`. Wrangler is the build tool, the API MCP is the primitive layer, the Skills plugin is the recipe book — but nothing reconciles code + config + account state. There's no `git status` for bindings.

**What I built.** `binding-doctor` (`bdr`) — a CLI and an MCP server that does a three-way diff (declared / referenced / live) and applies it idempotently. Empty Worker → one command → resources created, IDs written back, D1 migrations applied, ready to deploy. Delete a resource out-of-band, re-run, drift healed.

- 90s demo: https://asciinema.org/a/dYDfRnAlD7Cdzsth
- Repo: https://github.com/diogodebastos/binding-doctor
- Blog post (1100 words): <blog link>

**Why I'm sending this.** I think this kind of thing — `wrangler doctor`, or a flag on `wrangler deploy` — belongs in the platform itself. It's the most common agent-to-human handoff in the whole stack, and Cloudflare has all the primitives to eliminate it. The story "Cloudflare is the only cloud where an agent ships an app without asking a human for an ID" is a real story.

I'd love to build the next version of this inside Cloudflare. Happy to chat about DevRel, DX engineering, or whichever team owns the agent surface. If there's a better person to talk to, even better — would appreciate the intro.

Thanks for reading.

Diogo
diogodebastos18@gmail.com
github.com/diogodebastos

---

## GitHub discussion post (cloudflare/agents)

**Title:** Reconciler for code/wrangler/account drift — would Cloudflare take a contribution like this?

Hi all — first time posting here.

I've been building Workers with Claude Code and ran into the same friction repeatedly: the agent writes `env.CHAT_DB`, but I still have to manually create the D1, copy the UUID, paste it into `wrangler.toml`. The 2500-endpoint API MCP plus the Skills plugin gets very close to closing this loop, but the *reconciliation* step — figure out what's missing across code/config/account and fix it idempotently — is still manual.

I prototyped a small tool over the weekend: [binding-doctor](https://github.com/diogodebastos/binding-doctor). It's ~600 lines of TS, ships as a CLI (`bdr`) and an MCP server (`bdr-mcp`), and does:

```
declared (wrangler.toml) vs referenced (env.X in code) vs live (CF API)
→ idempotent apply: create missing D1/R2/KV/Queue/Vectorize, write IDs back, run pending migrations
```

Demo: https://asciinema.org/a/dYDfRnAlD7Cdzsth. It also detects + heals drift when a resource is deleted out-of-band.

A few questions for the team / community:

1. Is there appetite for something like this landing in `wrangler` itself (e.g. `wrangler doctor`, or a `--auto-bind` flag on `wrangler deploy`)?
2. The MCP variant feels like it belongs in the Skills plugin alongside the existing `wrangler` skill — would a contribution there be welcome?
3. The kind-inference (`_DB → d1`, `_BUCKET → r2`, etc.) is currently heuristic. Has the team thought about a canonical annotation in code (e.g. a JSDoc tag) so this becomes deterministic?

Happy to open PRs against either repo if there's interest. And if there's a different/better way the team is already thinking about this problem, I'd love to learn.

— Diogo
