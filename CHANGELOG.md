# Changelog

All notable changes to "Claude Prompt Meter" will be documented here.

## [0.6.1] - 2026-06-21

### Fixed
- **Cache-write cost was undercounted (~35% of the cache-write line).** Cache writes are billed by TTL — 5-minute at 1.25× input, **1-hour at 2× input** — but every write was priced at 1.25×. Claude Code uses 1-hour caching heavily, so this materially understated cost. Now reads the `cache_creation` split (`ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`) and prices each correctly; falls back to the flat field at 1.25× for older logs. (Cache *reads* were always correct at 0.1×.)

## [0.6.0] - 2026-06-21

### Added
- **Monthly usage across all workspaces.** The dashboard now shows a "Usage" section with this month's total cost/prompts summed across **every** Claude Code project, plus a per-workspace breakdown (the workspace you're in is highlighted). Sessions are grouped by the `cwd` recorded in each log — robust to slug-folder drift — so the total matches a monthly subscription view. Throttled (15s) so it never runs on the hot file-watch path.

## [0.5.0] - 2026-06-21

### Added
- **Sub-agent token & cost accounting.** Work done by sub-agents (Workflow/Agent tool) is now folded into the prompt that spawned them — its tools count, output, and cost include the sub-agents' work, and a `⇲N` badge marks how many landed on that row. Previously a prompt that ran N agents showed only the spawn call, and the agents' (billed) tokens were invisible, undercounting session cost.
- **Exact attribution via runId**, not timestamps — a background agent that finishes after you've typed later prompts still attributes to its real upline prompt.
- **Diagnostics report** — a "Claude Prompt Meter" output channel plus a `Diagnostics (copy report)` command and a 🔍 button on the dashboard. Builds a local (no-network) report of platform/paths/parse status and copies it to the clipboard for bug reports.
- **Context-pressure warning.** A one-time notification when the live session's context window crosses a fill threshold (default 85%) — re-sent history compounds cost every turn, so it's a cue to `/clear` (fresh start) or `/compact` (keep a summary). It fires once per climb and re-arms after the fill drops; the status-bar tooltip also flags the % when over. Configure or disable via `claudePromptMeter.contextWarn.percent` (0 disables).

### Changed
- Cross-platform CI: the test suite now runs on macOS, Windows, and Linux.
- Per-file mtime cache so the dashboard doesn't re-parse unchanged sessions on every refresh.

## [0.4.1] - 2026-06-20

### Changed
- Command Palette titles are now in English under a "Claude Prompt Meter" category (e.g. "Claude Prompt Meter: Open Dashboard").
- Redesigned README: centered hero, badges, table of contents, and clearer English documentation.

## [0.4.0] - 2026-06-20

### Fixed
- **Pricing corrected (cost was undercounted).** Opus 4.8/4.7/4.6 output is $25/M (was $15 — every Opus prompt's cost was ~40% low on output). Fable 5 / Mythos 5 are $10/$50 (were priced as Sonnet $3/$15). All cost surfaces — status bar, dashboard, sparkline, heatmap, budget % — are affected.
- **Stored-XSS hardening.** The HTML escaper now also escapes quotes, so a crafted model id or filename in a session log can't break out of an attribute; added a Content-Security-Policy + script nonce and `localResourceRoots: []` to the webview.
- **Session dropdown cost matches the selected view** — a reset session's option no longer pairs a filtered prompt count with the full (unfiltered) cost.
- **Selecting an old session sticks** — a background refresh no longer yanks the dashboard/status bar back to the live session every ~1.5s. The status bar always reflects the live session; the dashboard keeps your selection.
- Trailing `<synthetic>`/zero-usage log lines no longer zero out the context-fill / "left" display.
- `normalizeModelId` resolves dated (`-20251001`), dotted (`4.6`), and legacy 3-segment ids to the right pricing entry instead of silently falling back.
- Heatmap and session list now honor a user pricing override (were hardcoded to the default).
- Watcher callbacks are guarded (a transient throw can't crash the extension host) and coalesced (150ms debounce); stale file/dir watchers are released instead of leaking across workspace churn.

### Changed
- Removed the legacy `resetTimestamp` global-state key; stopped shipping the internal `INSTALL.md`; README install command is version-agnostic; LICENSE holder corrected to `riwki`.

## [0.3.22] - 2026-06-20

### Fixed
- Hardened the cross-platform workspace→log-folder resolver: the cwd fallback now ignores trailing separators, slash direction, and case, so it reliably finds the session folder on macOS (case-sensitive filesystem) where Claude's folder-name casing can differ from the workspace path.

## [0.3.21] - 2026-06-20

### Changed
- **Reset is now per-session.** It starts a fresh cost/prompt/budget count for the session you're viewing only; every other session keeps its full counts. Previously reset was global and zeroed out every session's count. (Reset can't create a new Claude session file — only Claude does that on /clear — so it's a fresh count within the same session.)

## [0.3.20] - 2026-06-20

### Fixed
- Session dropdown no longer lists the current session twice — the newest session is represented only by the "Current session" entry.

## [0.3.19] - 2026-06-20

### Fixed
- Sparkline no longer balloons to an oversized bar after a reset (or whenever there's a single prompt) — its height is now fixed and centered instead of stretching to fill the card.

## [0.3.18] - 2026-06-20

### Added
- Click the budget card in the dashboard to set/change the daily budget via an input box — no need to open Settings.

## [0.3.17] - 2026-06-20

### Changed
- Sparkline now stretches to match the heatmap's height (cards are equal height) instead of sitting shorter beside it.

## [0.3.16] - 2026-06-20

### Fixed
- Heatmap/sparkline side-by-side proportions: the heatmap now takes only the width its calendar needs (no big empty gap when history is short) and the sparkline fills the rest; still stacks when the panel is narrow.

## [0.3.15] - 2026-06-20

### Added
- Sparkline bars above the average cost are drawn in a deeper coral so pricey prompts stand out.
- Clicking a sparkline bar scrolls to that prompt's row in the table and flashes it.

### Changed
- Heatmap and sparkline now sit side by side and reflow into separate rows when the panel is too narrow (responsive).

## [0.3.14] - 2026-06-20

### Changed
- Heatmap tooltip text made smaller (10.5px) with tighter padding.

## [0.3.13] - 2026-06-20

### Changed
- Heatmap tooltip is compact again (sized to its text, smaller font) instead of spanning the full width, while still capped to the visible width and clamped so it can't overflow the edge.

## [0.3.12] - 2026-06-20

### Changed
- Heatmap now starts at your first day of real usage (clamped to a 4-week minimum and 1-year maximum) instead of always showing a full empty year. The header shows the actual date range displayed (e.g. "May 2026 – Jun 2026"), and it grows automatically as your history builds up.

## [0.3.11] - 2026-06-20

### Fixed
- Heatmap tooltip overflow fixed for good — the tooltip is now pinned to both screen edges (left/right) and wraps to multiple lines when the panel is narrow, instead of relying on width math that could still clip. Works in both the sidebar and the editor panel at any width.

## [0.3.10] - 2026-06-20

### Fixed
- Heatmap tooltip overflow fixed properly — width is now capped to the visible viewport (`clientWidth`, not `100vw`, which included scroll overflow) and the body no longer scrolls horizontally, so the tooltip can't be cropped at the edge.

## [0.3.9] - 2026-06-20

### Fixed
- Heatmap tooltip no longer overflows the edge in the narrow sidebar — it now wraps and is capped to the viewport width (responsive).

## [0.3.8] - 2026-06-20

### Changed
- Heatmap tooltip is now instant on hover (was using the native `title` with its ~1s delay) and can be clicked to pin it open.

## [0.3.7] - 2026-06-20

### Changed
- Heatmap reworked to a proper GitHub-style calendar: full year, month labels across the top, weekday labels (จ/พ/ศ · M/W/F) down the left, scrolls horizontally in the narrow sidebar. Hover shows the full localized date + cost + prompt count.

## [0.3.6] - 2026-06-20

### Added
- **1-year cost heatmap** in the dashboard — a GitHub-contribution-style calendar of daily spend across all sessions in the project. Hover a day for cost + prompt count; days over the daily budget get a red outline.

## [0.3.5] - 2026-06-20

### Changed
- Marketplace logo updated; removed the unused `icon.svg`.

## [0.3.4] - 2026-06-20

### Changed
- Model in the per-prompt table is now a colored dot + plain text instead of a filled pill badge — quieter, blends with the theme while still color-coding by model family.

## [0.3.3] - 2026-06-20

### Added
- **Sidebar dashboard** — a Claude Prompt Meter icon in the Activity Bar opens the full dashboard docked in the sidebar (same view as the editor panel, kept in sync). The status bar meter and "Open Dashboard" command still work as before.

## [0.3.2] - 2026-06-20

### Added
- **Model badge per prompt in the dashboard table** — each row shows the model used (Opus 4.8 / Sonnet 4.6 / …), color-coded by family. This was announced in 0.3.0 but never actually shipped; it is now real. No-response prompts inherit the session's current model (shown dimmed).

### Fixed
- **Slash commands no longer counted as prompts** — `/model`, `/clear`, etc. inject synthetic log lines that were each showing up as phantom $0 prompts; they're now filtered out so prompt counts and the table are accurate
- **Works on any machine** — session log folder is now resolved from the open workspace (was hardcoded to one path), with a cwd-based fallback if the slug doesn't match
- Dashboard no longer crashes on open (stray character in a function name)
- Session dropdown now shows correct cost/prompt counts (was reading only the last 50 log lines)
- Context window is detected as 200k or 1M instead of assuming 1M, so "left" headroom is accurate
- Reset now hides pre-reset prompts correctly (was comparing the wrong field / type, blanking the view)
- File watcher follows new sessions and survives a not-yet-created log folder

### Changed
- Removed scratch/debug files from the packaged extension
- Added a `node --test` self-check for the stats core
- README updated to reflect how data is actually sourced

## [0.3.0] - 2026-06-19

### Added
- **Automatic model detection** — reads model ID from each prompt, applies correct pricing
- Support for all Claude models (Opus 4.8, Sonnet 4.6, Haiku 4.5, Fable 5, Mythos 5, 3.x legacy)
- Model badge in dashboard table (shows which model was used per prompt)
- Daily budget tracking with % used indicator
- Budget alerts in dashboard
- Hover tooltip shows current spend vs budget
- README, CHANGELOG, LICENSE for marketplace readiness

### Changed
- Cost calculation now uses model-specific pricing instead of global config
- Dashboard shows model used per prompt
- Status bar tooltip includes budget context
- Settings pricing now acts as fallback for unknown models

### Fixed
- Dropdown now correctly counts prompts after reset (was showing all prompts)
- Session cost now matches table cost (both use filtered prompts)

## [0.2.0] - 2026-06-18

### Added
- Session dashboard with total tokens, cost, prompt count
- Average cost per prompt calculation
- Bilingual Thai/English toggle
- Reset counter command

### Changed
- Improved cost calculation accuracy
- Better error handling for malformed usage blocks

## [0.1.0] - 2026-06-17

### Added
- Initial release
- Per-prompt token breakdown (input, output, cache read/write)
- Real-time cost calculation
- Configurable pricing for all token types
- Status bar indicator
