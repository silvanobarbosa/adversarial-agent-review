#!/usr/bin/env node
/**
 * Adversarial DESIGN judge — the visual counterpart to the security judge.
 *
 * Takes a screenshot of a live URL (Playwright) and asks an INDEPENDENT vision model to score
 * hierarchy · distinction · polish · brand · readability, and to answer "does this look like a
 * generic AI template?". FAIL → a gate (don't ship a generic-looking UI).
 *
 * Usage:  node judges/design-judge.mjs <liveUrl> [path=/]
 * Env (from process.env or a local .env file in the current directory):
 *   OPENROUTER_API_KEY     - required (any OpenAI-compatible endpoint with a vision model)
 *   OPENROUTER_VISION_MODEL - override the vision model (default: openai/gpt-4o)
 * Requires: `npm i playwright` and `npx playwright install chromium`.
 * Exit: 0 = PASS · 1 = FAIL (weak/generic design) · 2 = error.
 */
import fs from "node:fs";

// Load a local .env (current working directory) as a convenience; process.env wins.
const env = {};
try {
  for (const l of fs.readFileSync(`${process.cwd()}/.env`, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}
const E = (k) => process.env[k] || env[k];

const url = process.argv[2];
const subpath = process.argv[3] || "";
if (!url) { console.error("usage: design-judge.mjs <liveUrl> [path]"); process.exit(2); }
const target = subpath ? `${url.replace(/\/$/, "")}${subpath.startsWith("/") ? subpath : "/" + subpath}` : url;

const MODEL = E("OPENROUTER_VISION_MODEL") || "openai/gpt-4o"; // a strong model judges fairly (mini is too harsh)
const KEY = E("OPENROUTER_API_KEY");
if (!KEY) { console.error("no OPENROUTER_API_KEY"); process.exit(2); }

const RUBRIC = `You are a senior, critical and DEMANDING art director. Judge ONLY the visual design of this product screen (not the content). Score 0-10:
- hierarchy: can you read the screen in 3s? clear focus?
- distinction: own identity OR a generic template? (10 = memorable, 0 = Bootstrap/generic AI)
- polish: spacing, alignment, consistency, detail.
- brand: color/typography/tone coherent and intentional?
- readability: contrast and legibility.
Rule: if it looks like a "generic AI template" (grey card + blue button + no identity), distinction<=4 and verdict=FAIL.
Respond ONLY JSON: {"verdict":"PASS|FAIL","scores":{"hierarchy":n,"distinction":n,"polish":n,"brand":n,"readability":n},"generic":true|false,"findings":["..."],"summary":"..."}
FAIL if average<6 OR generic=true.`;

async function shot() {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await pg.goto(target, { waitUntil: "networkidle", timeout: 30000 }).catch(() => pg.goto(target, { timeout: 30000 }));
    await pg.waitForTimeout(1200);
    const buf = await pg.screenshot({ type: "png" });
    return buf.toString("base64");
  } finally { await b.close(); }
}

(async () => {
  let b64;
  try { b64 = await shot(); }
  catch (e) {
    console.error(`!! screenshot failed: ${e.message}\n(run 'npm i playwright && npx playwright install chromium' if the browser is missing)`);
    process.exit(2);
  }
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: [
        { type: "text", text: RUBRIC },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ] }],
    }),
  });
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || "";
  let verdict;
  try { verdict = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] || txt); }
  catch { console.error("non-JSON response from judge:", txt.slice(0, 300)); process.exit(2); }

  const s = verdict.scores || {};
  const avg = Object.values(s).reduce((a, n) => a + Number(n || 0), 0) / (Object.keys(s).length || 1);
  const pass = verdict.verdict === "PASS" && !verdict.generic && avg >= 6;
  console.log(JSON.stringify({ target, model: MODEL, verdict: pass ? "PASS" : "FAIL", avg: +avg.toFixed(1), ...verdict }, null, 2));
  console.error(`\n[design-judge] ${target} → ${pass ? "PASS" : "FAIL"} (avg ${avg.toFixed(1)}/10${verdict.generic ? " · GENERIC" : ""})`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("!! error:", e.message); process.exit(2); });
