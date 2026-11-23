# adversarial-agent-review

A small, copy-pasteable quality gate for code written by AI agents. Two independent parts, no
framework, nothing tied to any particular stack or vendor:

1. **Goldfish** — a fresh-reviewer review skill for the **plan**. The agent that wrote a plan does
   not approve it; fresh subagents (no conversation history) review it, one per lens.
2. **An independent judge** — a PASS/FAIL gate on the **code**. A model that did not write the code
   reviews it for security and correctness.

The thread tying them together: **whoever produced the work does not get to approve it.** That is
the whole idea. Everything here is a reference you copy into your own setup — fork it, adapt it,
own your copy. Issues are for discussion, not a support contract; it's provided as-is.

## The pipeline this fits into

A build with coding agents goes wrong when one agent plans, builds, and grades its own work in one
unbroken context — the blind spots that made the plan survive every later step. Splitting the work
into stages, with an **independent check between the risky ones**, catches more:

```
  planner  →  goldfish  →  builder  →  judge  →  fixer
  (plan)      (review       (write     (review   (fix the
              the PLAN,      the code)  the CODE, real findings,
              fresh                     fresh     then re-judge)
              reviewers)                model)
```

- **planner** — turns the request into a short plan/PRD written to a file.
- **goldfish** — fresh subagents review that plan, one per *lens* (see below), and report blind
  spots before a line of code is written. Reviews the **plan**.
- **builder** — implements the accepted plan.
- **judge** — an independent model (not the builder) returns PASS/FAIL on the **code**.
- **fixer** — on FAIL, fixes the real findings (or refutes a false one with a reason) and re-judges.

You don't need an orchestrator to use this. The two pieces stand alone: run goldfish before a big
build, run the judge in CI. Wire them into a pipeline only if you already have one.

### What a "lens" is

A lens is one way a plan can be wrong — one reviewer's single job. Giving each fresh subagent one
lens (comprehension, architecture, scope/YAGNI, contradictions, implementation-readiness) keeps each
review sharp and independent, instead of one reviewer trying to hold everything at once. The lenses
and their rubric are in [`skills/goldfish/SKILL.md`](skills/goldfish/SKILL.md).

## The judge

`judge.mjs` sends your source files to an independent model and prints a PASS/FAIL verdict with
findings (security, correctness, data-loss). No framework, one file, Node 18+ (uses built-in
`fetch`). Provider-agnostic: any OpenAI-compatible Chat Completions API.

```bash
cp .env.example .env     # fill in OPENAI_API_KEY (and OPENAI_BASE_URL / JUDGE_MODEL if not OpenAI)
node judge.mjs ./sample/vulnerable    # FAIL — SQL injection + hardcoded secret
node judge.mjs ./sample/clean         # PASS
node judge.mjs ./path/to/your/code    # judge your own change
```

- Input is a **local directory** — point it at a checkout or a changed subtree. No GitHub token,
  no network except the model API.
- File selection is by source extension, not by a stack-specific path. If it finds **no** source
  files it exits with an error — never a silent PASS.
- Exit code: `0` PASS, `1` FAIL, `2` operational error (missing key, no files, API error) — so CI
  fails the build on FAIL.

### Use it as a CI gate

```yaml
# .github/workflows/judge.yml (sketch)
- run: node judge.mjs .
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Cost note: the judge sends your source up to a size cap in one call. For a large repo, point it at
the changed files/subtree, not the whole tree, to keep the bill (and the signal) tight.

## Goldfish skill

See [`skills/goldfish/SKILL.md`](skills/goldfish/SKILL.md). It's a Claude Code skill: put the
`goldfish` folder under `~/.claude/skills/` (user-wide) or `.claude/skills/` (one project), then
invoke it when you want a plan reviewed. It **requires a harness that can spawn subagents** — fresh
reviewers are the point; reviewing in the same context is not a goldfish review.

## Files

```
judge.mjs                  the independent code judge
skills/goldfish/SKILL.md   the fresh-reviewer skill (lenses + rubric)
sample/vulnerable/         a tiny repo the judge should FAIL
sample/clean/              a tiny repo the judge should PASS
.env.example               env vars the judge reads
```

## License & credit

Apache-2.0 — see [`LICENSE`](LICENSE). The goldfish fresh-reviewer idea is adapted from Google's
Elephant-Goldfish Model; attribution is in [`NOTICE`](NOTICE).
