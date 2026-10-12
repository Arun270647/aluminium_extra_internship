import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Notice, StatusChip } from "../../components/primitives/Controls";
import { SaveScenario } from "../../components/ResearchControls";
import type { Kind, Module, ModuleMode, Prediction } from "../../services/research";

export type AnalysisResultState = "empty" | "running" | "committed" | "stale" | "invalid" | "error" | "unavailable";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function format(value: number, digits = 2) {
  return new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function word(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().replaceAll("_", " ").replace(/^\w/, character => character.toUpperCase())
    : null;
}

function textItems(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(textItems);
  return [];
}

export function utcTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

const elementNames = { Li: "Lithium", Ga: "Gallium", Sc: "Scandium" } as const;

// e.g. "roasting 600 °C / 120 min"
export function modeSummary(input: Record<string, unknown>, modes: ModuleMode[]) {
  const value = typeof input.experiment_mode === "string" ? input.experiment_mode : "";
  if (!value) return "";
  const mode = modes.find(item => item.value === value);
  const label = (mode?.label ?? value.replaceAll("_", " ")).toLowerCase();
  const conditions = isRecord(input.conditions) ? input.conditions : {};
  const parts = Object.entries(conditions).flatMap(([key, raw]) => {
    const number = finite(raw);
    if (number === null) return [];
    const unit = mode?.fields.find(field => field.key === key)?.unit;
    return [`${new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(number)}${unit ? ` ${unit}` : ""}`];
  });
  return parts.length ? `${label} ${parts.join(" / ")}` : label;
}

function shortVersion(id: string) {
  return id ? `model ${id.slice(0, 8)}` : "";
}

function stateChip(state: AnalysisResultState, prediction: Prediction | undefined, checking: boolean) {
  if (checking) return <StatusChip tone="info">Checking availability</StatusChip>;
  switch (state) {
    case "committed": return prediction ? <StatusChip tone="ok" pulse>Recorded {utcTime(prediction.created_at)} UTC</StatusChip> : null;
    case "stale": return <StatusChip tone="warn">Inputs changed since last run</StatusChip>;
    case "error": return <StatusChip tone="bad">Request failed</StatusChip>;
    case "invalid": return <StatusChip tone="bad">Check inputs</StatusChip>;
    case "unavailable": return <StatusChip tone="info">Model unavailable</StatusChip>;
    case "running": return <StatusChip tone="info">Running</StatusChip>;
    default: return null;
  }
}

const stateCopy: Record<Exclude<AnalysisResultState, "committed" | "stale">, string> = {
  empty: "",
  running: "Running this analysis… Your submitted measurements are being checked and evaluated.",
  invalid: "Correct the highlighted measurements. Values you already entered have been kept.",
  error: "No new result was recorded. Your inputs are still here so you can review them and retry.",
  unavailable: "This analysis cannot produce an estimate right now. Your measurements remain in this tab.",
};

function Facts({ items }: { items: Array<{ label: string; value: ReactNode; tone?: "warn" | "ok"; mono?: boolean }> }) {
  if (!items.length) return null;
  const columns = items.length === 4 ? 2 : Math.min(items.length, 3);
  return <dl className={`analysis-facts analysis-facts--${columns}`}>
    {items.map(item => <div key={item.label}>
      <dt>{item.label}</dt>
      <dd className={[item.mono && "mono", item.tone && `is-${item.tone}`].filter(Boolean).join(" ")}>{item.value}</dd>
    </div>)}
  </dl>;
}

function r2Item(label: string, value: unknown) {
  const number = finite(value);
  return number === null ? [] : [{ label, value: format(number, 2).replace("-", "−"), mono: true, tone: number < 0 ? "warn" as const : undefined }];
}

function ResultActions({ prediction, state, scenarioName, extra }: {
  prediction: Prediction; state: AnalysisResultState; scenarioName: string; extra?: ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const committed = state === "committed";
  return <>
    {state === "stale" && <Notice tone="warn" size="sm">Run the analysis again before saving a scenario for these measurements.</Notice>}
    <div className="analysis-actions">
      <Button variant="strong" disabled={!committed} aria-expanded={saving} onClick={() => setSaving(open => !open)}>Save as scenario</Button>
      {extra}
    </div>
    {committed && saving && <SaveScenario key={prediction.id} predictionId={prediction.id} initialName={scenarioName} />}
  </>;
}

function EmptyResult({ eyebrow, big, text }: { eyebrow: string; big: string; text: string }) {
  return <div className="analysis-empty">
    <span className="eyebrow eyebrow--accent">{eyebrow}</span>
    <span className="analysis-empty__mark" aria-hidden="true">{big}</span>
    <span className="analysis-empty__text">{text}</span>
  </div>;
}

export function AnalysisResult({
  kind, state, prediction, module, message, checking, onRetryAvailability, scenarioName,
  live, onUseChemistry, localCheck,
}: {
  kind: Kind; state: AnalysisResultState; prediction?: Prediction; module?: Module; message?: string;
  checking: boolean; onRetryAvailability: () => void; scenarioName: string;
  live?: ReactNode; onUseChemistry?: () => void; localCheck?: ReactNode;
}) {
  const showPrediction = !!prediction && (state === "committed" || state === "stale");
  const stateText = state === "committed" || state === "stale" ? "" : (message || stateCopy[state]);
  const modes = module?.input_schema?.modes ?? [];

  let body: ReactNode;
  if (showPrediction && prediction) {
    if (kind === "ore") body = <OreResult prediction={prediction} state={state} scenarioName={scenarioName} onUseChemistry={onUseChemistry} />;
    else if (kind === "alumina") body = <DigestionResult prediction={prediction} state={state} scenarioName={scenarioName} modes={modes} />;
    else body = <RecoveryResult prediction={prediction} state={state} scenarioName={scenarioName} modes={modes} />;
  } else {
    const empty = kind === "ore"
      ? <EmptyResult eyebrow="Grade by A/S thresholds" big="—" text="Run the analysis to see the grade here." />
      : kind === "alumina"
        ? <EmptyResult eyebrow="Digestion efficiency estimate" big="—" text="Run the estimate to see the digestion efficiency here." />
        : <EmptyResult eyebrow="Extraction efficiency" big="—" text="Run the estimate to see Li, Ga and Sc extraction here." />;
    body = <div className="analysis-result__block">
      {state === "empty" ? empty : <p className="analysis-state-copy" role={state === "invalid" || state === "error" ? "alert" : undefined}>
        {checking ? "Loading the verified model and input contract for this analysis." : stateText}</p>}
      {state === "running" && <div className="analysis-progress" aria-hidden="true"><span /></div>}
      {localCheck}
      {state === "unavailable" && <>
        {module?.limitations?.length ? <ul className="analysis-notes">{module.limitations.map(item => <li key={item}>{item}</li>)}</ul> : null}
        <div className="analysis-actions">
          <Button variant="quiet" size="sm" disabled={checking} onClick={onRetryAvailability}>Check availability</Button>
        </div>
      </>}
    </div>;
  }

  return <section className="panel analysis-result" aria-labelledby={`${kind}-result-title`}>
    <div className="panel__head analysis-result__head">
      <h2 className="panel__title" id={`${kind}-result-title`}>Result</h2>
      {stateChip(state, prediction, checking)}
    </div>
    {live}
    <div aria-live="polite" aria-busy={state === "running"}>{body}</div>
  </section>;
}

function OreResult({ prediction, state, scenarioName, onUseChemistry }: {
  prediction: Prediction; state: AnalysisResultState; scenarioName: string; onUseChemistry?: () => void;
}) {
  const output = prediction.output_data;
  const threshold = word(output.threshold_grade);
  const classifier = word(output.classifier_grade);
  const probability = finite(output.classifier_probability);
  const disagreement = typeof output.grade_disagreement === "boolean" ? output.grade_disagreement : null;
  const facts = [
    { label: "Classifier grade", value: classifier ?? "Not returned" },
    { label: "Classifier match score", value: probability === null ? "Not returned" : `${format(probability * 100, 1)} %`, mono: true },
    { label: "Cluster", value: output.cluster_id === null || output.cluster_id === undefined ? "Not returned" : String(output.cluster_id), mono: true },
    {
      label: "Grades agree",
      value: disagreement === null || !threshold || !classifier ? "Unknown" : disagreement ? "No" : "Yes",
      tone: disagreement === false ? "ok" as const : "warn" as const,
    },
  ];
  return <div className="analysis-result__block">
    <div className="analysis-headline">
      <span className="eyebrow eyebrow--accent">Grade by A/S thresholds</span>
      <span className="analysis-grade">{threshold ?? "Not returned"}</span>
      <span className="analysis-caption">Geochemical grade only — not an economic valuation.</span>
    </div>
    <Facts items={facts} />
    <Notice tone="info" size="sm">The classifier mostly reproduces the A/S threshold rule. Its score is not calibrated confidence.</Notice>
    <Limitations output={output} />
    <ResultActions prediction={prediction} state={state} scenarioName={scenarioName}
      extra={onUseChemistry && <Button variant="quiet" onClick={onUseChemistry}>Use chemistry in Digestion</Button>} />
  </div>;
}

function DigestionResult({ prediction, state, scenarioName, modes }: {
  prediction: Prediction; state: AnalysisResultState; scenarioName: string; modes: ModuleMode[];
}) {
  const output = prediction.output_data;
  const value = finite(output.digestion_efficiency_pct);
  const unit = output.unit === "percent" ? "%" : typeof output.unit === "string" ? output.unit : "";
  const validation = isRecord(output.validation) ? output.validation : {};
  const metrics = isRecord(validation.metrics) ? validation.metrics : {};
  const samples = finite(validation.samples);
  const mae = finite(metrics.mae) ?? finite(metrics.mae_pct_points);
  const input = prediction.input_data;
  const feed = word(input.feed_type)?.toLowerCase();
  const meta = [`Recorded ${utcTime(prediction.created_at)} UTC`, prediction.model_label || shortVersion(prediction.model_version_id),
    [feed, modeSummary(input, modes)].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const facts = [
    ...(samples === null ? [] : [{ label: "Training samples", value: `n = ${samples}`, mono: true }]),
    ...r2Item("Validation R² (structure-aware)", metrics.structure_aware_r2),
    ...(mae === null ? [] : [{ label: "Mean abs. error", value: `${format(mae, 1)} pts`, mono: true }]),
  ];
  return <>
    <div className="analysis-hero">
      <span className="eyebrow eyebrow--accent">Digestion efficiency estimate</span>
      <span className="analysis-big">{value === null ? "—" : format(value, 1)}{value !== null && unit && <small> {unit}</small>}</span>
      {value !== null && !unit && <span className="analysis-caption is-warn">The saved response did not include a unit.</span>}
      <span className="analysis-caption">{meta}</span>
    </div>
    <div className="analysis-result__block">
      <div className="analysis-read">
        <span className="eyebrow">How to read this</span>
        <p>{value === null ? "No efficiency value was returned with this record." : <>
          Of the alumina in this feed, about <strong>{format(value, 0)} %</strong> is estimated to dissolve under the chosen conditions.
          {samples !== null && <> The model was trained on {samples} laboratory observations.</>} Treat this as a starting point for investigation, not a plant figure.</>}</p>
      </div>
      <Facts items={facts} />
      <Limitations output={output} />
      <ResultActions prediction={prediction} state={state} scenarioName={scenarioName}
        extra={<Link className="btn btn--quiet" to="/history">View record</Link>} />
    </div>
  </>;
}

function RecoveryResult({ prediction, state, scenarioName, modes }: {
  prediction: Prediction; state: AnalysisResultState; scenarioName: string; modes: ModuleMode[];
}) {
  const output = prediction.output_data;
  const elements = isRecord(output.elements) ? output.elements : {};
  const input = prediction.input_data;
  const concentrations = isRecord(input.bauxite_concentrations_ug_g) ? input.bauxite_concentrations_ug_g : {};
  const sharedValidation = isRecord(output.validation) && isRecord(output.validation.elements) ? output.validation.elements : {};
  const summary = modeSummary(input, modes);
  const facts = (["Li", "Ga", "Sc"] as const).flatMap(symbol => {
    const element = isRecord(elements[symbol]) ? elements[symbol] : {};
    const validation = isRecord(element.validation) ? element.validation : {};
    const metrics = isRecord(validation.metrics) ? validation.metrics
      : isRecord(sharedValidation[symbol]) ? sharedValidation[symbol] : {};
    return r2Item(`${symbol} validation R²`, metrics.loocv_r2 ?? metrics.r2);
  });
  const limitations = textItems(output.limitations);
  return <>
    <div className="analysis-result__block analysis-result__block--rule">
      <span className="eyebrow eyebrow--accent">Extraction efficiency{summary ? ` · ${summary}` : ""}</span>
      {(["Li", "Ga", "Sc"] as const).map(symbol => {
        const element = isRecord(elements[symbol]) ? elements[symbol] : {};
        const value = finite(element.extraction_efficiency_pct);
        const unit = element.unit === "percent" ? "%" : typeof element.unit === "string" ? element.unit : "";
        const concentration = finite(concentrations[symbol]);
        const width = value === null ? 0 : Math.max(0, Math.min(100, value));
        return <div className="analysis-element" key={symbol}>
          <span className="analysis-element__name">
            <span>{elementNames[symbol]}</span>
            <span className="mono">{symbol}{concentration !== null ? ` · ${new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(concentration)} µg/g` : ""}</span>
          </span>
          <span className="analysis-bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></span>
          <span className="analysis-element__value">{value === null ? "—" : format(value, 1)}{value !== null && unit && <small> {unit}</small>}</span>
        </div>;
      })}
    </div>
    <div className="analysis-result__block">
      {limitations.length > 0 && <Notice tone="warn" size="lg"><strong>Qualitative screening only.</strong> {limitations.join(" ")}</Notice>}
      <Facts items={facts} />
      <ResultActions prediction={prediction} state={state} scenarioName={scenarioName} />
    </div>
  </>;
}

function Limitations({ output }: { output: Record<string, unknown> }) {
  const items = textItems(output.limitations);
  if (!items.length) return null;
  return <div className="analysis-limits">
    <span className="eyebrow">What to keep in mind</span>
    <ul className="analysis-notes">{items.map(item => <li key={item}>{item}</li>)}</ul>
  </div>;
}
