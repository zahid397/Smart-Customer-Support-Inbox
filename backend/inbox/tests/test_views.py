"""
Backend test suite.

Covers (per assessment requirements):
  - JWT auth flow
  - Paginated + filtered conversation retrieval
  - Locking state transitions (acquire, block other agent, takeover)
  - Celery sentiment task (eager mode)
  - Mock AI suggestion
  - Optimistic-reply endpoint behavior
"""
import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from inbox.models import Conversation, ConversationLock, Message
from inbox.services import LockService, SentimentAnalyzer, SuggestionService
from inbox.tasks import analyze_sentiment


# ── Fixtures ─────────────────────────────────────────────────
@pytest.fixture
def agent(db):
    u = User.objects.create(username="agent@test.com", email="agent@test.com")
    u.set_password("pass123")
    u.save()
    return u


@pytest.fixture
def agent2(db):
    u = User.objects.create(username="other@test.com", email="other@test.com")
    u.set_password("pass123")
    u.save()
    return u


@pytest.fixture
def conversation(db):
    conv = Conversation.objects.create(customer_name="John Doe", status="open")
    Message.objects.create(conversation=conv, sender="customer", message="Need help with my order")
    return conv


@pytest.fixture
def auth_client(agent):
    client = APIClient()
    resp = client.post(
        "/api/auth/login/",
        {"username": "agent@test.com", "password": "pass123"},
        format="json",
    )
    token = resp.data["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


# ── 1. JWT auth flow (API test) ──────────────────────────────
@pytest.mark.django_db
def test_jwt_login_returns_tokens(agent):
    client = APIClient()
    resp = client.post(
        "/api/auth/login/",
        {"username": "agent@test.com", "password": "pass123"},
        format="json",
    )
    assert resp.status_code == 200
    assert "access" in resp.data and "refresh" in resp.data


@pytest.mark.django_db
def test_unauthenticated_request_is_rejected():
    client = APIClient()
    resp = client.get("/api/conversations/")
    assert resp.status_code == 401


# ── 2. Paginated + filtered retrieval (API test) ─────────────
@pytest.mark.django_db
def test_conversation_list_paginated_and_filtered(auth_client):
    for i in range(15):
        Conversation.objects.create(customer_name=f"Cust {i}", status="open")
    Conversation.objects.create(customer_name="Special Closed", status="closed")

    resp = auth_client.get("/api/conversations/")
    assert resp.status_code == 200
    assert resp.data["count"] >= 16
    assert len(resp.data["results"]) == 10  # PAGE_SIZE

    # search
    resp = auth_client.get("/api/conversations/?search=Special")
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["customer_name"] == "Special Closed"

    # status filter
    resp = auth_client.get("/api/conversations/?status=closed")
    assert all(c["status"] == "closed" for c in resp.data["results"])


@pytest.mark.django_db
def test_conversation_detail_returns_thread(auth_client, conversation):
    resp = auth_client.get(f"/api/conversations/{conversation.id}/")
    assert resp.status_code == 200
    assert resp.data["customer_name"] == "John Doe"
    assert len(resp.data["messages"]) == 1
    assert resp.data["messages"][0]["sender"] == "customer"


# ── 3. Locking state transitions (unit) ─────────────────────
@pytest.mark.django_db
def test_lock_acquire_and_block_other_agent(conversation, agent, agent2):
    # agent acquires
    r1 = LockService.acquire(conversation, agent)
    assert r1.locked and r1.owned_by_me

    # agent2 cannot reply
    assert LockService.can_reply(conversation, agent2) is False
    # but agent can
    assert LockService.can_reply(conversation, agent) is True

    # agent2 acquire returns locked-by-other
    r2 = LockService.acquire(conversation, agent2)
    assert r2.locked and not r2.owned_by_me
    assert r2.holder_id == agent.id


@pytest.mark.django_db
def test_lock_release_allows_takeover(conversation, agent, agent2):
    LockService.acquire(conversation, agent)
    assert LockService.release(conversation, agent) is True
    # now agent2 can acquire
    r = LockService.acquire(conversation, agent2)
    assert r.owned_by_me is True


@pytest.mark.django_db
def test_expired_lock_can_be_taken_over(conversation, agent, agent2, settings):
    settings.LOCK_EXPIRY_SECONDS = 0  # everything is immediately expired
    LockService.acquire(conversation, agent)
    # agent2 may reply because the lock is expired
    assert LockService.can_reply(conversation, agent2) is True


# ── 4. Locking via API (423 LOCKED) ─────────────────────────
@pytest.mark.django_db
def test_reply_blocked_when_locked_by_other(auth_client, conversation, agent2):
    # agent2 holds the lock
    LockService.acquire(conversation, agent2)
    resp = auth_client.post(
        f"/api/conversations/{conversation.id}/reply/",
        {"message": "Hello"},
        format="json",
    )
    assert resp.status_code == 423
    assert "locked_by" in resp.data


# ── 5. Celery sentiment task (eager) ─────────────────────────
@pytest.mark.django_db
def test_sentiment_task_sets_positive(settings):
    conv = Conversation.objects.create(customer_name="Happy", status="open")
    Message.objects.create(conversation=conv, sender="customer", message="Thank you, this is great and awesome!")
    result = analyze_sentiment(conv.id)  # call directly (eager)
    conv.refresh_from_db()
    assert result == "Positive"
    assert conv.sentiment == "Positive"


@pytest.mark.django_db
def test_sentiment_task_sets_negative():
    conv = Conversation.objects.create(customer_name="Angry", status="open")
    Message.objects.create(conversation=conv, sender="customer", message="This is terrible and broken, I want a refund, worst ever")
    result = analyze_sentiment(conv.id)
    assert result == "Negative"


# ── 6. Mock AI suggestion (unit + API) ───────────────────────
def test_suggestion_service_refund_keyword():
    s = SuggestionService.suggest("I want a refund please")
    assert "refund" in s.lower()


@pytest.mark.django_db
def test_suggest_reply_endpoint(auth_client, conversation):
    resp = auth_client.post(
        f"/api/conversations/{conversation.id}/suggest-reply/",
        {"message": "Customer wants a refund"},
        format="json",
    )
    assert resp.status_code == 200
    assert "suggestion" in resp.data
    assert len(resp.data["suggestion"]) > 0


# ── 7. Reply creates message + returns 201 ───────────────────
@pytest.mark.django_db
def test_agent_reply_creates_message(auth_client, conversation, settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    resp = auth_client.post(
        f"/api/conversations/{conversation.id}/reply/",
        {"message": "Sure, I can help with that."},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["sender"] == "agent"
    assert conversation.messages.filter(sender="agent").count() == 1
