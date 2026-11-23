#!/usr/bin/env node
// Adversarial code judge — an independent model gives a PASS / FAIL verdict on code.
//
// The point is independence: the model that judges the code is NOT the one that wrote it.
// Wire this into CI (or a pre-merge step) as a gate.
//
// Provider-agnostic: talks to any OpenAI-compatible Chat Completions API.
//   OPENAI_BASE_URL  base URL, default https://api.openai.com/v1
//   OPENAI_API_KEY   required
//   JUDGE_MODEL      model id, default gpt-4o-mini
//                    (for OpenRouter: set OPENAI_BASE_URL=https://openrouter.ai/api/v1
//                     and JUDGE_MODEL=openai/gpt-4o-mini)
//
// Usage:
//   node judge.mjs [path]          judge the source files under [path] (default: .)
//
// Exit codes: 0 = PASS, 1 = FAIL (findings), 2 = operational error (no key / no files / API).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.JUDGE_MODEL || "gpt-4o-mini";

// Source extensions we review. Framework-agnostic on purpose: selection is by file type,
// not by a path pattern tied to one stack. No match → operational error, never a silent PASS.
const SOURCE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rb", ".rs",
  ".java", ".kt", ".php", ".cs", ".sql", ".sh", ".vue", ".svelte",
]);
const SKIP_DIR = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", "target",
  "vendor", "__pycache__", ".venv", "venv", "coverage",
]);
const MAX_BYTES = 200 * 1024; // bound the prompt (and the bill)

// Signals an operational error (exit 2). We never call process.exit() directly: on Windows +
// Node's keep-alive fetch socket, forcing exit while the socket is still closing trips a libuv
// assertion. Instead we throw, and main's catch sets process.exitCode and lets the loop drain.
class JudgeExit extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}
function fail(msg) {
  throw new JudgeExit(msg, 2);
}

function collect(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIR.has(name) || name.startsWith(".env")) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (s.isFile() && SOURCE_EXT.has(extname(name))) files.push({ p, size: s.size });
    }
  };
  walk(root);
  return files;
}

function buildBundle(root, files) {
  let total = 0;
  const parts = [];
  const skipped = [];
  // Smallest first, so a huge file can't crowd out the rest of the change.
  for (const f of files.sort((a, b) => a.size - b.size)) {
    if (total + f.size > MAX_BYTES) { skipped.push(relative(root, f.p)); continue; }
    total += f.size;
    parts.push(`\n===== ${relative(root, f.p).replace(/\\/g, "/")} =====\n` + readFileSync(f.p, "utf8"));
  }
  return { text: parts.join("\n"), skipped };
}

const SYSTEM = `You are an adversarial code reviewer. You did NOT write this code and owe it no benefit of the doubt.
Find real defects only: security holes (injection, auth/authz gaps, secret exposure, SSRF, unsafe deserialization),
correctness bugs that produce wrong results or crashes, and data-loss or data-leak risks.
Ignore style, naming, and formatting. Do not invent problems; if the code is sound, say so.
Return STRICT JSON, no prose outside it:
{"verdict":"PASS"|"FAIL","findings":[{"severity":"critical"|"high"|"medium","file":"path","title":"...","detail":"root cause + impact"}],"summary":"one line"}
FAIL only if at least one critical or high finding is real. medium findings alone are a PASS with notes.`;

async function judge(bundle) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Review the following files and return the JSON verdict.\n${bundle}` },
      ],
    }),
  });
  if (!res.ok) fail(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) fail("API returned no content");
  try {
    return JSON.parse(content);
  } catch {
    // Some models wrap JSON in a code fence despite json_object; recover the object.
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    fail("could not parse model output as JSON");
  }
}

async function main() {
  if (!API_KEY) fail("OPENAI_API_KEY is not set (see .env.example)");
  const root = process.argv[2] || ".";
  let rootStat;
  try { rootStat = statSync(root); } catch { fail(`path not found: ${root}`); }
  if (!rootStat.isDirectory()) fail(`path is not a directory: ${root}`);

  const files = collect(root);
  if (files.length === 0) fail(`no source files found under ${root} — nothing to judge (not a PASS)`);

  const { text, skipped } = buildBundle(root, files);
  if (skipped.length) console.error(`judge: bundle over ${MAX_BYTES} bytes; skipped ${skipped.length} file(s)`);

  const v = await judge(text);
  const findings = Array.isArray(v.findings) ? v.findings : [];
  console.log(`\nModel: ${MODEL} @ ${BASE_URL}`);
  console.log(`Verdict: ${v.verdict}  —  ${v.summary || ""}`);
  for (const f of findings) {
    console.log(`\n  [${(f.severity || "?").toUpperCase()}] ${f.title}`);
    console.log(`  file: ${f.file || "?"}`);
    console.log(`  ${f.detail || ""}`);
  }
  console.log("");
  process.exitCode = v.verdict === "PASS" ? 0 : 1;
}

main().catch((e) => {
  console.error(`judge: ${e.message}`);
  process.exitCode = e instanceof JudgeExit ? e.code : 2;
});
