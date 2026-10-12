import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, KindTag, Notice, PageHeader, Pagination } from "../../components/primitives/Controls";
import { EmptyState, PredictionDetails, ResourceState, SaveScenario } from "../../components/ResearchControls";
import { asApiError } from "../../services/api";
import {
  downloadCSV,
  kindNames,
  useResource,
  type Kind,
  type Page,
  type Prediction,
  type RecordSummary,
  utcDateTime,
} from "../../services/research";
import "../../styles/records.css";

const validKinds = new Set(Object.keys(kindNames));
type Period = "all" | "7d" | "30d" | "custom";
// "Last 30 days" is the default when there is no URL parameter
const periods: Array<[Period, string]> = [["30d", "Last 30 days"], ["7d", "Last 7 days"], ["all", "All time"], ["custom", "Custom range (UTC)"]];
const DAY = 86_400_000;

function positivePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function dateInput(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
}

function HistoryDetail({ id }: { id: string }) {
  const state = useResource<Prediction>(`/predictions/${id}/`);
  return <div className="history-detail" aria-label="Recorded analysis detail">
    <ResourceState {...state} retry={state.reload} />
    {state.data && <>
      <PredictionDetails prediction={state.data} />
      <SaveScenario predictionId={state.data.id} />
    </>}
  </div>;
}

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = validKinds.has(searchParams.get("kind") ?? "") ? searchParams.get("kind") ?? "" : "";
  const rawPeriod = searchParams.get("period");
  const period: Period = rawPeriod === "7d" || rawPeriod === "all" || rawPeriod === "custom" ? rawPeriod : "30d";
  const search = (searchParams.get("q") ?? "").slice(0, 120);
  const [searchDraft, setSearchDraft] = useState(search);
  const from = period === "custom" ? dateInput(searchParams.get("from")) : "";
  const through = period === "custom" ? dateInput(searchParams.get("through")) : "";
  const page = positivePage(searchParams.get("page"));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  // date_to is exclusive, so add a day to include the selected end date
  const apiFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (search.trim()) params.set("search", search.trim());
    if (period === "7d" || period === "30d") {
      params.set("date_from", new Date(Date.now() - (period === "7d" ? 7 : 30) * DAY).toISOString());
    }
    if (from) params.set("date_from", `${from}T00:00:00Z`);
    if (through) params.set("date_to", new Date(Date.parse(`${through}T00:00:00Z`) + DAY).toISOString());
    return params;
  }, [kind, period, from, through, search]);

  const listQuery = new URLSearchParams(apiFilters);
  listQuery.set("page", String(page));
  const state = useResource<Page<RecordSummary>>(`/predictions/?${listQuery.toString()}`);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (next.get("period") !== "custom") { next.delete("from"); next.delete("through"); }
    const nextFrom = next.get("from"), nextThrough = next.get("through");
    if (nextFrom && nextThrough && nextThrough < nextFrom) {
      setError("The Through date must be on or after the From date.");
      return;
    }
    setError("");
    next.delete("page");
    setExpanded(null);
    setSearchParams(next);
  }

  useEffect(() => { setSearchDraft(search); }, [search]);
  useEffect(() => {
    if (searchDraft === search) return;
    const timer = window.setTimeout(() => update({ q: searchDraft.trim() ? searchDraft : "" }), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  function changePage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) next.set("page", String(nextPage)); else next.delete("page");
    setExpanded(null);
    setSearchParams(next);
  }

  async function exportHistory() {
    setExporting(true);
    setError("");
    try {
      const query = apiFilters.toString();
      await downloadCSV(`/predictions/export/${query ? `?${query}` : ""}`, "prediction-history.csv");
    } catch (caught) {
      setError(asApiError(caught).message);
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = Boolean(kind || period !== "30d" || search);
  const total = state.data?.count;

  return <section className="screen records-screen">
    <PageHeader eyebrow="Saved work" title="Analysis history"
      lede="Every successful run, named or not. Records are immutable snapshots of inputs, outputs and model version."
      actions={<Button variant="quiet" className="history-export" disabled={exporting || !total} onClick={() => void exportHistory()}>
        {exporting ? "Preparing CSV…" : `Export CSV${total !== undefined ? ` (${total} ${total === 1 ? "record" : "records"})` : ""}`}
      </Button>} />

    <div className="history-filters" role="group" aria-label="Filter recorded analyses">
      <label className="history-filter">
        <span className="sr-only">Analysis</span>
        <select className="filter-select" value={kind} onChange={event => update({ kind: event.target.value })}>
          <option value="">All analyses</option>
          {Object.entries(kindNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="history-filter">
        <span className="sr-only">Period</span>
        <select className="filter-select" value={period} onChange={event => update({ period: event.target.value === "30d" ? "" : event.target.value })}>
          {periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {period === "custom" && <>
        <label className="history-filter history-filter--date">
          <span>From</span>
          <input className="filter-select" type="date" value={from} onChange={event => update({ from: event.target.value })} />
        </label>
        <label className="history-filter history-filter--date">
          <span>Through</span>
          <input className="filter-select" type="date" value={through} onChange={event => update({ through: event.target.value })} />
        </label>
      </>}
      <label className="history-filter history-filter--search">
        <span className="sr-only">Search summaries</span>
        <input className="filter-select history-search" type="search" maxLength={120} placeholder="Search summaries"
          value={searchDraft} onChange={event => setSearchDraft(event.target.value)} />
      </label>
      {hasFilters && <Button variant="quiet" size="sm" onClick={() => { setError(""); setExpanded(null); setSearchDraft(""); setSearchParams(new URLSearchParams()); }}>Reset</Button>}
    </div>

    {error && <Notice tone="bad" role="alert">{error}</Notice>}
    <ResourceState {...state} retry={state.reload} />

    {state.data && (state.data.results.length > 0 ? <div className="table-wrap" role="region" aria-label="Recorded analyses" tabIndex={0}>
      <div className="table-grid history-grid table-head" aria-hidden="true">
        <span>Recorded (UTC)</span><span>Analysis</span><span>Summary</span><span>Scenario</span><span>Model</span>
      </div>
      <ul className="record-list">
        {state.data.results.map(record => {
          const open = expanded === record.id;
          return <li key={record.id}>
              <button type="button" className={`table-grid history-grid table-row row-link history-row${open ? " is-open" : ""}`}
                aria-expanded={open} aria-controls={`prediction-${record.id}`}
                onClick={() => setExpanded(open ? null : record.id)}>
                <span className="mono history-when"><time dateTime={record.created_at}>{utcDateTime(record.created_at)}</time></span>
                <span><KindTag kind={record.kind as Kind} /></span>
                <span className="cell-ellipsis" title={record.result_detail ?? undefined}>{record.result_detail ?? record.result_summary ?? record.summary}</span>
                <span className={`cell-ellipsis${record.scenario_name ? "" : " cell-muted"}`}>{record.scenario_name ?? "Not named"}</span>
                <span className="mono cell-model cell-ellipsis" title={record.model_label ?? record.model_version_id}>
                  {record.model_label ?? record.model_version_id.slice(0, 8)}</span>
              </button>
              {open && <div id={`prediction-${record.id}`} className="history-detail-shell"><HistoryDetail id={record.id} /></div>}
          </li>;
        })}
      </ul>
      <Pagination page={page} data={state.data} onChange={changePage} />
    </div> : hasFilters ? <EmptyState title="No analyses match these filters.">
      <p>Change or reset the filters to see other records.</p>
    </EmptyState> : <EmptyState title="No analyses in the last 30 days.">
      <p>Older records are kept. Show all time, or run an analysis — it appears here automatically.</p>
      <Button variant="quiet" size="sm" onClick={() => update({ period: "all" })}>Show all time</Button>
      <Link className="link-action" to="/workspace/material">Start a material analysis →</Link>
    </EmptyState>)}

    <p className="records-footnote">History is private to your account. Deleting a scenario never deletes the recorded analysis behind it.</p>
  </section>;
}
