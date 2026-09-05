# Chess vs Bot — UX Specification (Phase A)

**Repo:** boardgame-platform  
**Branch:** `feature/chess-bot-mode` (base `4da141b`)  
**Owner:** BG UI/UX  
**Status:** Spec + original assets only — **no** Stockfish / ChessEngine / `game_service` changes in this phase.  
**Out of scope for this doc’s implementers:** auth, CORS, rate-limit.

---

## 0. Design principles

1. **Premium chess club** — walnut / ivory / brass; restrained gold glow; match existing redesign tokens in `frontend/src/app/globals.css` and `frontend/src/styles/chess.css`.
2. **Same family as live Chess** — reuse `.game-layout`, `.chess-root`, `.chess-board-shell`, `.chess-status`, player rows, clocks, result / rematch patterns. Bot mode is a *table variant*, not a new product skin.
3. **Setup as a polished surface** — modal or dedicated panel with medallion cards, not SaaS form spam (no dense select stacks, no wizard chrome).
4. **Readable at a glance** — persona cards work at ~120–160px; avatars remain legible at **32–48px** in-game.
5. **Bilingual by default** — FA RTL + EN LTR; every user-facing string has an i18n key (Frontend wires `fa.json` / `en.json`).
6. **Honest about the opponent** — always show a **BOT** badge; never imply a human or rated ladder opponent.

**Token anchors (do not invent a parallel palette):**

| Role | Token / value |
|------|----------------|
| Canvas / panels | `--surface-canvas`, `--surface-raised`, `--surface-overlay` |
| Brass accent | `--action-primary` `#d4a24e`, `--gold-line`, `--theme-chess` |
| Board | `--chess-light` `#e8dcc0`, `--chess-dark` `#5a4630` |
| Type / radius / motion | `--type-*`, `--radius-*`, `--motion-*`, `--ease-*` |
| Layout | `.game-layout` / `__primary` / `__rail`; `--shell-game` |

---

## 1. User journey (happy path)

```
Lobby Chess tile
  → choose “Play vs Bot” (secondary to “Play Online”)
  → Bot setup surface opens
  → pick persona (difficulty) + color (White / Black / Random)
  → Start
  → brief loading (“Preparing the table…”)
  → in-game: same Chess chrome; bot identity + BOT badge on opponent row
  → play; bot-thinking indicator on bot’s turn
  → result modal
  → Rematch (same persona + color preference) or Back to lobby / Change bot
```

**Abort / error paths:** setup cancel → lobby; start failure → inline error on setup + Retry; disconnect mid-bot game → existing Chess reconnect copy (Backend defines bot seat persistence).

---

## 2. Lobby entry (without cluttering the Chess tile)

### Goal
Expose **Play Online** and **Play vs Bot** without turning the Chess mode card into a button farm.

### Recommended pattern
Keep the existing Chess **game tile / mode card** visual weight (cover, kicker, tagline).

Inside the Chess card’s **action cluster** (same row as today’s Create / Quick Match):

| Control | Priority | Style |
|---------|----------|--------|
| **Play Online** | Primary | Existing quick-match / create affordance language (primary brass button or orb + “Create table”) |
| **Play vs Bot** | Secondary | Ghost / outline brass button, or text+icon link under primary actions |

**Do not:**
- Add a second Chess tile.
- Split Chess into two lobby sections.
- Put bot CTA on Home heroes (optional later; Phase A = lobby only).

**Microcopy (EN):** `Play Online` · `Play vs Bot`  
**Microcopy (FA):** keys listed in §15 (e.g. «بازی آنلاین» · «بازی با ربات»).

**Focus order:** Play Online → Play vs Bot → other card chrome.

---

## 3. Setup surface

### Presentation
- **Desktop:** centered modal (`role="dialog"`, `aria-modal="true"`) over dimmed lobby, or full-width **setup panel** replacing the open-tables list briefly. Prefer **modal** for focus trap + clear cancel.
- **Mobile:** bottom sheet / full-screen sheet with same content hierarchy.
- Visual: dark wood panel, brass hairline (`--gold-line`), soft radial brass wash (same language as `.chess-board-shell`), `--radius-modal`.

### Hierarchy (top → bottom)
1. **Title** — “Play vs Bot” + short subtitle (“Choose your opponent. No rating. Local club table.”).
2. **Persona grid** — 6 cards (see §4); single-select; selected = `--shadow-selected` / brass ring.
3. **Color chooser** — White / Black / Random segmented control (§5).
4. **Primary CTA** — “Start game” (disabled until persona selected; Random color OK).
5. **Secondary** — “Cancel” / close (Esc).

### Anti-patterns
- Long forms, difficulty sliders, Elo number inputs, “advanced engine options”.
- Eval / depth / multipv controls (non-goals).

---

## 4. Six persona cards

Each card = circular medallion avatar + display name + one-line flavor + difficulty hint.

| ID | Asset | Display name (EN) | Flavor (EN) | Tier |
|----|-------|-------------------|-------------|------|
| `pawn` | `pawn.svg` | Pawn Bot | Learning the board | 1 — easiest |
| `knight` | `knight.svg` | Knight Bot | Curious and bold | 2 |
| `bishop` | `bishop.svg` | Bishop Bot | Quiet pressure | 3 |
| `rook` | `rook.svg` | Rook Bot | Solid club player | 4 |
| `queen` | `queen.svg` | Queen Bot | Sharp and ambitious | 5 |
| `king` | `king.svg` | King Bot | Full club strength | 6 — hardest |

**Card anatomy**
- Avatar: 56–72px on setup; uses `/chess/bots/{id}.svg`.
- Title: `--type-h3`, brass on select.
- Flavor: `--type-caption` / `--text-muted`.
- Optional subtle tier pips (1–6) under flavor — decorative only; Backend maps ID → strength.

**Selection:** one persona; click/tap or keyboard (arrows within radiogroup).  
**Default:** none selected → CTA disabled; or soft-default **Knight** if product wants one-click start (Frontend choice; if default, announce via `aria-describedby`).

---

## 5. Difficulty hierarchy

Strict ascending strength: **Pawn → Knight → Bishop → Rook → Queen → King**.

- UI never shows raw Stockfish depth/Skill Level numbers to players.
- Backend owns numeric mapping; UI only sends persona `id` (and color).
- Optional helper under grid: “Higher pieces play stronger.” (i18n).

---

## 6. Color chooser

Segmented control (3 options), equal visual weight:

| Value | EN | Behavior |
|-------|-----|----------|
| `white` | White | Player seat White; bot Black |
| `black` | Black | Player seat Black; board flipped as today |
| `random` | Random | Client or server flips a coin once at start; show resulting color in loading / first paint |

**A11y:** `role="radiogroup"` + `aria-label` “Your color”; each option `role="radio"`.  
**Visual:** ivory / ebony / brass-shuffle iconography (simple glyphs, not new art pack).

---

## 7. Start / loading / error

### Start
1. Client validates persona + color.
2. Calls Backend bot-game create API (contract owned by Backend; UI payload sketch: `{ game_type: "chess", mode: "bot", persona, color }`).
3. Disable CTA; show loading state on button (“Starting…”) and optional overlay.

### Loading
- Short club line: “Setting the pieces…” / “Preparing the table…”
- Prefer **≤ ~1.5s** perceived wait; reuse existing Chess loading card language if redirecting to `/game/[id]`.

### Error
- Inline alert on setup surface (not only toast): icon + message + **Retry** + keep selections.
- Examples: “Couldn’t start the bot table. Try again.” / network / capacity (Backend messages mapped via i18n when possible).
- Never leave user on a blank game shell.

---

## 8. Bot-thinking state

When it is the bot’s turn:

- Opponent clock / row shows a restrained **thinking** indicator:
  - Soft pulse on avatar ring **or** three brass dots (`aria-live="polite"`: “Bot is thinking”).
  - Honor `prefers-reduced-motion`: static “Thinking…” label, no pulse.
- Do **not** show engine depth, nodes, PV, or eval.
- Human controls remain blocked for moves (same as waiting for opponent); board still shows last move / check banners as today.

---

## 9. In-game identity + BOT badge

### Opponent row
- Avatar: persona SVG (32–40px desktop rail; 28–32px mobile).
- Display name: persona name (e.g. “Rook Bot”), **not** a fake username that looks human.
- **BOT** badge: pill beside name — small brass outline, uppercase EN “BOT” / FA equivalent; optional `bot-badge.svg` as icon-only adornment.
- Rating: omit or show em-dash / “—”. Do not invent Elo.

### Player row
- Unchanged human username + rating as online Chess.

### Status strip
- Reuse `.chess-status` for turn / check; optional suffix when bot thinks.

### Chat / Voice
- **Chat with bot:** non-goal (see §16). Prefer hide or disable ChatPanel for bot tables, or leave collapsed with empty state “No chat at bot tables.”  
- Voice: hide / omit for bot mode (no peer).

---

## 10. Rematch

Post-game: reuse Chess result modal + rematch pattern with bot-specific copy.

| Action | Behavior |
|--------|----------|
| **Rematch** | New bot game, **same persona**; color = previous preference (if Random, re-roll unless product locks last color — recommend **re-roll Random**). |
| **Change opponent** | Close result → reopen setup with last persona preselected. |
| **Back to lobby** | Existing navigation. |

No human rematch-consent banner for bot (bot always “accepts”). If Frontend reuses `joinRematchTable`, Backend should short-circuit consent for `mode=bot`.

---

## 11. Desktop composition

Reuse existing Chess shell:

```
[data-game-table]
  .game-layout
    .game-layout__primary
      status · clocks · .chess-board-shell · promotion / banners
    .game-layout__rail
      identity card (you + bot) · moves list · (no chat/voice or collapsed stub)
```

- Board island stays `dir="ltr"`.
- Width tokens: `--shell-game` / `.chess-board-width` unchanged.
- Identity card: wood/brass panel consistent with `.chess-panel-title` / `.chess-player-row`.

---

## 12. Mobile

- Setup: full-screen or large bottom sheet; persona grid **2×3**; color control sticky above CTA.
- In-game: stack primary board; opponent+you rows above board; bot badge readable; thinking dots near opponent clock.
- Avoid horizontal overflow; touch targets ≥ 44px for persona cards and color chips.
- Rail content folds under board (existing Chess behavior).

---

## 13. FA RTL + EN LTR

| Surface | Direction |
|---------|-----------|
| Setup chrome, titles, buttons, badges | Follow `html[dir]` (RTL for `fa`) |
| Chess board + coordinates | Force `dir="ltr"` (existing) |
| Move list SAN | LTR island recommended |
| BOT badge text | Localized string; keep pill geometry mirrored with logical margins |

Use logical CSS (`margin-inline`, `inset-inline-start`, `text-start`). Avoid physical `left`/`right` for badge placement.

---

## 14. Keyboard / focus / reduced motion

### Keyboard
- Lobby: Tab to Play vs Bot.
- Setup dialog: focus trap; initial focus on first persona or dialog title; Esc closes.
- Personas: arrow keys within radiogroup; Space/Enter select.
- Color radiogroup: arrows.
- Start: Enter activates primary when enabled.
- In-game: existing board keyboard behavior unchanged.

### Focus
- Visible `:focus-visible` rings using `--game-focus` / brass (match `.btn`).
- Selected persona ≠ only color change; include ring/shadow for non-color cues.

### Reduced motion
```css
@media (prefers-reduced-motion: reduce) {
  /* no avatar pulse, no thinking dots animation, no setup enter scale */
}
```
Instant opacity swaps only (`--motion-instant`).

---

## 15. Asset list

| Path | Use |
|------|-----|
| `frontend/public/chess/bots/pawn.svg` | Persona + in-game avatar |
| `frontend/public/chess/bots/knight.svg` | … |
| `frontend/public/chess/bots/bishop.svg` | … |
| `frontend/public/chess/bots/rook.svg` | … |
| `frontend/public/chess/bots/queen.svg` | … |
| `frontend/public/chess/bots/king.svg` | … |
| `frontend/public/chess/bots/bot-badge.svg` | Optional badge glyph |
| `frontend/public/chess/bots/CREDITS.md` | Provenance |

**Style contract:** circular medallion, brass ring, dark wood fill, subtle robotic accent (e.g. small optic / rivet), piece silhouette readable at 32–48px. Same family; slight brass/wood tint shifts by tier.

Sizes: author at 128×128 viewBox; display at 32–72px via CSS.

---

## 16. Explicit non-goals (Phase A / Bot UX)

- **No eval bar**, score gauge, or win% meter.
- **No PV / principal variation**, depth, nodes, or multipv UI.
- **No chat with bot**, LLM commentary, or trash-talk lines.
- **No** downloading or shipping Chess.com / Lichess / commercial bot art.
- **No** Backend Stockfish wiring in this UI phase (Backend owns engine).
- **No** auth / CORS / rate-limit changes.
- **No** rated ladder / Elo for bot games.
- **No** opening-book browser or “coach mode” overlays.

---

## 17. Licenses / provenance

- Persona SVGs are **original project-created** art (see `CREDITS.md`) — treat as CC0 / project-owned for salon use.
- **Stockfish** is GPL; distribution and notices are **Backend’s** `THIRD_PARTY_NOTICES` responsibility — **deferred** from this UX package; do not imply UI owns that compliance.

---

## 18. Suggested i18n keys (Frontend owns wiring)

Namespace suggestion: `lobby.*` for entry + `game.bot.*` (or top-level `chessBot.*`). Sketch:

```
lobby.playOnline
lobby.playVsBot
lobby.botSetupTitle
lobby.botSetupSubtitle
lobby.botStart
lobby.botStarting
lobby.botCancel
lobby.botColorLabel
lobby.botColorWhite
lobby.botColorBlack
lobby.botColorRandom
lobby.botDifficultyHint
lobby.botStartError
lobby.botRetry

game.bot.badge                    // "BOT" / «ربات»
game.bot.thinking                 // "Bot is thinking"
game.bot.preparing                // "Setting the pieces…"
game.bot.rematch
game.bot.changeOpponent
game.bot.noChat
game.bot.noRating

game.bot.persona.pawn.name
game.bot.persona.pawn.flavor
game.bot.persona.knight.name
game.bot.persona.knight.flavor
game.bot.persona.bishop.name
game.bot.persona.bishop.flavor
game.bot.persona.rook.name
game.bot.persona.rook.flavor
game.bot.persona.queen.name
game.bot.persona.queen.flavor
game.bot.persona.king.name
game.bot.persona.king.flavor
```

**EN examples:** see tables in §2–§4.  
**FA:** Frontend provides natural RTL copy in `fa.json` (parity required).

---

## 19. Handoff notes

### Frontend
- Implement lobby CTA, setup dialog, persona cards, color control, loading/error, in-game badge + thinking, rematch variants, i18n, a11y.
- Consume `/chess/bots/*.svg` only; do not hotlink external bot art.
- Keep board / WS move path identical to online Chess once Backend exposes bot tables.

### Backend
- Map persona IDs → engine strength; create bot seats; rematch without human consent; never leak eval/PV to client.
- Stockfish GPL notices in Backend THIRD_PARTY_NOTICES (deferred from this commit).

### QA checklist (short)
- [ ] Chess tile not visually doubled  
- [ ] Setup keyboard + Esc + focus trap  
- [ ] FA RTL layout + LTR board  
- [ ] Avatars crisp at 32px  
- [ ] Thinking respects reduced motion  
- [ ] BOT badge always visible on opponent  
- [ ] No eval/PV/chat-with-bot affordances  
