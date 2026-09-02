# Kimi K3 Prompt — Salem 1692 UI/UX Overhaul

You are improving the "Salem 1692" table and overall UI/UX of a self-hosted board game platform.

## PROJECT CONTEXT
Repo: boardgame-platform (FastAPI + Next.js 15 App Router, React 19, Tailwind v4, FA/EN i18n with RTL/LTR via next-intl, localePrefix "always").
Salem frontend lives in:
- frontend/src/components/salem/  (catalog.ts, SalemGame.tsx, SalemTable.tsx, SalemTableFelt.tsx, SalemCard.tsx, salemSounds.ts, types.ts)
- frontend/src/styles/salem.css
- frontend/public/salem/  (portraits/, icons/, sounds/, heroes/, CREDITS.md — READ IT, respect licenses)
Translations: frontend/messages/fa.json + en.json.
Backend engine (DO NOT rewrite): backend/app/games/salem_engine.py — server-authoritative, hidden-info contracts enforced by game_service (secret events filtered per seat). You may READ it to understand phases/actions, but only touch frontend unless a tiny backend key addition is unavoidable.
Existing tests MUST stay green: backend/tests/ (120 passed) — especially test_salem_engine.py, test_secret_events.py.

## TASKS (from owner feedback, with the 4 attached screenshots)

### 1. Town Hall portraits are missing/broken
Screenshots 1-2: most Town Hall characters show a generic black silhouette SVG; only 3 have real PD photos (card_cache, kiln_guard, first_light — see HALL_PHOTO set in catalog.ts).
FIX: give EVERY Town Hall character a real, dignified period portrait (17th-century Puritan era look).
- Source ONLY public-domain / free-licensed art: Wikimedia Commons PD portraits (real historical figures where applicable: Cotton Mather, William Phips, Samuel Parris already exist as JPGs), or generate original woodcut-style SVG plates that actually LOOK like engraved period portraits (hatching, frame, sepia palette) — not a plain dark silhouette.
- Wire the real files under frontend/public/salem/portraits/, update HALL_PHOTO set as needed, and keep CREDITS.md updated with source/license per file.
- Add a graceful fallback (styled initial-letter crest, NOT a creepy silhouette) only if a file is ever missing.

### 2. Town Hall pick must describe the character's ability
Screenshot 1: players pick blindly. Each character card in the pick modal MUST show: name, portrait, and a 1-2 sentence ability description (what it does, when it triggers).
- Descriptions in BOTH fa.json and en.json (next-intl keys per hall id; follow existing townHallI18nKey pattern).
- Persian copy must be natural, formal-ish game Persian. Backend salem_data.py contains the authoritative abilities — match the text to actual engine behavior, don't invent.

### 3. Overall visual redesign — make it look premium, not amateur
Screenshot 3: the table view layout is unbalanced (huge oval woodcut dominating center, cramped side panels, poor hierarchy).
- Redesign the Salem table as a premium "candlelit 1692 tavern table": strong visual hierarchy, readable at a glance — board/table centerpiece scaled to viewport, clear zones: phase banner, night result, player seats around the table, hand dock at bottom.
- Polish is welcome: subtle CSS animations (candle flicker, card hover lift, dawn/night transitions, tryal reveal flip), tasteful ambient gradients/vignette. CSS-first; three.js allowed ONLY if it degrades gracefully and doesn't bloat the bundle — ask yourself if CSS can achieve 90% of it first.
- Also do a pass on the whole site shell (navbar, lobby, home) for consistency with the new look: spacing, typography scale, contrast (WCAG AA), RTL correctness everywhere (test fa layout!).
- Keep Lighthouse-friendly: lazy-load images, no giant bundled assets.

### 4. Hand cards must look like real premium playing cards
Screenshot 4: cards are plain beige rectangles.
- Redesign SalemCard: proper card anatomy — ornate period border/frame, color-coded suit by card type (accusation/defense/action per cardColor in catalog.ts), title band, readable body text, accusation marks (pins) as designed icons, hover lift + selected glow states, RTL-safe.
- Match the parchment/wood theme; add subtle texture (existing parchment.jpg) — no external heavy images.

### 5. Audio: replace scary loud sounds with mellow ones
- Current procedural sounds (public/salem/sounds/*.ogg, CC0 originals) are harsh/loud — especially night drone.
- Replace with SOFT, low-volume, warm ambience and gentle SFX (card slide, soft chime, low warm pad for night — think cozy tavern, not horror film). You may regenerate procedural audio (e.g. python/numpy render to ogg) or use CC0 assets from freesound-style sources with attribution; keep files small (<100KB each).
- Normalize loudness around -20 LUFS (quiet background), add a volume slider + mute toggle persisted in localStorage, respect browser autoplay policies.

### 6. Card play UX is incomprehensible — no feedback
- Playing a card must be OBVIOUS: click card → card enters a clear "playing" state (lifted, glowing, with a confirm/cancel affordance if it needs a target), then animate to its destination (to the tryal row / discard / target seat) with a visible result callout (e.g. "جادوگر متهم شد!" toast, accuser→target line).
- Add micro-animations: deal-in on hand refresh, flip on tryal reveal, shake on illegal action + inline reason text, fade/slide for night→day transitions. Keep animations 150-400ms, respect prefers-reduced-motion.
- After ANY player action, the state change must be visually traceable (what happened, who did it — only within what hidden-info allows: never leak night actor/target).

## HARD CONSTRAINTS
- NEVER reveal hidden info client-side or in logs (night actors, witch cards, doctor-like saves). Visible-state contract is sacred.
- All user-facing text via next-intl keys in fa.json+en.json. No hardcoded strings. Persian must read naturally; RTL must be correct (logical CSS properties or rtl: variants).
- Only original / CC0 / public-domain assets. NEVER copy Facade Games' Salem 1692 card art/text. Update CREDITS.md for every new asset.
- Don't rename engine actions or change WS/API contracts — frontend-only unless truly unavoidable.
- Performance: keep initial JS payload reasonable; images lazy/optimized; no 3D library unless justified.

## VERIFICATION (must do before claiming done)
1. `docker compose up -d --build frontend backend` — build must succeed clean.
2. `cd backend && SECRET_KEY=test DATABASE_URL=sqlite+aiosqlite:///./test.db REDIS_URL=redis://localhost:6379/0 python -m pytest tests -q` → 120 passed.
3. `docker compose exec frontend npx tsc --noEmit` (or the project's typecheck) — no type errors.
4. Manual smoke in browser at http://localhost/fa: create a Salem table, join with a 2nd browser, start, pick a Town Hall character (description visible), play one card end-to-end observing the new animations/sounds, and screenshot before/after of: Town Hall modal, table view, hand cards.
5. Report: list of files changed, new assets + licenses, and the 6 issues each marked FIXED with evidence.
