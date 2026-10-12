import csv
import io
import math
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from config.errors import ServiceError

from .ml.registry import MANIFESTS
from .ml.registry import clear_cache as clear_model_cache
from .models import ModelVersion, Prediction, Scenario
from .test_fixtures import historical_scenario


class ResearchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        details = dict(first_name="Test", last_name="Analyst", organization="Synthetic laboratory", status="approved")
        cls.owner = User.objects.create_user("records-a@example.test", "Sample-long-test-secret", **details)
        cls.other = User.objects.create_user("records-b@example.test", "Sample-long-test-secret", **details)
        cls.admin = User.objects.create_superuser("review@example.test", "Sample-long-test-secret",
                                                  first_name="Review", last_name="Admin", organization="Test")
        cls.first = historical_scenario(cls.owner, "First")
        cls.second = historical_scenario(cls.owner, "Second", variant=1)
        cls.foreign = historical_scenario(cls.other, "Private")
        cls.ore = historical_scenario(cls.owner, "Material", kind="ore")

    def setUp(self):
        cache.clear()
        clear_model_cache()
        self.client = APIClient(enforce_csrf_checks=True)
        self.authenticate(self.owner)

    def authenticate(self, user):
        self.client.force_login(user)
        token = self.client.get("/api/v1/auth/csrf/").data["csrf_token"]
        self.client.credentials(HTTP_X_CSRFTOKEN=token)

    def get(self, route):
        return self.client.get("/api/v1" + route)

    def post_prediction(self, kind, payload, key=None):
        headers = {"HTTP_IDEMPOTENCY_KEY": str(key or uuid.uuid4())}
        return self.client.post(f"/api/v1/predictions/{kind}/", payload, format="json", **headers)

    def test_anonymous_and_suspended_denied_on_every_record_boundary(self):
        routes = ["/models/", "/predictions/", f"/predictions/{self.first.prediction_id}/", "/predictions/export/",
                  "/scenarios/", f"/scenarios/{self.first.pk}/", f"/scenarios/compare/?ids={self.first.pk},{self.second.pk}",
                  f"/scenarios/compare/export/?ids={self.first.pk},{self.second.pk}"]
        self.client.logout()
        for route in routes:
            self.assertEqual(self.get(route).status_code, 403, route)
        self.client.force_login(self.owner)
        User.objects.filter(pk=self.owner.pk).update(status="suspended", is_active=False)
        for route in routes:
            self.assertEqual(self.get(route).status_code, 403, route)

    def test_admin_cannot_access_analyst_research_routes(self):
        self.authenticate(self.admin)
        routes = ["/models/", "/predictions/", f"/predictions/{self.first.prediction_id}/", "/predictions/export/",
                  "/scenarios/", f"/scenarios/{self.first.pk}/", f"/scenarios/compare/?ids={self.first.pk},{self.second.pk}",
                  f"/scenarios/compare/export/?ids={self.first.pk},{self.second.pk}"]
        for route in routes:
            response = self.get(route)
            self.assertEqual(response.status_code, 403, route)
            self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_owned_history_detail_and_filters(self):
        response = self.get("/predictions/?page_size=1")
        self.assertEqual(response.data["count"], 3)
        self.assertTrue(response.data["next"].startswith("/api/v1/predictions/"))
        self.assertEqual(self.get(f"/predictions/{self.foreign.prediction_id}/").status_code, 404)
        self.assertEqual(self.get("/predictions/?kind=alumina").data["count"], 2)
        boundary = timezone.now() - timedelta(days=1)
        Prediction.objects.filter(pk=self.first.prediction_id).update(created_at=boundary)
        at = boundary.isoformat().replace("+00:00", "Z")
        self.assertEqual(self.get(f"/predictions/?date_from={at}").data["count"], 3)
        self.assertEqual(self.get(f"/predictions/?date_to={at}").data["count"], 0)
        self.assertEqual(self.get("/predictions/?kind=bad").status_code, 400)
        self.assertEqual(self.get("/predictions/?page_size=101").status_code, 400)
        self.assertEqual(self.get("/predictions/?owner=someone").status_code, 400)
        self.assertEqual(self.get("/predictions/?date_from=2026-09-02&date_to=2026-09-01").status_code, 400)

    def test_result_summaries_are_owned_and_derived_from_saved_outputs(self):
        history = self.get("/predictions/?page_size=100").data["results"]
        summaries = {item["id"]: item["result_summary"] for item in history}
        self.assertNotIn(str(self.foreign.prediction_id), summaries)
        self.assertEqual(summaries[str(self.first.prediction_id)], "70.0 %")
        self.assertEqual(summaries[str(self.ore.prediction_id)], "High · A/S 6.00")
        scenarios = {item["id"]: item for item in self.get("/scenarios/?page_size=100").data["results"]}
        self.assertNotIn(str(self.foreign.pk), scenarios)
        self.assertEqual(scenarios[str(self.second.pk)]["result_summary"], "71.0 %")
        self.assertEqual(scenarios[str(self.second.pk)]["model_label"], "synthetic-test-only vtest-only")
        detail = self.get(f"/scenarios/{self.ore.pk}/").data
        self.assertEqual(detail["result_summary"], "High · A/S 6.00")
        self.assertEqual(detail["prediction"]["model_label"], "synthetic-test-only vtest-only")
        metals = historical_scenario(self.owner, "Metals", kind="secondary_metals")
        self.assertEqual(self.get(f"/scenarios/{metals.pk}/").data["result_summary"], "Li 50.0 · Ga 51.0 · Sc 52.0 %")
        self.assertEqual(self.get(f"/scenarios/{self.foreign.pk}/").status_code, 404)

    def test_history_rows_carry_detail_scenario_name_and_model_label(self):
        metals = historical_scenario(self.owner, "Metals", kind="secondary_metals")
        rows = {item["id"]: item for item in self.get("/predictions/?page_size=100").data["results"]}
        first, ore, metal = (rows[str(x.prediction_id)] for x in (self.first, self.ore, metals))
        self.assertEqual(first["result_detail"], "70.0 % · roasted · lime 0 %")
        self.assertEqual(ore["result_detail"], "High grade · A/S 6.00 · classifier high (75.0 %) · cluster 0")
        self.assertEqual(metal["result_detail"], "Li 50.0 % · Ga 51.0 % · Sc 52.0 % · digestion 250 °C")
        self.assertEqual(first["scenario_name"], "First")
        self.assertEqual(first["model_label"], "synthetic-test-only vtest-only")
        Scenario.objects.filter(pk=self.first.pk).delete()
        rows = {item["id"]: item for item in self.get("/predictions/?page_size=100").data["results"]}
        self.assertIsNone(rows[str(self.first.prediction_id)]["scenario_name"])

    def test_history_search_matches_owned_names_kinds_and_saved_labels(self):
        def ids(term):
            return {item["id"] for item in self.get(f"/predictions/?search={term}&page_size=100").data["results"]}
        self.assertEqual(ids("Seco"), {str(self.second.prediction_id)})
        self.assertEqual(ids("material"), {str(self.ore.prediction_id)})
        self.assertEqual(ids("HIGH"), {str(self.ore.prediction_id)})
        self.assertEqual(ids("lime"), {str(self.first.prediction_id), str(self.second.prediction_id)})
        self.assertEqual(ids("Private"), set())
        self.assertEqual(self.get("/predictions/?search=" + "x" * 121).status_code, 400)

    def test_unroasted_baseline_and_mode_conditions_are_described(self):
        from .serializers import result_detail
        base = Prediction(kind="alumina", output_data={"digestion_efficiency_pct": 64.1},
                          input_data={"feed_type": "unroasted", "experiment_mode": "roasting", "conditions": {}})
        self.assertEqual(result_detail(base), "64.1 % · unroasted baseline")
        roast = Prediction(kind="alumina", output_data={"digestion_efficiency_pct": 72.4},
                           input_data={"feed_type": "roasted", "experiment_mode": "roasting",
                                       "conditions": {"roasting_temperature_c": 600, "roasting_time_min": 60}})
        self.assertEqual(result_detail(roast), "72.4 % · roasted · 600 °C / 60 min")

    def test_result_summary_is_null_when_saved_output_is_incomplete(self):
        from .serializers import result_summary
        cases = [("ore", {"as_ratio": 6}), ("ore", {"threshold_grade": "high", "as_ratio": math.inf}),
                 ("alumina", {}), ("alumina", {"digestion_efficiency_pct": "70"}),
                 ("secondary_metals", {"elements": {"Li": {"extraction_efficiency_pct": 1}}}),
                 ("secondary_metals", {"elements": {e: {"extraction_efficiency_pct": math.nan} for e in ["Li", "Ga", "Sc"]}})]
        for kind, output in cases:
            self.assertIsNone(result_summary(Prediction(kind=kind, output_data=output)), (kind, output))

    def test_unknown_pages_and_resources_return_404(self):
        self.assertEqual(self.get("/predictions/?page=900").status_code, 404)
        self.assertEqual(self.get(f"/scenarios/{uuid.uuid4()}/").status_code, 404)

    def test_scenario_create_edit_delete_is_audited_and_retains_prediction(self):
        response = self.client.post("/api/v1/scenarios/", {"name": "  Named result  ", "prediction_id": str(self.first.prediction_id)}, format="json")
        self.assertEqual(response.status_code, 201)
        id_ = response.data["id"]
        self.assertEqual(response.data["name"], "Named result")
        self.assertEqual(AuditEvent.objects.get(action="scenario_created").target_id, uuid.UUID(id_))
        self.assertEqual(self.client.patch(f"/api/v1/scenarios/{id_}/", {"name": "Renamed", "description": "Notes"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/v1/scenarios/{id_}/").status_code, 204)
        self.assertTrue(Prediction.objects.filter(pk=self.first.prediction_id).exists())
        self.assertEqual(AuditEvent.objects.filter(target_id=id_).count(), 3)

    def test_ownership_on_save_edit_delete_and_comparison(self):
        response = self.client.post("/api/v1/scenarios/", {"name": "Stolen", "prediction_id": str(self.foreign.prediction_id)}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.get(f"/scenarios/{self.foreign.pk}/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/v1/scenarios/{self.foreign.pk}/", {"name": "Stolen"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/v1/scenarios/{self.foreign.pk}/").status_code, 404)
        for suffix in ["", "export/"]:
            response = self.get(f"/scenarios/compare/{suffix}?ids={self.first.pk},{self.foreign.pk}")
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("Private", str(response.data))

    def test_scenario_rejects_injection_and_invalid_names(self):
        for payload in [{"name": "", "prediction_id": str(self.first.prediction_id)},
                        {"name": "x", "prediction_id": str(self.first.prediction_id), "user": str(self.other.pk)},
                        {"name": "x", "prediction_id": str(self.first.prediction_id), "output_data": {}}]:
            self.assertEqual(self.client.post("/api/v1/scenarios/", payload, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/v1/scenarios/{self.first.pk}/", {"prediction_id": str(self.second.prediction_id)}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/v1/scenarios/{self.first.pk}/", {"description": "x" * 2001}, format="json").status_code, 400)

    def test_an_audit_failure_rolls_back_scenario_mutations(self):
        with patch("apps.research.services.AuditEvent.objects.create", side_effect=RuntimeError("test")):
            response = self.client.patch(f"/api/v1/scenarios/{self.first.pk}/", {"name": "Must roll back"}, format="json")
        self.assertEqual(response.status_code, 500)
        self.first.refresh_from_db()
        self.assertEqual(self.first.name, "First")

    def test_comparison_order_units_versions_and_missing_values(self):
        response = self.get(f"/scenarios/compare/?ids={self.second.pk},{self.first.pk}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scenarios"][0]["name"], "Second")
        row = next(row for row in response.data["result_rows"] if row["key"] == "digestion_efficiency_pct")
        self.assertEqual(row["values"], [71, 70])
        self.assertEqual(row["unit"], "%")
        self.assertTrue(any("Different model versions" in warning for warning in response.data["warnings"]))
        self.assertIn("Synthetic test fixture, not a model prediction.", response.data["warnings"])

    def test_comparison_rejects_invalid_counts_types_schemas_and_units(self):
        incompatible = historical_scenario(self.owner, "Schema two", schema="2")
        for ids, status in [
            (str(self.first.pk), 400), (f"{self.first.pk},{self.first.pk}", 400),
            (f"{self.first.pk},invalid", 400), (f"{self.first.pk},{self.ore.pk}", 409),
            (f"{self.first.pk},{incompatible.pk}", 409),
        ]:
            self.assertEqual(self.get(f"/scenarios/compare/?ids={ids}").status_code, status)
        output = dict(self.second.prediction.output_data, unit="kg")
        Prediction.objects.filter(pk=self.second.prediction_id).update(output_data=output)
        self.assertEqual(self.get(f"/scenarios/compare/?ids={self.first.pk},{self.second.pk}").status_code, 409)

    def test_exports_preserve_values_and_neutralize_formula_names(self):
        self.first.name = "=HYPERLINK(\"example\")"
        self.first.save()
        response = self.get(f"/scenarios/compare/export/?ids={self.first.pk},{self.second.pk}")
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
        self.assertTrue(rows[0][2].startswith("'="))
        self.assertIn("private", response["Cache-Control"])
        history = self.get("/predictions/export/?kind=alumina")
        self.assertEqual(len(list(csv.reader(io.StringIO(history.content.decode("utf-8-sig"))))), 3)
        self.assertNotIn(str(self.foreign.prediction_id), history.content.decode())

    def test_export_caps_results_without_silently_truncating(self):
        existing = self.first.prediction
        Prediction.objects.bulk_create([Prediction(user=self.owner, model_version=existing.model_version, kind="alumina",
                                                   request_key=uuid.uuid4(), request_hash="0" * 64,
                                                   input_data=existing.input_data, output_data=existing.output_data)
                                        for _ in range(1000)])
        self.assertEqual(self.get("/predictions/export/").status_code, 400)

    def test_csrf_required_for_every_mutation(self):
        self.client.credentials()
        self.assertEqual(self.client.post("/api/v1/scenarios/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/v1/scenarios/{self.first.pk}/", {"name": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/v1/scenarios/{self.first.pk}/").status_code, 403)
        self.assertEqual(self.client.post("/api/v1/predictions/ore/", {}, format="json").status_code, 403)

    @patch("apps.research.ml.registry.ARTIFACT_DIR", None)
    def test_unverified_models_cannot_generate_or_save_predictions(self):
        before = Prediction.objects.count()
        response = self.get("/models/")
        self.assertEqual(len(response.data), 3)
        self.assertTrue(all(not item["available"] and item["input_schema"] is None for item in response.data))
        payloads = {
            "ore": {"al2o3_pct": 60, "sio2_pct": 10, "fe2o3_pct": 15, "tio2_pct": 3,
                    "cao_pct": 1, "mgo_pct": 1, "k2o_pct": 1, "na2o_pct": 1},
            "alumina": {"feed_type": "roasted", "al2o3_pct": 60, "sio2_pct": 10, "experiment_mode": "lime",
                        "conditions": {"lime_pct": 1}},
            "secondary-metals": {"bauxite_concentrations_ug_g": {"Li": 100, "Ga": 50, "Sc": 30},
                                 "experiment_mode": "temperature", "conditions": {"digestion_temperature_c": 250}},
        }
        for kind, payload in payloads.items():
            response = self.post_prediction(kind, payload)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.data["error"]["code"], "model_unavailable")
        self.assertEqual(Prediction.objects.count(), before)

    def test_prediction_requires_idempotency_key_and_distinguishes_shape_vs_domain_errors(self):
        payload = {"al2o3_pct": 60, "sio2_pct": 10, "fe2o3_pct": 15, "tio2_pct": 3,
                   "cao_pct": 1, "mgo_pct": 1, "k2o_pct": 1, "na2o_pct": 1}
        response = self.client.post("/api/v1/predictions/ore/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

        shape_error = dict(payload, unknown=1)
        response = self.post_prediction("ore", shape_error)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

        domain_error = dict(payload, al2o3_pct=140)
        response = self.post_prediction("ore", domain_error)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["error"]["code"], "unsupported_input")

    @patch("apps.research.views.run_prediction")
    def test_idempotency_conflict_and_replay_before_availability_checks(self, run_prediction):
        run_prediction.return_value = {
            "as_ratio": 6.0,
            "threshold_grade": "high",
            "classifier_grade": "high",
            "classifier_probability": 0.75,
            "cluster_id": 1,
            "grade_disagreement": False,
            "validation": {"method": "test"},
            "limitations": ["test"],
        }
        manifest = MANIFESTS["ore"]
        version = ModelVersion.objects.create(
            kind="ore",
            artifact_name=manifest["artifact"],
            sha256=manifest["sha256"],
            adapter_version=manifest["adapter_version"],
            schema_version="1",
            metadata={"test": True},
            status="enabled",
            verified_at=timezone.now(),
        )
        payload = {"al2o3_pct": 60.0, "sio2_pct": 10, "fe2o3_pct": 15, "tio2_pct": 3,
                   "cao_pct": 1, "mgo_pct": 1, "k2o_pct": 1, "na2o_pct": 1}
        key = uuid.uuid4()
        first = self.post_prediction("ore", payload, key=key)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(str(first.data["model_version_id"]), str(version.pk))

        replay = self.post_prediction("ore", dict(payload, al2o3_pct=60), key=key)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data["id"], first.data["id"])

        conflict = self.post_prediction("ore", dict(payload, al2o3_pct=59), key=key)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.data["error"]["code"], "idempotency_conflict")

        version.status = "disabled"
        version.save(update_fields=["status"])
        replay_after_disable = self.post_prediction("ore", payload, key=key)
        self.assertEqual(replay_after_disable.status_code, 200)
        self.assertEqual(replay_after_disable.data["id"], first.data["id"])

    def test_removed_admin_activity_routes_return_not_found(self):
        routes = ["/admin/predictions/", f"/admin/predictions/{self.foreign.prediction_id}/", "/admin/audit-events/",
                  "/admin/system-status/"]
        for route in routes:
            self.assertEqual(self.get(route).status_code, 404)
        self.authenticate(self.admin)
        for route in routes:
            self.assertEqual(self.get(route).status_code, 404)

    def test_record_model_guards_and_postgres_constraints(self):
        prediction = self.first.prediction
        prediction.input_data = {}
        with self.assertRaises(ValidationError):
            prediction.save()
        with self.assertRaises(ValidationError):
            prediction.delete()
        version = self.first.prediction.model_version
        version.metadata = {"changed": True}
        with self.assertRaises(ValidationError):
            version.save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            ModelVersion.objects.create(kind="alumina", artifact_name="test", sha256="1" * 64, adapter_version="test", status="enabled")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Prediction.objects.create(user=self.owner, model_version=self.first.prediction.model_version,
                                      kind="alumina", request_key=self.first.prediction.request_key,
                                      request_hash="0" * 64, input_data={}, output_data={})
        with self.assertRaises(ValidationError):
            Scenario.objects.create(user=self.owner, prediction=self.foreign.prediction, name="Not owned")


class ModelVersionOperatorCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser(
            "operator@example.test",
            "Sample-long-test-secret",
            first_name="Ops",
            last_name="Admin",
            organization="Operations",
        )
        cls.user = User.objects.create_user(
            "plain-user@example.test",
            "Sample-long-test-secret",
            first_name="Plain",
            last_name="User",
            organization="Lab",
            status="approved",
        )

    def setUp(self):
        clear_model_cache()

    @patch("apps.research.services.verify_manifest")
    def test_management_verify_enable_disable_flow(self, verify_manifest):
        manifest = MANIFESTS["ore"]
        verify_manifest.return_value = {
            "artifact_name": manifest["artifact"],
            "sha256": manifest["sha256"],
            "adapter_version": manifest["adapter_version"],
            "schema_version": "1",
            "runtime": {"python": "3.12.3", "numpy": "1.26.4", "scipy": "1.14.1", "scikit_learn": "1.6.1"},
        }

        old = ModelVersion.objects.create(
            kind="ore",
            artifact_name="old.pkl",
            sha256="1" * 64,
            adapter_version="legacy",
            schema_version="1",
            metadata={},
            status="enabled",
            verified_at=timezone.now(),
        )

        out_verify = io.StringIO()
        call_command("model_version_control", "verify", "ore", "--actor-email", self.admin.email, stdout=out_verify)
        created = ModelVersion.objects.get(kind="ore", sha256=manifest["sha256"], adapter_version=manifest["adapter_version"])
        self.assertIsNotNone(created.verified_at)
        self.assertEqual(created.status, "unverified")

        out_enable = io.StringIO()
        call_command(
            "model_version_control",
            "enable",
            "ore",
            "--actor-email",
            self.admin.email,
            "--model-version-id",
            str(created.pk),
            stdout=out_enable,
        )
        created.refresh_from_db()
        old.refresh_from_db()
        self.assertEqual(created.status, "enabled")
        self.assertEqual(old.status, "disabled")
        actions = list(AuditEvent.objects.filter(target_type="model_version").values_list("action", flat=True))
        self.assertIn("model_enabled", actions)
        self.assertIn("model_disabled", actions)

        out_disable = io.StringIO()
        call_command("model_version_control", "disable", "ore", "--actor-email", self.admin.email, stdout=out_disable)
        created.refresh_from_db()
        self.assertEqual(created.status, "disabled")

    @patch("apps.research.services.verify_manifest")
    def test_management_command_enforces_operator_rules(self, verify_manifest):
        manifest = MANIFESTS["ore"]
        verify_manifest.return_value = {
            "artifact_name": manifest["artifact"],
            "sha256": manifest["sha256"],
            "adapter_version": manifest["adapter_version"],
            "schema_version": "1",
            "runtime": {"python": "3.12.3", "numpy": "1.26.4", "scipy": "1.14.1", "scikit_learn": "1.6.1"},
        }
        with self.assertRaises(CommandError):
            call_command("model_version_control", "enable", "ore", "--actor-email", self.admin.email)
        with self.assertRaises(CommandError):
            call_command("model_version_control", "verify", "ore", "--actor-email", "missing@example.test")
        with self.assertRaises(ServiceError):
            call_command("model_version_control", "verify", "ore", "--actor-email", self.user.email)


def _runtime_prerequisite_errors():
    failures = []
    try:
        import numpy  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        failures.append(f"numpy missing: {exc}")
    try:
        import scipy  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        failures.append(f"scipy missing: {exc}")
    try:
        import sklearn  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        failures.append(f"scikit-learn missing: {exc}")
    if not ARTIFACT_DIR.exists():
        failures.append(f"artifact directory missing: {ARTIFACT_DIR}")
    return failures


ARTIFACT_DIR = Path(__file__).resolve().parents[4] / "ml-part" / "models"


class RealArtifactIntegrationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        details = dict(first_name="Run", last_name="Time", organization="Integration", status="approved")
        cls.owner = User.objects.create_user("runtime@example.test", "Sample-long-test-secret", **details)
        for kind in ("ore", "alumina", "secondary_metals"):
            manifest = MANIFESTS[kind]
            ModelVersion.objects.create(
                kind=kind,
                artifact_name=manifest["artifact"],
                sha256=manifest["sha256"],
                adapter_version=manifest["adapter_version"],
                schema_version="1",
                metadata={"source": "integration-test"},
                status="enabled",
                verified_at=timezone.now(),
            )

    def setUp(self):
        cache.clear()
        clear_model_cache()
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.owner)
        token = self.client.get("/api/v1/auth/csrf/").data["csrf_token"]
        self.client.credentials(HTTP_X_CSRFTOKEN=token)

    def _assert_runtime_ready(self):
        failures = _runtime_prerequisite_errors()
        self.assertFalse(failures, "Real artifact integration prerequisites missing: " + "; ".join(failures))

    def _post(self, kind, payload):
        return self.client.post(
            f"/api/v1/predictions/{kind}/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

    @patch("apps.research.ml.registry.ARTIFACT_DIR", ARTIFACT_DIR)
    def test_real_artifacts_return_finite_outputs_for_three_modules(self):
        self._assert_runtime_ready()
        ore_payload = {"al2o3_pct": 65, "sio2_pct": 8, "fe2o3_pct": 15, "tio2_pct": 3.5,
                       "cao_pct": 1.5, "mgo_pct": 0.5, "k2o_pct": 0.3, "na2o_pct": 0.2}
        ore_response = self._post("ore", ore_payload)
        self.assertEqual(ore_response.status_code, 201)
        self.assertTrue(math.isfinite(ore_response.data["output_data"]["as_ratio"]))
        self.assertTrue(0 <= ore_response.data["output_data"]["classifier_probability"] <= 1)

        alumina_payload = {
            "feed_type": "roasted",
            "al2o3_pct": 68.34,
            "sio2_pct": 13.09,
            "experiment_mode": "roasting",
            "conditions": {"roasting_temperature_c": 600, "roasting_time_min": 120},
        }
        alumina_response = self._post("alumina", alumina_payload)
        self.assertEqual(alumina_response.status_code, 201)
        alumina_value = alumina_response.data["output_data"]["digestion_efficiency_pct"]
        self.assertTrue(math.isfinite(alumina_value))
        self.assertEqual(alumina_response.data["output_data"]["unit"], "percent")

        metals_payload = {
            "bauxite_concentrations_ug_g": {"Li": 198.5, "Ga": 50.5, "Sc": 38.181},
            "experiment_mode": "temperature",
            "conditions": {"digestion_temperature_c": 250},
        }
        metals_response = self._post("secondary-metals", metals_payload)
        self.assertEqual(metals_response.status_code, 201)
        for element in ("Li", "Ga", "Sc"):
            value = metals_response.data["output_data"]["elements"][element]["extraction_efficiency_pct"]
            self.assertTrue(math.isfinite(value))
            self.assertEqual(metals_response.data["output_data"]["elements"][element]["unit"], "percent")
