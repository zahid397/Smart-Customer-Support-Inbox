"""Celery tasks. Sentiment analysis runs asynchronously off the reply path."""
from celery import shared_task

from .models import Conversation
from .services import SentimentAnalyzer


@shared_task
def analyze_sentiment(conversation_id: int) -> str:
    """
    Compute and persist conversation sentiment. Triggered after an agent
    reply; the HTTP response does NOT wait for this.
    """
    try:
        conversation = Conversation.objects.get(pk=conversation_id)
    except Conversation.DoesNotExist:
        return "Unknown"

    sentiment = SentimentAnalyzer.analyze(conversation)
    conversation.sentiment = sentiment
    conversation.save(update_fields=["sentiment"])
    return sentiment
