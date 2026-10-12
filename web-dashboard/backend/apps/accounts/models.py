import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils.crypto import salted_hmac


class UserManager(BaseUserManager):
    @classmethod
    def normalize_email(cls, email):
        return super().normalize_email(email.strip()).lower()

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required.")
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.is_active = user.status == "approved"
        user.is_staff = user.is_active and user.role == "admin"
        user.set_password(password)
        user.full_clean(exclude=["password"])
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        for field, value in {"role": "admin", "status": "approved", "is_superuser": True}.items():
            if field in extra_fields and extra_fields[field] != value:
                raise ValueError(f"A superuser must have {field}={value}.")
            extra_fields[field] = value
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        USER = "user", "User"
        ADMIN = "admin", "Administrator"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        SUSPENDED = "suspended", "Suspended"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    organization = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=Role, default=Role.USER)
    status = models.CharField(max_length=10, choices=Status, default=Status.PENDING)
    is_active = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_reason = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name", "organization"]

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower("email"), name="user_email_case_unique"),
            models.CheckConstraint(condition=Q(role__in=["user", "admin"]), name="user_valid_role"),
            models.CheckConstraint(condition=Q(status__in=["pending", "approved", "rejected", "suspended"]),
                                   name="user_valid_status"),
            models.CheckConstraint(
                condition=(Q(status="approved", is_active=True) | (~Q(status="approved") & Q(is_active=False))),
                name="user_active_matches_status"),
            models.CheckConstraint(
                condition=(Q(role="admin", status="approved", is_staff=True) |
                           (~Q(role="admin", status="approved") & Q(is_staff=False))),
                name="user_staff_matches_role_status"),
            models.CheckConstraint(
                condition=Q(is_superuser=False) | Q(role="admin", status="approved"),
                name="user_superuser_is_approved_admin"),
        ]
        indexes = [models.Index(fields=["status", "created_at"], name="user_review_queue_idx")]

    def __str__(self):
        return self.email

    def _get_session_auth_hash(self, secret=None):
        # status change invalidates older sessions
        reviewed = self.reviewed_at.isoformat() if self.reviewed_at else ""
        return salted_hmac(
            "accounts.User.session_auth_hash",
            f"{self.password}:{self.role}:{self.status}:{reviewed}",
            secret=secret,
            algorithm="sha256",
        ).hexdigest()
