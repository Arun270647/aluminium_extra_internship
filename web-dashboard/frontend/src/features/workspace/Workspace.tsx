import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ChoiceCard, Input, MeasurementField, Notice } from "../../components/primitives/Controls";
import { ConfirmDialog } from "../../components/ResearchControls";
import { AnalysisResult, format, type AnalysisResultState } from "./AnalysisResult";
import { api, asApiError } from "../../services/api";
import {
  kindNames,
  useResource,
  type Kind,
  type Module,
  type ModuleField,
  type ModuleMode,
  type Page,
  type Prediction,
  type Scenario,
} from "../../services/research";
import { useDraft } from "./DraftProvider";
import "../../styles/workspace.css";

type Measurement = {
  key: string;
  name: string;
  symbol: string;
  unit: string;
};

type CheckedMeasurements = {
  signature: string;
  total: number | null;
  ratio: number | null;
};

const oxides: Measurement[] = [
  { key: "al2o3_pct", name: "Alumina", symbol: "Al₂O₃", unit: "wt %" },
  { key: "sio2_pct", name: "Silica", symbol: "SiO₂", unit: "wt %" },
  { key: "fe2o3_pct", name: "Iron oxide", symbol: "Fe₂O₃", unit: "wt %" },
  { key: "tio2_pct", name: "Titania", symbol: "TiO₂", unit: "wt %" },
  { key: "cao_pct", name: "Calcium oxide", symbol: "CaO", unit: "wt %" },
  { key: "mgo_pct", name: "Magnesia", symbol: "MgO", unit: "wt %" },
  { key: "k2o_pct", name: "Potassium oxide", symbol: "K₂O", unit: "wt %" },
  { key: "na2o_pct", name: "Sodium oxide", symbol: "Na₂O", unit: "wt %" },
];

const elements: Measurement[] = [
  { key: "Li", name: "Lithium", symbol: "Li", unit: "µg/g" },
  { key: "Ga", name: "Gallium", symbol: "Ga", unit: "µg/g" },
  { key: "Sc", name: "Scandium", symbol: "Sc", unit: "µg/g" },
];

const pageCopy: Record<Kind, { eyebrow: string; title: string; introduction: string; action: string; fieldTitle: string; fieldMeta: string }> = {
  ore: {
    eyebrow: "Analysis · 01",
    title: "Material analysis",
    introduction: "Enter eight measured oxides. The ratio and total update as you type; the grade comes from the model when you run it.",
    action: "Analyze material",
    fieldTitle: "Oxide measurements",
    fieldMeta: "All 8 required · wt %",
  },
  alumina: {
    eyebrow: "Analysis · 02",
    title: "Digestion",
    introduction: "Enter feed chemistry, choose the feed condition and one experiment. Only fields used by that experiment are submitted.",
    action: "Estimate digestion",
    fieldTitle: "Feed chemistry",
    fieldMeta: "",
  },
  secondary_metals: {
    eyebrow: "Analysis · 03",
    title: "Metal recovery",
    introduction: "Enter bauxite Li, Ga and Sc concentrations and one experiment. You get three extraction estimates together.",
    action: "Estimate recovery",
    fieldTitle: "Bauxite concentrations",
    fieldMeta: "All 3 required · µg/g",
  },
};

function normalized(value: unknown): unknown {
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

function signature(value: unknown) {
  return JSON.stringify(normalized(value));
}

function numberValue(raw: string | undefined) {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

function boundsFor(module: Module | undefined, fieldKey: string): ModuleField | undefined {
  return module?.input_schema?.fields?.find(field => field.key === fieldKey);
}

function validateNumber(raw: string | undefined, label: string, options: { min?: number; max?: number } = {}) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return `Enter a value for ${label.toLowerCase()}.`;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return `Enter a finite value for ${label.toLowerCase()}.`;
  if (options.min !== undefined && value < options.min) return `Enter ${options.min} or more.`;
  if (options.max !== undefined && value > options.max) return `Enter ${options.max} or less.`;
  return "";
}

function ProcessField({
  kind,
  field,
  value,
  error,
  onChange,
}: {
  kind: Kind;
  field: ModuleField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `${kind}-${field.key}`;
  const hasRange = field.min !== undefined && field.max !== undefined;
  const hintId = `${id}-hint`;
  return <label className={`analysis-cond${error ? " is-invalid" : ""}`} htmlFor={id}>
    <span className="analysis-cond__label">{field.label}</span>
    <span className="measure__box">
      <input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={event => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? `${id}-error` : null, hasRange ? hintId : null].filter(Boolean).join(" ") || undefined} />
      {field.unit && <span className="measure__unit">{field.unit}</span>}
    </span>
    {error ? <span className="field__error" id={`${id}-error`}>{error}</span>
      : hasRange && <span className="field__hint" id={hintId}>Documented range {field.min}–{field.max}</span>}
  </label>;
}

export function Workspace({ kind }: { kind: Kind }) {
  const {
    draft,
    setName,
    setValue,
    resetKind,
    copyChemistry,
    setResult,
    getPendingRetry,
    rememberPendingRetry,
    clearPendingRetry,
  } = useDraft();
  const discovery = useResource<Module[]>("/models/");
  const latest = useResource<Page<Scenario>>("/scenarios/?page_size=1");
  const module = discovery.data?.find(item => item.kind === kind);
  const values = draft.values[kind];
  const measurements = kind === "ore" ? oxides : kind === "alumina" ? oxides.slice(0, 2) : elements;
  const modes = module?.input_schema?.modes ?? [];
  const selectedMode = modes.find(item => item.value === values.experiment_mode);
  const baseline = kind === "alumina" && values.feed_type === "unroasted"
    && selectedMode?.value === "roasting";
  const mode = baseline && selectedMode ? { ...selectedMode, fields: [] } : selectedMode;
  const copy = pageCopy[kind];
  const result = draft.results[kind];

  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState<"clear" | "copy" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [checked, setChecked] = useState<CheckedMeasurements | null>(null);
  const [busy, setBusy] = useState(false);

  const activeRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();

  useEffect(() => () => {
    requestGeneration.current += 1;
    activeRequest.current?.abort();
  }, []);

  const valuesSignature = signature(values);

  function buildPayload({ strict = false }: { strict?: boolean } = {}) {
    const readNumericField = (fieldKey: string) => {
      const value = numberValue(values[fieldKey]);
      if (strict && value === null) throw new Error(`Missing or invalid value for ${fieldKey}.`);
      return value;
    };
    const enteredMeasurements = Object.fromEntries(measurements.map(field => [field.key, readNumericField(field.key)]));
    const conditions = Object.fromEntries((mode?.fields ?? []).map(field => [field.key, readNumericField(field.key)]));
    if (kind === "ore") return enteredMeasurements;
    if (kind === "alumina") {
      return {
        ...enteredMeasurements,
        feed_type: values.feed_type?.trim() ?? "",
        experiment_mode: values.experiment_mode?.trim() ?? "",
        conditions,
      };
    }
    return {
      bauxite_concentrations_ug_g: enteredMeasurements,
      experiment_mode: values.experiment_mode?.trim() ?? "",
      conditions,
    };
  }

  const currentPayload = buildPayload();
  const currentPayloadSignature = signature(currentPayload);
  const requiredMeasurementsReady = measurements.every(field => numberValue(values[field.key]) !== null);
  const totalWithinRange = kind === "secondary_metals"
    || measurements.reduce((sum, field) => sum + (numberValue(values[field.key]) ?? 0), 0) <= 100;
  const chemistryRatioReady = kind === "secondary_metals" || (numberValue(values.sio2_pct) ?? 0) >= 0.001;
  const modeReady = kind === "ore"
    || (!!mode
      && (kind !== "alumina" || !!values.feed_type)
      && (mode.fields ?? []).every(field => numberValue(values[field.key]) !== null));
  const payloadReadyForMatch = requiredMeasurementsReady && totalWithinRange && chemistryRatioReady && modeReady;
  const resultMatches = !!result && payloadReadyForMatch && currentPayloadSignature === signature(result.input_data);
  const checkedIsCurrent = checked?.signature === valuesSignature;

  function updateValue(key: string, value: string) {
    setValue(kind, key, value);
    setRequestError("");
    setErrors(current => {
      if (!current[key] && !current.total) return current;
      const next = { ...current };
      delete next[key];
      delete next.total;
      return next;
    });
  }

  function validate(): Record<string, string> {
    const invalid: Record<string, string> = {};
    for (const field of measurements) {
      const manifestBounds = boundsFor(module, field.key);
      const baseBounds = kind === "secondary_metals" ? { min: 0 }
        : { min: field.key === "sio2_pct" ? 0.001 : 0, max: 100 };
      const issue = validateNumber(values[field.key], field.name, {
        min: manifestBounds?.min ?? baseBounds.min,
        max: manifestBounds?.max ?? baseBounds.max,
      });
      if (issue) invalid[field.key] = issue;
    }

    if (kind !== "secondary_metals" && numberValue(values.sio2_pct) !== null
      && (numberValue(values.sio2_pct) ?? 0) < 0.001) {
      invalid.sio2_pct = "Enter at least 0.001 wt% silica.";
    }

    const total = kind === "secondary_metals"
      ? null
      : measurements.reduce((sum, field) => sum + (numberValue(values[field.key]) ?? 0), 0);
    if (total !== null && total > 100) invalid.total = "The oxide total cannot exceed 100 wt %.";

    if (module?.available && kind !== "ore") {
      if (!mode) invalid.experiment_mode = "Choose a supported experiment.";
      if (kind === "alumina" && !values.feed_type) invalid.feed_type = "Choose a feed condition.";
      for (const field of mode?.fields ?? []) {
        const issue = validateNumber(values[field.key], field.label, field);
        if (issue) invalid[field.key] = issue;
      }
    }
    return invalid;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const invalid = validate();
    setErrors(invalid);
    setRequestError("");
    if (Object.keys(invalid).length) {
      window.setTimeout(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }

    const total = kind === "secondary_metals"
      ? null
      : measurements.reduce((sum, field) => sum + (numberValue(values[field.key]) ?? 0), 0);
    const ratio = kind === "secondary_metals"
      ? null
      : (numberValue(values.al2o3_pct) ?? 0) / (numberValue(values.sio2_pct) ?? 1);
    setChecked({ signature: valuesSignature, total, ratio });

    if (!module?.available) return;

    let payload: Record<string, unknown>;
    try {
      payload = buildPayload({ strict: true });
    } catch {
      setRequestError("Some required values are missing or invalid. Check the highlighted fields and try again.");
      return;
    }
    const payloadSignature = signature(payload);
    const pendingRetry = getPendingRetry(kind);
    const retryIdentity = pendingRetry?.payload === payloadSignature
      ? pendingRetry
      : { payload: payloadSignature, id: crypto.randomUUID() };
    if (!pendingRetry || pendingRetry.payload !== retryIdentity.payload || pendingRetry.id !== retryIdentity.id) {
      rememberPendingRetry(kind, retryIdentity);
    }

    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setBusy(true);

    try {
      const prediction = await api<Prediction>(`/predictions/${kind === "secondary_metals" ? "secondary-metals" : kind}/`, {
        method: "POST",
        headers: { "Idempotency-Key": retryIdentity.id },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      setResult(kind, prediction);
      clearPendingRetry(kind);
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      const issue = asApiError(error);
      setRequestError(issue.message);
      if (issue.code === "model_version_changed") discovery.reload();
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  let resultState: AnalysisResultState = "empty";
  if (busy) resultState = "running";
  else if (Object.keys(errors).length) resultState = "invalid";
  else if (requestError) resultState = "error";
  else if (result && resultMatches) resultState = "committed";
  else if (result) resultState = "stale";
  else if (!discovery.loading && (discovery.error || !module?.available)) resultState = "unavailable";

  const resultMessage = requestError || discovery.error;
  const canCopyChemistry = !!(draft.values.ore.al2o3_pct?.trim() || draft.values.ore.sio2_pct?.trim());

  const liveTotal = kind === "secondary_metals" || measurements.every(field => numberValue(values[field.key]) === null)
    ? null : measurements.reduce((sum, field) => sum + (numberValue(values[field.key]) ?? 0), 0);
  const liveSilica = numberValue(values.sio2_pct);
  const liveAlumina = numberValue(values.al2o3_pct);
  const liveRatio = liveAlumina !== null && liveSilica !== null && liveSilica >= 0.001 ? liveAlumina / liveSilica : null;
  const totalTooHigh = liveTotal !== null && liveTotal > 100;

  const live = kind === "ore" ? <div className="analysis-live">
    <div className="analysis-live__cell">
      <span className="eyebrow">Live · Alumina / silica</span>
      <span className="analysis-live__value">{liveRatio === null ? "—" : format(liveRatio, 2)}</span>
      <span className="analysis-caption">from your entered values</span>
    </div>
    <div className={`analysis-live__cell${totalTooHigh ? " is-bad" : ""}`}>
      <span className="eyebrow">Live · Oxide total</span>
      <span className="analysis-live__value">{liveTotal === null ? "—" : format(liveTotal, 2)}<small> wt %</small></span>
      <span className="analysis-caption">{totalTooHigh ? "Total cannot exceed 100 wt %" : "within 100 wt % limit"}</span>
    </div>
  </div> : undefined;

  const localCheck = checked && checkedIsCurrent && kind !== "ore" ? <p className="analysis-caption">
    {kind === "secondary_metals" ? "All three concentrations are finite and nonnegative."
      : `Entered oxide total ${checked.total?.toFixed(2)} wt % · A/S ${checked.ratio?.toFixed(3)}. A/S is calculated from your entries; it is not an economic recommendation.`}
  </p> : undefined;

  const submittedFields = kind !== "alumina" || !module?.available ? ""
    : !mode ? "Choose an experiment to see exactly what is submitted."
      : `Submits Al₂O₃, SiO₂, feed condition${baseline ? " and the unroasted baseline (no roasting conditions)"
        : mode.fields.length ? ` and ${mode.fields.map(field => field.label.toLowerCase()).join(", ")}` : ""}.`;
  const helper = !module?.available
    ? "Input checks run locally. No model estimate or history record is created."
    : kind === "alumina" ? submittedFields
      : kind === "secondary_metals" ? "All three elements are estimated in one run."
        : "A successful run creates an immutable record in your history.";

  return <section className={`screen screen--wide analysis-page analysis-page--${kind}`}>
    <header className="page-head">
      <div className="page-head__copy">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 className="page-head__title">{copy.title}</h1>
        <p className="page-head__lede">{copy.introduction}</p>
      </div>
      <div className="page-head__actions analysis-draft">
        <span className="analysis-draft__label">Draft</span>
        <span className="analysis-draft__name">{draft.name.trim() || "Unnamed draft"}</span>
        <Button variant="quiet" size="sm" aria-expanded={renaming} onClick={() => setRenaming(value => !value)}>Rename</Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirm("clear")}>Clear</Button>
      </div>
    </header>

    {renaming && <label className="field analysis-rename">
      <span>Draft scenario name</span>
      <Input autoFocus maxLength={120} value={draft.name} onChange={event => setName(event.target.value)}
        placeholder="For example, North bench sample" />
      <span className="field__hint">This name is used only if you save a completed analysis as a scenario.</span>
    </label>}

    <div className="analysis-grid">
      <form ref={form} className="panel analysis-inputs" onSubmit={event => void submit(event)} noValidate
        aria-labelledby={`${kind}-inputs-title`}>
        <div className="panel__head">
          <h2 className="panel__title" id={`${kind}-inputs-title`}>{copy.fieldTitle}</h2>
          {kind === "alumina"
            ? <Button variant="quiet" size="sm" className="analysis-nowrap" disabled={!canCopyChemistry || busy}
              onClick={() => setConfirm("copy")}>Copy from Material draft</Button>
            : <span className="panel__meta">{copy.fieldMeta}</span>}
        </div>
        <fieldset className="analysis-fieldset" disabled={busy}>
          <legend className="sr-only">{copy.fieldTitle}</legend>
          <div className={`analysis-measures${kind === "secondary_metals" ? " analysis-measures--single" : ""}`}>
            {measurements.map(field => <MeasurementField key={field.key} id={`${kind}-${field.key}`} symbol={field.symbol}
              name={field.name} unit={field.unit} wide={kind === "secondary_metals"} value={values[field.key] ?? ""}
              error={errors[field.key]} onChange={value => updateValue(field.key, value)} />)}
          </div>

          {kind === "alumina" && <div className="analysis-section" role="radiogroup" aria-labelledby={`${kind}-feed-heading`}>
            <span className="eyebrow" id={`${kind}-feed-heading`}>Feed condition</span>
            <div className="analysis-choices">
              <ChoiceCard name={`${kind}-feed`} value="unroasted" checked={values.feed_type === "unroasted"}
                title="Unroasted" text="Feed without roasting treatment" onChange={value => updateValue("feed_type", value)} />
              <ChoiceCard name={`${kind}-feed`} value="roasted" checked={values.feed_type === "roasted"}
                title="Roasted" text="Thermally treated feed" onChange={value => updateValue("feed_type", value)} />
            </div>
            {errors.feed_type && <p className="field__error" role="alert">{errors.feed_type}</p>}
          </div>}

          {kind !== "ore" && <div className={`analysis-section${kind === "alumina" ? " analysis-section--rule" : ""}`}>
            <div className="analysis-section__head">
              <label className="eyebrow" htmlFor={`mode-${kind}`}>Experiment</label>
              {modes.length > 0 && <span className="panel__meta">{modes.length} supported {modes.length === 1 ? "mode" : "modes"}</span>}
            </div>
            <select className="select" id={`mode-${kind}`}
              disabled={!module?.available || discovery.loading} value={values.experiment_mode ?? ""}
              aria-invalid={errors.experiment_mode ? true : undefined}
              aria-describedby={errors.experiment_mode ? `${kind}-mode-error` : undefined}
              onChange={event => updateValue("experiment_mode", event.target.value)}>
              <option value="">{discovery.loading ? "Checking available experiments…" :
                module?.available ? "Choose an experiment" : "No verified experiment available"}</option>
              {modes.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
            {errors.experiment_mode && <span className="field__error" id={`${kind}-mode-error`}>{errors.experiment_mode}</span>}
            {baseline ? <p className="analysis-caption">Unroasted baseline: no roasting temperature or time is submitted.</p>
              : mode && <ModeFields kind={kind} mode={mode} values={values} errors={errors} onChange={updateValue} />}
            {!module?.available && !discovery.loading && <Notice tone="warn" size="sm">{kind === "alumina"
              ? "Verified process options will appear when the digestion model is available."
              : "Use bauxite measurements. Verified roasting, lime or temperature options will appear when the recovery model is available."}</Notice>}
          </div>}
        </fieldset>

        {Object.keys(errors).length > 0 && <div className="analysis-errors">
          {errors.total && <Notice tone="bad" size="sm" role="alert">{errors.total}</Notice>}
          <Notice tone="bad" size="sm" role="alert">Check the highlighted measurements, then try again.</Notice>
        </div>}

        <div className="panel__foot">
          <Button type="submit" size="lg" disabled={busy}>{busy ? "Running analysis…" : module?.available ? copy.action : "Check measurements"}</Button>
          {helper && <p className="helper">{helper}</p>}
        </div>
      </form>

      <AnalysisResult kind={kind} state={resultState} prediction={result} module={module} message={resultMessage}
        checking={discovery.loading} onRetryAvailability={discovery.reload} scenarioName={draft.name}
        live={live} localCheck={localCheck}
        onUseChemistry={kind === "ore" ? () => setConfirm("copy") : undefined} />
    </div>

    {latest.data?.results[0] && <Link className="analysis-latest" to={`/scenarios/${latest.data.results[0].id}`}>
      Latest scenario: <strong>{latest.data.results[0].name}</strong> <span aria-hidden="true">→</span>
    </Link>}

    {confirm && <ConfirmDialog title={confirm === "clear" ? `Clear this ${kindNames[kind].toLowerCase()} draft?` : "Copy material chemistry?"}
      action={confirm === "clear" ? "Clear this analysis" : "Copy chemistry"} cancel={() => setConfirm(null)} confirm={() => {
        if (confirm === "clear") {
          activeRequest.current?.abort();
          requestGeneration.current += 1;
          clearPendingRetry(kind);
          resetKind(kind);
          setChecked(null);
          setErrors({});
          setRequestError("");
        } else {
          copyChemistry();
          setErrors({});
          setRequestError("");
          if (kind === "ore") navigate("/workspace/digestion");
        }
        setConfirm(null);
      }}>
      <p>{confirm === "clear"
        ? "This removes the unsaved measurements and current result from this analysis only. Other analysis drafts, history and saved scenarios stay unchanged."
        : "This replaces the alumina and silica values in the digestion draft. Feed and experiment conditions stay as entered."}</p>
    </ConfirmDialog>}
  </section>;
}

function ModeFields({
  kind,
  mode,
  values,
  errors,
  onChange,
}: {
  kind: Kind;
  mode: ModuleMode;
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!mode.fields.length) {
    return <p className="analysis-caption">This mode has no additional continuous conditions in the exported model.</p>;
  }
  return <div className={`analysis-conds${kind === "secondary_metals" ? " analysis-conds--narrow" : ""}`}>{mode.fields.map(field =>
    <ProcessField key={field.key} kind={kind} field={field} value={values[field.key] ?? ""}
      error={errors[field.key]} onChange={value => onChange(field.key, value)} />)}</div>;
}
