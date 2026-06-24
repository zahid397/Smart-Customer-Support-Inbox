<div align="center">

# 💬 Smart Customer Support Inbox

### A production-ready, multi-agent support inbox with real-time delivery, async AI, and concurrency-safe conversation locking.

<br>

![Django](https://img.shields.io/badge/Django-4.2-092E20?style=for-the-badge&logo=django&logoColor=white)
![DRF](https://img.shields.io/badge/DRF-API-A30000?style=for-the-badge&logo=django&logoColor=white)
![Celery](https://img.shields.io/badge/Celery-Async-37814A?style=for-the-badge&logo=celery&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-Broker-DC382D?style=for-the-badge&logo=redis&logoColor=white)

![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Typed-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React Query](https://img.shields.io/badge/React_Query-State-FF4154?style=for-the-badge&logo=reactquery&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

<br>

![Tests](https://img.shields.io/badge/tests-20_passing-22c55e?style=flat-square&logo=pytest&logoColor=white)
![Backend](https://img.shields.io/badge/backend-13_pytest-22c55e?style=flat-square)
![Frontend](https://img.shields.io/badge/frontend-7_jest-22c55e?style=flat-square)
![Build](https://img.shields.io/badge/build-passing-22c55e?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

<sub>Built in a 24-hour window · Clean architecture · Fully tested · Docker-ready</sub>

</div>

<br>

> **TL;DR** — Several agents share one queue of customer conversations. Any agent can open a thread, get an AI-suggested reply, and respond. New messages appear without refresh, and **database-level locking** stops two agents from replying to the same customer at once. Sentiment runs **asynchronously** so replies stay instant.

<br>

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [🧠 Key Design Decisions](#-key-design-decisions)
- [🚀 Quick Start](#-quick-start)
- [📡 API Reference](#-api-reference)
- [🧪 Testing](#-testing)
- [📁 Project Structure](#-project-structure)
- [🔮 Roadmap](#-roadmap)

<br>

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

#### 🔐 Stateless JWT Auth
Token-based login, no server sessions. Auto-attached via axios interceptor; 401 bounces to login.

</td>
<td width="50%" valign="top">

#### 🔒 Concurrency-Safe Locking
DB-row locks via `select_for_update()`. One agent replies at a time; auto-expires after 5 min.

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### ⚡ Optimistic UI + Rollback
Messages render instantly. On failure they roll back, show a toast, and restore the agent's text.

</td>
<td width="50%" valign="top">

#### 🔄 Real-Time Sync
Incremental polling fetches only new messages (`?after=`). Transport isolated for easy WS swap.

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### 🤖 Mock AI Suggestions
Keyword/template reply engine — no external API, fully deterministic and offline.

</td>
<td width="50%" valign="top">

#### 📊 Async Sentiment Analysis
Celery computes sentiment off the request path, so replies return in milliseconds.

</td>
</tr>
</table>

<br>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Next.js 14 (App Router)                     │
│      /login        /conversations        /conversations/[id]      │
│                                                                   │
│   React Query (server state)  ·  Optimistic UI  ·  3s polling     │
│   JWT in localStorage, attached via axios interceptor             │
└────────────────────────────────┬──────────────────────────────────┘
                              │  REST + JWT (Bearer)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Django + DRF   ·   :8000                      │
│                                                                   │
│   ConversationViewSet (thin)  ──▶   services.py (business logic)  │
│      • list / detail / reply            • LockService (atomic)     │
│      • suggest-reply                    • SuggestionService (AI)   │
│      • lock / unlock / status           • SentimentAnalyzer       │
│      • messages (polling)                                         │
│                                                                   │
│   reply()  ──▶  analyze_sentiment.delay()  ───┐  (non-blocking)   │
└─────────────────────────────────────────────────┼─────────────────┘
                              │                   │
                              ▼                   ▼
                      PostgreSQL / SQLite     Celery + Redis
                   (conversations, messages,  (async sentiment →
                    locks · select_for_update) saved back to DB)
```

<div align="center">
<sub><b>Two independently deployable apps · stateless JSON REST API · JWT-secured</b></sub>
</div>

<br>

---

## 🧠 Key Design Decisions

Each choice below was a deliberate trade-off. Expand for the reasoning.

<details>
<summary><b>🔒 Database locking with <code>select_for_update()</code> — not Redis</b></summary>

<br>

The data that needs protecting (conversations) already lives in the relational database. Using `select_for_update()` inside a transaction gives **true row-level atomicity with the same system that already holds the truth** — no second source of state to keep consistent, no risk of a Redis flush silently dropping locks.

- **Atomic acquire** — two agents racing to open the same conversation can't both win.
- **Auto-expiry** — a lock expires after `LOCK_EXPIRY_SECONDS` (default 300s) of inactivity, tracked by `last_activity`. Replying "touches" the lock.
- **Read vs write** — other agents can always `GET` the thread, but `POST /reply` returns **`423 Locked`** if someone else holds a live lock.
- **Visibility** — the holder's name is returned by the lock endpoints and shown via `LockIndicator`.

> Redis would be the right call for *extremely* high lock churn — a documented, scale-dependent trade-off. For this workload, the DB approach is simpler, safer, and survives restarts.

</details>

<details>
<summary><b>📊 Celery for sentiment — not inline computation</b></summary>

<br>

Sentiment analysis is **non-critical to the agent's immediate action** and potentially slow. Blocking the reply request on it would make the UI feel sluggish for no reason.

The reply view only calls `analyze_sentiment.delay(conversation_id)` — this queues the task and returns **immediately** with `201`. A Celery worker computes and persists sentiment moments later. This is the classic **fast path vs slow path** separation.

> In tests, `CELERY_TASK_ALWAYS_EAGER=True` runs the task synchronously so no broker is needed.

</details>

<details>
<summary><b>🔄 Incremental HTTP polling — not WebSockets</b></summary>

<br>

| Option | Pros | Cons |
|--------|------|------|
| **Polling** ✅ | Zero extra infra; works behind any proxy/LB; stateless and JWT-friendly | ~3s latency; some wasted requests |
| WebSockets | True push, lowest latency | Needs ASGI + Channels + Redis channel layer + sticky sessions |
| SSE | Push, simpler than WS | One-way only; long-lived connections complicate scaling |

For a support inbox, **3-second latency is imperceptible**, and the operational simplicity is a big win. Polling is **incremental** — only messages with `id > after` are returned, so each poll is cheap. Critically, **the transport is isolated in `usePollMessages.ts`**, so swapping to SSE/WS later changes exactly one file.

</details>

<details>
<summary><b>⚡ Optimistic UI with rollback — for perceived speed</b></summary>

<br>

Agents send many replies per hour; waiting for a server round-trip each time is friction.

1. On send → render the message **instantly** with a temporary id and a greyed *"sending…"* state.
2. On success → **replace** the optimistic message with the confirmed server message (real id).
3. On failure → **remove** the message, show an **error toast**, and **restore the agent's text** so nothing is lost.

> Speed never comes at the cost of correctness — the rollback path is explicitly tested.

</details>

<details>
<summary><b>🧱 Thin views, fat services — separation of concerns</b></summary>

<br>

All locking, AI, and sentiment logic lives in `services.py`; views only validate input and delegate.

- **Testable** — call `LockService` directly without mocking HTTP.
- **Reusable** — the same logic works from a view, a Celery task, or a management command.
- **Readable** — views show *what* happens; services hold *how*.

</details>

<br>

---

## 🚀 Quick Start

### Option A — Docker (everything at once) 🐳

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| 🖥️ Frontend | http://localhost:3000 |
| ⚙️ Backend | http://localhost:8000 |
| 📊 Redis + Celery worker | auto-started |

Backend auto-migrates and seeds on boot. Log in with **`admin@test.com`** / **`admin123`**.

<br>

### Option B — Local (manual) 🔧

<details>
<summary><b>1️⃣ &nbsp;Backend</b></summary>

<br>

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed          # creates admin@test.com / admin123 + demo data
python manage.py runserver     # → http://localhost:8000
```

</details>

<details>
<summary><b>2️⃣ &nbsp;Celery worker</b> <sub>(separate terminal, needs Redis)</sub></summary>

<br>

```bash
cd backend
celery -A config worker -l info
```

> 💡 **No Redis handy?** Set `CELERY_TASK_ALWAYS_EAGER=True` and sentiment runs inline — no broker needed. The reply endpoint still returns immediately because it only calls `.delay()`.

</details>

<details>
<summary><b>3️⃣ &nbsp;Frontend</b> <sub>(separate terminal)</sub></summary>

<br>

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev                    # → http://localhost:3000
```

</details>

<br>

---

## 📡 API Reference

<sub>All endpoints except login require `Authorization: Bearer <access_token>`.</sub>

| Method | Endpoint | Description |
|:------:|----------|-------------|
| `POST` | `/api/auth/login/` | 🔑 Get JWT access + refresh |
| `POST` | `/api/auth/refresh/` | ♻️ Refresh access token |
| `GET` | `/api/conversations/?page=&search=&status=` | 📋 Paginated, searchable list |
| `GET` | `/api/conversations/{id}/` | 💬 Full message thread |
| `POST` | `/api/conversations/{id}/reply/` | ✍️ Agent reply (triggers async sentiment) |
| `POST` | `/api/conversations/{id}/suggest-reply/` | 🤖 Mock AI suggestion |
| `POST` | `/api/conversations/{id}/lock/` | 🔒 Acquire / refresh lock |
| `POST` | `/api/conversations/{id}/unlock/` | 🔓 Release lock |
| `GET` | `/api/conversations/{id}/lock/` | ℹ️ Lock status |
| `GET` | `/api/conversations/{id}/messages/?after={id}` | 🔄 Incremental messages (polling) |

<details>
<summary><b>📥 Example payloads & responses</b></summary>

<br>

**Login**
```jsonc
// POST /api/auth/login/   →   200 OK
{ "username": "admin@test.com", "password": "admin123" }

// response
{ "access": "eyJ...", "refresh": "eyJ..." }
```

**Conversation list item**
```jsonc
{
  "id": 1,
  "customer_name": "John Doe",
  "last_message": "Need help with my order",
  "status": "open",
  "created_at": "2026-01-01T12:00:00Z"
}
```

**Reply** → `201 Created` with the new message, or `423 Locked`:
```jsonc
{ "detail": "Conversation is locked by another agent.", "locked_by": "agent2@test.com" }
```

**Suggest-reply**
```jsonc
// POST { "message": "I want a refund" }   →   200 OK
{ "suggestion": "We're sorry for the inconvenience. I've started your refund…" }
```

</details>

<br>

---

## 🧪 Testing

<table>
<tr>
<td width="50%" valign="top">

### ⚙️ Backend — 13 tests
```bash
cd backend
CELERY_TASK_ALWAYS_EAGER=True python -m pytest
```

✅ JWT login + unauthorized rejection
✅ Paginated / searched / filtered list
✅ Conversation detail thread
✅ Lock transitions (acquire, block, takeover, expiry)
✅ `423 Locked` API response
✅ Celery sentiment (positive + negative)
✅ Mock AI suggestion (unit + API)
✅ Reply creates message

</td>
<td width="50%" valign="top">

### 🖥️ Frontend — 7 tests
```bash
cd frontend
npm test
```

**`ConversationList`**
✅ Loading state
✅ Populated list
✅ Empty state
✅ Error + retry

**`MessageComposer`**
✅ Optimistic insert → confirm
✅ Optimistic insert → rollback + toast
✅ Locked state disables replying

</td>
</tr>
</table>

<div align="center"><sub><b>20 / 20 passing</b> · backend verified end-to-end · frontend production build clean</sub></div>

<br>

---

## 📁 Project Structure

```
support-inbox/
├── 📂 backend/
│   ├── config/                    # settings, urls, celery, wsgi/asgi
│   ├── inbox/
│   │   ├── models.py              # Conversation · Message · ConversationLock
│   │   ├── serializers.py
│   │   ├── views.py               # thin ConversationViewSet
│   │   ├── services.py            # 🧠 LockService · SuggestionService · SentimentAnalyzer
│   │   ├── tasks.py               # Celery analyze_sentiment
│   │   ├── management/commands/seed.py
│   │   └── tests/test_views.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── 📂 frontend/
│   ├── src/
│   │   ├── app/                   # login · conversations · conversations/[id]
│   │   ├── components/            # ConversationList · MessageComposer · LockIndicator · Toast
│   │   ├── hooks/                 # usePollMessages  (🔄 real-time transport)
│   │   ├── lib/                   # api client · providers
│   │   └── types/
│   ├── __tests__/                 # ConversationList · MessageComposer
│   └── Dockerfile
│
├── 🐳 docker-compose.yml
└── 📖 README.md
```

<br>

---

## 🔮 Roadmap

- [ ] Swap polling → **WebSockets** (only `usePollMessages.ts` changes)
- [ ] Move locking → **Redis** for high-churn scale
- [ ] Real **LLM-powered** reply suggestions
- [ ] Read **replicas** + Redis caching for the conversation list
- [ ] **Queue routing** so urgent Celery tasks don't queue behind heavy ones
- [ ] OpenAPI / Swagger schema + Postman collection

<br>

---

<div align="center">

### Built with clean architecture, real tests, and deliberate trade-offs.

<sub>If this helped, consider giving it a ⭐</sub>

<br>

![Made with Django](https://img.shields.io/badge/Made_with-Django_+_Next.js-4f46e5?style=for-the-badge)

</div>
