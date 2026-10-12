"""Synthetic records used by the tests."""
import hashlib
import uuid

from .models import ModelVersion, Prediction, Scenario


def historical_prediction(user, kind="alumina", variant=0, schema="1"):
    version, _ = ModelVersion.objects.get_or_create(
        kind=kind, sha256=hashlib.sha256(f"synthetic-{kind}-{variant}".encode()).hexdigest(),
        adapter_version="test-only", schema_version=schema,
        defaults={"artifact_name": "synthetic-test-only.pkl", "status": "disabled",
                  "metadata": {"note": "Synthetic test fixture. No artifact inference."}},
    )
    limitations = ["Synthetic test fixture, not a model prediction."]
    validation = {"method": "test fixture", "metric": None, "note": "No scientific validation is claimed."}
    if kind == "alumina":
        inputs = {"al2o3_pct": 60, "sio2_pct": 10, "feed_type": "roasted",
                  "experiment_mode": "lime", "conditions": {"lime_pct": variant}}
        outputs = {"digestion_efficiency_pct": 70 + variant, "unit": "percent",
                   "validation": validation, "limitations": limitations}
    elif kind == "ore":
        inputs = dict(zip(["al2o3_pct", "sio2_pct", "fe2o3_pct", "tio2_pct", "cao_pct", "mgo_pct", "k2o_pct", "na2o_pct"],
                          [60, 10, 15, 3, 1, 1, 1, 1]))
        outputs = {"as_ratio": 6, "threshold_grade": "high", "classifier_grade": "high",
                   "classifier_probability": .75, "cluster_id": 0, "grade_disagreement": False,
                   "validation": validation, "limitations": limitations}
    else:
        inputs = {"bauxite_concentrations_ug_g": {"Li": 100, "Ga": 50, "Sc": 30}, "experiment_mode": "temperature",
                  "conditions": {"digestion_temperature_c": 250}}
        outputs = {"elements": {e: {"extraction_efficiency_pct": 50 + i, "unit": "percent",
                                    "validation": validation} for i, e in enumerate(["Li", "Ga", "Sc"])},
                   "limitations": limitations}
    return Prediction.objects.create(user=user, model_version=version, kind=kind, request_key=uuid.uuid4(),
                                     request_hash="0" * 64, input_data=inputs, output_data=outputs, schema_version=schema)


def historical_scenario(user, name, kind="alumina", variant=0, schema="1"):
    return Scenario.objects.create(user=user, name=name, prediction=historical_prediction(user, kind, variant, schema),
                                   description="Synthetic browser/test record. Not scientific evidence.")
