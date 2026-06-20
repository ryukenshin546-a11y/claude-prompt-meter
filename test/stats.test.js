// Minimal self-check for the stats core. Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sessionStats, allSessions, costByDay } = require("../stats.js");
const { modelLabel, normalizeModelId, getPricingForModel, MODEL_PRICING } = require("../pricing.js");

// Build a fake session file from JSONL lines and return its path.
function fixture(lines) {
  const p = path.join(os.tmpdir(), `cpm-test-${process.pid}-${lines.length}.jsonl`);
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
