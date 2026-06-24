# Smart Customer Support Inbox

A production-ready support inbox where agents view, manage, and reply to customer conversations — with real-time message delivery, a mock AI reply engine, asynchronous sentiment analysis, and conversation locking to prevent concurrent edits.

**Stack:** Django 4.2 + DRF + Simple JWT + Celery/Redis (backend) · Next.js 14 (App Router) + TypeScript + Tailwind + React Query (frontend).

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      Next.js 14 (App Router)                       │
│  /login   /conversations   /conversations/[id]                     │
│                                                                    │
│  React Query (server state) · Optimistic UI · 3s polling           │
│  JWT stored in localStorage, attached via axios interceptor        │
└───────────────────────────────┬────────────────────────────────────┘
                              │ REST + JWT (Bearer)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Django + DRF  (port 8000)                        │
│                                                                    │
│  ConversationViewSet (thin)  ──▶  services.py (business logic)     │
│     • list / detail / reply           • LockService (atomic)       │
│     • suggest-reply                    • SuggestionService (mock AI)│
│     • lock / unlock / status           • SentimentAnalyzer         │
│     • messages (polling)                                           │
│                                                                    │
│  reply ──▶ analyze_sentiment.delay() ──────┐  (non-blocking)       │
└────────────────────────────────────────────┼───────────────────────┘
                              │              │
                              ▼              ▼
                       SQLite DB        Celery + Redis
                  (conversations,     (async sentiment;
                   messages, locks)    result saved to DB)
```

### Real-time strategy: **polling** (chosen) — and why

The spec allows WebSockets, SSE, or polling. I chose **short polling (3s)** for the new-messages endpoint:

| Option | Pros | Cons |
|--------|------|------|
| **Polling (chosen)** | Zero extra infra; works behind any proxy/load-balancer; trivial to reason about; stateless and JWT-friendly | ~3s latency; some wasted requests |
| WebSockets | True push, lowest latency | Needs ASGI server + Django Channels + Redis channel layer; sticky sessions; more moving parts to deploy |
| SSE | Push, simpler than WS | One-way only; long-lived connections complicate scaling/proxies |

For a support inbox, 3-second latency is imperceptible in practice, and the operational simplicity is a big win. The polling endpoint is incremental — it only returns messages with `id > after`, so each poll is cheap. **The transport is fully isolated in `usePollMessages.ts`**, so swapping to SSE/WS later changes exactly one file.

### State management: **React Query + local state**

- **React Query** owns server state (conversation list, detail) — caching, loading/error states, refetching all handled declaratively.
- **Local component state** (`useState`) owns the live message array so optimistic inserts and rollbacks are instant and don't fight the cache.
- JWT lives in `localStorage`, attached by an axios request interceptor; a response interceptor bounces to `/login` on 401.

### Concurrency / locking design

A conversation lock is a **database row** (`ConversationLock`, one-to-one with `Conversation`):

- **Atomic acquire** uses `select_for_update()` inside a transaction so two agents racing to open the same conversation can't both win.
- **Auto-expiry**: a lock is considered expired after `LOCK_EXPIRY_SECONDS` (default 300s = 5 min) of inactivity, tracked by `last_activity`. Sending a reply "touches" the lock.
- **Read vs write**: other agents can always `GET` the thread, but `POST /reply` returns **423 Locked** if someone else holds a live lock.
- **Visibility**: the lock holder's name is returned by the lock/status endpoints and shown in the UI via `LockIndicator`.

Why a DB row and not pure Redis? The data already lives in Postgres/SQLite, `select_for_update` gives real atomicity without a second source of truth, and it survives a Redis flush. (Redis would be a fine alternative for very high lock churn — documented trade-off.)

---

## 2. Running the project

### Option A — Docker (everything at once)

```bash
docker compose up --build
```
- Frontend → http://localhost:3000
- Backend  → http://localhost:8000
- Redis + Celery worker start automatically
- Backend auto-migrates and seeds on boot

Log in with **admin@test.com / admin123**.

### Option B — Local (manual)

**Backend:**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed                # creates admin@test.com / admin123 + demo data
python manage.py runserver           # http://localhost:8000
```

**Celery (separate terminal, needs Redis running):**
```bash
cd backend
celery -A config worker -l info
```
> No Redis handy? Set `CELERY_TASK_ALWAYS_EAGER=True` in the backend env and sentiment runs inline (no broker needed). The reply endpoint still returns immediately in normal mode because it only calls `.delay()`.

**Frontend (separate terminal):**
```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev                          # http://localhost:3000
```

---

## 3. API Documentation

All endpoints except login require `Authorization: Bearer <access_token>`.

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| POST | `/api/auth/login/` | Get JWT access + refresh | `{ username, password }` |
| POST | `/api/auth/refresh/` | Refresh access token | `{ refresh }` |
| GET | `/api/conversations/?page=&search=&status=` | Paginated list | — |
| GET | `/api/conversations/{id}/` | Full thread | — |
| POST | `/api/conversations/{id}/reply/` | Agent reply (triggers async sentiment) | `{ message }` |
| POST | `/api/conversations/{id}/suggest-reply/` | Mock AI suggestion | `{ message }` |
| POST | `/api/conversations/{id}/lock/` | Acquire/refresh lock | — |
| POST | `/api/conversations/{id}/unlock/` | Release lock | — |
| GET | `/api/conversations/{id}/lock/` | Lock status | — |
| GET | `/api/conversations/{id}/messages/?after={id}` | Incremental messages (polling) | — |

**Login**
```json
// POST /api/auth/login/  → 200
{ "username": "admin@test.com", "password": "admin123" }
// response
{ "access": "eyJ...", "refresh": "eyJ..." }
```

**Conversation list item**
```json
{ "id": 1, "customer_name": "John Doe", "last_message": "Need help with my order",
  "status": "open", "created_at": "2026-01-01T12:00:00Z" }
```

**Reply** → `201 Created` with the new message, or `423 Locked`:
```json
{ "detail": "Conversation is locked by another agent.", "locked_by": "agent2@test.com" }
```

**Suggest-reply**
```json
// POST { "message": "I want a refund" }  → 200
{ "suggestion": "We're sorry for the inconvenience. I've started your refund…" }
```

---

## 4. Testing

### Backend (13 tests — pytest)
```bash
cd backend
CELERY_TASK_ALWAYS_EAGER=True python -m pytest
```
Covers: JWT login + unauthorized rejection, paginated/searched/filtered list, conversation detail thread, **lock state transitions** (acquire, block other agent, takeover, expiry), **423 locked** API response, **Celery sentiment task** (positive + negative, eager mode), mock AI suggestion (unit + API), and reply creating a message.

### Frontend (7 tests — Jest + React Testing Library)
```bash
cd frontend
npm test
```
Covers **ConversationList** (loading, populated, empty, error+retry) and **MessageComposer** (optimistic insert → confirm on success, optimistic insert → **rollback + error toast** on failure, locked-state disables replying).

---

## 5. Project Structure

```
support-inbox/
├── backend/
│   ├── config/              # settings, urls, celery, wsgi/asgi
│   ├── inbox/
│   │   ├── models.py        # Conversation, Message, ConversationLock
│   │   ├── serializers.py
│   │   ├── views.py         # thin ConversationViewSet
│   │   ├── services.py      # LockService, SuggestionService, SentimentAnalyzer
│   │   ├── tasks.py         # Celery analyze_sentiment
│   │   ├── management/commands/seed.py
│   │   └── tests/test_views.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/             # login, conversations, conversations/[id]
│   │   ├── components/      # ConversationList, MessageComposer, LockIndicator, Toast
│   │   ├── hooks/           # usePollMessages (real-time transport)
│   │   ├── lib/             # api client, providers
│   │   └── types/
│   ├── __tests__/           # ConversationList, MessageComposer
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 6. Key Design Decisions (summary)

1. **Thin views, fat services** — all locking, AI, and sentiment logic lives in `services.py`; views only validate and delegate.
2. **Locking via `select_for_update`** — real atomicity, no race conditions, auto-expiry.
3. **Async sentiment** — the reply endpoint calls `.delay()` and returns `201` immediately; the worker computes and persists sentiment separately.
4. **Optimistic UI** — messages render instantly with an opacity "sending…" state; on API failure they're removed and a toast explains why, with the text restored so the agent doesn't lose work.
5. **Polling over WS** — least infrastructure, fully isolated transport for easy future swap.
