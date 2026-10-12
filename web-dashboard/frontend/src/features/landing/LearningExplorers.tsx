import { useId, useState, type ReactNode } from "react";
import { analysisGuides, glossary, type AnalysisKey } from "./learningContent";
import { ResearchPhoto } from "./PublicVisuals";

export function ChoiceGroup({ label, options, value, onChange }: {
  label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void;
}) {
  return <div className="learning-choices" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
const modelOptions = analysisGuides.map(guide => ({ value: guide.key, label: guide.name }));

function ModelSchematic({ kind }: { kind: AnalysisKey }) {
  const title = useId();
  const box = (x: number, y: number, width: number, label: string, accent = false) => <g>
    <rect x={x} y={y} width={width} height="44" className={accent ? "diagram-accent" : ""} />
    <text x={x + width / 2} y={y + 27} textAnchor="middle">{label}</text>
  </g>;
  return <svg className="model-schematic" viewBox="0 0 600 310" role="img" aria-labelledby={title}>
    <title id={title}>{kind === "material" ? "Oxide input branches into ratio calculation, Random Forest classification and scaled K-means clustering."
      : kind === "digestion" ? "Fifteen features pass through the saved scaler and Ridge model to a validated efficiency estimate."
        : "Separate lithium, gallium and scandium concentrations pass through their own scaler and Ridge pipeline before all three outputs are validated."}</title>
    {kind === "material" ? <>
      <path d="M300 60V88M100 88H500M100 88V116M300 88V116M500 88V116M100 160V196M300 160V196M500 160V196" />
      {box(205, 16, 190, "8-oxide assay", true)}
      {box(20, 116, 160, "Al₂O₃ ÷ SiO₂")}{box(220, 116, 160, "Random Forest")}{box(420, 116, 160, "Saved scaler")}
      {box(20, 196, 160, "Threshold grade")}{box(220, 196, 160, "Classifier grade")}{box(420, 196, 160, "K-means · 4 groups")}
      <text x="300" y="285" textAnchor="middle" className="diagram-caption">Three complementary outputs, not three stages of production</text>
    </> : kind === "digestion" ? <>
      <path d="M156 112H220M380 112H444M520 134V190H300V222" />
      {box(16, 90, 140, "15 features", true)}{box(220, 90, 160, "Saved scaler")}{box(444, 90, 140, "Ridge · α = 1")}
      <text x="300" y="42" textAnchor="middle" className="diagram-caption">Feed + chemistry + presence / value pairs</text>
      {box(180, 222, 240, "Validated efficiency (%)", true)}
      <text x="300" y="292" textAnchor="middle" className="diagram-caption">Scaling and weights are reused, not fitted on your request</text>
    </> : <>
      {["Li", "Ga", "Sc"].map((element, index) => <g key={element}>
        <path d={`M102 ${44 + index * 76}H180M420 ${44 + index * 76}H475V260H390`} />
        {box(22, 22 + index * 76, 80, element, true)}
        {box(180, 22 + index * 76, 240, "Own scaler → Ridge · α = 5")}
      </g>)}
      {box(170, 238, 220, "Validate all 3 percentages", true)}
      <text x="300" y="305" textAnchor="middle" className="diagram-caption">One result bundle · no partial-success record</text>
    </>}
  </svg>;
}

function MobileModelMap({ kind }: { kind: AnalysisKey }) {
  const paths = kind === "material"
    ? [
      { label: "Ratio path", nodes: ["Al₂O₃ ÷ SiO₂", "Threshold grade"] },
      { label: "Classification path", nodes: ["8-oxide row", "Random Forest", "Classifier grade"] },
      { label: "Clustering path", nodes: ["8-oxide row", "Saved scaler", "K-means · cluster 0–3"] },
    ] : kind === "digestion"
      ? [{ label: "Digestion pipeline", nodes: ["15 encoded features", "Saved StandardScaler", "Ridge · alpha 1", "Validated efficiency (%)"] }]
      : ["Li", "Ga", "Sc"].map(element => ({ label: `${element} pipeline`, nodes: [`${element}: 6 features`, "Own scaler → Ridge · alpha 5"] }));
  return <div className="mobile-model-map">
    {paths.map(path => <div key={path.label}><h4>{path.label}</h4><ol>
      {path.nodes.map((node, index) => <li key={node}>{index > 0 && <span aria-hidden="true">↓</span>}<strong>{node}</strong></li>)}
    </ol></div>)}
    {kind === "recovery" && <p className="mobile-model-result">Validate all three percentages → one result bundle.</p>}
  </div>;
}

export function ModelExplorer() {
  const [selected, setSelected] = useState("material");
  const [step, setStep] = useState(0);
  const guide = analysisGuides.find(item => item.key === selected)!;
  const stage = guide.stages[step];
  return <div className="model-explorer">
    <ChoiceGroup label="Choose a model walkthrough" options={modelOptions} value={selected}
      onChange={value => { setSelected(value); setStep(0); }} />
    <div className="model-method"><span>{guide.method}</span><span>{guide.dimension}</span></div>
    <ol className="model-stepper" aria-label="Model walkthrough steps">
      {["Your inputs", "Preparation", "The model", "Your result"].map((label, index) => <li key={label}>
        <button type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}>
          <span>{String(index + 1).padStart(2, "0")}</span>{label}
        </button>
      </li>)}
    </ol>
    <div className="model-stage" aria-live="polite" aria-atomic="true">
      <div>
        <p className="eyebrow">Step {step + 1} of 4 · {guide.name}</p>
        <h3>{stage.title}</h3><p>{stage.description}</p>
        <ul className="learning-tags">{stage.labels.map(label => <li key={label}>{label}</li>)}</ul>
        <p className="learning-caution">{stage.note}</p>
      </div>
      <figure><ModelSchematic kind={guide.key} /><MobileModelMap kind={guide.key} />
        <figcaption>Conceptual model map. No inference is run in this explainer.</figcaption></figure>
    </div>
    <div className="walkthrough-controls">
      <button type="button" className="btn btn--quiet btn--sm" disabled={step === 0} onClick={() => setStep(step - 1)}>← Previous step</button>
      <span>{step + 1} / 4</span>
      <button type="button" className="btn btn--quiet btn--sm" disabled={step === 3} onClick={() => setStep(step + 1)}>Next step →</button>
    </div>
  </div>;
}

export function RatioLab() {
  const [alumina, setAlumina] = useState(50);
  const [silica, setSilica] = useState(10);
  const ratio = alumina / silica;
  const grade = ratio >= 6 ? "High" : ratio >= 4 ? "Medium" : "Low";
  const presets = [{ label: "Low-ratio example", a: 48, s: 14 }, { label: "Medium-ratio example", a: 50, s: 10 }, { label: "High-ratio example", a: 54, s: 8 }];
  return <div className="ratio-lab">
    <div>
      <span className="learning-tag">Interactive arithmetic · not ML inference</span>
      <h3>Try the alumina-to-silica ratio.</h3>
      <p>Move either slider to see why two assays can receive different rule-based grades.
        These illustrative ranges are teaching controls, not a model’s serving limits.</p>
      <div className="ratio-presets" role="group" aria-label="Illustrative ratio examples">
        {presets.map(preset => <button type="button" key={preset.label}
          onClick={() => { setAlumina(preset.a); setSilica(preset.s); }}>{preset.label}</button>)}
      </div>
      <label className="learning-slider" htmlFor="example-alumina"><span>Alumina · Al₂O₃ <strong>{alumina} wt%</strong></span>
        <input id="example-alumina" type="range" min="20" max="70" step="1" value={alumina}
          aria-valuetext={`${alumina} weight percent`} onChange={event => setAlumina(Number(event.target.value))} /></label>
      <label className="learning-slider" htmlFor="example-silica"><span>Silica · SiO₂ <strong>{silica} wt%</strong></span>
        <input id="example-silica" type="range" min="2" max="25" step="1" value={silica}
          aria-valuetext={`${silica} weight percent`} onChange={event => setSilica(Number(event.target.value))} /></label>
    </div>
    <div className="ratio-result">
      <p className="eyebrow">Calculated locally</p>
      <output htmlFor="example-alumina example-silica" aria-live="polite">
        <span className="ratio-equation">{alumina} ÷ {silica} =</span><strong>{ratio.toFixed(2)}</strong>
        <span className="ratio-grade">{grade} · rule-based grade</span>
      </output>
      <div className="ratio-thresholds" aria-label="A/S grade thresholds">
        {[["Low", "Below 4"], ["Medium", "4 to below 6"], ["High", "6 or above"]].map(([name, range]) =>
          <div key={name} className={grade === name ? "is-current" : ""}><strong>{name}</strong><span>{range}</span></div>)}
      </div>
      <p>No classifier grade, cluster or recovery result is generated here. This example is not saved and is not an ore-value assessment.</p>
    </div>
  </div>;
}

const evidence = [
  { key: "material", title: "Material: a learned chemistry label", fact: "1,091", factLabel: "processed samples recorded in artifact metadata",
    method: "Random Forest classification + four-cluster K-means",
    finding: "Saved classifier accuracy is about 96.35%, but its labels were derived from the A/S ratio in the input chemistry.",
    means: "This measures agreement with chemistry-derived labels, not independent industrial ore quality.",
    caution: "Implausible silica values in the source data and train/test isolation need further review. Do not interpret cluster IDs as named ore classes." },
  { key: "digestion", title: "Digestion: evaluate beyond a random split", fact: "55", factLabel: "training observations recorded for the exported model",
    method: "StandardScaler + Ridge, alpha 1",
    finding: "Recorded R²: 0.436 for random five-fold evaluation, −0.162 for leave-one-block-out, and −1.614 for sample-group evaluation.",
    means: "The grouped results expose limited generalization to held-out experimental structure. A more favorable random split does not remove that limitation.",
    caution: "The alpha 10 model’s scores do not apply to the exported alpha 1 artifact. These are recorded evaluations, not newly recomputed results." },
  { key: "recovery", title: "Recovery: three targets, separate evidence", fact: "25 / 30 / 30", factLabel: "artifact training counts for Li / Ga / Sc",
    method: "Three StandardScaler + Ridge pipelines, alpha 5",
    finding: "Recorded Ridge MAE is 8.75 percentage points for Li, 5.77 for Ga and 6.76 for Sc. Their recorded R² values are 0.175, −0.035 and 0.094.",
    means: "These results indicate weak predictive performance. MAE describes average evaluation error, not a ± interval around your prediction.",
    caution: "The alternative Sc Random Forest score is not evidence for this Ridge estimator. Source-block parsing and independent evaluation remain open." },
];

export function EvidenceExplorer() {
  const [selected, setSelected] = useState("material");
  const item = evidence.find(entry => entry.key === selected)!;
  return <div className="evidence-explorer">
    <ChoiceGroup label="Review model evidence" options={modelOptions} value={selected} onChange={setSelected} />
    <div className="evidence-explorer-body" aria-live="polite">
      <div className="evidence-stat"><span className="eyebrow">Recorded training context</span><strong>{item.fact}</strong><p>{item.factLabel}</p>
        <span className="learning-tag">Historical evidence · not fresh evaluation</span></div>
      <div><h3>{item.title}</h3><p className="method-label">{item.method}</p>
        <dl className="evidence-list">
          <div><dt>What was recorded</dt><dd>{item.finding}</dd></div>
          <div><dt>How to read it</dt><dd>{item.means}</dd></div>
          <div><dt>What still needs care</dt><dd>{item.caution}</dd></div>
        </dl>
      </div>
    </div>
  </div>;
}

export function GlossaryExplorer() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const matches = glossary.filter(item => (category === "All" || item.category === category)
    && `${item.term} ${item.explanation}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="glossary-explorer">
    <label htmlFor="glossary-search">Find a term</label>
    <input className="input" id="glossary-search" type="search" value={search}
      placeholder="Try “Ridge”, “scenario” or “MAE”…" onChange={event => setSearch(event.target.value)} />
    <ChoiceGroup label="Filter glossary by topic" options={["All", "Material", "Models", "Evidence", "Records"].map(value => ({ value, label: value }))}
      value={category} onChange={setCategory} />
    <p className="glossary-count" role="status">{matches.length} {matches.length === 1 ? "term" : "terms"}</p>
    <div className="learning-glossary">{matches.map(item => <details key={item.term}>
      <summary>{item.term}<span>{item.category}</span></summary><p>{item.explanation}</p>
    </details>)}</div>
    {!matches.length && <div className="glossary-empty"><p>No matching terms. Try another word or clear the filters.</p>
      <button className="btn btn--quiet btn--sm" type="button" onClick={() => { setSearch(""); setCategory("All"); }}>Clear filters</button></div>}
  </div>;
}

const systemLayers = [
  { key: "browser", name: "React", role: "The workspace you see", mark: "UI",
    text: "The browser keeps your current draft, presents the model’s allowed fields and displays committed results. It never loads the model files or connects directly to the database.",
    owns: ["Forms and visible validation", "Navigation and in-tab drafts", "Results, history and comparisons"], boundary: "Client-side validation helps you correct inputs; Django still enforces the actual contract." },
  { key: "api", name: "Django REST API", role: "The request coordinator", mark: "API",
    text: "Django checks the session, role and CSRF token; binds an enabled model version; validates inputs and orchestrates inference and persistence.",
    owns: ["Session, approval and ownership checks", "Input adapters and output validation", "Request retries and commit checks"], boundary: "A successful estimator call is not a saved result. The database commit must succeed first." },
  { key: "models", name: "ML runtime", role: "The learned estimators", mark: "ML",
    text: "Trusted, digest-checked artifacts run on the server. Each serving worker reuses loaded models, while database enablement still controls whether new predictions may run.",
    owns: ["Saved scaler and estimator execution", "Exact artifact and adapter identity", "Per-module readiness"], boundary: "Your requests do not retrain the models. An unavailable module does not return a made-up replacement." },
  { key: "database", name: "PostgreSQL", role: "The durable record", mark: "DB",
    text: "The database stores accounts, sessions, model metadata, immutable predictions and named scenarios. An account can read only records permitted by the backend.",
    owns: ["Accounts and session records", "Input/output/version snapshots", "Scenario references and audit records"], boundary: "Reopening a recorded analysis reads its saved snapshot, even if that historical model is no longer enabled." },
];

export function SystemExplorer() {
  const [selected, setSelected] = useState("api");
  const layer = systemLayers.find(item => item.key === selected)!;
  return <div className="system-explorer">
    <div className="system-map" role="group" aria-label="Explore system components">
      {systemLayers.map((item, index) => <div className={`system-map-node system-map-${item.key}`} key={item.key}>
        {index > 0 && <span className="system-connection" aria-hidden="true">{index < 2 ? "↓" : "↳"}</span>}
        <button type="button" aria-pressed={selected === item.key} onClick={() => setSelected(item.key)}>
          <span className="system-mark" aria-hidden="true">{item.mark}</span><strong>{item.name}</strong><span>{item.role}</span>
        </button>
      </div>)}
      <p className="system-map-caption">React ⇄ Django; Django connects to both the ML runtime and PostgreSQL.</p>
    </div>
    <div className="system-detail" aria-live="polite">
      <span className="learning-tag">Select a component to explore</span>
      <h3>{layer.name}</h3><p>{layer.text}</p>
      <h4>What it handles</h4><ul className="scope-list">{layer.owns.map(task => <li key={task}>{task}</li>)}</ul>
      <p className="learning-caution">{layer.boundary}</p>
    </div>
  </div>;
}

const requestCases = [
  { key: "success", label: "Valid request", status: "201 · Recorded", saved: true, stoppedAt: 4,
    title: "The result becomes part of your History.",
    text: "Authorization, input checks, model execution and output validation succeed. The server rechecks account and version status, commits the prediction and only then returns it." },
  { key: "invalid", label: "Unsupported input", status: "422 · Unsupported input", saved: false, stoppedAt: 1,
    title: "Stop before running the estimator.",
    text: "A recognized request with unsupported mode conditions or values is rejected during domain validation. No prediction is saved. The form keeps your draft so you can correct it." },
  { key: "changed", label: "Version disabled", status: "409 · Model version changed", saved: false, stoppedAt: 3,
    title: "An unsaved output is not a successful result.",
    text: "If the bound model is disabled during execution, the final version check prevents a new commit. Refresh the available-model metadata and deliberately retry. Previously completed records are unaffected." },
  { key: "retry", label: "Identical retry", status: "200 · Existing record", saved: true, stoppedAt: 0,
    title: "Return the completed record, not a second prediction.",
    text: "After authorization, the same request key and equivalent payload can replay an already completed prediction. No fresh inference or duplicate record is needed. Changed input with the same key is a conflict." },
];

export function RequestExplorer() {
  const [selected, setSelected] = useState("success");
  const item = requestCases.find(entry => entry.key === selected)!;
  return <div className="request-explorer">
    <ChoiceGroup label="Explore a request outcome" options={requestCases.map(entry => ({ value: entry.key, label: entry.label }))}
      value={selected} onChange={setSelected} />
    <p className="example-label">Illustrated scenarios only. These controls do not call the API.</p>
    <ol className="request-track" aria-label="Illustrated request path">
      {["Authorize / replay", "Validate input", "Run / check output", "Recheck / commit", "Return record"].map((label, index) =>
        <li key={label} className={index <= item.stoppedAt ? "is-reached" : ""}>
          <span aria-hidden="true">{index < item.stoppedAt ? "✓" : index === item.stoppedAt ? "●" : "—"}</span>
          {label}<small>{index < item.stoppedAt ? "Passed" : index === item.stoppedAt ? item.key === "retry" ? "Replay returns here" : "Outcome here" : "Not reached"}</small>
        </li>)}
    </ol>
    <div className="request-outcome" aria-live="polite"><span className="learning-tag">{item.status}</span>
      <h3>{item.title}</h3><p>{item.text}</p>
      <p className="record-outcome">{item.saved ? item.key === "retry" ? "Existing prediction retained · no duplicate" : "One validated prediction recorded" : "No new prediction saved"}</p>
    </div>
  </div>;
}

export function FAQ({ items }: { items: { question: string; answer: ReactNode }[] }) {
  return <div className="learning-faq">{items.map(item => <details key={item.question}>
    <summary>{item.question}</summary><div>{item.answer}</div>
  </details>)}</div>;
}

export function ImageStory({ photo, label, title, children }: {
  photo: "bauxite" | "laboratory" | "refinery"; label: string; title: string; children: ReactNode;
}) {
  return <section data-reveal="" className="public-block image-story">
    <ResearchPhoto name={photo} /><div><p className="eyebrow">{label}</p><h2>{title}</h2>{children}</div>
  </section>;
}
