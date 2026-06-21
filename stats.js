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

// mtime AND size: a file rewritten within one mtime tick (coarse on Windows)
// changes size when its content changes, so the cache can't serve stale data.
const fileSig = (f) => { try { const s = fs.statSync(f); return s.mtimeMs + ":" + s.size; } catch { return "0"; } };

// The dashboard re-derives every session on each refresh (and refreshes often).
// Skip the expensive read+JSON.parse for files unchanged since last time, keyed
// by mtime + a pricing signature (so custom-rate edits invalidate). The active
// session's file keeps changing, so it always re-parses — always fresh.
// ponytail: no eviction; bounded by file count, not refresh count. LRU if it ever bites.
const _subCache = new Map();   // agent file -> { m, sig, v }
const _sessCache = new Map();  // main  file -> { sig, v }

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

// Sub-agents (Workflow/Agent tool) run as full sessions of their own, written
// to <session-dir>/<id>/subagents/**/agent-*.jsonl — NOT into the main file,
// which only logs the one spawning tool_use. Their tokens are billed and their
// tool calls are real work, so we fold them back into the prompt that spawned
// them (matched by timestamp). ctx/window stay main-only: each has its own window.
function listAgentFiles(dir) {
  let out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listAgentFiles(p));
    else if (/^agent-.*\.jsonl$/.test(e.name)) out.push(p);
  }
  return out;
}

// One entry per sub-agent transcript: its start time + summed work/usage/cost.
function subagentContribs(file, userPricing = DEFAULT_PRICING) {
  const dir = path.join(path.dirname(file), path.basename(file, ".jsonl"), "subagents");
  const sig = JSON.stringify(userPricing);
  const out = [];
  for (const af of listAgentFiles(dir)) {
    const m = fileSig(af);
    const hit = _subCache.get(af);
    if (hit && hit.m === m && hit.sig === sig) { out.push(hit.v); continue; }
    // wf_<runId> path segment links this transcript to its spawning tool_use.
    const runId = af.split(/[\\/]/).find((seg) => seg.startsWith("wf_")) || null;
    let lines;
    try { lines = fs.readFileSync(af, "utf8").trim().split("\n"); } catch { continue; }
    let ts = null, calls = 0, output = 0, freshIn = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    for (const line of lines) {
      const o = safe(line);
      if (!o) continue;
      if (!ts && o.timestamp) ts = o.timestamp;
      const u = o.message?.usage;
      if (u) {
        const p = getPricingForModel(o.message?.model, userPricing);
        output += u.output_tokens || 0;
        freshIn += u.input_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheWrite += u.cache_creation_input_tokens || 0;
        cost += costOf(u, p);
      }
      const c = o.message?.content;
      if (Array.isArray(c)) for (const b of c) if (b.type === "tool_use") calls++;
    }
    const v = { ts, runId, calls, output, freshIn, cacheRead, cacheWrite, cost };
    _subCache.set(af, { m, sig, v });
    out.push(v);
  }
  return out;
}

// Walk one session file once, returning everything every view needs.
function sessionStats(file, userPricing = DEFAULT_PRICING) {
  // Cache key folds in the main file AND every sub-agent file's mtime: sub-agents
  // append asynchronously, so the main mtime alone can't tell us they changed.
  const subDir = path.join(path.dirname(file), path.basename(file, ".jsonl"), "subagents");
  let sig = fileSig(file) + "|" + JSON.stringify(userPricing);
  for (const af of listAgentFiles(subDir)) sig += "|" + af + ":" + fileSig(af);
  const cached = _sessCache.get(file);
  if (cached && cached.sig === sig) return cached.v;

  let lines;
  try { lines = fs.readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }

  const prompts = [];           // one entry per user-typed prompt
  let cur = null;
  let sessionCost = 0, sessionOut = 0, sessionCacheRead = 0, sessionCacheWrite = 0, sessionFreshIn = 0;
  let is1m = false;             // 1M context window? from [1m] model tag or observed ctx

  // Exact sub-agent attribution: link wf_<runId> -> the prompt that spawned it,
  // via the spawning tool_use id and the RunId echoed in that tool's result.
  const spawnPrompt = new Map(); // tool_use id (Workflow/Agent) -> prompt object
  const runToTool = new Map();   // wf_<runId> -> that spawning tool_use id

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
    if (Array.isArray(c)) for (const b of c) {
      if (b.type === "tool_use") {
        cur.calls++;
        if (b.name === "Workflow" || b.name === "Agent") spawnPrompt.set(b.id, cur);
      } else if (b.type === "tool_result" && spawnPrompt.has(b.tool_use_id)) {
        // a spawn's own result echoes RunId: "wf_..." — bind it to that tool_use
        const txt = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        const m = txt.match(/wf_[a-z0-9-]+/gi);
        if (m) for (const r of m) runToTool.set(r, b.tool_use_id);
      }
    }
  }
  pushCur();

  if (!prompts.length) return null;

  // Fold each sub-agent's work into the prompt that spawned it. Prefer the exact
  // runId link (immune to background agents finishing after later prompts); fall
  // back to the [ts, nextTs) window only when the link isn't resolvable yet.
  // calls/output/cost grow on that row and on session billing — but NOT ctx/window
  // (separate context windows). `agents` marks how many sub-agents landed here.
  for (const ct of subagentContribs(file, userPricing)) {
    let target = ct.runId && runToTool.has(ct.runId) ? spawnPrompt.get(runToTool.get(ct.runId)) : null;
    if (!target) {
      const t = tsMs(ct.ts);
      target = prompts[prompts.length - 1];
      for (let i = 0; t && i < prompts.length; i++) {
        const a = tsMs(prompts[i].ts);
        const b = i + 1 < prompts.length ? tsMs(prompts[i + 1].ts) : Infinity;
        if (t >= a && t < b) { target = prompts[i]; break; }
      }
    }
    target.calls += ct.calls;
    target.output += ct.output;
    target.cost += ct.cost;
    target.agents = (target.agents || 0) + 1;
    sessionFreshIn += ct.freshIn;
    sessionOut += ct.output;
    sessionCacheRead += ct.cacheRead;
    sessionCacheWrite += ct.cacheWrite;
    sessionCost += ct.cost;
  }

  // No-response prompts (interrupted/queued, $0) carry no model of their own —
  // inherit the session's current model so every row shows one. Mark it inherited.
  let lastModel = null;
  for (const p of prompts) {
    if (p.model) lastModel = p.model;
    else if (lastModel) { p.model = lastModel; p.inherited = true; }
  }

  const last = prompts[prompts.length - 1];
  const window = is1m ? 1_000_000 : STD_WINDOW;
  const result = {
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
  _sessCache.set(file, { sig, v: result });
  return result;
}

// Context-pressure warning state machine (pure, so it's unit-testable).
// Fire once when fill% first reaches the threshold, then stay quiet until it
// drops back below (after /clear or /compact) — which re-arms it for the next
// climb. threshold 0 disables. Returns { warn (fire now?), warned (new state) }.
function ctxWarnState(pct, threshold, wasWarned) {
  if (!threshold || pct < threshold) return { warn: false, warned: false };
  return { warn: !wasWarned, warned: true };
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
  // Reuses (cached) sessionStats so it shares the per-file parse; prompt.cost
  // already folds in sub-agent cost, so gating per prompt gates both.
  // markers: { sessionId: ms } — each session counts only prompts after ITS OWN
  // reset marker (sessions without a marker count everything).
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    return files
      .map((f) => {
        const p = path.join(dir, f);
        const id = path.basename(f, ".jsonl");
        const reset = markers[id] || 0;
        let stat;
        try { stat = fs.statSync(p); } catch { return null; }

        const s = sessionStats(p, userPricing);
        let promptCount = 0, cost = 0;
        if (s) for (const pr of s.prompts) {
          if (!reset || tsMs(pr.ts) > reset) { promptCount++; cost += pr.cost; }
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

// Aggregate usage across ALL projects under `base`, grouped by the workspace
// `cwd` recorded in each session (ground truth — so one workspace split across
// slug folders merges correctly). monthPrefix like "2026-06" filters by local
// day; null = all-time. Returns { total:{cost,prompts}, workspaces:[{name,cwd,cost,prompts}] }.
function usageByWorkspace(monthPrefix = null, userPricing = DEFAULT_PRICING, base = path.join(os.homedir(), ".claude", "projects")) {
  let dirs;
  try { dirs = fs.readdirSync(base); } catch { return { total: { cost: 0, prompts: 0 }, workspaces: [] }; }
  const byWs = new Map(); // normalized cwd -> { name, cwd, cost, prompts }
  for (const d of dirs) {
    const dir = path.join(base, d);
    const lf = latestJsonl(dir);
    if (!lf) continue;
    const cwd = sessionCwd(lf);
    const key = cwd ? normPath(cwd) : "slug:" + d;
    const name = cwd ? path.basename(cwd.replace(/[\\/]+$/, "")) : d;
    let cost = 0, prompts = 0;
    for (const [day, v] of Object.entries(costByDay(dir, userPricing))) {
      if (monthPrefix && !day.startsWith(monthPrefix)) continue;
      cost += v.cost; prompts += v.prompts;
    }
    if (!cost && !prompts) continue;
    const ws = byWs.get(key) || { name, cwd: cwd || null, cost: 0, prompts: 0 };
    ws.cost += cost; ws.prompts += prompts;
    byWs.set(key, ws);
  }
  const workspaces = [...byWs.values()].sort((a, b) => b.cost - a.cost);
  const total = workspaces.reduce((t, w) => ({ cost: t.cost + w.cost, prompts: t.prompts + w.prompts }), { cost: 0, prompts: 0 });
  return { total, workspaces };
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

module.exports = { sessionStats, latestJsonl, allSessions, costByDay, usageByWorkspace, projectDir, findProjectDir, sessionCwd, costOf, ctxWarnState, DEFAULT_PRICING, WINDOW, getPricingForModel, normalizeModelId };
