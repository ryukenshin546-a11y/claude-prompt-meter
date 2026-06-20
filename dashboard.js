// Self-contained webview HTML — no external CDN, brand coral theme.
const { WINDOW } = require("./stats.js");
const { modelLabel, modelColor } = require("./pricing.js");

const T = {
  th: { title: "Claude Prompt Meter", session: "ภาพรวม Session", cost: "ค่าใช้จ่ายรวม",
        prompts: "พรอมป์", ctxUsed: "บริบทที่ใช้", left: "เหลือ", perPrompt: "แยกราย Prompt",
        heatmap: "การใช้รายวัน", heatLess: "น้อย", heatMore: "มาก", overBudget: "เกินงบ", sparkTitle: "ราคาต่อ prompt",
        col: { n: "#", model: "รุ่น", input: "ส่ง", output: "รับ", tools: "tools", ctx: "บริบท", cost: "ราคา" },
        budget: "งบประมาณวันนี้", noBudget: "ยังไม่ตั้งงบ — คลิกเพื่อกำหนด", budgetEdit: "คลิกเพื่อตั้งงบประมาณ",
        selectSession: "เลือก Session", currentSession: "Session ปัจจุบัน", reset: "รีเซ็ต",
        resetHint: "รีเซ็ต counter (ไม่ลบข้อมูลจริง)", help: "คู่มือ", langSwitch: "EN",
        helpContent: {
          title: "คู่มือการใช้งาน",
          cost: "ค่าใช้จ่าย", costDesc: "คำนวณจาก input + output + cache ตาม pricing ที่ตั้งไว้",
          ctx: "บริบท", ctxDesc: "พื้นที่ที่ session ใช้อยู่ รวม input + cache สูงสุด 1M tokens",
          input: "ส่ง", inputDesc: "Token ที่คุณพิมพ์ส่งไป (เฉพาะของใหม่ ไม่นับ cache)",
          output: "รับ", outputDesc: "Token ที่ AI ตอบกลับ (รวม tool results)",
          tools: "Tools", toolsDesc: "จำนวนครั้งที่เรียก tools เช่น Read, Edit, Bash, Agent, Grep",
          budget: "งบประมาณ", budgetDesc: "งบรายวัน ตั้งผ่าน Ctrl+Shift+P → Claude Prompt Meter: ตั้งงบประมาณรายวัน",
          dropdown: "Dropdown เลือก Session", dropdownDesc: "ดู session เก่าที่ผ่านมาได้",
          reset: "↻ รีเซ็ต", resetDesc: "เริ่มนับใหม่ตั้งแต่จุดนี้ (ไม่ลบข้อมูลจริง แค่ซ่อนของเก่า)",
          lang: "TH/EN", langDesc: "สลับภาษาทันที"
        }
      },
  en: { title: "Claude Prompt Meter", session: "Session Overview", cost: "Total cost",
        prompts: "prompts", ctxUsed: "context used", left: "left", perPrompt: "Per-Prompt Breakdown",
        heatmap: "Daily usage", heatLess: "less", heatMore: "more", overBudget: "over budget", sparkTitle: "Cost / prompt",
        col: { n: "#", model: "model", input: "in", output: "out", tools: "tools", ctx: "ctx", cost: "cost" },
        budget: "Today's budget", noBudget: "no budget set — click to set", budgetEdit: "Click to set budget",
        selectSession: "Select Session", currentSession: "Current session", reset: "Reset",
        resetHint: "Reset counter (won't delete data)", help: "Help", langSwitch: "TH",
        helpContent: {
          title: "User Guide",
          cost: "Cost", costDesc: "Calculated from input + output + cache with configured pricing",
          ctx: "Context", ctxDesc: "Window space session uses, total input + cache, max 1M tokens",
          input: "Input", inputDesc: "Tokens you sent (new tokens only, excluding cache)",
          output: "Output", outputDesc: "Tokens AI replied (including tool results)",
          tools: "Tools", toolsDesc: "Number of tool calls like Read, Edit, Bash, Agent, Grep",
          budget: "Budget", budgetDesc: "Daily limit via Ctrl+Shift+P → Claude Prompt Meter: setBudget",
          dropdown: "Session Selector", dropdownDesc: "View past sessions",
          reset: "↻ Reset", resetDesc: "Start counting from now (no data loss, just hides old)",
          lang: "TH/EN", langDesc: "Switch language instantly"
        }
      },
};

// Escapes &<>"' so it's safe in both text and double-quoted attribute contexts.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : "" + n);

function renderDashboard(stats, { lang = "th", budget = null, usd, sessions = [], resetTs = 0, currentSessionId = null, heatmap = {}, nonce = "" }) {
  const t = T[lang];
  const s = stats.session;
  const prompts = stats.prompts;
  const ctxPct = Math.min(100, (s.ctx / (s.window || WINDOW)) * 100);

  // sparkline of per-prompt cost (inline SVG, no CDN). Bars above the average
  // are drawn in the deeper coral so pricey prompts stand out; click jumps to the row.
  const maxCost = Math.max(...prompts.map((p) => p.cost), 0.0001);
  const avgCost = prompts.length ? prompts.reduce((a, p) => a + p.cost, 0) / prompts.length : 0;
  const bars = prompts
    .map((p, i) => {
      const ht = Math.max(2, (p.cost / maxCost) * 60);
      const fill = p.cost > avgCost ? "#b0502f" : "#cf8e79"; // over-avg deeper, rest muted
      return `<rect class="spk" data-i="${i}" x="${i * 10}" y="${64 - ht}" width="8" height="${ht}" rx="1" fill="${fill}"><title>#${i + 1} · ${usd(p.cost)}</title></rect>`;
    })
    .join("");

  const badge = (p) => {
    const label = modelLabel(p.model);
    if (!label) return `<span class="dim">—</span>`;
    return `<span class="badge${p.inherited ? " inherited" : ""}" title="${esc(p.model)}${p.inherited ? " (inherited)" : ""}">
      <span class="mdot" style="background:${modelColor(p.model)}"></span>${esc(label)}</span>`;
  };

  const rows = prompts
    .map((p, i) => {
      return `<tr id="prow-${i}">
      <td>${i + 1}</td>
      <td>${badge(p)}</td>
      <td>${k(p.input)}</td>
      <td>${k(p.output)}</td>
      <td>${p.calls}</td>
      <td>${k(p.ctx)}</td>
      <td class="cost">${usd(p.cost)}</td>
    </tr>`;
    })
    .reverse() // newest first
    .join("");

  const budgetBlock = budget
    ? (() => {
        const pct = Math.min(100, Math.round((s.cost / budget) * 100));
        const over = s.cost > budget;
        return `<div class="card budget-card" id="budgetCard" title="${t.budgetEdit}">
          <div class="label">${t.budget} <span class="edit-hint">✎</span></div>
          <div class="bigval">${usd(s.cost)} <span class="dim">/ $${budget}</span></div>
          <div class="bar"><div class="fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
          <div class="dim">${pct}%</div>
        </div>`;
      })()
    : `<div class="card budget-card" id="budgetCard" title="${t.budgetEdit}"><div class="label">${t.budget} <span class="edit-hint">✎</span></div><div class="dim">${t.noBudget}</div></div>`;

  const sessionOpts = sessions
    .slice(1) // sessions[0] is the live/newest one — already represented by the "current" option, so don't list it twice
    .map((sess) => {
      const date = new Date(sess.modified).toLocaleString(lang === "th" ? "th-TH" : "en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      const selected = currentSessionId === sess.id ? " selected" : "";
      return `<option value="${esc(sess.id)}"${selected}>${date} · ${sess.promptCount} prompts · ${usd(sess.cost)}</option>`;
    })
    .join("");

  const resetNote = resetTs ? `<span class="dim" style="font-size:11px">(${lang === "th" ? "นับใหม่ session นี้ตั้งแต่" : "this session counted from"} ${new Date(resetTs).toLocaleString(lang === "th" ? "th-TH" : "en-US")})</span>` : "";

  // 1-year cost heatmap, GitHub-contribution layout: month labels on top, weekday
  // labels (Mon/Wed/Fri) on the left, one column per week (Sun→Sat top→bottom).
  const heatBlock = (() => {
    const locale = lang === "th" ? "th-TH" : "en-US";
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Start at the first day with real data, but clamp to [1 year ago, 4 weeks ago]
    // so a brand-new install isn't a wall of empty cells and a long history caps at a year.
    const keys = Object.keys(heatmap).sort();
    const yearAgo = new Date(today); yearAgo.setDate(yearAgo.getDate() - 364);
    const fourWeeks = new Date(today); fourWeeks.setDate(fourWeeks.getDate() - 27);
    let start = keys.length ? new Date(keys[0] + "T00:00:00") : new Date(fourWeeks);
    if (start < yearAgo) start = new Date(yearAgo);
    if (start > fourWeeks) start = new Date(fourWeeks);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay()); // back to the Sunday that starts that week

    const days = [];
    let max = 0.0001;
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const e = heatmap[ymd(d)] || { cost: 0, prompts: 0 };
      if (e.cost > max) max = e.cost;
      days.push({ date: new Date(d), cost: e.cost, prompts: e.prompts });
    }
    const weeks = Math.ceil(days.length / 7);

    const cells = days.map((c) => {
      const lvl = c.cost === 0 ? 0 : (0.18 + 0.82 * (c.cost / max)).toFixed(3);
      const over = budget && c.cost > budget;
      const bg = c.cost === 0 ? "var(--vscode-input-background,#2a2a2a)" : `rgba(176,80,47,${lvl})`;
      const dateStr = c.date.toLocaleDateString(locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      const title = `${dateStr} · ${usd(c.cost)} · ${c.prompts} ${t.prompts}${over ? " · " + t.overBudget : ""}`;
      return `<div class="hc${over ? " over" : ""}" style="background:${bg}" data-tip="${esc(title)}"></div>`;
    }).join("");

    // month label at the first week column where a new month begins
    let lastMonth = -1;
    const months = [];
    for (let w = 0; w < weeks; w++) {
      const d = days[w * 7] && days[w * 7].date;
      if (!d) continue;
      if (d.getMonth() !== lastMonth) {
        months.push(`<span style="grid-column:${w + 1}">${d.toLocaleDateString(locale, { month: "short" })}</span>`);
        lastMonth = d.getMonth();
      }
    }
    const dow = (i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: "narrow" }); // Jan 7 2024 = Sunday
    const dows = [1, 3, 5].map((i) => `<span style="grid-row:${i + 1}">${dow(i)}</span>`).join("");

    const mY = (d) => d.toLocaleDateString(locale, { month: "short", year: "numeric" });
    const range = `${mY(start)} – ${mY(today)}`;
    return `<h2>${t.heatmap} <span class="heat-range">(${range})</span></h2>
      <div class="heat-wrap">
        <div class="heat-months" style="grid-template-columns:repeat(${weeks},12px)">${months.join("")}</div>
        <div class="heat-body">
          <div class="heat-dows">${dows}</div>
          <div class="heat" style="grid-template-columns:repeat(${weeks},12px)">${cells}</div>
        </div>
      </div>
      <div class="heat-legend"><span>${t.heatLess}</span>
        <span class="hc" style="background:var(--vscode-input-background,#2a2a2a)"></span>
        <span class="hc" style="background:rgba(176,80,47,.35)"></span>
        <span class="hc" style="background:rgba(176,80,47,.65)"></span>
        <span class="hc" style="background:rgba(176,80,47,1)"></span>
        <span>${t.heatMore}</span></div>`;
  })();

  const h = t.helpContent;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}';">
    <style>
    :root { --coral:#b0502f; --coral-soft:#c46849; }
    body { font-family:'DM Sans','Prompt',system-ui,sans-serif; padding:18px; color:var(--vscode-foreground);
           background:var(--vscode-editor-background); overflow-x:hidden; }
    h1 { font-size:18px; margin:0 0 4px; display:flex; align-items:center; gap:8px; }
    h1 .dot { color:var(--coral); }
    .toolbar { display:flex; gap:8px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
    select { background:var(--vscode-input-background); color:var(--vscode-input-foreground);
             border:1px solid var(--vscode-input-border); border-radius:4px; padding:6px 10px;
             font-size:13px; min-width:200px; }
    button { background:var(--coral); color:#fff; border:none; border-radius:4px; padding:6px 12px;
             font-size:13px; cursor:pointer; font-family:inherit; }
    button:hover { background:var(--coral-soft); }
    button.secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
    button.secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
    h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; opacity:.7; margin:22px 0 8px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
    .card { border:1px solid var(--vscode-panel-border,#3a3a3a); border-left:3px solid var(--coral);
            border-radius:6px; padding:12px 14px; background:var(--vscode-editorWidget-background); }
    .label { font-size:11px; opacity:.65; text-transform:uppercase; letter-spacing:.05em; }
    .bigval { font-size:22px; font-weight:600; margin-top:4px; }
    .dim { opacity:.55; font-size:12px; }
    .bar { height:8px; border-radius:4px; background:var(--vscode-input-background,#333); margin:8px 0 4px; overflow:hidden; }
    .fill { height:100%; background:var(--coral); }
    .fill.over { background:#d44; }
    svg { background:var(--vscode-editorWidget-background); border-radius:6px; border:1px solid var(--vscode-panel-border,#3a3a3a); }
    table { width:100%; border-collapse:collapse; font-size:13px; margin-top:6px; }
    th,td { text-align:right; padding:6px 10px; border-bottom:1px solid var(--vscode-panel-border,#2a2a2a); }
    th:first-child,td:first-child { text-align:left; }
    th:nth-child(2),td:nth-child(2) { text-align:left; }
    th { font-weight:600; opacity:.7; font-size:11px; text-transform:uppercase; }
    td.cost { color:var(--coral-soft); font-weight:600; }
    .badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; white-space:nowrap; }
    .badge.inherited { opacity:.5; }
    .mdot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
    .viz { display:flex; flex-wrap:wrap; gap:8px 20px; align-items:stretch; }
    .viz-card { min-width:0; display:flex; flex-direction:column; }
    .viz-heat { flex:0 1 auto; max-width:100%; }   /* only as wide as the calendar; scrolls if it grows past the row */
    .viz-spark { flex:1 1 260px; }                 /* fills the remaining width */
    .viz-card h2 { margin-top:8px; }
    .viz-spark svg.spark { height:118px; margin:auto 0; } /* fixed height (≈heatmap), centered; cards stay equal height via stretch */
    svg.spark rect.spk { cursor:pointer; }
    svg.spark rect.spk:hover { opacity:.75; }
    tr.flash td { animation:rowflash 1.3s ease-out; }
    @keyframes rowflash { from { background:rgba(176,80,47,.55); } to { background:transparent; } }
    .budget-card { cursor:pointer; }
    .budget-card:hover { border-color:var(--coral); }
    .budget-card .edit-hint { opacity:.4; font-size:11px; }
    .heat-range { opacity:.5; font-weight:400; text-transform:none; letter-spacing:0; }
    .heat-wrap { overflow-x:auto; padding-bottom:4px; margin:6px 0; }
    .heat-months { display:grid; gap:3px; font-size:9px; opacity:.55; margin-left:17px; margin-bottom:3px; }
    .heat-months span { grid-row:1; white-space:nowrap; }
    .heat-body { display:flex; gap:3px; }
    .heat-dows { display:grid; grid-template-rows:repeat(7,12px); gap:3px; width:14px; font-size:9px; opacity:.55; text-align:center; }
    .heat-dows span { grid-column:1; line-height:12px; }
    .heat { display:grid; grid-auto-flow:column; grid-template-rows:repeat(7,12px); gap:3px; }
    .hc { width:12px; height:12px; border-radius:2px; }
    .hc.over { outline:1.5px solid #d44; outline-offset:-1px; }
    .heat-legend { display:flex; align-items:center; gap:4px; font-size:11px; opacity:.6; margin-top:6px; }
    .heat-legend .hc { display:inline-block; }
    .hc { cursor:pointer; }
    .heat-tip { position:fixed; display:none; z-index:2000; pointer-events:none;
                white-space:normal; word-break:break-word; width:max-content;
                background:var(--vscode-editorHoverWidget-background,#252526); color:var(--vscode-editorHoverWidget-foreground,#ccc);
                border:1px solid var(--vscode-editorHoverWidget-border,#454545); border-radius:4px; padding:2px 6px;
                font-size:10.5px; box-shadow:0 2px 8px rgba(0,0,0,.4); }
    tr:hover td { background:var(--vscode-list-hoverBackground); }
    .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8);
             align-items:center; justify-content:center; z-index:1000; }
    .modal.show { display:flex; }
    .modal-content { background:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border);
                     border-radius:8px; padding:32px; max-width:650px; max-height:90vh; overflow-y:auto; }
    .modal-content h3 { margin:0 0 20px; font-size:18px; color:var(--coral); }
    .modal-close { float:right; font-size:28px; cursor:pointer; opacity:.5; line-height:1; font-weight:300; }
    .modal-close:hover { opacity:1; }
    .help-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:16px; }
    .help-item { border-left:3px solid var(--coral); padding-left:12px; }
    .help-item h4 { margin:0 0 6px; font-size:14px; color:var(--coral); font-weight:600; }
    .help-item p { margin:0; font-size:12px; line-height:1.6; opacity:.9; }
  </style></head><body>
    <h1><span class="dot">●</span> ${t.title}</h1>
    <div class="toolbar">
      <select id="sessionSelect">
        <option value=""${currentSessionId ? "" : " selected"}>${t.currentSession}</option>
        ${sessionOpts}
      </select>
      <button id="resetBtn" title="${t.resetHint}">↻ ${t.reset}</button>
      <button id="langBtn" class="secondary">${t.langSwitch}</button>
      <button id="helpBtn" class="secondary">? ${t.help}</button>
      ${resetNote}
    </div>
    <h2>${t.session}</h2>
    <div class="grid">
      <div class="card"><div class="label">${t.cost}</div><div class="bigval">${usd(s.cost)}</div><div class="dim">${prompts.length} ${t.prompts}</div></div>
      <div class="card"><div class="label">${t.ctxUsed}</div><div class="bigval">${k(s.ctx)}</div>
        <div class="bar"><div class="fill" style="width:${ctxPct}%"></div></div>
        <div class="dim">${ctxPct.toFixed(1)}% · ${k(s.left)} ${t.left}</div></div>
      ${budgetBlock}
    </div>
    <div class="viz">
      <div class="viz-card viz-heat">${heatBlock}</div>
      <div class="viz-card viz-spark">
        <h2>${t.sparkTitle}</h2>
        <svg class="spark" width="100%" height="68" viewBox="0 0 ${Math.max(prompts.length * 10, 100)} 68" preserveAspectRatio="none">${bars}</svg>
      </div>
    </div>
    <h2>${t.perPrompt}</h2>
    <table>
      <thead><tr><th>${t.col.n}</th><th>${t.col.model}</th><th>${t.col.input}</th><th>${t.col.output}</th><th>${t.col.tools}</th><th>${t.col.ctx}</th><th>${t.col.cost}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div id="heat-tip" class="heat-tip"></div>
    <div id="helpModal" class="modal">
      <div class="modal-content">
        <span class="modal-close" id="closeHelp">&times;</span>
        <h3>${h.title}</h3>
        <div class="help-grid">
          <div class="help-item"><h4>${h.cost}</h4><p>${h.costDesc}</p></div>
          <div class="help-item"><h4>${h.ctx}</h4><p>${h.ctxDesc}</p></div>
          <div class="help-item"><h4>${h.input}</h4><p>${h.inputDesc}</p></div>
          <div class="help-item"><h4>${h.output}</h4><p>${h.outputDesc}</p></div>
          <div class="help-item"><h4>${h.tools}</h4><p>${h.toolsDesc}</p></div>
          <div class="help-item"><h4>${h.budget}</h4><p>${h.budgetDesc}</p></div>
          <div class="help-item"><h4>${h.dropdown}</h4><p>${h.dropdownDesc}</p></div>
          <div class="help-item"><h4>${h.reset}</h4><p>${h.resetDesc}</p></div>
          <div class="help-item"><h4>${h.lang}</h4><p>${h.langDesc}</p></div>
        </div>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const select = document.getElementById('sessionSelect');
      const resetBtn = document.getElementById('resetBtn');
      const langBtn = document.getElementById('langBtn');
      const helpBtn = document.getElementById('helpBtn');
      const helpModal = document.getElementById('helpModal');
      const closeHelp = document.getElementById('closeHelp');

      select.addEventListener('change', e => {
        if (e.target.value) {
          select.disabled = true;
          select.style.opacity = '0.5';
          vscode.postMessage({ command: 'selectSession', id: e.target.value });
          setTimeout(() => { select.disabled = false; select.style.opacity = '1'; }, 2000);
        }
      });

      resetBtn.addEventListener('click', () => {
        resetBtn.disabled = true;
        vscode.postMessage({ command: 'reset' });
        setTimeout(() => { resetBtn.disabled = false; }, 1000);
      });

      langBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'toggleLang' });
      });

      helpBtn.addEventListener('click', () => {
        helpModal.classList.add('show');
      });

      closeHelp.addEventListener('click', () => {
        helpModal.classList.remove('show');
      });

      helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.classList.remove('show');
      });

      // Heatmap tooltip: instant on hover (no native title delay), click to pin.
      const heatEl = document.querySelector('.heat');
      const tip = document.getElementById('heat-tip');
      let pinned = false;
      // Click the budget card -> open the input box (no Settings needed).
      const budgetCard = document.getElementById('budgetCard');
      if (budgetCard) budgetCard.addEventListener('click', () => vscode.postMessage({ command: 'setBudget' }));

      // Click a sparkline bar -> scroll its table row into view and flash it.
      const spark = document.querySelector('svg.spark');
      if (spark) spark.addEventListener('click', (e) => {
        const i = e.target.getAttribute && e.target.getAttribute('data-i');
        if (i == null) return;
        const row = document.getElementById('prow-' + i);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
      });

      // Compact tooltip sized to its text, capped so it's never wider than the
      // visible width (clientWidth), then clamped — so its right edge can't overflow.
      const showTip = (el) => {
        const vw = document.documentElement.clientWidth;
        tip.textContent = el.dataset.tip;
        tip.style.maxWidth = Math.min(360, vw - 16) + 'px';
        tip.style.left = '0px'; tip.style.top = '0px';
        tip.style.display = 'block';
        const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
        const x = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), vw - tr.width - 8);
        const y = r.top - tr.height - 6;
        tip.style.left = x + 'px';
        tip.style.top = (y < 4 ? r.bottom + 6 : y) + 'px';
      };
      const hideTip = () => { tip.style.display = 'none'; };
      if (heatEl) {
        heatEl.addEventListener('mouseover', (e) => { if (!pinned && e.target.dataset.tip) showTip(e.target); });
        heatEl.addEventListener('mouseout', () => { if (!pinned) hideTip(); });
        heatEl.addEventListener('click', (e) => { if (e.target.dataset.tip) { pinned = true; showTip(e.target); e.stopPropagation(); } });
        document.addEventListener('click', () => { pinned = false; hideTip(); });
      }
    </script>
  </body></html>`;
}

module.exports = { renderDashboard };
