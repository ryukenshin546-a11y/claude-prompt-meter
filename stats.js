// Pure stats core — no vscode dependency, so it's unit-testable on its own.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { getPricingForModel, normalizeModelId } = require("./pricing.js");

const WINDOW = 1_000_000; // legacy fallback export; real window resolved per-session
const STD_WINDOW = 200_000;

// Sonnet 4.6 default pricing (USD / 1M tokens) — used as fallback when model unknown
const DEFAULT_PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,
  cacheCreatePerMillion: 3.75,
};

const safe = (l) => { try { return JSON.parse(l); } catch { return null; } };

// Slash commands (/model, /clear, …) inject synthetic user lines wrapped in
// <command-name>, <local-command-stdout>, etc. They aren't prompts the user typed.
function isCommandMeta(c) {
  const text = typeof c === "string" ? c : Array.isArray(c) ? (c.find((b) => b.type === "text")?.text || "") : "";
  return /^\s*<(?:local-)?command-/.test(text);
}

// type:"user" AND (string content OR array without tool_result) = a real prompt,
// not a tool_result being fed back into the loop or slash-command plumbing.
function isTyped(o) {
  if (o?.type !== "user") return false;
  const c = o.message?.content;
  if (isCommandMeta(c)) return false;
  if (typeof c === "string") return true;
  return Array.isArray(c) && !c.some((b) => b.type === "tool_result");
}

function costOf(u, p) {
  return (
    ((u.input_tokens || 0) * p.inputPerMillion +
      (u.output_tokens || 0) * p.outputPerMillion +
      (u.cache_read_input_tokens || 0) * p.cacheReadPerMillion +
      (u.cache_creation_input_tokens || 0) * p.cacheCreatePerMillion) /
    1_000_000
  );
}

// Walk one session file once, returning everything every view needs.
function sessionStats(file, userPricing = DEFAULT_PRICING) {
  let lines;
  try { lines = fs.readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }

  const prompts = [];           // one entry per user-typed prompt
  let cur = null;
  let sessionCost = 0, sessionOut = 0, sessionCacheRead = 0, sessionCacheWrite = 0, sessionFreshIn = 0;
  let is1m = false;             // 1M context window? from [1m] model tag or observed ctx

  const pushCur = () => { if (cur) prompts.push(cur); };

  for (const line of lines) {
    const o = safe(line);
    if (!o) continue;

    if (isTyped(o)) {
      pushCur();
      cur = { input: 0, output: 0, calls: 0, roundtrips: 0, ctx: 0, cost: 0, ts: o.timestamp || null, model: null };
    }
    if (!cur) continue; // skip leading meta before first prompt

    const u = o.message?.usage;
    if (u) {
      // detect model switch — use model-specific pricing
      const model = o.message?.model;
      const pricing = getPricingForModel(model, userPricing);
      if (model && !cur.model) cur.model = normalizeModelId(model);

      if (model && /\[1m\]/.test(model)) is1m = true;
      cur.roundtrips++;
      if (cur.roundtrips === 1)
        cur.input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      cur.output += u.output_tokens || 0;
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx > 0) cur.ctx = ctx; // ignore <synthetic>/zero-usage trailing lines that would reset ctx to 0
      if (cur.ctx > STD_WINDOW) is1m = true; // a 200k window can't hold this much
      cur.cost += costOf(u, pricing);
      // session-wide tallies (billed, summed across every roundtrip)
      sessionFreshIn += u.input_tokens || 0;
      sessionOut += u.output_tokens || 0;
      sessionCacheRead += u.cache_read_input_tokens || 0;
      sessionCacheWrite += u.cache_creation_input_tokens || 0;
      sessionCost += costOf(u, pricing);
    }
    const c = o.message?.content;
    if (Array.isArray(c)) for (const b of c) if (b.type === "tool_use") cur.calls++;
  }
  pushCur();

  if (!prompts.length) return null;

  // No-response prompts (interrupted/queued, $0) carry no model of their own —
  // inherit the session's current model so every row shows one. Mark it inherited.
  let lastModel = null;
  for (const p of prompts) {
    if (p.model) lastModel = p.model;
    else if (lastModel) { p.model = lastModel; p.inherited = true; }
  }

  const last = prompts[prompts.length - 1];
  const window = is1m ? 1_000_000 : STD_WINDOW;
  return {
    last,
    prompts,
    session: {
      promptCount: prompts.length,
      freshIn: sessionFreshIn,
      output: sessionOut,
      cacheRead: sessionCacheRead,
      cacheWrite: sessionCacheWrite,
      cost: sessionCost,
      ctx: last.ctx,            // current window fill = last prompt's ctx
      window,                   // 1M or 200k depending on model
      left: Math.max(0, window - last.ctx),
    },
  };
}

function latestJsonl(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    if (!files.length) return null;
    return files
      .map((f) => ({ p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0].p;
  } catch { return null; }
}

// ISO timestamp string -> ms (resetTs is a Date.now() number); 0 if absent/bad.
const tsMs = (t) => (t ? new Date(t).getTime() || 0 : 0);

function allSessions(dir, markers = {}, userPricing = DEFAULT_PRICING) {
  // returns [{file, id, created, modified, promptCount, cost}] newest first.
  // Parses the whole file: a 3MB session reads in a few ms, and the old
  // last-50-lines preview reported wildly wrong cost/count for long sessions.
  // markers: { sessionId: ms } — each session counts only prompts after ITS OWN
  // reset marker (sessions without a marker count everything).
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    return files
      .map((f) => {
        const p = path.join(dir, f);
        const id = path.basename(f, ".jsonl");
        const reset = markers[id] || 0;
        const stat = fs.statSync(p);
        let lines;
        try { lines = fs.readFileSync(p, "utf8").trim().split("\n"); } catch { return null; }

        // Gate BOTH count and cost on the reset marker (usage rows carry no
        // timestamp, so track post-reset state per prompt instead of per line).
        let promptCount = 0, cost = 0, counting = !reset;
        for (const line of lines) {
          const o = safe(line);
          if (!o) continue;
          if (isTyped(o)) {
            counting = !reset || tsMs(o.timestamp) > reset;
            if (counting) promptCount++;
          }
          const u = o.message?.usage;
          if (u && counting) cost += costOf(u, getPricingForModel(o.message?.model, userPricing));
        }

        return {
          file: p,
          id,
          created: stat.birthtimeMs,
          modified: stat.mtimeMs,
          promptCount,
          cost,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified);
  } catch { return []; }
}

// Local YYYY-MM-DD for an ISO timestamp (local tz, so "today" matches the user's clock).
function localDay(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cost + prompt count bucketed by local day, summed across every session in the
// project. Returns { "YYYY-MM-DD": { cost, prompts } }.
// ponytail: re-parses every file per call; fine because it only runs while the
// dashboard is open. If that ever bites, cache per-file by mtime.
function costByDay(dir, userPricing = DEFAULT_PRICING) {
  const out = {};
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return out; }
  for (const f of files) {
    const s = sessionStats(path.join(dir, f), userPricing);
    if (!s) continue;
    for (const p of s.prompts) {
      const day = localDay(p.ts);
      if (!day) continue;
      (out[day] ||= { cost: 0, prompts: 0 });
      out[day].cost += p.cost;
      out[day].prompts += 1;
    }
  }
  return out;
}

// Read the cwd a session was recorded in (appears in the first few lines).
function sessionCwd(file) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n", 8);
    for (const l of lines) { const o = safe(l); if (o?.cwd) return o.cwd; }
  } catch {}
  return null;
}

// Compare two paths tolerant of trailing separators, slash direction, and case
// (Claude's slug casing can differ from the workspace path, esp. across OSes).
const normPath = (p) => path.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
const samePath = (a, b) => !!a && !!b && normPath(a) === normPath(b);

// Resolve the ~/.claude/projects/<slug> dir for a workspace root.
// Try the slug first (fast); if it doesn't exist, scan for a project dir whose
// latest session was recorded in `root` (ground-truth cwd, immune to slug drift).
function findProjectDir(root) {
  if (!root) return null;
  const guess = projectDir(root);
  const hasJsonl = (d) => { try { return fs.readdirSync(d).some((f) => f.endsWith(".jsonl")); } catch { return false; } };
  if (hasJsonl(guess)) return guess;

  const base = path.join(os.homedir(), ".claude", "projects");
  try {
    for (const d of fs.readdirSync(base)) {
      const full = path.join(base, d);
      const f = latestJsonl(full);
      if (f && samePath(sessionCwd(f), root)) return full;
    }
  } catch {}
  return fs.existsSync(guess) ? guess : null; // exists-but-empty is still valid to watch
}

// Project dir slug: VS Code path -> ~/.claude/projects/<slug>
function projectDir(root) {
  // Keep dashes, replace everything else with dash
  const slug = root.replace(/[^a-zA-Z0-9-]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug);
}

module.exports = { sessionStats, latestJsonl, allSessions, costByDay, projectDir, findProjectDir, costOf, DEFAULT_PRICING, WINDOW, getPricingForModel, normalizeModelId };
