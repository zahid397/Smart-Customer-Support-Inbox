"""
Seed command: creates the admin user and demo conversations.

Usage:
    python manage.py seed
Creates:
    admin@test.com / admin123  (+ a second agent for lock demos)
    several demo conversations with message threads
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from inbox.models import Conversation, Message


class Command(BaseCommand):
    help = "Seed the database with an admin user and demo conversations."

    def handle(self, *args, **options):
        # ── Users ────────────────────────────────────────────
        admin, created = User.objects.get_or_create(
            username="admin@test.com",
            defaults={"email": "admin@test.com", "is_staff": True, "is_superuser": True},
        )
        admin.set_password("admin123")
        admin.email = "admin@test.com"
        admin.is_staff = True
        admin.is_superuser = True
        admin.save()
        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Updated'} admin: admin@test.com / admin123"
        ))

        # A second agent so locking can be demonstrated
        agent2, _ = User.objects.get_or_create(
            username="agent2@test.com",
            defaults={"email": "agent2@test.com"},
        )
        agent2.set_password("agent123")
        agent2.email = "agent2@test.com"
        agent2.save()
        self.stdout.write(self.style.SUCCESS("Second agent: agent2@test.com / agent123"))

        # ── Demo conversations ───────────────────────────────
        if Conversation.objects.exists():
            self.stdout.write("Conversations already exist — skipping demo seed.")
            return

        demo = [
            ("John Doe", "open", [
                ("customer", "Need help with my order #12345"),
                ("customer", "It still hasn't arrived and I'm worried."),
            ]),
            ("Sarah Smith", "open", [
                ("customer", "I want a refund for my last purchase."),
                ("agent", "I understand, let me look into that for you."),
                ("customer", "Thank you, I appreciate the quick response!"),
            ]),
            ("Mike Johnson", "pending", [
                ("customer", "The app keeps crashing when I open settings."),
            ]),
            ("Emily Brown", "closed", [
                ("customer", "How do I reset my password?"),
                ("agent", "I've sent you a reset link — check your email."),
                ("customer", "Got it, thanks! Works perfectly now."),
            ]),
            ("David Wilson", "open", [
                ("customer", "This is the worst experience, I'm very frustrated."),
                ("customer", "Nothing works and nobody is helping me!"),
            ]),
        ]

        for name, status_val, msgs in demo:
            conv = Conversation.objects.create(customer_name=name, status=status_val)
            for sender, text in msgs:
                Message.objects.create(conversation=conv, sender=sender, message=text)

        self.stdout.write(self.style.SUCCESS(
            f"Created {len(demo)} demo conversations."
        ))
