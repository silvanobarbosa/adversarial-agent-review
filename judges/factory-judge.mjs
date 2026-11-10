#!/usr/bin/env node
/**
 * Adversarial security/correctness judge — an independent PASS/FAIL gate.
 *
 * The model that JUDGES must not be the model that WROTE the code. This script reads a
 * repo's security-relevant files via the GitHub API and asks an independent, OpenAI-compatible
 * model to find bugs + vulnerabilities (broken authz/BOLA, IDOR, injection, hardcoded secrets,
 * PII exposure, broken auth, open CORS, missing security headers, insecure upload/SSRF).
 *
 * Usage:  node judges/factory-judge.mjs <owner/repo> [ref]
 * Env (from process.env or a local .env file in the current directory):
 *   GITHUB_TOKEN          - to read the repo (a read-only token is enough; public repos may work unauthenticated but will hit low rate limits)
 *   OPENROUTER_API_KEY    - judge via OpenRouter (any OpenAI-compatible endpoint), or
 *   GROQ_API_KEY          - judge via Groq as a fallback
 *   OPENROUTER_JUDGE_MODEL / OPENROUTER_MODEL - override the judge model (default: z-ai/glm-4.6)
 * Exit: 0 = PASS · 1 = FAIL (blocks deploy) · 2 = operational error.
 */
import fs from "node:fs";
import path from "node:path";

// Load a local .env (current working directory) as a convenience; process.env wins.
const env = {};
try {
  for (const l of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}
const E = (k) => process.env[k] || env[k];
const GHT = E("GITHUB_TOKEN");
const log = (...a) => console.error(...a);

const repo = process.argv[2];
const ref = process.argv[3] || "main";
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { log("usage: factory-judge.mjs <owner/repo> [ref]"); process.exit(2); }

// INDEPENDENT (non-authoring) model: OpenRouter → Groq.
function judgeProvider() {
  if (E("OPENROUTER_API_KEY")) return { url: "https://openrouter.ai/api/v1/chat/completions", key: E("OPENROUTER_API_KEY"), model: E("OPENROUTER_JUDGE_MODEL") || E("OPENROUTER_MODEL") || "z-ai/glm-4.6" };
  if (E("GROQ_API_KEY")) return { url: "https://api.groq.com/openai/v1/chat/completions", key: E("GROQ_API_KEY"), model: "llama-3.3-70b-versatile" };
  return null;
}

const ghHeaders = { Accept: "application/vnd.github+json", "User-Agent": "adversarial-agent-review" };
if (GHT) ghHeaders.Authorization = `Bearer ${GHT}`;
const gh = (p) => fetch(`https://api.github.com${p}`, { headers: ghHeaders });

// 1) Pull the files that matter for security/correctness (API routes, middleware, lib, schema, actions, config).
const KEEP = /^(src\/app\/api\/.*route\.(ts|js)|src\/middleware\.(ts|js)|src\/lib\/.*\.(ts|js)|src\/db\/schema\.(ts|js)|src\/app\/.*\/actions\.(ts|js)|next\.config\.(ts|js|mjs)|drizzle\.config\.ts)$/;
log(`[judge] reading ${repo}@${ref}…`);
const tree = await gh(`/repos/${repo}/git/trees/${ref}?recursive=1`).then((r) => r.json()).catch(() => ({}));
if (!tree.tree) { log("!! could not read repo tree:", JSON.stringify(tree).slice(0, 150)); process.exit(2); }
const files = tree.tree.filter((n) => n.type === "blob" && KEEP.test(n.path)).slice(0, 60);

// Per-file cap. A small cap produces false FAILs: every larger file arrives cut mid-function and the
// judge accuses "incomplete code" — an alarm that, repeated, trains people to ignore the whole gate.
const MAX_PER_FILE = 24_000;
let corpus = "";
for (const f of files) {
  if (corpus.length > 90_000) break;
  const c = await gh(`/repos/${repo}/contents/${encodeURIComponent(f.path)}?ref=${ref}`).then((r) => r.json()).catch(() => null);
  if (!c?.content) continue;
  const text = Buffer.from(c.content, "base64").toString("utf8");
  const cut = text.length > MAX_PER_FILE;
  // When we cut, the corpus SAYS it was cut, so the judge doesn't mistake the chunk's end for the file's end.
  corpus += `\n\n===== ${f.path} =====\n` + text.slice(0, MAX_PER_FILE) +
    (cut ? `\n[...file truncated here by the reader, at ${MAX_PER_FILE} chars of ${text.length}...]` : "");
}
if (!corpus) { log("!! no key files to judge (empty app?). PASS by emptiness."); console.log(JSON.stringify({ verdict: "PASS", findings: [], summary: "no key code" })); process.exit(0); }

// 2) Call the judge.
const prov = judgeProvider();
if (!prov) { log("!! no AI provider (set OPENROUTER_API_KEY or GROQ_API_KEY). Cannot judge."); process.exit(2); }
log(`[judge] judging with ${prov.model}…`);
const sys = "You are an ADVERSARIAL QA and security reviewer, INDEPENDENT of whoever wrote the code. This is a deploy GATE — be rigorous and skeptical. Analyze the app and find: (a) correctness bugs; (b) VULNS: broken authorization/BOLA (an API handler not checking session/object ownership), IDOR, injection (SQL/NoSQL/command), hardcoded secret, PII exposed in a response/log, broken auth, open CORS, missing security headers, insecure upload/SSRF. Respond with ONLY valid JSON: {\"verdict\":\"PASS\"|\"FAIL\",\"findings\":[{\"severity\":\"critical\"|\"high\"|\"medium\"|\"low\",\"title\":\"...\",\"file\":\"...\",\"why\":\"...\"}],\"summary\":\"...\"}. Rule: FAIL if there is ANY critical or high finding. Don't invent — only what the code shows. IMPORTANT: some files arrive TRUNCATED (a marker says so at the end). NEVER report \"incomplete code\", \"truncated function\" or \"missing end of file\" — the cut is the reader's, not the repository's, and that finding is always false.";
let out;
try {
  const r = await fetch(prov.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${prov.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: prov.model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: `Repo: ${repo}\n\nCode:\n${corpus}` }] }),
  });
  const d = await r.json();
  if (!r.ok) { log("!! provider error:", JSON.stringify(d).slice(0, 200)); process.exit(2); }
  const txt = d.choices?.[0]?.message?.content || "{}";
  out = JSON.parse(txt.replace(/^```json\s*|\s*```$/g, ""));
} catch (e) { log("!! judge failed:", e.message); process.exit(2); }

// 3) Verdict.
const findings = Array.isArray(out.findings) ? out.findings : [];
const bad = findings.filter((f) => ["critical", "high"].includes(String(f.severity).toLowerCase()));
const verdict = bad.length ? "FAIL" : (out.verdict || "PASS");
console.log(JSON.stringify({ verdict, judge: prov.model, findings, summary: out.summary || "" }, null, 2));
log(`\n[judge] ${verdict === "PASS" ? "PASS" : "FAIL"} — ${findings.length} findings (${bad.length} crit/high). judge=${prov.model}`);
for (const f of bad) log(`  [${f.severity}] ${f.title} @ ${f.file}`);
process.exit(verdict === "PASS" ? 0 : 1);
