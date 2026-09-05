# Chess vs Bot — API Contract (Phase B)

**Repo:** boardgame-platform  
**Branch:** `feature/chess-bot-mode`  
**Audience:** Frontend (lobby setup, game shell, rematch)  
**Aligns with:** `docs/CHESS_BOT_UX_SPEC.md` personas (Pawn…King)  
**Non-goals:** eval/PV/analysis FEN APIs, client UCI options, rated Elo, chat-with-bot, auth/CORS/rate-limit changes.

---

## 1. Personas ↔ server difficulty

Frontend may send either the **persona id** (preferred) or the **difficulty alias**. Server normalizes to persona id.

| Persona `id` | Difficulty alias | Display (EN) | Stockfish Skill Level (server only) | Thinking delay (ms, inclusive) |
|--------------|------------------|--------------|--------------------------------------|--------------------------------|
| `pawn`       | `novice`         | Pawn Bot     | 0                                    | 400–900                        |
| `knight`     | `easy`           | Knight Bot   | 3                                    | 500–1100                       |
| `bishop`     | `normal`         | Bishop Bot   | 7                                    | 600–1300                       |
| `rook`       | `hard`           | Rook Bot     | 11                                   | 700–1500                       |
| `queen`      | `expert`         | Queen Bot    | 16                                   | 900–1800                       |
| `king`       | `master`         | King Bot     | 20                                   | 1000–2000                      |

- Client **never** sends Skill Level, depth, Hash, Threads, or MultiPV.
- Thinking delay is applied **server-side** after the engine returns (or around compute) so the BOT “thinking” indicator feels natural; ranges scale subtly with strength.

### Colors

| `player_color` | Meaning |
|----------------|---------|
| `white`        | Human seat 0 (White); bot seat 1 |
| `black`        | Human seat 1 (Black); bot seat 0; board flipped as today |
| `random`       | Server flips once at create; response includes resolved `player_color` |

Rematch with previous preference `random` **re-rolls**.

---

## 2. Create bot match

### `POST /api/games/bot`

Creates an **already-active** unrated chess table (no lobby wait, no second human).

**Request**

```json
{
  "difficulty": "bishop",
  "player_color": "random"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `difficulty` | string | yes | Persona id **or** alias (`pawn`/`novice` … `king`/`master`) |
| `player_color` | `"white"` \| `"black"` \| `"random"` | no | Default `"random"` |
| `game_type` | `"chess"` | no | Only chess supported; omit or `"chess"` |

**Alternate (extended create):** `POST /api/games` with

```json
{
  "game_type": "chess",
  "settings": {
    "mode": "bot",
    "difficulty": "rook",
    "player_color": "white"
  }
}
```

Same semantics as `/games/bot`. Non-bot create unchanged.

**Success `201`**

```json
{
  "id": "uuid",
  "game_type": "chess",
  "status": "active",
  "rated": false,
  "opponent_type": "bot",
  "your_seat": 0,
  "player_color": "white",
  "color_preference": "random",
  "bot": {
    "persona_id": "bishop",
    "difficulty": "normal",
    "display_name": "Bishop Bot",
    "avatar_path": "/chess/bots/bishop.svg",
    "tier": 3
  },
  "created_at": "ISO-8601",
  "started_at": "ISO-8601"
}
```

- No `expires_at` (not a waiting lobby).
- If bot is White, opening move is **scheduled** immediately (after thinking delay); client should subscribe WS and expect a normal `state` / `move_made` like a human opponent.

**Errors**

| HTTP | `detail` / code | When |
|------|-----------------|------|
| `400` | `unknown_difficulty` | Bad persona/alias |
| `400` | `invalid_player_color` | Not white\|black\|random |
| `400` | `bot_chess_only` | Non-chess `game_type` |
| `409` | `bot_capacity` | Too many concurrent active bot games for this user |
| `503` | `bot_engine_unavailable` | Stockfish path missing / pool cannot start (create may still succeed in some deploys; move path surfaces `bot_error`) |

---

## 3. Game metadata (GET + lobby-shaped payloads)

`GET /api/games/{id}` and WS `started` / `lobby_update` / `state` envelope payloads include bot fields when `opponent_type === "bot"`:

```json
{
  "id": "...",
  "game_type": "chess",
  "status": "active",
  "rated": false,
  "opponent_type": "bot",
  "your_seat": 0,
  "is_host": true,
  "player_color": "white",
  "color_preference": "white",
  "bot": {
    "persona_id": "rook",
    "difficulty": "hard",
    "display_name": "Rook Bot",
    "avatar_path": "/chess/bots/rook.svg",
    "tier": 4
  },
  "players": [
    {
      "seat": 0,
      "opponent_type": "human",
      "user": { "id": "...", "username": "...", "rating": 1200, "last_seen_at": null }
    },
    {
      "seat": 1,
      "opponent_type": "bot",
      "user": null,
      "bot": { "persona_id": "rook", "difficulty": "hard", "display_name": "Rook Bot", "avatar_path": "/chess/bots/rook.svg", "tier": 4 }
    }
  ],
  "state": { "...": "same ChessEngine visible_state as online" },
  "result": null
}
```

**Bot profile fields exposed to client (only):**

| Field | Type | Use |
|-------|------|-----|
| `persona_id` | string | Asset key / i18n |
| `difficulty` | string | Alias (`novice`…`master`) |
| `display_name` | string | Fallback EN name if i18n missing |
| `avatar_path` | string | e.g. `/chess/bots/rook.svg` |
| `tier` | int 1–6 | Optional pips |

**Never exposed:** Skill Level, depth, nodes, PV, eval, Hash, Threads, FEN analysis, engine version strings in game payloads.

Human rating may still appear on the human row; bot row rating is omitted (`user: null`). UI shows “—” / no Elo.

Bot tables are **not** listed in `GET /api/games/lobbies` (they start `active`).

---

## 4. Moves (REST + WS) — same pipeline as online

### Human move

- WS: `{ "type": "action", "room": "game:{id}", "action": "move", "payload": { "move": "<uci>" } }`
- REST: `POST /api/games/{id}/action` with `{ "action": "move", "payload": { "move": "<uci>" } }`

Server: ChessEngine validate → commit → if next turn is bot → schedule idempotent bot task.

### Bot move

- Same `apply_action` pipeline (validate → events → commit → broadcast `state`).
- Event payload for moves unchanged: `move_made` with `{ "san", "uci", "seat" }` (bot seat index).
- `actor_user_id` on the event log is `null` for bot moves.

### Idempotency

Bot tasks carry `(game_id, expected_seq)`. Before applying, server checks:

1. Game still `active`
2. `game.last_seq == expected_seq`
3. Side to move is still the bot seat

Duplicate / stale tasks **no-op** (no double-move).

---

## 5. WebSocket / realtime behavior

| Event `type` | When | Notes |
|--------------|------|-------|
| `state` | After any move (human or bot) | Identical shape to online Chess; `payload.state` + filtered `events` |
| `started` | Rare for bot (game already active on create); create returns snapshot via GET | Prefer GET after create + WS `subscribe`/`sync` |
| `bot_thinking` | Optional advisory when bot compute starts | `{ "seat": <bot_seat> }` — UI may ignore and derive from `turn_seat` |
| `bot_error` | Engine failure after retries | Recoverable; see §6 |
| `error` | Illegal move / not your turn / etc. | Unchanged |
| `chat` | Disabled / ignored for bot tables | Prefer Frontend hide chat; server may reject with `bot_no_chat` |

Subscribe/sync/auth unchanged. Bot seat has no user; human member authorizes the room.

Clocks: same 10-minute Chess clocks. Bot seat is treated as always “present” (no abandon / no random auto-move on bot turn). Auto-move and offline grace apply only to the **human** seat.

---

## 6. Engine failure & capacity

| Situation | Client sees |
|-----------|-------------|
| Transient Stockfish / timeout | Limited retries; then `bot_error` |
| `bot_error` payload | `{ "code": "bot_engine_error", "message": "Bot could not move. Retry.", "retryable": true }` |
| Client retry | `POST /api/games/{id}/bot/retry` (auth member) re-schedules if still bot turn |
| **No** random legal move fallback | Honesty over fake play |
| Concurrent limit | `409 bot_capacity` on create |

Suggested Frontend: keep selections; show inline retry; on `bot_error` offer Retry that calls `/bot/retry` or rematch.

---

## 7. Rematch

`POST /api/games/{id}/rematch` on a **finished bot** game:

- Creates a **new** active bot game with the **same persona/difficulty**.
- `color_preference` preserved; if it was `random`, **re-roll** resolved color.
- **No** human rematch-consent / no `rematch` WS invite to a fake opponent.
- Response: `{ "game_id": "uuid" }` (same as today).

Human–human rematch unchanged (waiting table + invites).

---

## 8. Ratings

- Bot games always `rated: false`.
- `_apply_ratings` / Elo **skipped**.
- Result payload has no `ratings` deltas for bot tables.

---

## 9. Error code cheat-sheet (Frontend)

| Code / detail | HTTP | UI hint |
|---------------|------|---------|
| `unknown_difficulty` | 400 | Keep setup; highlight persona |
| `invalid_player_color` | 400 | Reset color control |
| `bot_chess_only` | 400 | — |
| `bot_capacity` | 409 | “Too many bot tables open” |
| `bot_engine_unavailable` | 503 | Retry later |
| `bot_engine_error` | WS `bot_error` | Retry move / rematch |
| `bot_no_chat` | WS error | Hide chat |
| `Not your turn` / illegal | 409 / WS error | Existing Chess handling |

---

## 10. Server config (ops; not client)

| Env | Default | Meaning |
|-----|---------|---------|
| `STOCKFISH_PATH` | `/usr/local/bin/stockfish` | UCI binary (Stockfish **18** / tag `sf_18`) |
| `CHESS_BOT_POOL_SIZE` | `2` | Reusable engines (no spawn-per-move) |
| `CHESS_BOT_THREADS` | `1` | UCI Threads per engine |
| `CHESS_BOT_HASH_MB` | `64` | UCI Hash |
| `CHESS_BOT_MOVE_TIMEOUT` | `8` | Seconds per go |
| `CHESS_BOT_MAX_CONCURRENT_PER_USER` | `3` | Active bot games cap |

---

## 11. Frontend wiring checklist

1. Setup → `POST /api/games/bot` with `{ difficulty: personaId, player_color }`.
2. Navigate to `/game/{id}`; WS auth → subscribe `game:{id}` → sync.
3. Render opponent from `bot` / players[`opponent_type=bot`]; always BOT badge; no Elo.
4. Derive thinking UI from `state.turn_seat === bot_seat` (and optional `bot_thinking`).
5. Moves: existing Chess WS action path.
6. Rematch: existing rematch endpoint (bot short-circuit server-side).
7. On `bot_error`: Retry via `POST .../bot/retry` or rematch / change opponent.
