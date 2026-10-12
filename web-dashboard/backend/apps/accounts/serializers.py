from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"non_field_errors": ["Expected a JSON object."]})
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({k: ["This field is not accepted."] for k in sorted(unknown)})
        return super().to_internal_value(data)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "organization", "role", "status", "created_at"]
        read_only_fields = fields


class RegistrationSerializer(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    first_name = serializers.CharField(max_length=100)
    last_name = serializers.CharField(max_length=100)
    organization = serializers.CharField(max_length=255)
    password = serializers.CharField(min_length=12, max_length=128, trim_whitespace=False, write_only=True)
    password_confirm = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_email(self, value):
        value = User.objects.normalize_email(value)
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": ["Passwords do not match."]})
        user = User(**{k: v for k, v in attrs.items() if not k.startswith("password")})
        try:
            validate_password(attrs["password"], user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return attrs


class LoginSerializer(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


class EmptySerializer(StrictSerializer):
    pass


class TransitionSerializer(StrictSerializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)


class UserListQuerySerializer(StrictSerializer):
    status = serializers.ChoiceField(choices=User.Status.choices, required=False)
    role = serializers.ChoiceField(choices=User.Role.choices, required=False)
    search = serializers.CharField(max_length=255, required=False, allow_blank=True)
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)


class UserCountQuerySerializer(StrictSerializer):
    role = serializers.ChoiceField(choices=User.Role.choices, required=False)
    search = serializers.CharField(max_length=255, required=False, allow_blank=True)


class UserStatusCountsSerializer(serializers.Serializer):
    pending = serializers.IntegerField()
    approved = serializers.IntegerField()
    suspended = serializers.IntegerField()
    rejected = serializers.IntegerField()


class UserCountsSerializer(serializers.Serializer):
    counts = UserStatusCountsSerializer()


class UserEnvelopeSerializer(serializers.Serializer):
    user = UserSerializer()
    session_expires_at = serializers.DateTimeField(
        help_text="Absolute expiry of the current session (eight hours after sign-in; never extended).")


class RegistrationResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    message = serializers.CharField()


class CSRFSerializer(serializers.Serializer):
    csrf_token = serializers.CharField()


class ErrorDetailSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    fields = serializers.DictField(child=serializers.ListField(child=serializers.CharField()))
    request_id = serializers.CharField()


class ErrorEnvelopeSerializer(serializers.Serializer):
    error = ErrorDetailSerializer()
