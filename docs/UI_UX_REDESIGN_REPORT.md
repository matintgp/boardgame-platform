# UI/UX Redesign Final Report — Phases 0–10

**Repo:** boardgame-platform
**Date:** 2026-09-05 (Asia/Tehran)
**Branch:** `main` (local ahead of `origin/main`; **not pushed**)
**Stack:** Next.js 15 / React 19 / Tailwind CSS v4 / next-intl (`fa` default + `en`)

Companion baseline: [UI_UX_REDESIGN_AUDIT.md](./UI_UX_REDESIGN_AUDIT.md) (Phase 0).

---


## 1. Goals vs delivered

| Goal (from audit / phase plan) | Delivered? | Notes |
|--------------------------------|------------|--------|
| Design tokens + type scale on shared shell | **Yes** | Semantic surfaces, borders, actions, motion, radius, shadow, type utilities in `globals.css` |
| Premium home / lobby discovery tiles | **Yes** | World-distinct `.game-tile` accents; club-floor lobby rows |
| Wider live-table shell | **Yes** | `.salon-main:has([data-game-table])` → ~`max-w-7xl` |
| Chess club wood theme | **Yes** | `chess.css` wood board/clocks + status shell |
| Mafia noir parlor | **Yes** | Dedicated `mafia.css`, phase banners, clearer roles/actions |
| Rokugan war-table / lacquer depth | **Yes** | Expanded `rokugan.css`, planning/reveal polish |
| Salem premium finish | **Yes** | Phase atmosphere, Town Hall, dock, type-scale (builds on prior Salem overhaul) |
| Chat / voice as salon booths | **Yes** | Shared booth chrome; emoji clutter reduced; chat log a11y |
| Shell a11y (skip link, mobile nav) | **Yes** | Skip link + drawer + Escape; Phase 8 leftover polish (drawer label / `hidden`, seat-bar RTL) |
| `prefers-reduced-motion` for enter / cover hover | **Yes** | Globals block covers enter stagger, card-lift, game-cover, tiles, skip-link, piece-slide |
| Shared `GameChrome` primitive | **No** | Still per-game layout reinvention |
| Friends / Profile dossier (Phase 5 depth) | **Partial / stub** | Type-scale / brand polish only; no presence, history, invite |
| Playwright visual baselines | **No** | Not added |
| Engine / WS / auth / lobby TTL changes | **Intentionally not** | UI-only redesign |

**Honest maturity now:** Salem still leads theme depth; Chess / Mafia / Rokugan are clearly themed club tables rather than bare salon skins; shared shell is coherent (obsidian/brass) with wider game mains.

---

## 2. Major redesign commit SHAs

| SHA (short) | Full SHA | Summary |
|-------------|----------|---------|
| `5d2cf6e` | `5d2cf6e133fee194cbb7c6b0c3bd0b6a7ca2c965` | Design-system tokens + premium home/lobby tiles |
| `1cff495` | `1cff495b521992f8fc61b6e85dfd81fc3a6b5183` | Chess club status shell; auth/profile type-scale |
| `df155d6` | `df155d679f0c44c5cbc1fdb8ed6b260909b248ef` | Phase 0 audit doc |
| `6387f6b` | `6387f6b9eddc498ff8bb76f79c5f0e61569b0be1` | Chess wood board/clocks; friends type-scale; brand mark |
| `df79350` | `df7935051697ee009989991983606781570e36ad` | Wider salon main for live tables |
| `6d629d4` | `6d629d45c35907f0ccd630fe311f1244267d1937` | Skip-link, mobile nav drawer, Escape-close |
| `e41317f` | `e41317f0ff7226f1d7e6b77b299c3c23edca91bd` | Mafia noir parlor (`mafia.css`) |
| `71135db` | `71135dbe7f2b0111092c52c6b10a77b788894fab` | Shared chat booth + Rokugan depth / log a11y |
| `694866f` | `694866f10744fdbb239e62238edcc59c868d5697` | Salem premium phase / Town Hall / dock |
| `2e62301` | `2e62301c2c32cbd674ed3cc71e4424aeaf1f03b7` | Voice booth chrome |
| `94e4350` | `94e435060a5870e2c555f5e15f703db767b3d7cf` | Rokugan war-table planning & reveal |

*(Plus follow-up local commit(s) for this report and motion/a11y polish — see git log on `main`.)*


## 3. Per-screen / per-game before → after

### Shell / platform screens

| Screen | Before (audit) | After |
|--------|----------------|-------|
| **Home** | Obsidian hero but ad-hoc type; generic covers | Token type scale; world-distinct game tiles with per-game accent bars |
| **Auth** | Generic salon card | Type-scale polish; still no branded illustration / forgot-password |
| **Lobby** | Dense list under `max-w-5xl` | Accent table rows, TTL chips, host-cap chrome; still poll-based matchmaking |
| **Friends** | Functional lists; weak a11y search | Type-scale / salon polish only — still a **stub** vs presence/invite |
| **Profile** | Password + rating stub | Type-scale polish — still a **stub** (no history / avatar upload) |
| **Nav / layout** | Wrapping links; no skip link; games squeezed | Skip link; mobile drawer + Escape; wider main when `data-game-table` present |
| **Chat / Voice** | Emoji-heavy side cards | Shared booth styling; chat `role="log"` / `aria-live`; voice matches salon |

### Games

| Game | Before | After |
|------|--------|-------|
| **Chess** | Green/cream functional board | Wood club board/clocks, status shell, piece motion (reduced-motion aware in globals) |
| **Mafia** | Noir sketch in `globals.css`, emoji seats | Dedicated `mafia.css`, phase banners, clearer role/action UI |
| **Rokugan** | Thin lacquer (~190 LOC CSS) | War-table depth, planning/reveal polish, expanded CSS |
| **Salem** | Already strongest | Further phase atmosphere, Town Hall & dock polish, premium type |

---

## 4. Design system tokens introduced

Defined primarily in `frontend/src/app/globals.css` `:root`:

- **Surfaces:** `--surface-canvas|base|raised|overlay|sunken`
- **Text:** `--text-primary|secondary|muted|disabled`
- **Borders:** `--border-subtle|default|strong`
- **Actions / game states:** `--action-primary|danger|success|warning`, `--game-focus|selected|target|invalid`
- **Space / radius / shadow:** `--space-*`, `--radius-*`, `--shadow-*`
- **Motion:** `--motion-instant|fast|normal|slow|reveal`, `--ease-standard|enter|exit|impact`
- **Type:** `--type-display|h1|h2|h3|body|body-sm|label|caption|status` (+ `.type-*` utilities)
- **Theme accents:** `--theme-chess|mafia|rokugan|salem`
- **Compat aliases:** `--bg`, `--surface`, `--border`, `--accent`, `--text`, `--muted`, `--gold-line|soft`

Per-game packages remain: `styles/chess.css`, `mafia.css`, `rokugan.css`, `salem.css` (scoped tokens / atmospheres).

---

## 5. A11y / RTL / responsive notes

**Done in shell**

- `html[lang]` / `dir` from locale (`fa` → RTL).
- Skip link → `#main-content` (`tabIndex={-1}` on `<main>`).
- Mobile nav drawer (≤720px), `aria-expanded` / `aria-controls`, Escape closes and restores focus; drawer stays mounted with `hidden` for stable ids; dialog label is Menu / منو.
- Focus-visible on `.btn` / `.input` / links / summaries.
- Chat log: `role="log"`, `aria-live="polite"`.
- Logical properties widely used (`inset-inline`, `padding-inline`, `ps`/`pe` on profile chip).
- Lobby seat fill gradient uses `to inline-end` (RTL-safe).
- Kickers / display type reduce letter-spacing under `html[dir="rtl"]`.
- `prefers-reduced-motion: reduce` kills enter stagger, result/confetti/trophy/mm-ring, card-lift + game-cover hover scale, game-tile transform, skip-link transition, piece-slide; urgent lobby TTL pulse also disabled.

**Remaining gaps**

- Friends search still not a full combobox pattern.
- Result / rematch modals still lack consistent `role="dialog"` + focus trap across games.
- Many in-game icon controls incomplete for keyboard maps.
- No shared GameChrome (connection / leave / rules / sound).
- Playwright / Lighthouse baselines not checked in CI.


## 6. Known remaining gaps

1. Friends stub — no presence, invite-to-lobby, or accessible search listbox.
2. Profile stub — no match history, per-game ratings dossier, avatar upload.
3. No shared GameChrome component yet.
4. Playwright visual baselines not added.
5. Post-game lounge inconsistent across games.
6. Auth depth incomplete (no recovery flow / branded art).
7. Matchmaking still client poll under the hood.
8. No React Button/Input/Modal/Toast primitives yet.
9. bun.lock intentionally untracked.

---

## 7. What was NOT changed

- Game engines / action contracts / visible_state secrecy rules
- WebSocket protocol (JWT first frame, sync/subscribe, chat)
- Auth cookies / refresh rotation model
- Lobby TTL rules (10-minute expiry, max 2 open lobbies, Celery cleanup)
- Rematch consent (joinRematchTable) semantics
- Server authority (no client move validation)
- Salem asset licensing discipline (public/salem/CREDITS.md)
---

## 8. Phase 10 QA snapshot

Build: ok (Next production compile + types)
Typecheck: ok
Backend suite: skipped in this env

---

## 9. Suggested next steps

1. Extract shared GameChrome and migrate all four games onto it.
2. Deepen Friends (presence + invite) and Profile (history / per-game ratings).
3. Unify post-game lounge + dialog a11y (focus trap).
4. Add Playwright smoke + screenshot baselines for fa and en.
5. Optional React primitives (Button, Input, Modal, Toast) on tokens.
6. Install backend dev extras in CI; keep engine and secret-event tests green.

End of report.

Finish-pass commits on this branch tip:
- 9246f34efbedcd3a96d29c5aa3f6869c65f5c1d6 — UI/UX: motion/a11y polish
- (this docs commit) — docs: UI/UX redesign final report
