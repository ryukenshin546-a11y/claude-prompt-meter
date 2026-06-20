// Model-specific pricing (USD per 1M tokens)
// Source: https://www.anthropic.com/pricing

const MODEL_PRICING = {
  // Opus 4.x — $5 in / $25 out per 1M (cacheRead 0.1x, cacheCreate 1.25x of input)
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },

  // Sonnet 4.x — $3 in / $15 out
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },

  // Haiku 4.x — $1 in / $5 out
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheCreate: 1.25 },

  // Fable / Mythos 5 — $10 in / $50 out (priced above Opus tier)
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1.0, cacheCreate: 12.5 },
  "claude-mythos-5": { input: 10, output: 50, cacheRead: 1.0, cacheCreate: 12.5 },

  // 3.x legacy
  "claude-3-5-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "claude-3-5-haiku": { input: 1, output: 5, cacheRead: 0.1, cacheCreate: 1.25 },
  "claude-3-opus": { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
};

// Normalize a model string to a MODEL_PRICING key.
//   "claude-opus-4-8[1m]"        → "claude-opus-4-8"
//   "claude-haiku-4-5-20251001"  → "claude-haiku-4-5"  (trailing date dropped)
//   "claude-sonnet-4.6"          → "claude-sonnet-4-6" (dotted minor → dashed)
//   "claude-3-opus-20240229"     → "claude-3-opus"     (prefix match)
function normalizeModelId(model) {
  if (!model) return null;
  let s = model.replace(/\[.*?\]$/, "").replace(/-\d{8}$/, "").replace(/(\d+)\.(\d+)/, "$1-$2");
  if (MODEL_PRICING[s]) return s;
  const key = Object.keys(MODEL_PRICING).find((k) => s.startsWith(k));
  return key || s.split("-").slice(0, 4).join("-"); // fall back to 4-segment base for unknown ids
}

// "claude-opus-4-8" -> "Opus 4.8", "claude-fable-5" -> "Fable 5".
// Unknown/legacy ids fall back to the raw normalized id.
function modelLabel(id) {
  if (!id) return null;
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  let m = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)-(\d+)/);
  if (m) return `${cap(m[1])} ${m[2]}.${m[3]}`;
  m = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)/);
  if (m) return `${cap(m[1])} ${m[2]}`;
  return id;
}

// Badge dot color, keyed by model family.
function modelColor(id) {
  const fam = (id || "").match(/^claude-(opus|sonnet|haiku|fable|mythos)/)?.[1];
  return { opus: "#b0502f", sonnet: "#4a78b0", haiku: "#4a9b6e", fable: "#8a5cb0", mythos: "#8a5cb0" }[fam] || "#888";
}

function getPricingForModel(model, fallback) {
  const normalized = normalizeModelId(model);
  if (normalized && MODEL_PRICING[normalized]) {
    return {
      inputPerMillion: MODEL_PRICING[normalized].input,
      outputPerMillion: MODEL_PRICING[normalized].output,
      cacheReadPerMillion: MODEL_PRICING[normalized].cacheRead,
      cacheCreatePerMillion: MODEL_PRICING[normalized].cacheCreate,
    };
  }
  return fallback;
}

module.exports = { MODEL_PRICING, normalizeModelId, getPricingForModel, modelLabel, modelColor };
