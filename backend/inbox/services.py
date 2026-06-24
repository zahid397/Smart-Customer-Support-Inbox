"""
Business logic layer. Views stay thin and delegate here.

Contains:
  - LockService:   atomic acquire / release / refresh of conversation locks
  - SuggestionService: keyword/template-based mock AI reply suggestions
"""
from __future__ import annotations

from dataclasses import dataclass

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import Conversation, ConversationLock, Message


# ─────────────────────────────────────────────────────────────
# Locking
# ─────────────────────────────────────────────────────────────
@dataclass
class LockResult:
    locked: bool          # is the conversation currently locked?
    owned_by_me: bool     # does the requesting user hold the lock?
    holder_id: int | None
    holder_name: str | None


class LockService:
    """
    Atomic conversation locking using a DB row + select_for_update.
    A lock auto-expires after settings.LOCK_EXPIRY_SECONDS of inactivity.
    """

    @staticmethod
    @transaction.atomic
    def acquire(conversation: Conversation, user: User) -> LockResult:
        """
        Acquire (or refresh) the lock for `user`. If another agent holds a
        non-expired lock, returns a result indicating it's locked by them.
        """
        # Lock the conversation row to serialize concurrent acquire calls
        conv = Conversation.objects.select_for_update().get(pk=conversation.pk)

        lock = ConversationLock.objects.select_for_update().filter(conversation=conv).first()

        if lock is None:
            lock = ConversationLock.objects.create(conversation=conv, holder=user)
            return LockResult(True, True, user.id, _name(user))

        # Existing lock — take it over if expired or already ours
        if lock.is_expired or lock.holder_id == user.id:
            lock.holder = user
            lock.acquired_at = timezone.now()
            lock.last_activity = timezone.now()
            lock.save()
            return LockResult(True, True, user.id, _name(user))

        # Held by someone else and still valid
        return LockResult(True, False, lock.holder_id, _name(lock.holder))

    @staticmethod
    @transaction.atomic
    def release(conversation: Conversation, user: User) -> bool:
        """Release the lock if `user` holds it. Returns True if released."""
        lock = ConversationLock.objects.select_for_update().filter(
            conversation=conversation
        ).first()
        if lock and lock.holder_id == user.id:
            lock.delete()
            return True
        return False

    @staticmethod
    def status(conversation: Conversation, user: User) -> LockResult:
        """Read current lock status without acquiring."""
        lock = getattr(conversation, "lock", None)
        if lock is None or lock.is_expired:
            return LockResult(False, False, None, None)
        return LockResult(
            True, lock.holder_id == user.id, lock.holder_id, _name(lock.holder)
        )

    @staticmethod
    def can_reply(conversation: Conversation, user: User) -> bool:
        """A user may reply only if unlocked or they hold the lock."""
        lock = getattr(conversation, "lock", None)
        if lock is None or lock.is_expired:
            return True
        return lock.holder_id == user.id


def _name(user: User) -> str:
    return user.get_full_name() or user.email or user.username


# ─────────────────────────────────────────────────────────────
# Mock AI suggestion engine (no external API)
# ─────────────────────────────────────────────────────────────
class SuggestionService:
    """
    Keyword/template-based reply suggestions. Deterministic and offline.
    Rules are checked in order; first match wins; otherwise a default.
    """

    RULES: list[tuple[tuple[str, ...], str]] = [
        (
            ("refund", "money back", "reimburse"),
            "We're sorry for the inconvenience. I've started your refund — "
            "you'll see it on your original payment method within 5–7 business days.",
        ),
        (
            ("cancel", "cancellation", "unsubscribe"),
            "I can help you cancel that. I've processed the cancellation and "
            "you won't be charged again. Is there anything else I can do?",
        ),
        (
            ("broken", "not working", "defective", "error", "bug", "crash"),
            "I'm sorry you're running into this. Could you share a screenshot or "
            "the exact error message? In the meantime, try restarting — that "
            "resolves most cases.",
        ),
        (
            ("delivery", "shipping", "track", "where is my order", "arrive"),
            "Thanks for reaching out! Your order is on its way. You can track it "
            "with the link in your confirmation email. Let me know if it doesn't arrive on time.",
        ),
        (
            ("password", "login", "can't log in", "locked out", "reset"),
            "No problem — I've sent a password reset link to your registered email. "
            "Follow it to set a new password and regain access.",
        ),
        (
            ("price", "cost", "charge", "billing", "invoice"),
            "Happy to clarify your billing. I've reviewed your account — let me "
            "know which charge you'd like explained and I'll break it down.",
        ),
        (
            ("thank", "thanks", "great", "awesome", "love"),
            "Thank you so much for the kind words! It means a lot. "
            "Don't hesitate to reach out if you need anything else. 😊",
        ),
        (
            ("angry", "terrible", "worst", "frustrated", "unacceptable"),
            "I completely understand your frustration, and I'm sorry we let you down. "
            "Let me make this right for you personally — here's what I'll do next.",
        ),
    ]

    DEFAULT = (
        "Thanks for reaching out! I understand your concern and I'm here to help. "
        "Could you share a little more detail so I can assist you better?"
    )

    @classmethod
    def suggest(cls, message: str) -> str:
        text = (message or "").lower()
        for keywords, reply in cls.RULES:
            if any(k in text for k in keywords):
                return reply
        return cls.DEFAULT


# ─────────────────────────────────────────────────────────────
# Sentiment (used by the Celery task; kept here as pure logic)
# ─────────────────────────────────────────────────────────────
class SentimentAnalyzer:
    POSITIVE = {"thank", "thanks", "great", "awesome", "love", "happy", "perfect", "good", "excellent", "appreciate"}
    NEGATIVE = {"angry", "terrible", "worst", "frustrated", "unacceptable", "bad", "broken", "hate", "refund", "cancel", "disappointed"}

    @classmethod
    def analyze(cls, conversation: Conversation) -> str:
        text = " ".join(
            conversation.messages.values_list("message", flat=True)
        ).lower()
        pos = sum(1 for w in cls.POSITIVE if w in text)
        neg = sum(1 for w in cls.NEGATIVE if w in text)
        if pos > neg:
            return Conversation.Sentiment.POSITIVE
        if neg > pos:
            return Conversation.Sentiment.NEGATIVE
        return Conversation.Sentiment.NEUTRAL
