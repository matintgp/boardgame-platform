# UI/UX Redesign Audit — Phase 0

**Repo:** boardgame-platform @ `ebbc5d7`  
**Scope:** Frontend inspection only (no gameplay/backend changes).  
**Honest baseline:** Salem is furthest toward premium after recent overhaul commits; Chess / Mafia / Rokugan and shell screens still read as functional salon skins, not 9/10 product UIs.

---

## 1. Current architecture snapshot

| Layer | Stack |
|--------|--------|
| Frontend | Next.js 15 App Router, React 19, Tailwind CSS v4, next-intl (`fa` default + `en`, `localePrefix: "always"`), PWA (`sw.js` + manifest) |
| Design surface | `globals.css` CSS variables + utility classes (`.card`, `.btn`, `.salon-nav`); per-game CSS: `styles/salem.css` (~1.4k LOC), `styles/rokugan.css` (~190 LOC); Mafia cinematic bits live in `globals.css` |
| Games UI | `GameRouter` → `ChessGame` / `MafiaGame` / `RokuganGame` / `SalemGame` (+ `components/salem/*`) |
| Realtime | Memory JWT + WS auth frame; `gameSocket` reconnect/`sync`; chat over WS; LiveKit voice (`VoicePanel`, collapsed by default) |
| Backend engines (registry) | `chess`, `rokugan`, `mafia`, `salem` — server-authoritative; client renders `visible_state` only |

**i18n namespaces** (`messages/{fa,en}.json`, keys in parity ~438 each):  
`app`, `auth`, `lobby`, `game`, `friends`, `profile`, `rokugan`, `chat`, `mafia`, `voice`, `notFound`, `salem` (largest).

**Public assets:** `/heroes` (4 covers), `/pieces` (chess PNGs), `/rokugan/{icons,sounds}`, `/salem/{portraits,icons,sounds,heroes}` + CREDITS, shared `/sounds`.

**Salem engine phases (headers only):** `town_hall` → `dawn` → `day` → `conspiracy` → `night` → `confess` → `over` (tables 4–7 start in `town_hall`).

**Global shell:** `layout.tsx` wraps all routes in sticky `Navbar` + `<main className="… max-w-5xl …">` — games share the salon width; no full-bleed breakout.

---

## 2. Per-screen audit

### Home (`[locale]/page.tsx`)
- **Strengths:** Obsidian/brass hero panel, kicker, staggered game covers, CTAs via `HomeHeroCtas`.
- **Gaps:** Covers all deep-link to `/lobby` (no per-game deep create); no social proof / live tables / how-to; type scale is ad-hoc Tailwind sizes, not a token scale.

### Auth (`AuthForm` + login/register)
- **Strengths:** Clean card form, autocomplete attrs, bilingual copy, cookie-commit delay before navigate.
- **Gaps:** Generic salon card (no branded illustration); error strings often raw API English; no password visibility toggle / strength hint beyond `minLength`; no “forgot password”.

### Lobby (`lobby/page.tsx`)
- **Strengths:** Mode cards with quick-match orb + create; TTL chips (`LobbyExpiryNote`), host cap `MAX_OPEN_LOBBIES=2`, seat bars, status pills, 15s poll + 1s clock; alerts for join/cap errors.
- **Gaps:** Dense list UX (not a “club floor”); matchmaking is client poll loop; no invite-by-friend from lobby; little empty-state storytelling; still capped by `max-w-5xl`.

### Friends
- **Strengths:** Search dropdown, avatar rows, incoming/outgoing/accepted sections, salon cards.
- **Gaps:** Sequential profile fetches per friend; no online presence; no “invite to table”; no empty illustrations; search has no debounce/loading/a11y listbox pattern.

### Profile
- **Strengths:** Avatar + rating feature tile, change-password form.
- **Gaps:** No match history / per-game ELO / avatar upload; password-only settings; feels like a stub vs a player “dossier”.

### Game shell (`GameRouter` + each game page)
- **Strengths:** Auth gate, typed game_type switch, shared rematch offer banner + result modal pattern, waiting-table TTL on Chess/Mafia/Rokugan.
- **Gaps:** No shared GameChrome (connection chip, leave, rules, sound) — each game reinvents layout; `max-w-5xl` squeezes oval/table UIs; loading/error are plain text/cards.

### Chat / Voice
- **Strengths:** Reusable `ChatPanel` (collapsible), `VoicePanel` (LiveKit join/mute/leave).
- **Gaps:** Emoji-heavy chrome; chat lacks timestamps, moderation, role/phase gating UI; voice peer list is crude; both look like generic side cards, not immersive “tavern booths”; collapsed defaults hide discovery.

### Results / Rematch
- **Strengths:** Shared `result-pop` + confetti/trophy on Chess; rematch API + `joinRematchTable` consent flow across games; rating delta on Chess.
- **Gaps:** Visual language inconsistent (Chess richest; others thinner); rematch copy emoji-driven; no shared “post-game lounge” (stats, rematch countdown, spectate next).

---

## 3. Per-game audit (vs premium ~9/10)

### Chess (~functional club board)
- **Strengths:** Custom board with piece PNGs, flip for black, clocks, check/illegal banners, promotion picker, move animation hook (`piece-slide`), result modal + rematch, `dir="ltr"` board island, square `aria-label`s.
- **Gaps:** Classic green/cream board only (no wood/club themes); sparse coordinate chrome; no move list / eval / takeback UX; sidebar is plain “♞ Chess” card; audio limited vs Salem; not yet “chess club” atmosphere.

### Mafia (~noir table sketch)
- **Strengths:** Polar seat circle, night/day/over table classes + stars in `globals.css`, phase banner, role/vote/kill flows, `aria-live` connection, rematch/result.
- **Gaps:** Still emoji-forward seats; no dedicated `mafia.css` token set; day/night is CSS glow not full noir art direction; log/UX dense; no role reveal ceremony art; mobile circle cramped; far behind Salem polish.

### Rokugan (~lacquer prototype)
- **Strengths:** Scoped `--rk-*` tokens, province grid + river + token pick, raze/lock sounds, lobby hero, crest banner.
- **Gaps:** Thin CSS (~190 LOC); 2p choose/over only UI depth; little motion/feedback vs Salem; no full “lacquer silk” immersion (paper, seals, clan identity); province art sparse (`icons` only).

### Salem (~closest to 9/10 after `ebbc5d7` line)
- **Strengths:** Full component set (table, cards, dock, sounds, catalog); candlelit tokens in `salem.css`; phase banner + timers; Town Hall portraits + ability copy; hand dock / mobile strip / popover; sound controls; card emblems; PD asset discipline + CREDITS.
- **Gaps still:** Shared shell `max-w-5xl` fights stage; Chat/Voice still salon-generic beside themed table; some phase ceremonies (conspiracy/confess) can still feel cramped on short viewports; continuous polish debt vs true premium (deal/tryal choreography consistency).

**Relative maturity:** Salem ≫ Rokugan ≈ Mafia > Chess (logic-complete but visually oldest) for *theme depth*; Chess wins on board interaction clarity.

---

## 4. Design-system gaps

| Area | Today | Missing for 9/10 |
|------|--------|-------------------|
| Tokens | 7 salon vars (`--bg/--surface/--border/--accent/--text/--muted/--gold-*`); game-local `--salem-*` / `--rk-*` | Semantic scale (danger/success/info), elevation, radius, space, z-index; documented theme packages |
| Type | Vazirmatn + ad-hoc `text-sm/3xl/4xl`; `.kicker` only | Modular type scale, display vs UI vs mono (clocks), EN display face |
| Components | CSS classes, not a component library | Button/Input/Modal/Toast/Tabs/Badge primitives shared by games |
| Motion | `enter-*`, matchmaking pulse, result-pop; Salem/Mafia keyframes; `prefers-reduced-motion` partially honored | Shared motion tokens (duration/ease); focus-visible everywhere interactive; game chrome transitions |
| Focus | `.btn`/`.input`/links have focus-visible; many game buttons/emoji controls incomplete | Full keyboard maps for board/table seats; skip links; dialog focus traps on result/rematch |

---

## 5. RTL / a11y / responsive (code-observed)

- **RTL:** `html[dir]` from locale; logical props used in places (`.nav-link-active`, cover `text-start`); Chess/Mafia boards force `dir="ltr"` (correct). Risk: absolute `-right-1` badges (Mafia), emoji+string order, Rokugan river chrome.
- **Nav:** No hamburger — links wrap on narrow widths; profile chip can crowd FA/EN toggle.
- **a11y:** Good spots (`aria-live` on Mafia/Salem conn, lobby matchmaking, language `aria-current`). Gaps: Chat/Voice `<details>` summaries; many icon-only controls; result modals lack dialog semantics/`role="dialog"`; Friends search not a combobox pattern.
- **Responsive:** Salem has explicit ≤900/≤640 rules; Chess board `min(88vw,480px)` OK; Mafia circle / Rokugan table weaker; global `max-w-5xl` is the shared bottleneck for immersive tables.
- **Motion:** Global reduce-motion covers salon + mafia; Salem/Rokugan have their own blocks — keep auditing new keyframes.

---

## 6. Contract constraints (do not break)

1. **Server authority** — no client move validation; UI only reflects engine output.
2. **`visible_state(state, seat)`** — never render secrets (witch night targets, hidden roles, private hands of others); spectator=`seat=None`.
3. **Secret events** — replays/sync filtered via `event_visible_to` / `SECRET_EVENT_TYPES`.
4. **WS protocol** — auth first frame (JWT in memory); then subscribe/`sync {room,last_seq}` / action / chat; no query-string tokens.
5. **Auth model** — access JWT memory-only; refresh httpOnly cookie + rotation dedupe in `api.ts`.
6. **Lobby TTL** — 10-minute lobby expiry; max **2** open lobbies per user (`MAX_OPEN_LOBBIES`); Celery cleanup.
7. **Rematch** — consent via rematch offer + `joinRematchTable` (do not auto-seat).
8. **Engine action names / payloads** — UI must map existing action_types; no silent renames.
9. **i18n** — every string in **both** `fa.json` and `en.json`; keep `localePrefix: "always"`.
10. **Salem assets** — public-domain/CC0 only; keep `public/salem/CREDITS.md` current.
11. **Tests** — backend suite green, especially `test_salem_engine.py` / `test_secret_events.py`.

---

## 7. Prioritized redesign backlog → phases 1–10

| Phase | Focus | Outcome |
|-------|--------|---------|
| **1** | Design tokens + primitives | Extract salon + semantic tokens; Button/Input/Modal/Toast; type scale; focus ring kit |
| **2** | Shell chrome | Full-bleed game layout option; responsive Navbar; connection/leave/rules/sound strip shared |
| **3** | Home + Auth polish | Obsidian/brass club landing; per-game CTAs; branded auth; better errors |
| **4** | Lobby 2.0 | Club-floor cards, friend invite, clearer TTL/host UX, less poll-feel matchmaking UI |
| **5** | Friends + Profile | Presence, invite-to-lobby, match history / per-game ratings dossier |
| **6** | Chess club theme | Wood board skins, coordinates, move list, richer endgame lounge — keep clocks/WS intact |
| **7** | Mafia noir | Dedicated `mafia.css`, seat art, phase ceremonies, readable log — no role leaks |
| **8** | Rokugan lacquer | Deepen tokens/art/SFX, clearer choose feedback, clan identity — 2p contract unchanged |
| **9** | Salem finish | Ceremonies, dock/stage under short viewports, themed chat/voice skins; stay PD-clean |
| **10** | Chat/Voice + Results system | Unified post-game lounge, rematch UX, accessible LiveKit/chat chrome; QA RTL + reduce-motion + Lighthouse |

Phases 1–2 unblock 6–9; do not start per-game art thrash before tokens/chrome.

---

## 8. Assumed visual directions

| Surface | Direction |
|---------|-----------|
| **Platform shell** | Obsidian / brass gentlemen’s club — deep `#0b0d12`, brass `#d4a24e`, grain vignette, glass cards (already sketched in `globals.css`) |
| **Chess** | Quiet chess club — walnut board, ivory/ebony pieces, brass clocks, restrained gold |
| **Mafia** | Noir parlor — indigo night, cigarette-gold day, silhouette seats, stark phase titles |
| **Rokugan** | Lacquer & silk — vermillion/gold seals, ink rivers, paper provinces (extend `--rk-*`) |
| **Salem** | 1692 candlelit tavern — parchment, wax seals, oak oval, amber candle (current `--salem-*`; protect from salon gold bleed) |

---

## Snapshot judgment

- **Keep:** Salon token seed, lobby TTL/host UX, rematch consent, Salem component architecture + asset pipeline, bilingual key parity.
- **Lift next:** Shared design system + game chrome width; then theme Chess/Mafia/Rokugan up to Salem’s bar; finish Salem ceremonies and social screens.
- **Do not:** Touch engines, `visible_state`, WS auth, lobby TTL rules, or invent non-PD Salem art.

*Audit generated for Phase 0 at commit `ebbc5d7`. Frontend-only; no backend edits.*
