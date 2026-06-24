"""DRF serializers for conversations and messages."""
from rest_framework import serializers

from .models import Conversation, Message


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["sender", "message"]


class MessageDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ["id", "sender", "message", "created_at"]


class ConversationListSerializer(serializers.ModelSerializer):
    """Matches the required list payload contract."""
    last_message = serializers.CharField(read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "customer_name", "last_message", "status", "created_at"]


class ConversationDetailSerializer(serializers.ModelSerializer):
    messages = MessageDetailSerializer(many=True, read_only=True)

    class Meta:
        model = Conversation
        fields = [
            "id", "customer_name", "status", "sentiment",
            "created_at", "updated_at", "messages",
        ]


class ReplySerializer(serializers.Serializer):
    message = serializers.CharField(allow_blank=False, trim_whitespace=True)


class SuggestSerializer(serializers.Serializer):
    message = serializers.CharField(allow_blank=True, required=False, default="")
