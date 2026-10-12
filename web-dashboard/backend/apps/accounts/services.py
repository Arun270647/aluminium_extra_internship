from datetime import timedelta

from django.contrib.auth import login
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit.models import AuditEvent
from config.errors import ServiceError

from .models import User


def register_account(data):
    data = {k: v for k, v in data.items() if k != "password_confirm"}
    try:
        with transaction.atomic():
            user = User(**{k: v for k, v in data.items() if k != "password"})
            user.set_password(data["password"])
            user.save()
            return user
    except IntegrityError as exc:
        raise ValidationError({"email": ["An account with this email already exists."]}) from exc


def sign_in(request, data):
    email = User.objects.normalize_email(data["email"])
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        User().set_password(data["password"])  # keep timing similar for unknown emails
        raise ServiceError("invalid_credentials", "Email or password is incorrect.", 401)
    if not user.check_password(data["password"]):
        raise ServiceError("invalid_credentials", "Email or password is incorrect.", 401)
    with transaction.atomic():
        current = User.objects.select_for_update().get(pk=user.pk)
        if current.password != user.password:
            raise ServiceError("invalid_credentials", "Email or password is incorrect.", 401)
        messages = {
            "pending": "Your account is awaiting administrator approval.",
            "rejected": "Your access request was not approved. Contact your administrator.",
            "suspended": "Your access is suspended. Contact your administrator.",
        }
        if current.status != "approved" or not current.is_active:
            raise ServiceError(f"account_{current.status}", messages.get(current.status, "Access is unavailable."), 403)
        login(request, current, backend="django.contrib.auth.backends.ModelBackend")
        request.session.set_expiry(timezone.now() + timedelta(hours=8))
    return current


TRANSITIONS = {
    "approve": ("pending", "approved", "account_approved"),
    "reject": ("pending", "rejected", "account_rejected"),
    "suspend": ("approved", "suspended", "account_suspended"),
    "reactivate": ("suspended", "approved", "account_reactivated"),
}


@transaction.atomic
def transition_account(actor, target_id, action, reason, request_id):
    if action not in TRANSITIONS:
        raise ServiceError("not_found", "Unknown account action.", 404)
    # lock both rows in a fixed order
    locked = {u.pk: u for u in User.objects.select_for_update().filter(
        pk__in=[actor.pk, target_id]).order_by("pk")}
    actor = locked.get(actor.pk)
    if not actor or actor.role != "admin" or actor.status != "approved" or not actor.is_active:
        raise ServiceError("permission_denied", "Administrator access is required.", 403)
    target = locked.get(target_id)
    if target is None:
        raise ServiceError("not_found", "Account not found.", 404)
    if target.pk == actor.pk or target.role != "user":
        raise ServiceError("permission_denied", "This account is managed by an operator.", 403)
    previous, following, event = TRANSITIONS[action]
    if target.status != previous:
        raise ServiceError("invalid_transition", "This account has changed. Refresh and review its current status.", 409)
    reason = reason.strip()
    if len(reason) > 500 or (action in {"reject", "suspend"} and not reason):
        raise ValidationError({"reason": ["Enter a reason of 1–500 characters."]})
    target.status = following
    target.is_active = following == "approved"
    target.is_staff = False
    target.reviewed_by = actor
    target.reviewed_at = timezone.now()
    target.review_reason = reason
    target.save(update_fields=["status", "is_active", "is_staff", "reviewed_by",
                              "reviewed_at", "review_reason", "updated_at"])
    AuditEvent.objects.create(actor=actor, action=event, target_type="user", target_id=target.pk,
                              request_id=request_id,
                              metadata={"previous_status": previous, "new_status": following, "reason": reason})
    return target
