import uuid

from django.conf import settings
from django.db import models


class AuditEvent(models.Model):
    class Action(models.TextChoices):
        APPROVED = "account_approved"
        REJECTED = "account_rejected"
        SUSPENDED = "account_suspended"
        REACTIVATED = "account_reactivated"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=40, choices=Action)
    target_type = models.CharField(max_length=40)
    target_id = models.UUIDField()
    request_id = models.CharField(max_length=64)
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["created_at", "id"], name="audit_created_idx"),
            models.Index(fields=["target_type", "target_id", "created_at"], name="audit_target_idx"),
        ]
