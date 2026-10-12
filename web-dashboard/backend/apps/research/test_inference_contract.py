"""Inference tests using stubbed models."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from django.core.cache import cache
from django.db import close_old_connections
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from config.errors import ServiceError

from .ml.adapters import adapt_alumina, normalize_input
from .ml.canonical import request_hash
from .ml.inference import predict_alumina, predict_ore, predict_secondary_metals
from .ml.manifests import module_info
from .ml.registry import MANIFESTS, clear_cache
from .models import ModelVersion, Prediction

PAYLOAD = {
    "feed_type": "roasted", "al2o3_pct": 68.34, "sio2_pct": 13.09,
    "experiment_mode": "lime", "conditions": {"lime_pct": 5},
}
OUTPUT = {"digestion_efficiency_pct": 72, "unit": "percent", "limitations": ["Test double"]}


def version_for(kind="alumina"):
    manifest = MANIFESTS[kind]
    return ModelVersion(
        kind=kind, artifact_name=manifest["artifact"], sha256=manifest["sha256"],
        adapter_version=manifest["adapter_version"], schema_version="1",
        status="enabled", verified_at=timezone.now(),
    )


class CommitBoundaryTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            "commit-boundary@example.test", "Synthetic-only-long-secret",
            first_name="Boundary", last_name="Test", organization="Tests", status="approved",
        )
        self.version = version_for()
        self.version.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def post(self, key=None, payload=None):
        return self.client.post(
            "/api/v1/predictions/alumina/", payload or PAYLOAD, format="json",
            HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()),
        )

    def test_suspension_during_inference_prevents_commit(self):
        def infer(*_):
            User.objects.filter(pk=self.user.pk).update(status="suspended", is_active=False)
            return OUTPUT
        with patch("apps.research.views.run_prediction", side_effect=infer):
            response = self.post()
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Prediction.objects.exists())

    def test_disabling_bound_version_prevents_commit(self):
        def infer(*_):
            ModelVersion.objects.filter(pk=self.version.pk).update(status="disabled")
            return OUTPUT
        with patch("apps.research.views.run_prediction", side_effect=infer):
            response = self.post()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "model_version_changed")
        self.assertFalse(Prediction.objects.exists())

    def test_equivalent_numeric_retry_replays_after_disable(self):
        key = uuid.uuid4()
        with patch("apps.research.views.run_prediction", return_value=OUTPUT) as infer:
            first = self.post(key)
            ModelVersion.objects.filter(pk=self.version.pk).update(status="disabled")
            second = self.post(key, {**PAYLOAD, "conditions": {"lime_pct": 5.0, "digestion_time_min": None}})
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.data["id"], second.data["id"])
        infer.assert_called_once()
        self.assertEqual(Prediction.objects.count(), 1)

    def test_silica_minimum_is_inclusive_and_rejects_smaller_new_requests(self):
        for kind in ("ore", "alumina"):
            model = self.version if kind == "alumina" else version_for(kind)
            if kind == "ore":
                model.save()
            payload = PAYLOAD if kind == "alumina" else {
                key: value for key, value in zip(
                    ["al2o3_pct", "sio2_pct", "fe2o3_pct", "tio2_pct", "cao_pct", "mgo_pct", "k2o_pct", "na2o_pct"],
                    [65, 8, 15, 3.5, 1.5, .5, .3, .2], strict=True)
            }
            with self.subTest(kind=kind), patch("apps.research.views.run_prediction", return_value=OUTPUT) as infer:
                for silica in (0.000999, 0.001):
                    response = self.client.post(
                        f"/api/v1/predictions/{kind}/", {**payload, "sio2_pct": silica},
                        format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
                    )
                    self.assertEqual(response.status_code, 422 if silica < .001 else 201)
                    if silica < .001:
                        self.assertIn("sio2_pct", response.data["error"]["fields"])
                infer.assert_called_once()
        self.assertEqual(Prediction.objects.count(), 2)

    def test_historical_request_below_new_silica_minimum_remains_replayable(self):
        payload = normalize_input("alumina", {**PAYLOAD, "sio2_pct": 0.0005})
        legacy = version_for()
        legacy.adapter_version = "1.0"
        legacy.status = "disabled"
        legacy.save()
        key = uuid.uuid4()
        saved = Prediction.objects.create(
            user=self.user, model_version=legacy, kind="alumina", request_key=key,
            request_hash=request_hash("alumina", "1", payload), input_data=payload,
            output_data=OUTPUT, schema_version="1",
        )
        with patch("apps.research.views.run_prediction") as infer:
            replay = self.post(key, payload)
            rejected = self.post(payload=payload)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data["id"], str(saved.id))
        self.assertEqual(rejected.status_code, 422)
        infer.assert_not_called()
        self.assertEqual(Prediction.objects.count(), 1)

    def test_prediction_rate_limit_is_shared_across_kinds_and_preserves_reads(self):
        key = uuid.uuid4()
        with patch("apps.research.views.run_prediction", return_value=OUTPUT) as infer:
            for index in range(30):
                self.assertEqual(self.post(key).status_code, 201 if index == 0 else 200)
            limited = self.client.post(
                "/api/v1/predictions/ore/", {}, format="json",
                HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            )
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.data["error"]["code"], "rate_limited")
        self.assertGreater(int(limited["Retry-After"]), 0)
        self.assertEqual(self.client.get("/api/v1/predictions/").status_code, 200)
        infer.assert_called_once()
        self.assertEqual(Prediction.objects.count(), 1)


class ConcurrentRetryTests(TransactionTestCase):
    def test_two_simultaneous_retries_commit_once(self):
        cache.clear()
        user = User.objects.create_user(
            "concurrent@example.test", "Synthetic-only-long-secret",
            first_name="Concurrent", last_name="Test", organization="Tests", status="approved",
        )
        version_for().save()
        barrier = Barrier(2)
        key = str(uuid.uuid4())

        def infer(*_):
            barrier.wait(timeout=15)
            return OUTPUT

        def post():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=user.pk))
                response = client.post(
                    "/api/v1/predictions/alumina/", PAYLOAD, format="json", HTTP_IDEMPOTENCY_KEY=key,
                )
                return response.status_code, response.data.get("id")
            finally:
                close_old_connections()

        with patch("apps.research.views.run_prediction", side_effect=infer), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: post(), range(2)))
        self.assertEqual(sorted(status for status, _ in results), [200, 201])
        self.assertEqual(len({record_id for _, record_id in results}), 1)
        self.assertEqual(Prediction.objects.count(), 1)


class EstimatorFailureTests(SimpleTestCase):
    def tearDown(self):
        clear_cache()

    def test_discovery_verifies_the_advertised_version(self):
        version = version_for()
        with (
            patch("apps.research.ml.manifests.enabled_version", return_value=version) as resolve,
            patch("apps.research.ml.manifests.load_artifact_for_version") as load,
        ):
            info = module_info("alumina")
        self.assertTrue(info["available"])
        self.assertEqual(info["model_version_id"], version.id)
        resolve.assert_called_once_with("alumina")
        load.assert_called_once_with(version)

    def test_unroasted_baseline_keeps_roasting_factors_absent(self):
        payload = {**PAYLOAD, "feed_type": "unroasted", "experiment_mode": "roasting", "conditions": {}}
        normalized = normalize_input("alumina", payload)
        vector = adapt_alumina(normalized)[0]
        self.assertEqual(normalized["conditions"], {})
        self.assertEqual(vector[0], 0)
        np.testing.assert_array_equal(vector[3:7], [0, 0, 0, 0])

    def test_partial_roasting_conditions_are_not_baseline(self):
        payload = {**PAYLOAD, "feed_type": "unroasted", "experiment_mode": "roasting",
                   "conditions": {"roasting_temperature_c": 600}}
        with self.assertRaises(ServiceError):
            normalize_input("alumina", payload)

    def test_huge_integer_is_rejected_not_an_internal_error(self):
        with self.assertRaises(ServiceError) as caught:
            normalize_input("alumina", {**PAYLOAD, "al2o3_pct": 10 ** 400})
        self.assertEqual(caught.exception.status_code, 422)

    def test_malformed_regression_output_marks_runtime_unavailable(self):
        estimator = SimpleNamespace(predict=lambda _: ["not a number"])
        with patch("apps.research.ml.inference._bundle_for", return_value={"model": estimator}):
            with self.assertRaises(ServiceError) as caught:
                predict_alumina(PAYLOAD, version_for())
        self.assertEqual(caught.exception.status_code, 503)

    def test_out_of_range_element_rejects_entire_bundle(self):
        bundle = {element: {"model": SimpleNamespace(predict=lambda _, value=value: [value])}
                  for element, value in (("Li", 40), ("Ga", 101), ("Sc", 20))}
        payload = {"bauxite_concentrations_ug_g": {"Li": 100, "Ga": 50, "Sc": 30},
                   "experiment_mode": "roasting", "conditions": {}}
        with patch("apps.research.ml.inference._bundle_for", return_value=bundle):
            with self.assertRaises(ServiceError) as caught:
                predict_secondary_metals(payload, version_for("secondary_metals"))
        self.assertEqual(caught.exception.status_code, 422)

    def test_fractional_cluster_is_not_silently_truncated(self):
        classifier = SimpleNamespace(classes_=np.array(["high", "low", "medium"]),
                                     predict=lambda _: ["high"], predict_proba=lambda _: [[.8, .1, .1]])
        bundle = {"ore_grade_classifier": {"model": classifier},
                  "clustering": {"scaler": SimpleNamespace(transform=lambda x: x),
                                 "kmeans": SimpleNamespace(predict=lambda _: [1.5]), "n_clusters": 4}}
        payload = {key: value for key, value in zip(
            ["al2o3_pct", "sio2_pct", "fe2o3_pct", "tio2_pct", "cao_pct", "mgo_pct", "k2o_pct", "na2o_pct"],
            [65, 8, 15, 3.5, 1.5, .5, .3, .2], strict=True)}
        with patch("apps.research.ml.inference._bundle_for", return_value=bundle):
            with self.assertRaises(ServiceError) as caught:
                predict_ore(payload, version_for("ore"))
        self.assertEqual(caught.exception.status_code, 503)

    def test_probability_is_validated_before_any_display_rounding(self):
        classifier = SimpleNamespace(
            classes_=np.array(["high", "low", "medium"]),
            predict=lambda _: ["high"], predict_proba=lambda _: [[1.00001, 0, 0]],
        )
        bundle = {"ore_grade_classifier": {"model": classifier},
                  "clustering": {"scaler": SimpleNamespace(transform=lambda x: x),
                                 "kmeans": SimpleNamespace(predict=lambda _: [0]), "n_clusters": 4}}
        payload = {"al2o3_pct": 65, "sio2_pct": 8, "fe2o3_pct": 15, "tio2_pct": 3.5,
                   "cao_pct": 1.5, "mgo_pct": .5, "k2o_pct": .3, "na2o_pct": .2}
        with patch("apps.research.ml.inference._bundle_for", return_value=bundle):
            with self.assertRaises(ServiceError) as caught:
                predict_ore(payload, version_for("ore"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(caught.exception.detail.code, "model_output_out_of_range")
