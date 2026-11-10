#!/usr/bin/env node
/**
 * #1 (cérebro) Gerador de design-system por app — dá IDENTIDADE única a cada app
 * (pilar "design diferenciado"), mantendo qualidade premium consistente (sem drift).
 * Determinístico: mesmo input → mesmo tema; seeds diferentes → temas distintos.
 * Recita a receita premium 2026: dark-mode-first, tinta de marca, contraste alto,
 * acento vívido, par tipográfico curado, motion estrutural.
 *
 * Uso: node gen-design-system.mjs "<Nome do App>" [brandHex] [mood]
 *   mood: bold | calm | warm | tech | editorial (default: derivado do nome)
 * Saída: CSS de tokens (:root) + tokens.json (stderr) — cola no globals.css do app.
 */

const [name = "App", brandHex, moodArg] = process.argv.slice(2);

// seed determinístico a partir do nome
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const seed = hash(name.toLowerCase());
const norm = (h) => ((h % 360) + 360) % 360; // hue sempre 0..359
const rnd = (n) => norm(seed >>> (n * 3));

// hue base: da marca (hex) ou do seed
function hexToHue(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
const baseHue = hexToHue(brandHex) ?? rnd(1);

const MOODS = {
  bold:      { satBg: 16, satAcc: 90, lAcc: 62, spin: 150 },  // acento complementar vívido
  calm:      { satBg: 12, satAcc: 55, lAcc: 66, spin: 40 },   // análogo, dessaturado
  warm:      { satBg: 18, satAcc: 82, lAcc: 64, spin: 25 },   // tons quentes próximos
  tech:      { satBg: 14, satAcc: 88, lAcc: 60, spin: 190 },  // ciano/neon, contraste
  editorial: { satBg: 8,  satAcc: 70, lAcc: 68, spin: 210 },  // sóbrio, tipografia forte
};
const moodKeys = Object.keys(MOODS);
const mood = MOODS[moodArg] ? moodArg : moodKeys[seed % moodKeys.length];
const M = MOODS[mood];

const accentHue = norm(baseHue + M.spin);
const accent2Hue = norm(baseHue + M.spin + 30);

// pares tipográficos curados (system-safe + fallbacks premium)
const FONTS = [
  { display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif" },
  { display: "'Clash Display', 'Segoe UI', sans-serif", body: "'Inter', system-ui, sans-serif" },
  { display: "'Space Grotesk', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif" },
  { display: "'Sora', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
  { display: "'Instrument Serif', Georgia, serif", body: "'Geist', system-ui, sans-serif" },
];
const font = FONTS[seed % FONTS.length];
const radius = [10, 14, 18, 22][(seed >> 4) % 4];

const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
const tokens = {
  name, mood, baseHue, accentHue,
  bg: hsl(baseHue, M.satBg, 6),
  surface: hsl(baseHue, M.satBg - 2, 10),
  border: hsl(baseHue, M.satBg - 4, 18),
  text: hsl(baseHue, 10, 94),
  muted: hsl(baseHue, 8, 63),
  accent: hsl(accentHue, M.satAcc, M.lAcc),
  accent2: hsl(accent2Hue, M.satAcc - 5, M.lAcc + 4),
  radius: `${radius}px`,
  fontDisplay: font.display,
  fontBody: font.body,
};

// CSS de tokens (nomes compatíveis com o globals.css do golden template)
const css = `:root {
  /* design-system gerado — ${name} · mood:${mood} · hue:${baseHue}° (identidade única) */
  --bg: ${tokens.bg};
  --surface: ${tokens.surface};
  --border: ${tokens.border};
  --text: ${tokens.text};
  --muted: ${tokens.muted};
  --neon: ${tokens.accent};      /* acento primário */
  --neon-2: ${tokens.accent2};   /* acento secundário */
  --radius: ${tokens.radius};
  --shadow: 0 8px 40px hsl(${accentHue} ${M.satAcc}% ${M.lAcc}% / 0.10);
  --font-display: ${tokens.fontDisplay};
  --font-body: ${tokens.fontBody};
  /* motion estrutural (não decorativo) */
  --motion-fast: 140ms;
  --motion: 220ms;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}
body { font-family: var(--font-body); }
h1, h2, h3, .display { font-family: var(--font-display); letter-spacing: -0.01em; }`;

console.log(css);
console.error(JSON.stringify(tokens, null, 2));
