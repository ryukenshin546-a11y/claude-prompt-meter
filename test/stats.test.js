// Minimal self-check for the stats core. Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sessionStats, allSessions, costByDay, ctxWarnState } = require("../stats.js");
const { modelLabel, normalizeModelId, getPricingForModel, MODEL_PRICING } = require("../pricing.js");

// Build a fake session file from JSONL lines and return its path.
// Unique name per call: two fixtures must never share a path, or the parse
// cache (keyed by path) could serve one's result for the other.
let _fxN = 0;
function fixture(lines) {
  const p = path.join(os.tmpdir(), `cpm-test-${process.pid}-${_fxN++}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"));
  return p;
}

const userLine = (ts) => ({ type: "user", timestamp: ts, message: { role: "user", content: "hi" } });
const asstLine = (model, usage) => ({ type: "assistant", message: { model, usage, content: [{ type: "tool_use", name: "Read" }] } });

test("groups roundtrips per prompt; input=first roundtrip, output=summed", () => {
  const f = fixture([
    userLine("2026-06-20T10:00:00Z"),
    asstLine("claude-opus-4-8", { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 }),
    asstLine("claude-opus-4-8", { input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 600, cache_creation_input_tokens: 0 }),
  ]);
  const s = sessionStats(f);
  assert.equal(s.prompts.length, 1);
  assert.equal(s.last.input, 150);        // first roundtrip input + cache_creation
  assert.equal(s.last.output, 30);        // summed across roundtrips
  assert.equal(s.last.ctx, 605);          // last roundtrip: in + cache_read + cache_create
  assert.equal(s.last.calls, 2);          // two tool_use blocks
});

test("window is 200k by default, 1M once ctx exceeds 200k", () => {
  const small = sessionStats(fixture([userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 1000, output_tokens: 5 })]));
  assert.equal(small.session.window, 200_000);

  const big = sessionStats(fixture([userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { cache_read_input_tokens: 250_000, output_tokens: 5 })]));
  assert.equal(big.session.window, 1_000_000);
  assert.equal(big.session.left, 750_000);
});

test("Opus 4.x output is $25/M and Fable 5 is $10/$50 (official pricing)", () => {
  assert.equal(MODEL_PRICING["claude-opus-4-8"].output, 25);
  assert.equal(MODEL_PRICING["claude-opus-4-8"].input, 5);
  assert.equal(MODEL_PRICING["claude-fable-5"].input, 10);
  assert.equal(MODEL_PRICING["claude-fable-5"].output, 50);
});

test("normalizeModelId strips [1m] tags, dates, and dotted minors", () => {
  assert.equal(normalizeModelId("claude-opus-4-8[1m]"), "claude-opus-4-8");
  assert.equal(normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
  assert.equal(normalizeModelId("claude-sonnet-4.6"), "claude-sonnet-4-6");
  assert.equal(normalizeModelId("claude-3-opus-20240229"), "claude-3-opus");
  // and they resolve to a real pricing entry (not the Sonnet fallback)
  assert.equal(getPricingForModel("claude-opus-4-8[1m]", null).outputPerMillion, 25);
});

test("modelLabel formats known ids, falls back on unknown", () => {
  assert.equal(modelLabel("claude-opus-4-8"), "Opus 4.8");
  assert.equal(modelLabel("claude-sonnet-4-6"), "Sonnet 4.6");
  assert.equal(modelLabel("claude-fable-5"), "Fable 5");
  assert.equal(modelLabel("claude-3-5-sonnet"), "claude-3-5-sonnet"); // legacy: raw
  assert.equal(modelLabel(null), null);
});

test("no-response prompt inherits the session's current model", () => {
  const f = fixture([
    userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 10, output_tokens: 5 }),
    userLine("2026-06-20T10:01:00Z"), // interrupted: no assistant line, no model of its own
    userLine("2026-06-20T10:02:00Z"), asstLine("claude-sonnet-4-6", { input_tokens: 10, output_tokens: 5 }),
  ]);
  const s = sessionStats(f);
  assert.equal(s.prompts.length, 3);
  assert.equal(s.prompts[0].model, "claude-opus-4-8");
  assert.equal(s.prompts[1].model, "claude-opus-4-8"); // inherited from prompt 1
  assert.equal(s.prompts[1].inherited, true);
  assert.equal(s.prompts[2].model, "claude-sonnet-4-6");
});

test("slash-command plumbing lines are not counted as prompts", () => {
  const f = fixture([
    userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 10, output_tokens: 5 }),
    { type: "user", message: { role: "user", content: "<command-name>/model</command-name>" } },
    { type: "user", message: { role: "user", content: "<local-command-stdout>Set model to claude-sonnet-4-6[1m]</local-command-stdout>" } },
    userLine("2026-06-20T10:05:00Z"), asstLine("claude-sonnet-4-6", { input_tokens: 10, output_tokens: 5 }),
  ]);
  const s = sessionStats(f);
  assert.equal(s.prompts.length, 2); // two real prompts; the /model lines are dropped
});

test("costByDay buckets cost + prompts per local day across the file", () => {
  const dir = path.join(os.tmpdir(), `cpm-cbd-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    userLine("2026-06-20T09:00:00"), asstLine("claude-opus-4-8", { input_tokens: 1_000_000, output_tokens: 0 }), // $5 (opus input)
    userLine("2026-06-20T15:00:00"), asstLine("claude-opus-4-8", { input_tokens: 1_000_000, output_tokens: 0 }), // $5 same day
    userLine("2026-06-21T10:00:00"), asstLine("claude-opus-4-8", { input_tokens: 1_000_000, output_tokens: 0 }), // $5 next day
  ];
  fs.writeFileSync(path.join(dir, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  const by = costByDay(dir);
  assert.equal(by["2026-06-20"].prompts, 2);
  assert.ok(Math.abs(by["2026-06-20"].cost - 10) < 0.001); // two $5 prompts
  assert.equal(by["2026-06-21"].prompts, 1);
});

test("sub-agent transcripts fold into the spawning prompt's tools + cost", () => {
  const dir = path.join(os.tmpdir(), `cpm-sub-${process.pid}`);
  const id = "sess";
  const sub = path.join(dir, id, "subagents", "workflows", "wf_x");
  fs.mkdirSync(sub, { recursive: true });
  // main: two prompts, the 2nd spawns a sub-agent (one Workflow tool_use)
  fs.writeFileSync(path.join(dir, id + ".jsonl"), [
    userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 1, output_tokens: 1 }),
    userLine("2026-06-20T11:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 1, output_tokens: 1 }),
  ].map((l) => JSON.stringify(l)).join("\n"));
  // sub-agent runs at 11:05 → belongs to prompt #2; 3 tool_use, $5 opus input
  fs.writeFileSync(path.join(sub, "agent-abc.jsonl"), [
    { type: "user", timestamp: "2026-06-20T11:05:00Z", message: { content: "go" } },
    { type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 1_000_000, output_tokens: 0 },
      content: [{ type: "tool_use", name: "Read" }, { type: "tool_use", name: "Bash" }, { type: "tool_use", name: "Edit" }] } },
  ].map((l) => JSON.stringify(l)).join("\n"));

  const s = sessionStats(path.join(dir, id + ".jsonl"));
  assert.equal(s.prompts.length, 2);
  assert.equal(s.prompts[0].calls, 1);                 // prompt #1 untouched
  assert.equal(s.prompts[1].calls, 1 + 3);             // own tool + 3 sub-agent tools
  assert.ok(Math.abs(s.prompts[1].cost - 5) < 0.01);   // ~$5 sub-agent cost lands here
  assert.ok(Math.abs(s.session.cost - 5) < 0.01);      // and in the session total
});

test("background sub-agent attributes to its spawning prompt via runId, not timestamp", () => {
  const dir = path.join(os.tmpdir(), `cpm-runid-${process.pid}`);
  const id = "sess";
  // realistic runId (digits + dash) — a naive path regex can miss this even
  // when a simple name like "wf_real" would match, so use the gnarly form.
  const runId = "wf_b92d04f3-d83";
  const sub = path.join(dir, id, "subagents", "workflows", runId);
  fs.mkdirSync(sub, { recursive: true });
  // prompt #1 spawns a Workflow (toolu_W); its result echoes the RunId.
  // prompt #2 comes later. The agent runs in the background and only logs at
  // 11:30 — inside prompt #2's time window — so timestamp alone would misattribute.
  fs.writeFileSync(path.join(dir, id + ".jsonl"), [
    userLine("2026-06-20T10:00:00Z"),
    { type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", name: "Workflow", id: "toolu_W" }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_W", content: `Started. RunId: "${runId}"` }] } },
    userLine("2026-06-20T11:00:00Z"),
    { type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 1 }, content: [] } },
  ].map((l) => JSON.stringify(l)).join("\n"));
  fs.writeFileSync(path.join(sub, "agent-1.jsonl"), [
    { type: "user", timestamp: "2026-06-20T11:30:00Z", message: { content: "go" } },
    { type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 1_000_000, output_tokens: 0 },
      content: [{ type: "tool_use", name: "Read" }, { type: "tool_use", name: "Bash" }] } },
  ].map((l) => JSON.stringify(l)).join("\n"));

  const s = sessionStats(path.join(dir, id + ".jsonl"));
  assert.equal(s.prompts[0].agents, 1);              // marked: this row absorbed a sub-agent
  assert.equal(s.prompts[0].calls, 1 + 2);           // spawner's own tool + 2 background-agent tools
  assert.ok(Math.abs(s.prompts[0].cost - 5) < 0.01); // $5 lands on the SPAWNER (prompt #1)
  assert.equal(s.prompts[1].agents, undefined);      // NOT prompt #2, despite the 11:30 timestamp
  assert.equal(s.prompts[1].calls, 0);
});

test("cache invalidates when a path is rewritten with different content (same mtime tick)", () => {
  // Reproduces the original Windows flake: rewrite the SAME path back-to-back.
  // mtime resolution is coarse, so the cache must also key on file SIZE.
  const p = path.join(os.tmpdir(), `cpm-rewrite-${process.pid}.jsonl`);
  fs.writeFileSync(p, [userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 1000, output_tokens: 5 })].map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(sessionStats(p).session.window, 200_000);                 // small ctx → 200k
  fs.writeFileSync(p, [userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { cache_read_input_tokens: 250_000, output_tokens: 5 })].map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(sessionStats(p).session.window, 1_000_000);               // big ctx → 1M, not stale 200k
});

test("per-file cache doesn't go stale when pricing changes", () => {
  // unknown model → falls back to userPricing, so changing it must change cost
  const f = fixture([userLine("2026-06-20T10:00:00Z"), asstLine("mystery-model-x", { input_tokens: 1_000_000, output_tokens: 0 })]);
  const cheap = sessionStats(f, { inputPerMillion: 3, outputPerMillion: 0, cacheReadPerMillion: 0, cacheCreatePerMillion: 0 }).session.cost;
  const dear = sessionStats(f, { inputPerMillion: 50, outputPerMillion: 0, cacheReadPerMillion: 0, cacheCreatePerMillion: 0 }).session.cost;
  assert.ok(Math.abs(cheap - 3) < 0.01);
  assert.ok(Math.abs(dear - 50) < 0.01);   // recomputed, not served from the $3 cache entry
});

test("ctxWarnState fires once per climb past the threshold, re-arms after a drop", () => {
  assert.deepEqual(ctxWarnState(99, 0, false), { warn: false, warned: false }); // threshold 0 = disabled
  assert.deepEqual(ctxWarnState(80, 85, false), { warn: false, warned: false }); // below: quiet, not armed
  assert.deepEqual(ctxWarnState(85, 85, false), { warn: true, warned: true });   // first crossing: warn + arm
  assert.deepEqual(ctxWarnState(92, 85, true), { warn: false, warned: true });    // still high, already warned: quiet
  assert.deepEqual(ctxWarnState(40, 85, true), { warn: false, warned: false });   // dropped (/clear,/compact): disarm
});

test("usageByWorkspace groups by cwd across projects and filters by month", () => {
  const { usageByWorkspace } = require("../stats.js");
  const base = path.join(os.tmpdir(), `cpm-ws-${process.pid}`);
  const mk = (proj, lines) => {
    const dir = path.join(base, proj);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  };
  const u = (cwd, ts) => ({ type: "user", cwd, timestamp: ts, message: { content: "hi" } });
  const opus1M = asstLine("claude-opus-4-8", { input_tokens: 1_000_000, output_tokens: 0 }); // $5
  mk("projA", [u("/work/alpha", "2026-06-15T10:00:00Z"), opus1M]);                    // June $5
  mk("projB", [u("/work/beta", "2026-06-20T10:00:00Z"), opus1M,
               u("/work/beta", "2026-05-10T10:00:00Z"), opus1M]);                     // June $5 + May $5

  const jun = usageByWorkspace("2026-06", undefined, base);
  assert.equal(jun.workspaces.length, 2);
  assert.equal(jun.total.prompts, 2);                       // May prompt excluded by month filter
  assert.ok(Math.abs(jun.total.cost - 10) < 0.02);
  assert.deepEqual(jun.workspaces.map((w) => w.name).sort(), ["alpha", "beta"]);
  assert.ok(Math.abs(jun.workspaces.find((w) => w.name === "beta").cost - 5) < 0.02); // beta June only

  const all = usageByWorkspace(null, undefined, base);       // all-time: includes May
  assert.equal(all.total.prompts, 3);
  assert.ok(Math.abs(all.total.cost - 15) < 0.02);
});

test("allSessions counts each session only after its own reset marker", () => {
  const f = fixture([
    userLine("2026-06-20T10:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 1, output_tokens: 1 }),
    userLine("2026-06-20T12:00:00Z"), asstLine("claude-opus-4-8", { input_tokens: 1, output_tokens: 1 }),
  ]);
  const dir = path.dirname(f);
  const id = path.basename(f, ".jsonl");
  const reset = new Date("2026-06-20T11:00:00Z").getTime();
  // marker keyed by THIS session's id only
  const found = allSessions(dir, { [id]: reset }).find((x) => x.file === f);
  assert.equal(found.promptCount, 1); // only the 12:00 prompt survives this session's reset
  // a session with no marker keeps its full count
  const noMarker = allSessions(dir, {}).find((x) => x.file === f);
  assert.equal(noMarker.promptCount, 2);
  // cost is gated by the marker too (not just the count) — both prompts cost the same
  assert.ok(found.cost > 0 && Math.abs(noMarker.cost - 2 * found.cost) < 1e-9);
});
