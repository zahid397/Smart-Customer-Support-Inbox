"""
Data models for the support inbox.

Conversation     — a customer support thread with status + sentiment.
Message          — an individual message (from customer or agent).
ConversationLock — an atomic, auto-expiring lock so only one agent
                   can reply to a conversation at a time.
"""
from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


class Conversation(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        PENDING = "pending", "Pending"
        CLOSED = "closed", "Closed"

    class Sentiment(models.TextChoices):
        POSITIVE = "Positive", "Positive"
        NEUTRAL = "Neutral", "Neutral"
        NEGATIVE = "Negative", "Negative"
        UNKNOWN = "Unknown", "Unknown"

    customer_name = models.CharField(max_length=255)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN
    )
    sentiment = models.CharField(
        max_length=20, choices=Sentiment.choices, default=Sentiment.UNKNOWN
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]

    def __str__(self) -> str:
        return f"{self.customer_name} ({self.status})"

    @property
    def last_message(self) -> str:
        msg = self.messages.order_by("-created_at").first()
        return msg.message if msg else ""


class Message(models.Model):
    class Sender(models.TextChoices):
        CUSTOMER = "customer", "Customer"
        AGENT = "agent", "Agent"

    conversation = models.ForeignKey(
        Conversation, related_name="messages", on_delete=models.CASCADE
    )
    sender = models.CharField(max_length=20, choices=Sender.choices)
    message = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.sender}: {self.message[:40]}"


class ConversationLock(models.Model):
    """
    One-to-one lock per conversation. Presence of a non-expired row means the
    conversation is locked by `holder`. Auto-expires after LOCK_EXPIRY_SECONDS
    of inactivity (tracked via `last_activity`).
    """
    conversation = models.OneToOneField(
        Conversation, related_name="lock", on_delete=models.CASCADE
    )
    holder = models.ForeignKey(User, on_delete=models.CASCADE)
    acquired_at = models.DateTimeField(default=timezone.now)
    last_activity = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"Lock[{self.conversation_id}] by {self.holder.email or self.holder.username}"

    @property
    def is_expired(self) -> bool:
        age = (timezone.now() - self.last_activity).total_seconds()
        return age > settings.LOCK_EXPIRY_SECONDS

    def touch(self) -> None:
        """Refresh the inactivity timer."""
        self.last_activity = timezone.now()
        self.save(update_fields=["last_activity"])
