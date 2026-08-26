# BoardGame Platform

پلتفرم آنلاین بازی‌های رومیزی (شطرنج، مافیا، ...) با حساب کاربری، لابی، دوستان و بازی Realtime.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · Tailwind v4 · next-intl (FA/EN + RTL/LTR) · PWA |
| Backend | FastAPI · SQLAlchemy async · PyJWT · Argon2 (pwdlib) |
| Realtime | WebSocket + Redis Pub/Sub fan-out (stateless nodes, بدون sticky session) |
| Data | PostgreSQL 17 (event log append-only برای هر بازی) |
| Jobs | Celery worker + beat |
| Proxy | Nginx (TLS-ready, WS upgrade, rate-limit, security headers) |

## Quick start

```bash
cp .env.example .env
# در production حتماً SECRET_KEY را عوض کن:
#   python -c "import secrets; print(secrets.token_hex(64))"

docker compose up --build
```

سپس: **http://localhost** (از طریق Nginx)

- فرانت مستقیم: http://localhost:3000
- API docs (فقط dev): http://localhost/api/docs

## Architecture essentials (برای هر agent/توسعه‌دهنده‌ای که وارد پروژه میشه)

1. **منطق بازی ۱۰۰٪ سمت سرور است.** کلاینت فقط رندر می‌کند؛ هیچ اعتبارسنجی حرکتی به کلاینت واگذار نشده.
2. **Event Sourcing**: جدول `game_events` append-only است و منبع حقیقت بازی. ستون `games.state` فقط کش materialized است و با هر اکشن همراه eventها transactionally آپدیت می‌شود.
3. **موتور بازی پلاگین‌پذیر**: بازی جدید = یک کلاس در `backend/app/games/` با اینترفیس `init_state / apply_action / visible_state` + ثبت در `registry.py`. بازی‌های hidden-information باید در `visible_state(state, seat)` اطلاعات مخفی را فیلتر کنند (seat=None یعنی تماشاگر).
4. **Realtime**: همه پیام‌ها از یک کانال Redis (`bg:events`) عبور می‌کنند تا هر node FastAPI فقط سوکت‌های محلی خودش را feed کند. به همین دلیل scale افقی بدون sticky session کار می‌کند.
5. **Reconnect protocol**: کلاینت بعد از هر اتصال مجدد `sync {room, last_seq}` می‌فرستد؛ سرور رویدادهای جاافتاده را از DB replay و snapshot تازه می‌فرستد. عدد `seq` per-game و monotonic است.

## Auth model

- Access token: JWT کوتاه‌عمر (۱۵ دقیقه) — فقط در حافظه‌ی مرورگر (نه localStorage).
- Refresh token: تصادفی ۴۸ بایتی، **hashed** در DB ذخیره می‌شود (sha256)، در کوکی `httpOnly` با `path=/api/auth`، با rotation و انقضا. logout آن را revoke می‌کند.
- Rate limit روی login/register هم در FastAPI (Redis counter) و هم در Nginx.

## Commands

```bash
# Backend tests (بدون نیاز به DB):
cd backend && pip install -e ".[dev]" && pytest -q

# Migrations (خودکار در startup کانتینر اجرا می‌شود):
docker compose exec backend alembic upgrade head

# ساخت مایگریشن جدید بعد از تغییر models:
docker compose exec backend alembic revision --autogenerate -m "..."

# Frontend dev server:
cd frontend && npm install && npm run dev
```

## Roadmap (فازبندی توافق‌شده)

- ✅ فاز ۰: Auth + دوستان + لابی + WS realtime + شطرنج end-to-end + reconnect + i18n + PWA shell
- ⬜ فاز ۱: بازی hidden-info (مدل Battle for Rokugan) + صف matchmaking + ELO واقعی + تماشاگر/replay UI
- ⬜ فاز ۲: سوشال ددکشن (مافیا): فاز شب/روز + چت متنی درون‌بازی + گزارش تخلف/مودریشن + تایمرهای سروری
- ⬜ فاز ۳: چت صوتی با LiveKit self-hosted (Nginx باید UDP relay بگیرد)
- ⬜ TLS/HTTPS روی Nginx + دامنه production

## Security notes for production

- `ENV=production` → docs خاموش، کوکی secure فعال.
- پشت reverse proxy واقعی، `X-Forwarded-For` را trusted نگه دار (الان Nginx ست می‌کند).
- قبل از انتشار عمومی، موضوع IP/لایسنس بازی‌های تجاری بررسی شود (Battle for Rokugan, Town of Salem).
