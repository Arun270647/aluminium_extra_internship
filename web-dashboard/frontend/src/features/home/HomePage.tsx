import { Link } from "react-router";
import { KindTag, Notice, PageHeader, StatusChip } from "../../components/primitives/Controls";
import { useSession } from "../auth/SessionProvider";
import { kindNames, localWhen, useResource, type Kind, type Module, type Page, type RecordSummary, type Scenario } from "../../services/research";
import "../../styles/home.css";

type Tool = { kind: Kind; index: string; to: string; question: string; explainer: string; inputs: string; action: string };

const tools: Tool[] = [
  {
    kind: "ore", index: "01 · Material analysis", to: "/workspace/material",
    question: "What grade is this bauxite?",
    explainer: "You need eight oxide measurements in wt %. You get the A/S ratio, a grade by thresholds, a classifier grade and a cluster.",
    inputs: "8 × wt %", action: "Open material analysis",
  },
  {
    kind: "alumina", index: "02 · Digestion", to: "/workspace/digestion",
    question: "How much alumina will digest?",
    explainer: "You need Al₂O₃ and SiO₂, the feed condition and one experiment. You get a digestion-efficiency estimate in %.",
    inputs: "2 × wt % + experiment", action: "Open digestion",
  },
  {
    kind: "secondary_metals", index: "03 · Metal recovery", to: "/workspace/recovery",
    question: "How much Li, Ga and Sc can be extracted?",
    explainer: "You need the three concentrations in µg/g and one experiment. You get three extraction estimates — qualitative screening only.",
    inputs: "3 × µg/g + experiment", action: "Open metal recovery",
  },
];

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function ModelChip({ modules, loading, error }: { modules: Module[] | null; loading: boolean; error: string }) {
  if (loading) return <StatusChip tone="muted">Checking models…</StatusChip>;
  if (error || !modules) return <StatusChip tone="bad">Model status unavailable</StatusChip>;
  const available = modules.filter(module => module.available).length;
  if (available === modules.length) return <StatusChip tone="ok">All {modules.length === 3 ? "three" : modules.length} models available</StatusChip>;
  return <StatusChip tone="warn">{available} of {modules.length} models available</StatusChip>;
}

function ToolCard({ tool, module, modulesLoading }: { tool: Tool; module?: Module; modulesLoading: boolean }) {
  const version = module?.available ? module.model_label ?? module.model_version_id : null;
  return <article className="home-tool">
    <p className="eyebrow eyebrow--accent">{tool.index}</p>
    <h2 className="home-tool__question">{tool.question}</h2>
    <p className="home-tool__explainer">{tool.explainer}</p>
    <dl className="home-tool__facts">
      <div><dt>Inputs</dt><dd>{tool.inputs}</dd></div>
      <div><dt>Model</dt><dd className={version ? "home-tool__version" : "home-tool__unavailable"} title={version ?? undefined}>
        {modulesLoading ? "Checking…" : version ?? "Unavailable"}</dd></div>
    </dl>
    <Link className="btn home-tool__action" to={tool.to}>{tool.action} <span aria-hidden="true">→</span></Link>
  </article>;
}

export function HomePage() {
  const { user } = useSession();
  const models = useResource<Module[]>("/models/");
  const recent = useResource<Page<RecordSummary>>("/predictions/?page_size=5");
  const scenarios = useResource<Page<Scenario>>("/scenarios/?page_size=4");
  const now = new Date();
  const byKind = new Map((models.data ?? []).map(module => [module.kind, module]));

  return <section className="screen screen--home">
    <PageHeader
      eyebrow={new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(now)}
      title={`${greeting(now.getHours())}, ${user?.first_name ?? ""}.`}
      lede="Pick one of the three analyses below. Each one is independent — you only need the measurements it asks for."
      actions={<ModelChip modules={models.data} loading={models.loading} error={models.error} />}
    />

    <div className="hairline-grid home-tools">
      {tools.map(tool => <ToolCard key={tool.kind} tool={tool} module={byKind.get(tool.kind)} modulesLoading={models.loading} />)}
    </div>

    <div className="home-columns">
      <section className="home-list" aria-labelledby="home-recent">
        <div className="home-list__head">
          <h2 className="panel__title" id="home-recent">Recent analyses</h2>
          <Link className="link-action" to="/history">All history <span aria-hidden="true">→</span></Link>
        </div>
        {recent.loading && <p className="empty-box" role="status">Loading recent analyses…</p>}
        {recent.error && <div className="home-list__error"><Notice tone="bad" role="alert">{recent.error}</Notice>
          <button type="button" className="btn btn--quiet btn--sm" onClick={recent.reload}>Try again</button></div>}
        {recent.data && (recent.data.results.length === 0
          ? <p className="empty-box">No analyses yet — open a tool above.</p>
          : <ul className="home-rows">{recent.data.results.map(record => <li key={record.id}>
            <Link className="home-row home-row--recent" to="/history">
              <KindTag kind={record.kind} />
              <span className="home-row__copy">
                <span className="home-row__title">{record.result_detail ?? record.result_summary ?? record.summary}</span>
                <span className="home-row__meta">{record.scenario_name ?? "Unnamed record"}</span>
              </span>
              <time className="home-row__time mono" dateTime={record.created_at}>{localWhen(record.created_at)}</time>
            </Link>
          </li>)}</ul>)}
      </section>

      <section className="home-list" aria-labelledby="home-scenarios">
        <div className="home-list__head">
          <h2 className="panel__title" id="home-scenarios">Saved scenarios</h2>
          <Link className="link-action" to="/scenarios">All scenarios <span aria-hidden="true">→</span></Link>
        </div>
        {scenarios.loading && <p className="empty-box" role="status">Loading saved scenarios…</p>}
        {scenarios.error && <div className="home-list__error"><Notice tone="bad" role="alert">{scenarios.error}</Notice>
          <button type="button" className="btn btn--quiet btn--sm" onClick={scenarios.reload}>Try again</button></div>}
        {scenarios.data && (scenarios.data.results.length === 0
          ? <p className="empty-box">No saved scenarios yet — save a recorded analysis to name it.</p>
          : <ul className="home-rows">{scenarios.data.results.map(scenario => <li key={scenario.id}>
            <Link className="home-row" to={`/scenarios/${scenario.id}`}>
              <span className="home-row__copy">
                <span className="home-row__title">{scenario.name}</span>
                <span className="home-row__meta">{kindNames[scenario.kind]}{scenario.result_summary ? ` · ${scenario.result_summary}` : ""}</span>
              </span>
            </Link>
          </li>)}</ul>)}
        <Notice tone="warn" size="sm"><strong>Read results as laboratory estimates.</strong> Models are proof-of-concept
          and trained on small samples. A grade or percentage is not a commercial recommendation.</Notice>
      </section>
    </div>
  </section>;
}
