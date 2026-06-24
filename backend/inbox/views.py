"""
Thin DRF views. Business logic lives in services.py.

Endpoints:
  GET  /api/conversations/                 list (paginated, search, status filter)
  GET  /api/conversations/{id}/            full thread
  POST /api/conversations/{id}/reply       agent reply (+ async sentiment)
  POST /api/conversations/{id}/suggest-reply  mock AI suggestion
  POST /api/conversations/{id}/lock        acquire lock
  POST /api/conversations/{id}/unlock      release lock
  GET  /api/conversations/{id}/lock        lock status
  GET  /api/conversations/{id}/messages    poll messages (real-time via polling)
"""
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Conversation, Message
from .serializers import (
    ConversationDetailSerializer,
    ConversationListSerializer,
    MessageDetailSerializer,
    ReplySerializer,
    SuggestSerializer,
)
from .services import LockService, SuggestionService
from .tasks import analyze_sentiment


class ConversationViewSet(viewsets.ReadOnlyModelViewSet):
    """Read endpoints + custom actions for reply/suggest/lock."""

    def get_queryset(self):
        qs = Conversation.objects.all()
        search = self.request.query_params.get("search")
        status_filter = self.request.query_params.get("status")
        if search:
            qs = qs.filter(customer_name__icontains=search)
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ConversationDetailSerializer
        return ConversationListSerializer

    # ── reply ────────────────────────────────────────────────
    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        conversation = get_object_or_404(Conversation, pk=pk)

        # Locking: block reply if another agent holds the lock
        if not LockService.can_reply(conversation, request.user):
            lock_status = LockService.status(conversation, request.user)
            return Response(
                {
                    "detail": "Conversation is locked by another agent.",
                    "locked_by": lock_status.holder_name,
                },
                status=status.HTTP_423_LOCKED,
            )

        serializer = ReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        message = Message.objects.create(
            conversation=conversation,
            sender=Message.Sender.AGENT,
            message=serializer.validated_data["message"],
        )
        # Refresh the lock's inactivity timer if held by this user
        if hasattr(conversation, "lock") and conversation.lock.holder_id == request.user.id:
            conversation.lock.touch()

        # Bump conversation ordering
        conversation.save(update_fields=["updated_at"])

        # Fire async sentiment — response must NOT wait for it
        analyze_sentiment.delay(conversation.id)

        return Response(
            MessageDetailSerializer(message).data, status=status.HTTP_201_CREATED
        )

    # ── suggest-reply ────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="suggest-reply")
    def suggest_reply(self, request, pk=None):
        get_object_or_404(Conversation, pk=pk)
        serializer = SuggestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        suggestion = SuggestionService.suggest(serializer.validated_data["message"])
        return Response({"suggestion": suggestion}, status=status.HTTP_200_OK)

    # ── lock / unlock / status ───────────────────────────────
    @action(detail=True, methods=["post"])
    def lock(self, request, pk=None):
        conversation = get_object_or_404(Conversation, pk=pk)
        result = LockService.acquire(conversation, request.user)
        return Response(
            {
                "locked": result.locked,
                "owned_by_me": result.owned_by_me,
                "holder_id": result.holder_id,
                "holder_name": result.holder_name,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        conversation = get_object_or_404(Conversation, pk=pk)
        released = LockService.release(conversation, request.user)
        return Response({"released": released}, status=status.HTTP_200_OK)

    @lock.mapping.get
    def lock_status(self, request, pk=None):
        conversation = get_object_or_404(Conversation, pk=pk)
        result = LockService.status(conversation, request.user)
        return Response(
            {
                "locked": result.locked,
                "owned_by_me": result.owned_by_me,
                "holder_id": result.holder_id,
                "holder_name": result.holder_name,
            },
            status=status.HTTP_200_OK,
        )

    # ── messages (polling endpoint for real-time) ────────────
    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        conversation = get_object_or_404(Conversation, pk=pk)
        qs = conversation.messages.all()
        after = request.query_params.get("after")
        if after:
            qs = qs.filter(id__gt=after)
        return Response(MessageDetailSerializer(qs, many=True).data)
