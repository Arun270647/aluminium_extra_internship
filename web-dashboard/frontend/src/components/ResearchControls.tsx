import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Input, Pagination as TablePagination, StatusChip } from "./primitives/Controls";
import "../styles/research.css";
import { api, asApiError } from "../services/api";
import {
  dateLabel,
  kindNames,
  type Page,
  type Prediction,
  type Scenario,
} from "../services/research";

export function ResourceState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (loading) return <p className="record-message" role="status">Loading your records…</p>;
  if (error) return <div className="record-message record-message--error"><p className="notice notice--bad" role="alert">{error}</p>
    <Button variant="quiet" size="sm" onClick={retry}>Try again</Button></div>;
  return null;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="empty-state"><span className="empty-state__mark" aria-hidden="true">—</span><h2>{title}</h2><div className="empty-state__body">{children}</div></section>;
}

export function Pagination({ page, data, onChange }: { page: number; data: Page<unknown>; onChange: (page: number) => void }) {
  return <TablePagination page={page} data={data} onChange={onChange} />;
}

export function ConfirmDialog({ title, children, confirm, cancel, busy, action }: {
  title: string;
  children: ReactNode;
  confirm: () => void;
  cancel: () => void;
  busy?: boolean;
  action: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);

  return <dialog className="dialog" ref={ref} aria-labelledby={titleId} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )].filter(item => item.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={event => {
    event.preventDefault();
    if (!busy) cancel();
  }}>
    <div className="dialog__body">
      <h2 className="dialog__title" id={titleId}>{title}</h2>
      {children}
    </div>
    <div className="dialog__actions">
      <Button variant="quiet" disabled={busy} onClick={cancel}>Cancel</Button>
      <Button disabled={busy} onClick={confirm}>{busy ? "Working…" : action}</Button>
    </div>
  </dialog>;
}

const labels: Record<string, string> = {
  al2o3_pct: "Alumina · Al₂O₃",
  sio2_pct: "Silica · SiO₂",
  fe2o3_pct: "Iron oxide · Fe₂O₃",
  tio2_pct: "Titania · TiO₂",
  cao_pct: "Calcium oxide · CaO",
  mgo_pct: "Magnesia · MgO",
  k2o_pct: "Potassium oxide · K₂O",
  na2o_pct: "Sodium oxide · Na₂O",
  Li: "Lithium · Li",
  Ga: "Gallium · Ga",
  Sc: "Scandium · Sc",
  feed_type: "Feed condition",
  experiment_mode: "Experiment",
  conditions: "Process conditions",
  digestion_efficiency_pct: "Digestion efficiency",
  as_ratio: "Alumina / silica ratio",
  threshold_grade: "Grade by A/S thresholds",
  classifier_grade: "Classifier grade",
  classifier_probability: "Classifier match score",
  cluster_id: "Cluster identifier",
  grade_disagreement: "Grades disagree",
  extraction_efficiency_pct: "Extraction efficiency",
  roasting_temperature_c: "Roasting temperature",
  roasting_time_min: "Roasting time",
  lime_pct: "Lime addition",
  na2ok_g_l: "Caustic concentration",
  digestion_temperature_c: "Digestion temperature",
  digestion_time_min: "Digestion time",
  bauxite_concentrations_ug_g: "Bauxite concentrations",
  validation: "Validation evidence",
  limitations: "Limitations",
  unit: "Unit",
  elements: "Element results",
};

const units: Record<string, string> = {
  al2o3_pct: "wt %",
  sio2_pct: "wt %",
  fe2o3_pct: "wt %",
  tio2_pct: "wt %",
  cao_pct: "wt %",
  mgo_pct: "wt %",
  k2o_pct: "wt %",
  na2o_pct: "wt %",
  Li: "µg/g",
  Ga: "µg/g",
  Sc: "µg/g",
  roasting_temperature_c: "°C",
  roasting_time_min: "min",
  lime_pct: "%",
  na2ok_g_l: "g/L",
  digestion_temperature_c: "°C",
  digestion_time_min: "min",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sentence(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}

function returnedUnit(value: unknown) {
  const unit = textValue(value);
  if (!unit) return "";
  return unit.toLowerCase() === "percent" ? "%" : unit;
}

function rowUnit(path: string[], key: string, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if ((key === "Li" || key === "Ga" || key === "Sc") && path[path.length - 1] !== "bauxite_concentrations_ug_g") {
    return "";
  }
  return units[key] ?? "";
}

function textItems(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(textItems);
  return [];
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value, 4) : "Invalid number";
  if (typeof value === "object") return "Structured information";
  return String(value);
}

export function DataRows({ data, path = [] }: { data: Record<string, unknown>; path?: string[] }) {
  return <dl className="data-rows">{Object.entries(data).map(([key, value]) => {
    const currentPath = [...path, key];
    const unit = rowUnit(path, key, value);
    return <div key={key}>
      <dt>{labels[key] ?? sentence(key)}</dt>
      <dd>
        {isRecord(value) ? <DataRows data={value} path={currentPath} />
          : Array.isArray(value) ? <ul>{value.map((item, index) => <li key={index}>{isRecord(item) ? <DataRows data={item} path={currentPath} /> : displayValue(item)}</li>)}</ul>
            : <>{displayValue(value)}{unit && value !== null && value !== undefined && value !== "" ? <small> {unit}</small> : null}</>}
      </dd>
    </div>;
  })}</dl>;
}

function ValidationEvidence({ value }: { value: unknown }) {
  if (isRecord(value)) return <DataRows data={value} />;
  const items = textItems(value);
  if (items.length) return <ul className="evidence-list">{items.map(item => <li key={item}>{item}</li>)}</ul>;
  return <p className="evidence-empty">No validation note was returned with this record.</p>;
}

function ResultSummary({ prediction }: { prediction: Prediction }) {
  const output = prediction.output_data;

  if (prediction.kind === "alumina") {
    const value = finiteNumber(output.digestion_efficiency_pct);
    const unit = returnedUnit(output.unit);
    return <div className="typed-result typed-result--single">
      <p className="typed-result-label">Digestion efficiency estimate</p>
      <p className="typed-result-value">{value === null ? "Not returned" : formatNumber(value, 1)}
        {value !== null && unit ? <small>{unit}</small> : null}</p>
      {!unit && value !== null && <p className="result-unit-warning">The saved response did not include a unit.</p>}
    </div>;
  }

  if (prediction.kind === "ore") {
    const ratio = finiteNumber(output.as_ratio);
    const probability = finiteNumber(output.classifier_probability);
    const threshold = textValue(output.threshold_grade);
    const classifier = textValue(output.classifier_grade);
    const hasGradePair = !!(threshold && classifier);
    const disagreementFlag = typeof output.grade_disagreement === "boolean" ? output.grade_disagreement : null;
    const disagreement = hasGradePair && disagreementFlag === true;
    const agreementMessage = !hasGradePair
      ? "One or both grade fields were not returned, so agreement cannot be determined."
      : disagreementFlag === true
        ? "The threshold and classifier grades do not agree."
        : disagreementFlag === false
          ? "The threshold and classifier grades agree."
          : "Agreement status was not returned with this record.";
    return <div className="typed-result typed-result--ore">
      <p className="typed-result-label">Grade by A/S thresholds</p>
      <p className="typed-result-value typed-result-value--word">{threshold ? sentence(threshold) : "Not returned"}</p>
      <dl className="result-facts">
        <div><dt>Alumina / silica</dt><dd>{ratio === null ? "Not returned" : formatNumber(ratio, 3)}</dd></div>
        <div><dt>Classifier grade</dt><dd>{classifier ? sentence(classifier) : "Not returned"}</dd></div>
        <div><dt>Classifier match score</dt><dd>{probability === null ? "Not returned" : `${formatNumber(probability * 100, 1)}%`}</dd></div>
        <div><dt>Cluster identifier</dt><dd>{displayValue(output.cluster_id)}</dd></div>
      </dl>
      <p className={`result-agreement ${disagreement || disagreementFlag === null || !hasGradePair ? "result-agreement--warning" : ""}`}>
        {agreementMessage}
        {" "}The classifier score is not calibrated confidence or an economic rating.
      </p>
    </div>;
  }

  const elements = isRecord(output.elements) ? output.elements : {};
  return <div className="typed-result typed-result--metals">
    <p className="typed-result-label">Extraction efficiency estimates</p>
    <div className="element-results">{(["Li", "Ga", "Sc"] as const).map(symbol => {
      const element = isRecord(elements[symbol]) ? elements[symbol] : {};
      const value = finiteNumber(element.extraction_efficiency_pct);
      const unit = returnedUnit(element.unit);
      return <div className="element-result" key={symbol}>
        <div><strong>{symbol}</strong><span>{{ Li: "Lithium", Ga: "Gallium", Sc: "Scandium" }[symbol]}</span></div>
        <p>{value === null ? "Not returned" : formatNumber(value, 1)}{value !== null && unit ? <small>{unit}</small> : null}</p>
        {!unit && value !== null && <small className="result-unit-warning">Unit not supplied</small>}
      </div>;
    })}</div>
    <p className="result-agreement">All three values belong to one recorded bundle. They are extraction estimates, not recovered mass or economic value.</p>
  </div>;
}

export function PredictionDetails({ prediction }: { prediction: Prediction }) {
  const limitations = textItems(prediction.output_data.limitations);
  return <article className="prediction-details">
    <div className="prediction-result-head">
      <div><p className="eyebrow">{kindNames[prediction.kind]} result</p><h3>Recorded result</h3></div>
      <StatusChip tone="ok">Recorded</StatusChip>
    </div>
    <ResultSummary prediction={prediction} />
    <p className="record-meta">Recorded {dateLabel(prediction.created_at)}</p>
    <section className="result-evidence" aria-labelledby={`limitations-${prediction.id}`}>
      <h4 id={`limitations-${prediction.id}`}>What to keep in mind</h4>
      {limitations.length
        ? <ul className="evidence-list">{limitations.map(item => <li key={item}>{item}</li>)}</ul>
        : <p className="evidence-empty">No limitation text was returned with this recorded analysis.</p>}
    </section>
    <div className="snapshot-columns">
      <section>
        <h3>Input snapshot</h3>
        <p className="evidence-intro">The exact measurements and conditions saved with this result.</p>
        <DataRows data={prediction.input_data} />
      </section>
      <section>
        <h3>Validation</h3>
        <p className="evidence-intro">Evidence supplied with this model output.</p>
        <ValidationEvidence value={prediction.output_data.validation} />
      </section>
    </div>
    <details className="source-disclosure">
      <summary>Model provenance and complete result fields</summary>
      <dl className="data-rows provenance-rows">
        <div><dt>Prediction ID</dt><dd>{prediction.id}</dd></div>
        <div><dt>Model</dt><dd>{prediction.model_label ?? "Not recorded"}</dd></div>
        <div><dt>Model version ID</dt><dd>{prediction.model_version_id}</dd></div>
        <div><dt>Result schema</dt><dd>{prediction.schema_version}</dd></div>
      </dl>
      <DataRows data={prediction.output_data} />
    </details>
  </article>;
}

export function SaveScenario({ predictionId, initialName = "" }: { predictionId: string; initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Scenario | null>(null);

  return <section className="save-scenario"><h3>Save as a scenario</h3>
    <p className="evidence-intro">A scenario adds a name and description to this immutable recorded analysis.</p>
    {saved ? <p className="notice notice--ok" role="status">Saved “{saved.name}”. <Link to={`/scenarios/${saved.id}`}>Open scenario →</Link></p>
      : <form onSubmit={event => {
        event.preventDefault();
        if (busy) return;
        const trimmedName = name.trim();
        if (!trimmedName) {
          setError("Enter a scenario name.");
          return;
        }
        setBusy(true);
        setError("");
        void api<Scenario>("/scenarios/", {
          method: "POST",
          body: JSON.stringify({ name: trimmedName, description: description.trim(), prediction_id: predictionId }),
        }).then(setSaved).catch(errorValue => setError(asApiError(errorValue).message)).finally(() => setBusy(false));
      }}>
        <label className="field">Scenario name<Input required maxLength={120} value={name}
          aria-invalid={error ? true : undefined} onChange={event => setName(event.target.value)} /></label>
        <label className="field">Description <span className="field__hint">Optional</span><textarea className="textarea" maxLength={2000}
          value={description} onChange={event => setDescription(event.target.value)} rows={3} /></label>
        {error && <p role="alert" className="field__error">{error}</p>}
        <Button type="submit" variant="strong" disabled={busy}>{busy ? "Saving…" : "Save scenario"}</Button>
      </form>}
  </section>;
}
