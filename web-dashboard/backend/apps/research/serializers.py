import math

from rest_framework import serializers

from apps.accounts.serializers import StrictSerializer

from .models import KINDS, Prediction, Scenario


class RecordQuery(StrictSerializer):
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)
    kind = serializers.ChoiceField(choices=KINDS, required=False)


class HistoryQuery(RecordQuery):
    date_from = serializers.DateTimeField(required=False)
    search = serializers.CharField(required=False, max_length=120)
    date_to = serializers.DateTimeField(required=False)

    def validate(self, attrs):
        if "date_from" in attrs and "date_to" in attrs and attrs["date_from"] >= attrs["date_to"]:
            raise serializers.ValidationError({"date_to": ["End date must be after start date."]})
        return attrs


class AdminHistoryQuery(HistoryQuery):
    user_id = serializers.UUIDField(required=False)


class ScenarioInput(StrictSerializer):
    name = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    prediction_id = serializers.UUIDField()


class ScenarioUpdate(StrictSerializer):
    name = serializers.CharField(max_length=120, required=False)
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True)


def _finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def _number(value):
    return f"{value:.6g}"


def model_label(version):
    if version is None:
        return None
    stem = version.artifact_name.rsplit("/", 1)[-1]
    stem = stem[:-4] if stem.endswith(".pkl") else stem
    for suffix in ("_models", "_model"):
        stem = stem[: -len(suffix)] if stem.endswith(suffix) else stem
    return f"{stem} v{version.adapter_version}"


def _output(prediction):
    return prediction.output_data if isinstance(prediction.output_data, dict) else {}


def _grade(output):
    grade, ratio = output.get("threshold_grade"), _finite(output.get("as_ratio"))
    if not isinstance(grade, str) or not grade.strip() or ratio is None:
        return None, None
    return grade.strip().capitalize(), ratio


def _elements(output):
    elements = output.get("elements")
    if not isinstance(elements, dict):
        return None
    values = {}
    for symbol in ("Li", "Ga", "Sc"):
        element = elements.get(symbol)
        value = _finite(element.get("extraction_efficiency_pct")) if isinstance(element, dict) else None
        if value is None:
            return None
        values[symbol] = value
    return values


def result_summary(prediction):
    output = _output(prediction)
    if prediction.kind == "ore":
        grade, ratio = _grade(output)
        return None if grade is None else f"{grade} · A/S {ratio:.2f}"
    if prediction.kind == "alumina":
        value = _finite(output.get("digestion_efficiency_pct"))
        return None if value is None else f"{value:.1f} %"
    if prediction.kind == "secondary_metals":
        values = _elements(output)
        if values is None:
            return None
        return " · ".join(f"{symbol} {value:.1f}" for symbol, value in values.items()) + " %"
    return None


def _conditions(prediction):
    data = prediction.input_data if isinstance(prediction.input_data, dict) else {}
    conditions = data.get("conditions") if isinstance(data.get("conditions"), dict) else {}
    mode = data.get("experiment_mode")

    def value(key, unit):
        number = _finite(conditions.get(key))
        return None if number is None else f"{_number(number)} {unit}"

    if prediction.kind == "alumina":
        feed = data.get("feed_type") if data.get("feed_type") in ("roasted", "unroasted") else None
        if mode == "roasting":
            temperature, time = value("roasting_temperature_c", "°C"), value("roasting_time_min", "min")
            if temperature is None and time is None:
                return f"{feed} baseline" if feed else "roasting"
            return " · ".join(filter(None, [feed, " / ".join(filter(None, [temperature, time]))]))
        detail = {"lime": ["lime", value("lime_pct", "%")],
                  "caustic": ["caustic", value("na2ok_g_l", "g/L")],
                  "digestion_temperature": ["digestion", value("digestion_temperature_c", "°C")],
                  "digestion_time": ["digestion", value("digestion_time_min", "min")]}.get(mode)
        parts = [feed] + ([" ".join(filter(None, detail))] if detail else [])
        return " · ".join(filter(None, parts)) or None
    if prediction.kind == "secondary_metals":
        if mode == "temperature":
            return " ".join(filter(None, ["digestion", value("digestion_temperature_c", "°C")]))
        if mode == "lime":
            return " ".join(filter(None, ["lime", value("lime_pct", "%")]))
        return mode if isinstance(mode, str) and mode else None
    return None


def result_detail(prediction):
    output = _output(prediction)
    if prediction.kind == "ore":
        grade, ratio = _grade(output)
        if grade is None:
            return None
        parts = [f"{grade} grade", f"A/S {ratio:.2f}"]
        classifier, probability = output.get("classifier_grade"), _finite(output.get("classifier_probability"))
        if isinstance(classifier, str) and classifier.strip():
            parts.append(f"classifier {classifier.strip().lower()}"
                         + (f" ({probability * 100:.1f} %)" if probability is not None else ""))
        cluster = output.get("cluster_id")
        if isinstance(cluster, (int, str)) and not isinstance(cluster, bool) and str(cluster) != "":
            parts.append(f"cluster {cluster}")
        return " · ".join(parts)
    if prediction.kind == "alumina":
        value = _finite(output.get("digestion_efficiency_pct"))
        if value is None:
            return None
        return " · ".join(filter(None, [f"{value:.1f} %", _conditions(prediction)]))
    if prediction.kind == "secondary_metals":
        values = _elements(output)
        if values is None:
            return None
        return " · ".join([f"{symbol} {value:.1f} %" for symbol, value in values.items()]
                          + list(filter(None, [_conditions(prediction)])))
    return None


class PredictionSerializer(serializers.ModelSerializer):
    model_label = serializers.SerializerMethodField(
        help_text="Artifact file stem and adapter version of the model that produced this record.")

    class Meta:
        model = Prediction
        fields = ["id", "kind", "created_at", "model_version_id", "model_label", "schema_version",
                  "input_data", "output_data"]
        read_only_fields = fields

    def get_model_label(self, prediction) -> str | None:
        return model_label(prediction.model_version)


class ScenarioSerializer(serializers.ModelSerializer):
    kind = serializers.CharField(source="prediction.kind", read_only=True)
    model_version_id = serializers.UUIDField(source="prediction.model_version_id", read_only=True)
    schema_version = serializers.CharField(source="prediction.schema_version", read_only=True)
    result_summary = serializers.SerializerMethodField(
        help_text="Server-derived headline from the saved prediction output; null when unavailable.")
    model_label = serializers.SerializerMethodField(
        help_text="Artifact file stem and adapter version of the referenced prediction's model.")

    class Meta:
        model = Scenario
        fields = ["id", "name", "description", "prediction_id", "kind", "model_version_id", "model_label",
                  "schema_version", "result_summary", "created_at", "updated_at"]
        read_only_fields = fields

    def get_result_summary(self, scenario) -> str | None:
        return result_summary(scenario.prediction)

    def get_model_label(self, scenario) -> str | None:
        return model_label(scenario.prediction.model_version)


class ScenarioDetailSerializer(ScenarioSerializer):
    prediction = PredictionSerializer(read_only=True)

    class Meta(ScenarioSerializer.Meta):
        fields = ScenarioSerializer.Meta.fields + ["prediction"]


class CompareQuery(StrictSerializer):
    ids = serializers.CharField(max_length=110)

    def validate_ids(self, value):
        values = value.split(",")
        field = serializers.UUIDField()
        if len(values) not in (2, 3):
            raise serializers.ValidationError("Choose two or three scenarios.")
        parsed = [field.run_validation(v) for v in values]
        if len(set(parsed)) != len(parsed):
            raise serializers.ValidationError("Choose distinct scenarios.")
        return parsed


class AuditQuery(RecordQuery):
    kind = None
    action = serializers.ChoiceField(choices=[
        "account_approved", "account_rejected", "account_suspended", "account_reactivated",
        "scenario_created", "scenario_updated", "scenario_deleted", "model_enabled", "model_disabled",
    ], required=False)


class ModuleSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=KINDS)
    available = serializers.BooleanField()
    status = serializers.CharField()
    model_version_id = serializers.UUIDField(allow_null=True)
    model_label = serializers.CharField(allow_null=True)
    schema_version = serializers.CharField()
    input_schema = serializers.JSONField(allow_null=True)
    targets = serializers.ListField(child=serializers.JSONField())
    validation = serializers.JSONField(allow_null=True)
    limitations = serializers.ListField(child=serializers.CharField())


class PredictionSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=KINDS)
    created_at = serializers.DateTimeField()
    model_version_id = serializers.UUIDField()
    schema_version = serializers.CharField()
    summary = serializers.CharField()
    result_summary = serializers.CharField(
        allow_null=True, help_text="Server-derived headline from the saved output; null when unavailable.")
    result_detail = serializers.CharField(
        allow_null=True, help_text="Headline plus saved classifier evidence or experiment conditions.")
    scenario_name = serializers.CharField(
        allow_null=True, help_text="Name of the owner's most recently updated scenario for this record.")
    model_label = serializers.CharField(allow_null=True)
    user = serializers.JSONField(required=False, help_text="Administrator activity only: id and name.")


class HistoryPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.CharField(allow_null=True)
    previous = serializers.CharField(allow_null=True)
    results = PredictionSummarySerializer(many=True)


class ScenarioPageSerializer(HistoryPageSerializer):
    results = ScenarioSerializer(many=True)


class ComparisonRowSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    unit = serializers.CharField()
    values = serializers.ListField(child=serializers.JSONField(allow_null=True))


class ComparisonSerializer(serializers.Serializer):
    scenarios = ScenarioDetailSerializer(many=True)
    parameter_rows = ComparisonRowSerializer(many=True)
    result_rows = ComparisonRowSerializer(many=True)
    warnings = serializers.ListField(child=serializers.CharField())


class AuditSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    action = serializers.CharField()
    target_type = serializers.CharField()
    target_id = serializers.UUIDField(allow_null=True)
    created_at = serializers.DateTimeField()
    actor = serializers.CharField()
    metadata = serializers.DictField()


class AuditPageSerializer(HistoryPageSerializer):
    results = AuditSerializer(many=True)


class SystemStatusSerializer(serializers.Serializer):
    database = serializers.CharField()
    modules = ModuleSerializer(many=True)
    counts = serializers.DictField(child=serializers.IntegerField())
