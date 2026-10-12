import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button, Input, KindTag, Notice, PageHeader, Pagination, Panel, StatusChip } from "../../components/primitives/Controls";
import {
  ConfirmDialog,
  EmptyState,
  PredictionDetails,
  ResourceState,
} from "../../components/ResearchControls";
import { api, asApiError } from "../../services/api";
import {
  downloadCSV,
  kindNames,
  useResource,
  type Comparison,
  type ComparisonRow,
  type Kind,
  type Page,
  type Scenario,
  utcDateTime,
  utcShortDate,
} from "../../services/research";
import "../../styles/records.css";

const kindOrder = Object.keys(kindNames) as Kind[];
const validKinds = new Set<string>(kindOrder);
const incompatibleMessage = "Choose scenarios with the same analysis type to compare them.";

function positivePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function modelName(record: { model_label?: string | null; model_version_id?: string | null }) {
  return record.model_label ?? (record.model_version_id ? record.model_version_id.slice(0, 8) : "—");
}

export function ScenariosPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = validKinds.has(searchParams.get("kind") ?? "") ? searchParams.get("kind") ?? "" : "";
  const page = positivePage(searchParams.get("page"));
  const [selected, setSelected] = useState<Scenario[]>([]);
  const [error, setError] = useState("");
  const query = `/scenarios/?page=${page}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`;
  const state = useResource<Page<Scenario>>(query);

  useEffect(() => {
    setSelected([]);
    setError("");
  }, [kind]);

  function updateList(nextKind: string, nextPage = 1) {
    const next = new URLSearchParams();
    if (nextKind) next.set("kind", nextKind);
    if (nextPage > 1) next.set("page", String(nextPage));
    setSearchParams(next);
  }

  function choose(record: Scenario) {
    setError("");
    if (selected.some(scenario => scenario.id === record.id)) {
      setSelected(selected.filter(scenario => scenario.id !== record.id));
      return;
    }
    if (selected.length === 3) {
      setError("You can compare up to three scenarios at a time.");
      return;
    }
    if (selected.some(scenario => scenario.kind !== record.kind || scenario.schema_version !== record.schema_version)) {
      setError(incompatibleMessage);
      return;
    }
    setSelected([...selected, record]);
  }

  function openRow(event: MouseEvent<HTMLDivElement>, scenario: Scenario) {
    // checkbox and name link handle their own clicks
    if ((event.target as HTMLElement).closest("input, a, button, label")) return;
    navigate(`/scenarios/${scenario.id}`);
  }

  const canCompare = selected.length >= 2;
  const comparisonPath = canCompare ? `/scenarios/compare?ids=${selected.map(scenario => scenario.id).join(",")}` : "";
  const filters: Array<[string, string]> = [["", "All"], ...kindOrder.map(value => [value, kindNames[value]] as [string, string])];

  return <section className="screen records-screen">
    <PageHeader eyebrow="Saved work" title="Scenarios"
      lede="A scenario is a name on a recorded analysis. Tick two or three of the same type to compare them."
      actions={<>
        <span className="records-selected" aria-live="polite">{selected.length} selected</span>
        {selected.length > 0 && <Button variant="quiet" onClick={() => { setSelected([]); setError(""); }}>Clear</Button>}
        {canCompare
          ? <Link className="btn" to={comparisonPath}>Compare selected →</Link>
          : <Button disabled aria-describedby="compare-hint">Compare selected →</Button>}
      </>} />
    <p id="compare-hint" className="sr-only">Select two or three scenarios of the same analysis type to enable comparison.</p>

    <div className="filter-chips" role="group" aria-label="Filter by analysis">
      {filters.map(([value, label]) => <button key={label} type="button"
        className={`filter-chip${kind === value ? " is-active" : ""}`} aria-pressed={kind === value}
        onClick={() => updateList(value)}>{label}</button>)}
    </div>

    {error && <Notice tone="bad" role="alert">{error}</Notice>}
    <ResourceState {...state} retry={state.reload} />

    {state.data && (state.data.results.length > 0 ? <div className="table-wrap" role="region" aria-label="Saved scenarios" tabIndex={0}>
      <div className="table-grid scenario-grid table-head" aria-hidden="true">
        <span /><span>Scenario</span><span>Analysis</span><span>Result</span><span>Updated</span>
      </div>
      <ul className="record-list">
        {state.data.results.map(scenario => {
          const checked = selected.some(item => item.id === scenario.id);
          return <li key={scenario.id}>
            <div className={`table-grid scenario-grid table-row row-link${checked ? " is-selected" : ""}`}
              onClick={event => openRow(event, scenario)}>
              <label className="check-hit">
                <input type="checkbox" checked={checked} onChange={() => choose(scenario)} />
                <span className="sr-only">Select {scenario.name} for comparison</span>
              </label>
              <span className="cell-stack">
                <Link className="record-name" to={`/scenarios/${scenario.id}`}>{scenario.name}</Link>
                {scenario.description && <span className="cell-ellipsis cell-sub">{scenario.description}</span>}
              </span>
              <span><KindTag kind={scenario.kind} /></span>
              <span className="mono cell-result">{scenario.result_summary ?? <span className="cell-sub">Not available</span>}</span>
              <span className="mono cell-sub"><span className="sr-only">Updated </span>
                <time dateTime={scenario.updated_at}>{utcDateTime(scenario.updated_at)}</time></span>
            </div>
          </li>;
        })}
      </ul>
      <Pagination page={page} data={state.data} onChange={nextPage => updateList(kind, nextPage)} />
    </div> : <EmptyState title={kind ? "No scenarios for this analysis." : "No named scenarios yet."}>
      <p>{kind
        ? "Choose another analysis type or save a completed analysis as a scenario."
        : "Open a recorded analysis from History and give it a name when you want to revisit or compare it."}</p>
      <Link className="link-action" to="/history">Open analysis history →</Link>
    </EmptyState>)}
  </section>;
}

function ScenarioEditor({ record, reload }: { record: Scenario; reload: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(record.name);
  const [description, setDescription] = useState(record.description);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a scenario name.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/scenarios/${record.id}/`, { method: "PATCH", body: JSON.stringify({ name: trimmedName, description }) });
      setEditing(false);
      reload();
    } catch (caught) {
      const issue = asApiError(caught);
      setError(issue.fields.name?.join(" ") ?? issue.fields.description?.join(" ") ?? issue.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/scenarios/${record.id}/`, { method: "DELETE" });
      navigate("/scenarios", { replace: true });
    } catch (caught) {
      setError(asApiError(caught).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function cancelEdit() {
    setName(record.name);
    setDescription(record.description);
    setEditing(false);
    setError("");
  }

  return <>
    <PageHeader back={<Link className="back-link" to="/scenarios">← Back to scenarios</Link>}
      eyebrow={`Saved scenario · ${kindNames[record.kind]}`} title={record.name}
      lede={record.description || "A named reference to one immutable recorded analysis."}
      actions={<>
        <Button variant="quiet" disabled={busy} onClick={() => editing ? cancelEdit() : (setEditing(true), setError(""))}>
          {editing ? "Close editor" : "Edit name & notes"}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => { setError(""); setDeleting(true); }}>Delete scenario</Button>
      </>} />

    {error && !deleting && <Notice tone="bad" role="alert">{error}</Notice>}

    {editing && <form className="panel" onSubmit={save} aria-labelledby="scenario-editor-title">
      <div className="panel__head">
        <h2 className="panel__title" id="scenario-editor-title">Edit scenario details</h2>
        <span className="panel__meta">The recorded measurements and result will not change.</span>
      </div>
      <div className="panel__body scenario-editor">
        <label className="field">Scenario name
          <Input required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Description <span className="field__hint">optional</span></span>
          <textarea className="textarea" rows={4} maxLength={2000} value={description} disabled={busy}
            onChange={event => setDescription(event.target.value)} />
        </label>
      </div>
      <div className="panel__foot">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save details"}</Button>
        <Button variant="quiet" disabled={busy} onClick={cancelEdit}>Cancel</Button>
      </div>
    </form>}

    {record.prediction ? <Panel title="Recorded analysis"
      meta={<span className="scenario-record-meta">
        <span className="mono cell-model">{modelName(record.prediction)}</span>
        <StatusChip tone="ok">Recorded {utcDateTime(record.prediction.created_at)} UTC</StatusChip>
      </span>}>
      <div className="panel__body"><PredictionDetails prediction={record.prediction} /></div>
    </Panel> : <Notice tone="warn" role="status">
      The recorded analysis was not returned. Reload this page to try again; no result has been inferred.
    </Notice>}

    {deleting && <ConfirmDialog title="Delete this scenario?" action="Delete scenario" busy={busy}
      confirm={() => void remove()} cancel={() => { if (!busy) { setDeleting(false); setError(""); } }}>
      <p>“{record.name}” will be removed from Scenarios. Its recorded analysis and full history will remain available.</p>
      {error && <p role="alert" className="field__error">{error}</p>}
    </ConfirmDialog>}
  </>;
}

export function ScenarioDetailPage() {
  const { id } = useParams();
  const state = useResource<Scenario>(id ? `/scenarios/${id}/` : null);
  return <section className="screen records-screen">
    {!state.data && <Link className="back-link" to="/scenarios">← Back to scenarios</Link>}
    <ResourceState {...state} retry={state.reload} />
    {state.data && <ScenarioEditor key={`${state.data.id}:${state.data.updated_at}`} record={state.data} reload={state.reload} />}
  </section>;
}

function sameValue(a: ComparisonRow["values"][number], b: ComparisonRow["values"][number]) {
  return a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-12);
}

type Cell = ComparisonRow["values"][number];
type RowFormat = { label: string; unit?: string; render: (value: Cell) => string; word?: boolean };

const fixed = (digits: number) => (value: Cell) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value)
    : plain(value);
const integer = (value: Cell) => typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : plain(value);
const capital = (value: Cell): string => typeof value === "string" && value
  ? value.replaceAll("_", " ").replace(/^./, first => first.toUpperCase()) : plain(value);

function plain(value: Cell): string {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? new Intl.NumberFormat("en", { maximumFractionDigits: 4, useGrouping: false }).format(value) : "—";
  return capital(value);
}

const oxide = (symbol: string): RowFormat => ({ label: `${symbol} (wt %)`, render: fixed(2) });
const elementName: Record<string, string> = { Li: "Lithium", Ga: "Gallium", Sc: "Scandium" };

const inputFormats: Array<[string, RowFormat]> = [
  ["al2o3_pct", oxide("Al₂O₃")], ["sio2_pct", oxide("SiO₂")], ["fe2o3_pct", oxide("Fe₂O₃")], ["tio2_pct", oxide("TiO₂")],
  ["cao_pct", oxide("CaO")], ["mgo_pct", oxide("MgO")], ["k2o_pct", oxide("K₂O")], ["na2o_pct", oxide("Na₂O")],
  ["bauxite_concentrations_ug_g.Li", { label: "Li (µg/g)", render: plain }],
  ["bauxite_concentrations_ug_g.Ga", { label: "Ga (µg/g)", render: plain }],
  ["bauxite_concentrations_ug_g.Sc", { label: "Sc (µg/g)", render: plain }],
  ["feed_type", { label: "Feed condition", render: capital }],
  ["experiment_mode", { label: "Experiment", render: capital }],
  ["conditions.roasting_temperature_c", { label: "Roasting temperature (°C)", render: plain }],
  ["conditions.roasting_time_min", { label: "Roasting time (min)", render: plain }],
  ["conditions.lime_pct", { label: "Lime addition (%)", render: plain }],
  ["conditions.na2ok_g_l", { label: "Caustic Na₂O (g/L)", render: plain }],
  ["conditions.digestion_temperature_c", { label: "Digestion temperature (°C)", render: plain }],
  ["conditions.digestion_time_min", { label: "Digestion time (min)", render: plain }],
];

const resultFormats: Array<[string, RowFormat]> = [
  ["digestion_efficiency_pct", { label: "Digestion efficiency", unit: "%", render: fixed(1) }],
  ["threshold_grade", { label: "Grade by A/S thresholds", render: capital, word: true }],
  ["as_ratio", { label: "Alumina / silica", render: fixed(2) }],
  ["classifier_grade", { label: "Classifier grade", render: capital, word: true }],
  ["classifier_probability", { label: "Classifier match score", unit: "%",
    render: value => typeof value === "number" && Number.isFinite(value) ? fixed(1)(value * 100) : plain(value) }],
  ["cluster_id", { label: "Cluster", render: integer }],
  ["grade_disagreement", { label: "Grades disagree", render: plain, word: true }],
  ...(["Li", "Ga", "Sc"] as const).map(symbol => [`elements.${symbol}.extraction_efficiency_pct`,
    { label: `${elementName[symbol]} extraction`, unit: "%", render: fixed(1) }] as [string, RowFormat]),
];

function presentRows(rows: ComparisonRow[], formats: Array<[string, RowFormat]>) {
  const known = new Map(formats);
  const order = new Map(formats.map(([key], index) => [key, index]));
  return [...rows]
    .sort((a, b) => (order.get(a.key) ?? formats.length) - (order.get(b.key) ?? formats.length))
    .map(row => ({ row, format: known.get(row.key) ?? {
      label: row.unit ? `${row.label} (${row.unit === "percent" ? "%" : row.unit})` : row.label, render: plain,
    } as RowFormat }));
}

function CompareCells({ row, format, highlight, result = false }: { row: ComparisonRow; format: RowFormat; highlight: boolean; result?: boolean }) {
  return <>
    <div role="rowheader" className={`compare-label${result ? " compare-label--result" : ""}`}>{format.label}</div>
    {row.values.map((value, index) => {
      const differs = highlight && index > 0 && !sameValue(value, row.values[0]);
      const empty = value === null || value === "";
      return <div role="cell" key={index}
        className={`compare-cell mono${result ? " compare-cell--result" : ""}${result && format.word ? " compare-cell--word" : ""}${differs ? " is-different" : ""}`}>
        {format.render(value)}
        {result && format.unit && !empty && <span className="compare-cell__unit"> {format.unit}</span>}
        {differs && <span className="sr-only"> (differs from first scenario)</span>}
      </div>;
    })}
  </>;
}

export function ComparisonPage() {
  const [params] = useSearchParams();
  const ids = params.get("ids") ?? "";
  const parsedIds = useMemo(() => ids.split(",").filter(Boolean), [ids]);
  const valid = parsedIds.length >= 2 && parsedIds.length <= 3 && new Set(parsedIds).size === parsedIds.length
    && parsedIds.every(id => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id));
  const state = useResource<Comparison>(valid ? `/scenarios/compare/?ids=${encodeURIComponent(ids)}` : null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  async function exportComparison() {
    if (!valid || !state.data || exporting) return;
    setExporting(true);
    setError("");
    try {
      await downloadCSV(`/scenarios/compare/export/?ids=${encodeURIComponent(ids)}`, "scenario-comparison.csv");
    } catch (caught) {
      setError(asApiError(caught).message);
    } finally {
      setExporting(false);
    }
  }

  const data = state.data;
  const count = data?.scenarios.length ?? 0;
  const columns = { gridTemplateColumns: `160px repeat(${count}, minmax(150px, 1fr))` };
  const kindLabel = data?.scenarios[0] ? kindNames[data.scenarios[0].kind].toLowerCase() : "";

  return <section className="screen records-screen">
    <PageHeader back={<Link className="back-link" to="/scenarios">← Back to scenarios</Link>}
      title={kindLabel ? `Compare ${kindLabel} scenarios` : "Compare scenarios"}
      lede="Side by side. Differences stay visible; no winner is declared."
      actions={<Button variant="quiet" disabled={!data || exporting} onClick={() => void exportComparison()}>
        {exporting ? "Preparing CSV…" : "Export comparison CSV"}
      </Button>} />

    {!valid && <EmptyState title="Choose two or three scenarios.">
      <p>Select distinct scenarios with the same analysis type and result format.</p>
      <Link className="link-action" to="/scenarios">Return to scenarios →</Link>
    </EmptyState>}

    <ResourceState {...state} retry={state.reload} />
    {error && <Notice tone="bad" role="alert">{error}</Notice>}

    {data && <>
      {data.warnings.length > 0 && <Notice tone="warn">
        <strong>Read these side by side, not as a ranking.</strong>
        <ul className="compare-warnings">{data.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
      </Notice>}

      <div className="table-wrap" role="region" aria-label="Scenario comparison" tabIndex={0}>
        <div role="table" aria-label={`Comparison of ${count} scenarios`} className="compare-table">
          <div role="row" className="compare-row compare-row--head" style={columns}>
            <div role="columnheader" className="compare-corner"><span className="sr-only">Measure</span></div>
            {data.scenarios.map(scenario => <div role="columnheader" key={scenario.id} className="compare-head">
              <Link className="compare-head__name" to={`/scenarios/${scenario.id}`}>{scenario.name}</Link>
              <span className="compare-head__meta">{utcShortDate(scenario.created_at)} · <span className="mono">{modelName(scenario)}</span></span>
            </div>)}
          </div>
          <div role="row" className="compare-band"><div role="cell">Result</div></div>
          {data.result_rows.length
            ? presentRows(data.result_rows, resultFormats).map(({ row, format }) => <div role="row" key={row.key} className="compare-row" style={columns}>
              <CompareCells row={row} format={format} highlight={false} result />
            </div>)
            : <div role="row" className="compare-band compare-band--empty"><div role="cell">No result values were returned.</div></div>}
          <div role="row" className="compare-band"><div role="cell">Inputs</div></div>
          {data.parameter_rows.length
            ? presentRows(data.parameter_rows, inputFormats).map(({ row, format }) => <div role="row" key={row.key} className="compare-row" style={columns}>
              <CompareCells row={row} format={format} highlight />
            </div>)
            : <div role="row" className="compare-band compare-band--empty"><div role="cell">No input values were returned.</div></div>}
        </div>
      </div>
      <p className="compare-legend"><span className="compare-legend__swatch" aria-hidden="true" />Highlighted cells differ from the first scenario.</p>

      <Panel title="Model evidence" meta={<span className="panel__meta">Full saved records for each scenario. No ranking is applied.</span>}>
        <div className="panel__body evidence-stack">
          {data.scenarios.map(scenario => <details className="evidence-disclosure" key={scenario.id}>
            <summary>{scenario.name} · <span className="mono">{modelName(scenario)}</span></summary>
            {scenario.prediction && <PredictionDetails prediction={scenario.prediction} />}
          </details>)}
        </div>
      </Panel>
    </>}
  </section>;
}
