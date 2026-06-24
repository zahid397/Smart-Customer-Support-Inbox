from django.contrib import admin
from .models import Conversation, Message, ConversationLock

@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "customer_name", "status", "sentiment", "created_at")
    list_filter = ("status", "sentiment")
    search_fields = ("customer_name",)

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "sender", "created_at")

@admin.register(ConversationLock)
class ConversationLockAdmin(admin.ModelAdmin):
    list_display = ("conversation", "holder", "last_activity")
