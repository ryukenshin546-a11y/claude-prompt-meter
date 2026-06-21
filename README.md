<div align="center">

<img src="icon.png" alt="Claude Prompt Meter" width="96" height="96"/>

# 💳 Claude Prompt Meter

### See exactly what **every Claude Code prompt costs** — right in your status bar.

**English** · [ไทย](README.th.md)

Per‑prompt token & cost breakdown, a session dashboard with a one‑year spend heatmap,
automatic per‑model pricing, daily budgets, and a bilingual **Thai / English** UI.
All from Claude Code's own local logs — **no API key, no network, no telemetry.**

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/ryukenshin546-a11y.claude-prompt-meter?label=VS%20Marketplace&color=b0502f&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=ryukenshin546-a11y.claude-prompt-meter)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/ryukenshin546-a11y.claude-prompt-meter?color=43853d)](https://marketplace.visualstudio.com/items?itemName=ryukenshin546-a11y.claude-prompt-meter)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/ryukenshin546-a11y.claude-prompt-meter)](https://marketplace.visualstudio.com/items?itemName=ryukenshin546-a11y.claude-prompt-meter&ssr=false#review-details)
[![Open VSX](https://img.shields.io/open-vsx/v/ryukenshin546-a11y/claude-prompt-meter?label=Open%20VSX&color=8a5cb0)](https://open-vsx.org/extension/ryukenshin546-a11y/claude-prompt-meter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-43853d.svg)](#-requirements--platform-support)
[![Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen.svg)](#-privacy)
[![UI: Thai · English](https://img.shields.io/badge/UI-Thai%20%C2%B7%20English-8a5cb0.svg)](#-usage)

<br/>

<img src="assets/statusbar.png" alt="The status bar meter: sent, received, context, tool calls, context left, and this prompt's cost — updated live" width="100%"/>

<sub>The status bar, updated live as Claude Code works. Click it to open the dashboard.</sub>

</div>

---

## 📑 Table of contents

- [What is this?](#-what-is-this)
- [Features](#-features)
- [Installation](#-installation)
- [Usage](#-usage)
- [How it works](#-how-it-works)
- [Pricing & models](#-pricing--models)
- [Settings](#-settings)
- [How reset works](#-how-reset-works)
- [Privacy](#-privacy)
- [Requirements & platform support](#-requirements--platform-support)
- [FAQ](#-faq)
- [License](#-license)

---

## 👋 What is this?

[Claude Code](https://claude.com/claude-code) writes a detailed log of every session to
your machine (one `*.jsonl` file per session). Those logs contain the exact token usage
Anthropic bills you for — input, output, and cache reads/writes — for every roundtrip.

**Claude Prompt Meter reads those logs and turns them into numbers you can actually use:**
what each prompt cost, how much you've spent today, which prompts were expensive, and how
your spend trends over the year. It never talks to the API — it just reads files Claude
Code already wrote.

> ℹ️ Unofficial community project. **Not affiliated with Anthropic.** It only *reads*
> Claude Code's local logs; it never modifies them and never sends anything anywhere.

---

## ✨ Features

| | |
|---|---|
| 💳 **Per‑prompt cost** | Every prompt's input / output / cache tokens **and** USD cost, live in the status bar. |
| 🏷️ **Automatic model pricing** | Detects the model used in each prompt (Opus 4.8, Sonnet 4.6, Haiku 4.5, Fable 5, …) and applies the correct rate — even if you switch models mid‑session. |
| 📊 **Session dashboard** | Opens in the editor **or** docks in the sidebar (Activity Bar). Totals, per‑prompt table, and model badges. |
| 🗓️ **One‑year cost heatmap** | A GitHub‑style calendar of daily spend across all your sessions. Hover any day for the exact cost. Over‑budget days get a red outline. |
| 📈 **Cost sparkline** | A bar per prompt — pricey prompts (above the session average) stand out darker. **Click a bar to jump to that row.** |
| 🎯 **Daily budget** | Set a daily USD budget and watch the % used. **Click the budget card** to change it — no Settings needed. |
| 🔁 **Per‑session reset** | Start a fresh count for the session you're viewing without touching any other session. |
| 🌐 **Bilingual** | Toggle Thai / English instantly. |

---

## 🖼️ The dashboard

<div align="center">
<img src="assets/dashboard.png" alt="The dashboard: total cost, context-used and budget cards, a daily-spend heatmap, a per-prompt cost sparkline, and a per-prompt table with color-coded model badges" width="100%"/>
</div>

Overview cards, a one‑year **spend heatmap**, a per‑prompt **cost sparkline** (click a bar
to jump to its row), and a **per‑prompt table** with color‑coded model badges — all from
your local logs. Open it in the editor or dock it in the sidebar.

---

## 📦 Installation

### From the Marketplace

1. Open **Extensions** (`Ctrl/Cmd + Shift + X`)
2. Search **“Claude Prompt Meter”**
3. Click **Install**

### From a `.vsix`

```bash
code --install-extension claude-prompt-meter-*.vsix
```

Then **reload the window** (`Ctrl/Cmd + Shift + P` → **Developer: Reload Window**) and open
a folder you use with Claude Code. The meter appears in the status bar automatically.

---

## 🚀 Usage

Open the **Command Palette** (`Ctrl/Cmd + Shift + P`) and type *Claude Prompt Meter*:

| Command | What it does |
|---|---|
| **Open Dashboard** | Full dashboard in the editor (also: click the status‑bar meter, or the gauge icon in the Activity Bar). |
| **Set Daily Budget** | Enter a USD amount (leave blank to remove). Also reachable by clicking the budget card. |
| **Reset Counter** | Start counting this session from now (see [How reset works](#-how-reset-works)). |
| **Toggle Language (Thai / English)** | Switch the UI language instantly. |
| **Refresh** | Re‑read the logs (rarely needed — it updates on its own). |

Everything updates live (within ~1.5 s) as Claude Code writes to the session log.

---

## 🧠 How it works

```text
~/.claude/projects/<your-workspace>/<session-id>.jsonl
        │
        ├─ reads token usage + model from each "usage" block
        ├─ groups roundtrips back into the prompt that triggered them
        ├─ prices each token type by the model that produced it
        └─ renders the status bar, dashboard, heatmap & sparkline
```

The workspace's log folder is resolved automatically from the folder you have open, so the
same build works on any machine and for any user — there is no path to configure.

---

## 💰 Pricing & models

Pricing is **detected per prompt** from the model recorded in the log, so a session that
switches from Sonnet to Opus is costed correctly throughout. Rates (USD per 1M tokens):

| Model | Input | Output |
|---|---:|---:|
| Opus 4.8 / 4.7 / 4.6 | $5 | $25 |
| Sonnet 4.6 / 4.5 | $3 | $15 |
| Haiku 4.5 | $1 | $5 |
| Fable 5 / Mythos 5 | $10 | $50 |
| Legacy 3.x (Opus / Sonnet / Haiku) | — | — |

Cache‑read and cache‑creation tokens are priced at each model's standard cache rates. For
unknown or custom models, the fallback rates in **Settings** are used.

---

## ⚙️ Settings

**Settings → Extensions → Claude Prompt Meter**

| Setting | Default | Description |
|---|---|---|
| `claudePromptMeter.budget.dailyUsd` | `null` | Daily budget in USD; shown as a % in the tooltip and dashboard. |
| `claudePromptMeter.pricing.inputPerMillion` | `3` | Fallback input rate for **unknown** models. |
| `claudePromptMeter.pricing.outputPerMillion` | `15` | Fallback output rate. |
| `claudePromptMeter.pricing.cacheReadPerMillion` | `0.3` | Fallback cache‑read rate. |
| `claudePromptMeter.pricing.cacheCreatePerMillion` | `3.75` | Fallback cache‑write rate. |

> 💡 You normally don't need to touch pricing — known models are priced automatically. The
> fallback only kicks in for a model the extension doesn't recognize.

---

## 🔁 How reset works

Reset is **non‑destructive and per‑session.** It records a timestamp for the session you're
viewing and simply *hides* the prompts before it, so the cost/budget counters start fresh
from that point.

- ✅ Only affects the session you're looking at — every other session keeps its full totals.
- ✅ Never deletes or edits any log file.
- ✅ Survives reloads and restarts.

> ℹ️ The extension can't create a new Claude session (only Claude Code does that on
> `/clear`), so reset is a *fresh count within the same session*, not a new entry in the
> session dropdown.

---

## 🔒 Privacy

- **No network calls.** The extension never contacts the Anthropic API or any server.
- **No telemetry.** Nothing is collected or sent.
- **Read‑only.** It only reads Claude Code's local `*.jsonl` logs; it never writes to them.
- All settings (language, budget, resets) live in your own VS Code profile.

---

## 🖥️ Requirements & platform support

- **VS Code 1.95** or newer.
- **Claude Code** — the data comes from its session logs under `~/.claude/projects`.

> ⚠️ **Platform support — please read.** Development and testing have been on **Windows**.
> macOS and Linux are fully supported in the code (the log folder is resolved by matching
> the recorded working directory, which handles case‑sensitive filesystems), but they are
> **not yet hardware‑tested.** On macOS/Linux, if the meter shows *“waiting…”*, make sure
> the folder you opened is the same one you use with Claude Code. Reports are very welcome.

---

## ❓ FAQ

**The status bar says “waiting…” — why?**
The open folder has no Claude Code session yet, or it isn't the folder you run Claude Code
in. Open the project folder you actually use with Claude Code; the meter appears once a
session log exists.

**Do the numbers match my real Anthropic bill?**
They're computed from the same token counts Anthropic records in the logs, priced at the
published per‑model rates — so they're an accurate estimate of usage‑based cost. They don't
account for plan credits, discounts, or taxes.

**Does it work without an API key?**
Yes. It reads local files only; there's nothing to authenticate.

**Why doesn't the extension show an icon in the sidebar by default?**
It does — a small gauge icon in the **Activity Bar** opens the dashboard. The meter itself
lives in the **status bar** (bottom‑right).

**Can I use it with multiple projects / multiple users?**
Yes. It tracks whichever workspace you have open, and all state is per‑VS Code‑profile, so
different users on the same machine stay separate.

---

## 📄 License

[MIT](LICENSE) © ryukenshin546-a11y

<div align="center"><sub>Built for everyone who's ever wondered “how much did that prompt just cost?”</sub></div>
