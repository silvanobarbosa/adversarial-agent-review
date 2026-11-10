# adversarial-agent-review

A small, copy-pasteable harness for keeping coding agents honest. It gives you an **independent
second opinion** on what an agent produces — because the model that wrote something is the worst
judge of whether it's any good.

Two parts, usable separately:

**A. Adversarial review (the core)**
- **`skills/goldfish/`** — a Claude Code skill for *fresh-reviewer* review: the agent that wrote a
  plan is **not** the agent that approves it. You spawn fresh subagents (no conversation history),
  one per *lens*, to catch the author's blind spots, before any code is written.
- **`judges/factory-judge.mjs`** — the **security/correctness judge**: a model that did **not** write
  the code reads a repo and returns a `PASS`/`FAIL` gate (broken authz/BOLA, IDOR, injection,
  hardcoded secrets, PII exposure, missing headers, …).

**B. Design quality (optional)**
- **`judges/design-judge.mjs`** — a **vision judge** that screenshots a live URL and scores whether
  the UI has its own identity or looks like a generic AI template. `PASS`/`FAIL`.
- **`design/gen-design-system.mjs`** — a deterministic CSS-token generator (same name → same theme)
  so generated apps don't all look the same.

> Provided as-is, under Apache-2.0. Issues welcome; no support SLA.

---

## The vocabulary (defined once)

- **Goldfish** — the reviewer agents. Named after Google's *Elephant-Goldfish Model*: the "elephant"
  has long memory and wrote the plan; the "goldfish" has no memory of how the plan came to be, so it
  can't be anchored by it. This repo re-implements the **concept**, not EGM's code (see `NOTICE`).
- **Lens** — one reviewer with one job: *comprehension*, *design critic*, *zoom-out/YAGNI*,
  *contradictions*, *implementation readiness*. Each runs as its own fresh, read-only subagent. See
  `skills/goldfish/SKILL.md` for the exact prompts.
- **Heilmeier Catechism** — George Heilmeier's questions for judging a proposal (objectives, state of
  the art, what's new, impact, risks, cost, timeline, success metric). The goldfish review enforces
  it on PRDs.
- **Judge** — a script that asks an *independent* model (not the authoring one) for a `PASS`/`FAIL`
  verdict. Independence is the whole point.

## Where it fits in a pipeline

```
planner → goldfish → builder → reviewer → fixer
          (reviews        (security + design
           the PLAN)        judges on the RESULT)
```

Goldfish reviews the **plan** before code exists; the judges gate the **result** before it ships.
You can adopt any one piece on its own.

---

## Judges: the PASS/FAIL contract

Both judges:
- read config from `process.env`, falling back to a local `.env` (copy `.env.example`). `process.env` wins.
- print a JSON verdict to **stdout**, logs to **stderr**.
- **exit code**: `0` = PASS · `1` = FAIL · `2` = operational error (no API key, repo unreadable,
  Playwright missing, …). Use the exit code as the CI gate.

### Security/correctness judge

```bash
cp .env.example .env            # fill GITHUB_TOKEN + OPENROUTER_API_KEY (or GROQ_API_KEY)
node judges/factory-judge.mjs <owner/repo> [ref]
```

It reads a repo's security-relevant files (API routes, middleware, lib, schema, server actions,
config) via the GitHub API and asks an independent model to find bugs + vulnerabilities. **FAIL** on
any `critical`/`high` finding. Default judge model: `z-ai/glm-4.6` (override with
`OPENROUTER_JUDGE_MODEL`). An empty/unreadable repo exits `2`; no key exits `2`.

> It targets a conventional Next.js / Drizzle layout by default (the file allowlist in the script).
> Edit the `KEEP` regex for a different stack.

### Design judge

```bash
npm i playwright && npx playwright install chromium
node judges/design-judge.mjs https://your-app.example.com [/path]
```

Screenshots the URL and scores it with a vision model (default `openai/gpt-4o`, override with
`OPENROUTER_VISION_MODEL`). **FAIL** if the average score < 6 or it reads as a generic template. If
Playwright or its browser isn't installed, it exits `2` with a hint.

### Design-system generator

```bash
node design/gen-design-system.mjs "My App" [brandHex] [mood]
# mood: bold | calm | warm | tech | editorial
```

Prints a `:root` CSS token block to stdout and the raw tokens (JSON) to stderr. Deterministic: the
same app name always yields the same theme; different names yield distinct ones. No API key, no network.

---

## The goldfish skill

Drop `skills/goldfish/` into your Claude Code skills directory (e.g. `~/.claude/skills/goldfish/`).
Trigger it with "goldfish review" / "stress-test this plan" / before a large build. It is prompt +
process only — no code to run, nothing to install, no network. Read `skills/goldfish/SKILL.md`; it is
the whole thing.

A review needs **subagents**. Reviewing a plan in the same context that wrote it doesn't catch the
blind spot — that's the point of "fresh".

## Credits

The fresh-reviewer idea is derived from Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
(Apache-2.0). See `NOTICE`. Everything here is an independent re-implementation of that concept.
