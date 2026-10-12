import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

KINDS = [("ore", "Material"), ("alumina", "Digestion"), ("secondary_metals", "Recovery")]


class ModelVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=24, choices=KINDS)
    artifact_name = models.CharField(max_length=255)
    sha256 = models.CharField(max_length=64)
    adapter_version = models.CharField(max_length=64)
    schema_version = models.CharField(max_length=16, default="1")
    metadata = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=[(x, x) for x in ["unverified", "enabled", "disabled"]],
                              default="unverified")
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=[x[0] for x in KINDS]), name="research_model_kind"),
            models.CheckConstraint(condition=Q(status__in=["unverified", "enabled", "disabled"]), name="research_model_status"),
            models.CheckConstraint(condition=~Q(status="enabled") | Q(verified_at__isnull=False),
                                   name="research_enabled_verified"),
            models.UniqueConstraint(fields=["kind", "sha256", "adapter_version", "schema_version"],
                                    name="research_model_identity"),
            models.UniqueConstraint(fields=["kind"], condition=Q(status="enabled"), name="research_one_enabled"),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            before = type(self).objects.get(pk=self.pk)
            fields = ["kind", "artifact_name", "sha256", "adapter_version", "schema_version", "metadata"]
            if any(getattr(before, field) != getattr(self, field) for field in fields):
                raise ValidationError("Model identity and metadata are immutable.")
        return super().save(*args, **kwargs)


class Prediction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    model_version = models.ForeignKey(ModelVersion, on_delete=models.PROTECT)
    kind = models.CharField(max_length=24, choices=KINDS)
    request_key = models.UUIDField()
    request_hash = models.CharField(max_length=64)
    input_data = models.JSONField()
    output_data = models.JSONField()
    schema_version = models.CharField(max_length=16, default="1")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "request_key"], name="research_request_unique"),
            models.CheckConstraint(condition=Q(kind__in=[x[0] for x in KINDS]), name="research_prediction_kind"),
        ]
        indexes = [
            models.Index(fields=["user", "created_at", "id"], name="research_history_idx"),
            models.Index(fields=["user", "kind", "created_at", "id"], name="research_kind_history_idx"),
            models.Index(fields=["created_at", "id"], name="research_activity_idx"),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Predictions are immutable.")
        if self.kind != self.model_version.kind or self.schema_version != self.model_version.schema_version:
            raise ValidationError("Prediction and model contracts must match.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Prediction history cannot be deleted.")


class Scenario(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    prediction = models.ForeignKey(Prediction, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["user", "updated_at", "id"], name="research_scenarios_idx")]

    def save(self, *args, **kwargs):
        if self.prediction.user_id != self.user_id:
            raise ValidationError("The prediction must belong to the scenario owner.")
        if not self._state.adding:
            before = type(self).objects.get(pk=self.pk)
            if before.user_id != self.user_id or before.prediction_id != self.prediction_id:
                raise ValidationError("Scenario ownership and prediction are immutable.")
        self.name = self.name.strip()
        if not self.name or len(self.name) > 120 or len(self.description) > 2000:
            raise ValidationError("Invalid scenario name or description.")
        return super().save(*args, **kwargs)
