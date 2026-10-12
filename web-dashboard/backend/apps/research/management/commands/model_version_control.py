import json

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.research.services import (
    disable_model_version,
    enable_model_version,
    verify_model_version,
)


class Command(BaseCommand):
    help = "Operator-only model version verification and activation control."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["verify", "enable", "disable"])
        parser.add_argument("kind", choices=["ore", "alumina", "secondary_metals", "secondary-metals"])
        parser.add_argument("--actor-email", required=True)
        parser.add_argument("--model-version-id")
        parser.add_argument("--request-id")

    def handle(self, *args, **options):
        action = options["action"]
        kind = options["kind"].replace("-", "_")
        actor_email = User.objects.normalize_email(options["actor_email"])
        actor = User.objects.filter(email__iexact=actor_email).first()
        if actor is None:
            raise CommandError("Operator account not found.")

        if action == "verify":
            version = verify_model_version(actor, kind, request_id=options.get("request_id") or "")
        elif action == "enable":
            model_version_id = options.get("model_version_id")
            if not model_version_id:
                raise CommandError("--model-version-id is required for enable.")
            version = enable_model_version(
                actor,
                kind,
                model_version_id=model_version_id,
                request_id=options.get("request_id") or "",
            )
        else:
            version = disable_model_version(actor, kind, request_id=options.get("request_id") or "")
        payload = {
            "action": action,
            "kind": kind,
            "model_version_id": str(version.pk) if version else None,
            "status": version.status if version else "unverified",
            "verified_at": version.verified_at.isoformat() if version and version.verified_at else None,
        }
        self.stdout.write(json.dumps(payload, sort_keys=True))
