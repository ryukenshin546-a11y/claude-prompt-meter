const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { sessionStats, latestJsonl, allSessions, costByDay, findProjectDir, projectDir, sessionCwd, DEFAULT_PRICING, WINDOW } = require("./stats.js");
const { renderDashboard } = require("./dashboard.js");

const L = {
  th: { in: "ส่ง", out: "รับ", ctx: "บริบท", tools: "tools", left: "เหลือ", cost: "ราคา",
        title: "พรอมป์ล่าสุด", roundtrips: "รอบเรียก API", session: "ทั้ง session",
        inDesc: "input ที่คุณพิมพ์ (เฉพาะของใหม่)", outDesc: "output ที่ AI + tools ตอบกลับ",
        ctxDesc: "บริบทที่ session อ่านอยู่ตอนนี้", toolsDesc: "จำนวนครั้งที่เรียก tools",
        leftDesc: "พื้นที่บริบทที่เหลือใน session", costDesc: "ค่าใช้จ่าย prompt นี้ (USD)",
        sessCost: "ค่าใช้จ่ายรวมทั้ง session", openDash: "เปิด Dashboard",
        waiting: "รอข้อมูล…", noSession: "ไม่พบ session", switchTo: "สลับเป็น English",
        setBudgetPrompt: "งบประมาณรายวัน (USD) หรือเว้นว่างเพื่อลบ", invalidBudget: "งบไม่ถูกต้อง",
        resetConfirm: "รีเซ็ต counter (ไม่ลบข้อมูลจริง)?", resetDone: "รีเซ็ตแล้ว — นับใหม่ตั้งแต่ตอนนี้" },
  en: { in: "in", out: "out", ctx: "ctx", tools: "tools", left: "left", cost: "cost",
        title: "Last prompt", roundtrips: "API roundtrips", session: "this session",
        inDesc: "input you typed (new tokens only)", outDesc: "output from AI + tools",
        ctxDesc: "context the session reads now", toolsDesc: "tool calls this prompt",
        leftDesc: "context headroom left", costDesc: "this prompt's cost (USD)",
        sessCost: "total session cost", openDash: "Open Dashboard",
        waiting: "waiting…", noSession: "no session", switchTo: "Switch to Thai",
        setBudgetPrompt: "Daily budget (USD), or leave blank to remove", invalidBudget: "Invalid budget",
        resetConfirm: "Reset counter (won't delete data)?", resetDone: "Reset done — counting from now" },
};

function activate(ctx) {
  const lang = () => ctx.globalState.get("lang", "th");
  // Per-session reset markers: { sessionId: timestampMs }. Resetting only affects
  // the session being viewed; others keep their full counts.
  const resetMarkers = () => ctx.globalState.get("resetMarkers", {});
  const markerFor = (id) => (id && resetMarkers()[id]) || 0;
  const pricing = () => {
    const c = vscode.workspace.getConfiguration("claudePromptMeter.pricing");
    return {
      inputPerMillion: c.get("inputPerMillion", DEFAULT_PRICING.inputPerMillion),
      outputPerMillion: c.get("outputPerMillion", DEFAULT_PRICING.outputPerMillion),
      cacheReadPerMillion: c.get("cacheReadPerMillion", DEFAULT_PRICING.cacheReadPerMillion),
      cacheCreatePerMillion: c.get("cacheCreatePerMillion", DEFAULT_PRICING.cacheCreatePerMillion),
    };
  };
  const dailyBudget = () => vscode.workspace.getConfiguration("claudePromptMeter.budget").get("dailyUsd", null);

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  bar.command = "claudePromptMeter.openDashboard";
  bar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  bar.show();
  ctx.subscriptions.push(bar);

  // Local diagnostics only — no network (a no-network meter shouldn't phone home).
  // Users open this channel / run the Diagnostics command and paste it into a report.
  const out = vscode.window.createOutputChannel("Claude Prompt Meter");
  ctx.subscriptions.push(out);
  const log = (msg) => out.appendLine(`[${new Date().toISOString()}] ${msg}`);

  // Resolve the session dir for whatever workspace is open — works on any machine.
  const resolveDir = () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? findProjectDir(root) : null;
  };

  // One-shot report covering the usual "no data shows up" causes, esp. cross-OS
  // path/slug mismatches: shows the resolved dir, and when it's null, the
  // candidate dirs with the cwd each recorded so a mismatch is obvious.
  const buildDiagnostics = () => {
    const L = [];
    const add = (k, v) => L.push(`${k}: ${v}`);
    add("extension", "claude-prompt-meter v" + (ctx.extension?.packageJSON?.version || "?"));
    add("platform", `${process.platform} ${process.arch}`);
    add("node", process.version);
    add("vscode", vscode.version);
    add("homedir", os.homedir());
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
    add("workspace root", root || "(none open)");
    const base = path.join(os.homedir(), ".claude", "projects");
    add("projects root", `${base} (exists: ${fs.existsSync(base)})`);
    const guess = root ? projectDir(root) : null;
    if (guess) add("slug guess", `${path.basename(guess)} (exists: ${fs.existsSync(guess)})`);
    const resolved = root ? findProjectDir(root) : null;
    add("resolved dir", resolved ? `${resolved} (exists: ${fs.existsSync(resolved)})` : "(null — no project matched this workspace)");
    if (resolved && fs.existsSync(resolved)) {
      let files = [];
      try { files = fs.readdirSync(resolved).filter((f) => f.endsWith(".jsonl")); } catch (e) { add("readdir error", e.message); }
      add("session files", files.length);
      const latest = latestJsonl(resolved);
      if (latest) {
        add("latest file", path.basename(latest));
        try {
          const s = sessionStats(latest, pricing());
          add("parse latest", s ? `OK — ${s.prompts.length} prompts, $${s.session.cost.toFixed(2)}` : "null (no typed prompts found)");
        } catch (e) { add("parse error", e.message + "\n" + (e.stack || "")); }
      }
    } else if (fs.existsSync(base)) {
      add("hint", "no match — candidate project dirs and the cwd each recorded (compare to workspace root above):");
      try {
        for (const d of fs.readdirSync(base).slice(0, 20)) {
          const lf = latestJsonl(path.join(base, d));
          L.push(`  - ${d}  ←  cwd: ${(lf && sessionCwd(lf)) || "(none)"}`);
        }
      } catch (e) { add("scan error", e.message); }
    }
    return L.join("\n");
  };
  ctx.globalState.update("resetTimestamp", undefined); // retire the pre-0.3.21 global reset key

  let dir = resolveDir();
  log(`activated on ${process.platform}; resolved dir: ${dir || "(null)"}`);
  let liveStats = null;        // the newest session — what the status bar always shows
  let liveId = null;           // basename of the file liveStats was parsed from
  let stats = null;            // what the dashboard shows (selected session, or live)
  let sessions = [];
  let currentSessionId = null; // selected session id, or null when viewing live
  let panel = null;            // dashboard opened in the editor area
  let view = null;             // dashboard docked in the sidebar (Activity Bar)

  // id of the session the DASHBOARD shows (anchored to the loaded file, not recomputed live)
  const displayedId = () => currentSessionId || liveId;
  // reset = start a fresh count for the displayed session only
  const doReset = async () => {
    const id = displayedId();
    if (!id) return;
    await ctx.globalState.update("resetMarkers", { ...resetMarkers(), [id]: Date.now() });
  };

  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : "" + n);
  const usd = (n) => "$" + n.toFixed(n < 1 ? 3 : 2);

  // filter a session's prompts by ITS reset marker — prompts after its reset only
  const filterByReset = (s, id) => {
    const ts = markerFor(id);
    if (!ts || !s) return s;
    // prompt timestamps are ISO strings under .ts; the marker is a ms number.
    const filtered = s.prompts.filter(p => new Date(p.ts).getTime() > ts);
    if (!filtered.length) return { ...s, prompts: [], session: { ...s.session, promptCount: 0, cost: 0 } };
    const cost = filtered.reduce((a, p) => a + p.cost, 0);
    return { ...s, prompts: filtered, last: filtered[filtered.length - 1], session: { ...s.session, promptCount: filtered.length, cost } };
  };

  const render = () => {
    const t = L[lang()];
    // Status bar always reflects the LIVE session, independent of any dashboard selection.
    const live = liveStats ? filterByReset(liveStats, liveId) : null;
    if (!live || !live.prompts.length) { bar.text = `$(comment-discussion) ${t.waiting}`; bar.tooltip = t.noSession; }
    else { renderBar(live, t); }
    if (panel || view) {
      const html = dashHtml();
      if (panel) panel.webview.html = html;
      if (view) view.webview.html = html;
    }
  };

  const renderBar = (s, t) => {
    const p = s.last, sess = s.session;
    bar.text =
      `$(arrow-up)${k(p.input)} $(arrow-down)${k(p.output)} ` +
      `$(archive)${k(p.ctx)} $(tools)${p.calls} ` +
      `$(dashboard)${k(sess.left)} $(credit-card)${usd(p.cost)}`;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**${t.title}** · ${p.roundtrips} ${t.roundtrips}\n\n`);
    md.appendMarkdown(`$(arrow-up) **${p.input.toLocaleString()}** — ${t.inDesc}\n\n`);
    md.appendMarkdown(`$(arrow-down) **${p.output.toLocaleString()}** — ${t.outDesc}\n\n`);
    md.appendMarkdown(`$(tools) **${p.calls}** — ${t.toolsDesc}\n\n`);
    md.appendMarkdown(`$(archive) **${p.ctx.toLocaleString()}** / ${(sess.window || WINDOW).toLocaleString()} — ${t.ctxDesc}\n\n`);
    md.appendMarkdown(`$(dashboard) **${sess.left.toLocaleString()}** — ${t.leftDesc}\n\n`);
    md.appendMarkdown(`$(credit-card) **${usd(p.cost)}** — ${t.costDesc}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**${t.session}** · ${sess.promptCount} prompts · **${usd(sess.cost)}** ${t.sessCost}\n\n`);
    const budget = dailyBudget();
    if (budget) {
      const pct = Math.round((sess.cost / budget) * 100);
      md.appendMarkdown(`$(graph) budget: ${usd(sess.cost)} / $${budget} (**${pct}%**)\n\n`);
    }
    md.appendMarkdown(`---\n\n[$(dashboard) ${t.openDash}](command:claudePromptMeter.openDashboard) · `);
    md.appendMarkdown(`[$(globe) ${t.switchTo}](command:claudePromptMeter.toggleLang)`);
    bar.tooltip = md;
  };

  // One dashboard HTML builder + one message handler, shared by the editor panel
  // and the sidebar view.
  const dashHtml = () => {
    if (!stats) return `<!DOCTYPE html><html><body style="padding:14px;font-family:sans-serif;color:var(--vscode-foreground);background:var(--vscode-editor-background)">${L[lang()].waiting}</body></html>`;
    const heatmap = dir && fs.existsSync(dir) ? costByDay(dir, pricing()) : {};
    const nonce = crypto.randomBytes(16).toString("base64");
    return renderDashboard(filterByReset(stats, displayedId()), { lang: lang(), budget: dailyBudget(), usd, sessions, resetTs: markerFor(displayedId()), currentSessionId, heatmap, nonce });
  };
  const onWebviewMsg = async (msg) => {
    if (msg.command === "selectSession") {
      const s = sessions.find(x => x.id === msg.id);
      if (s) { stats = sessionStats(s.file, pricing()); currentSessionId = msg.id; render(); } // lazy: parse only on select
    } else if (msg.command === "reset") {
      await doReset(); render();
    } else if (msg.command === "toggleLang") {
      await ctx.globalState.update("lang", lang() === "th" ? "en" : "th"); render();
    } else if (msg.command === "setBudget") {
      vscode.commands.executeCommand("claudePromptMeter.setBudget"); // reuse the input-box flow
    } else if (msg.command === "diagnostics") {
      vscode.commands.executeCommand("claudePromptMeter.diagnostics");
    }
  };

  // Follow the active session file (poll 1.5s for content growth) and the dir
  // (for new session files), rebinding whenever either changes. Always tears
  // down stale handles so watchers don't leak across dir/file churn.
  let watchedFile = null, watchedDir = null, dirWatcher = null;
  const bindFileWatch = () => {
    if (!dir || !fs.existsSync(dir)) {
      if (watchedFile) { try { fs.unwatchFile(watchedFile); } catch {} watchedFile = null; }
      if (dirWatcher) { try { dirWatcher.close(); } catch {} dirWatcher = null; watchedDir = null; }
      return;
    }
    if (dir !== watchedDir) {
      if (dirWatcher) { try { dirWatcher.close(); } catch {} }
      try { dirWatcher = fs.watch(dir, safeRefresh); watchedDir = dir; } catch {}
    }
    const f = latestJsonl(dir);
    if (f !== watchedFile) {
      if (watchedFile) { try { fs.unwatchFile(watchedFile); } catch {} watchedFile = null; }
      if (f) { fs.watchFile(f, { interval: 1500 }, safeRefresh); watchedFile = f; }
    }
  };

  const refresh = () => {
    if (!dir || !fs.existsSync(dir)) dir = resolveDir(); // (re)resolve lazily
    bindFileWatch();                                     // follow the newest session file
    const f = dir && fs.existsSync(dir) ? latestJsonl(dir) : null;
    liveStats = f ? sessionStats(f, pricing()) : null;
    liveId = f ? path.basename(f, ".jsonl") : null;
    sessions = dir && fs.existsSync(dir) ? allSessions(dir, resetMarkers(), pricing()) : [];
    // Keep showing a still-valid selected session; otherwise follow the live one.
    const sel = currentSessionId && sessions.find(x => x.id === currentSessionId);
    if (sel) stats = sessionStats(sel.file, pricing());
    else { stats = liveStats; currentSessionId = null; }
    render();
  };

  // Watcher callbacks run outside any promise chain — a throw would become an
  // uncaughtException in the extension host. Guard + coalesce bursts (150ms).
  let refreshTimer = null;
  const safeRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      try { refresh(); } catch (e) { log(`refresh failed: ${e.message}\n${e.stack || ""}`); }
    }, 150);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("claudePromptMeter.toggleLang", async () => {
      await ctx.globalState.update("lang", lang() === "th" ? "en" : "th");
      render();
    }),
    vscode.commands.registerCommand("claudePromptMeter.setBudget", async () => {
      const t = L[lang()];
      const current = dailyBudget();
      const val = await vscode.window.showInputBox({
        prompt: t.setBudgetPrompt,
        value: current ? String(current) : "",
        placeHolder: "10",
      });
      if (val === undefined) return;
      const num = val.trim() === "" ? null : parseFloat(val);
      if (num !== null && (isNaN(num) || num <= 0)) {
        vscode.window.showErrorMessage(t.invalidBudget);
        return;
      }
      await vscode.workspace.getConfiguration("claudePromptMeter.budget").update("dailyUsd", num, true);
      render();
    }),
    vscode.commands.registerCommand("claudePromptMeter.reset", async () => {
      const t = L[lang()];
      const ok = await vscode.window.showWarningMessage(t.resetConfirm, { modal: true }, "OK");
      if (ok) {
        await doReset();
        vscode.window.showInformationMessage(t.resetDone);
        render();
      }
    }),
    vscode.commands.registerCommand("claudePromptMeter.refresh", refresh),
    vscode.commands.registerCommand("claudePromptMeter.diagnostics", async () => {
      const report = buildDiagnostics();
      out.appendLine("\n===== DIAGNOSTICS =====\n" + report + "\n=======================");
      out.show(true);
      try { await vscode.env.clipboard.writeText(report); } catch {}
      vscode.window.showInformationMessage("Claude Prompt Meter: diagnostics copied to clipboard — paste it into your bug report.");
    }),
    vscode.commands.registerCommand("claudePromptMeter.openDashboard", () => {
      if (panel) { panel.reveal(); return; }
      panel = vscode.window.createWebviewPanel(
        "claudePromptMeter", "Claude Prompt Meter", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] }
      );
      panel.webview.onDidReceiveMessage(onWebviewMsg);
      panel.onDidDispose(() => { panel = null; });
      sessions = dir && fs.existsSync(dir) ? allSessions(dir, resetMarkers(), pricing()) : [];
      panel.webview.html = dashHtml();
    }),
    vscode.window.registerWebviewViewProvider("claudePromptMeter.dashboardView", {
      resolveWebviewView(wv) {
        view = wv;
        wv.webview.options = { enableScripts: true, localResourceRoots: [] };
        wv.webview.onDidReceiveMessage(onWebviewMsg);
        wv.onDidDispose(() => { view = null; });
        wv.webview.html = dashHtml();
      }
    })
  );

  refresh();

  // Watch the projects root so a brand-new session/dir wakes us up even when
  // the workspace had no session at activation time.
  try {
    const root = path.join(os.homedir(), ".claude", "projects");
    if (fs.existsSync(root)) { const w = fs.watch(root, safeRefresh); ctx.subscriptions.push({ dispose: () => w.close() }); }
  } catch {}
  ctx.subscriptions.push({ dispose: () => { if (refreshTimer) clearTimeout(refreshTimer); if (watchedFile) fs.unwatchFile(watchedFile); if (dirWatcher) dirWatcher.close(); } });
}

exports.activate = activate;
exports.deactivate = () => {};
