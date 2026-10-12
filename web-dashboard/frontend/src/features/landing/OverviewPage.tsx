import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PhotoCredit, photographs } from "./PublicVisuals";

// static example values for the hero card
const exampleOxides: [string, number][] = [
  ["Al₂O₃", 48.2], ["SiO₂", 3.1], ["Fe₂O₃", 18.4], ["TiO₂", 2.6],
  ["CaO", 0.42], ["MgO", 0.18], ["K₂O", 0.07], ["Na₂O", 0.11],
];
const exampleRatio = 48.2 / 3.1;

const tools = [
  { index: "01 — Material analysis", question: "What grade is this bauxite?", input: "Eight oxide measurements in wt %.",
    output: "A/S ratio, grade by thresholds, classifier grade and a cluster.", caveat: "The classifier largely reproduces the A/S threshold rule." },
  { index: "02 — Digestion", question: "How much alumina will digest?", input: "Al₂O₃, SiO₂, feed condition and one experiment.",
    output: "A digestion-efficiency estimate in %.", caveat: "Trained on 55 observations. Generalizes poorly to new conditions." },
  { index: "03 — Metal recovery", question: "How much Li, Ga and Sc can be extracted?", input: "Three concentrations in µg/g and one experiment.",
    output: "Three extraction estimates, recorded together.", caveat: "25–30 observations per element. Screening only." },
];

const steps = [
  { title: "Request access", body: "Give your name, organization and email. An administrator approves manually; then you sign in." },
  { title: "Enter what you measured", body: "Each tool asks only for its own inputs with explicit units. Totals and ratios check themselves as you type." },
  { title: "Run and read", body: "The result appears beside your inputs with the model version, validation figures and limitations." },
  { title: "Name it as a scenario", body: "A name and description on the recorded analysis. Nothing is recalculated." },
  { title: "Compare and export", body: "Put two or three compatible scenarios side by side, or export your history as CSV." },
];

const boundaries = [
  ["Not refinery control", "It does not operate equipment or set process parameters."],
  ["Not a valuation", "A “high” grade is geochemical. It says nothing about profitability."],
  ["Not self-learning", "Requests use fixed, versioned model files. Nothing is retrained from your inputs."],
  ["Not confidence", "Classifier scores are not calibrated probabilities and are shown as such."],
];

function useCountUp(target: number, duration = 1600, delay = 700) {
  const [value, setValue] = useState(() =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? target : 0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start - delay) / duration));
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, delay]);
  return value;
}

function ExampleCard() {
  const ratio = useCountUp(exampleRatio);
  return (
    <aside className="hero-card" aria-labelledby="hero-card-title">
      <div className="hero-card__head">
        <span className="eyebrow" id="hero-card-title">Material analysis · illustrative example</span>
        <span className="chip chip--info">Example</span>
      </div>
      <dl className="hero-card__oxides" aria-label="Illustrative oxide values in wt %">
        {exampleOxides.map(([symbol, value], index) => (
          <div key={symbol}>
            <dt>{symbol}</dt>
            <dd className="hero-card__bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, value / 50 * 100)}%`, animationDelay: `${0.6 + index * 0.08}s` }} />
            </dd>
            <dd className="mono">{value.toFixed(2)}</dd>
          </div>
        ))}
      </dl>
      <div className="hero-card__results">
        <div><span>Grade by A/S thresholds</span><strong className="hero-card__grade">High</strong></div>
        <div><span>Alumina / silica</span><strong className="hero-card__ratio mono" aria-label={`Ratio ${exampleRatio.toFixed(2)}`}>{ratio.toFixed(2)}</strong></div>
      </div>
      <p className="hero-card__note">Illustrative values for explanation only — not a recorded analysis or model output.
        A threshold grade is geochemical, not an economic valuation.</p>
    </aside>
  );
}

export function OverviewPage() {
  return (
    <>
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__photo" aria-hidden="true">
          <img src={`/images/${photographs.bauxite.file}`} alt="" />
        </div>
        <div className="landing-hero__shade" aria-hidden="true" />
        <div className="landing-hero__inner">
          <div className="landing-hero__copy">
            <p className="landing-hero__eyebrow rise-1">Laboratory proof of concept · 2026</p>
            <h1 id="landing-title" className="rise-2">From a bauxite assay to a <em>recorded estimate</em>.</h1>
            <p className="landing-hero__lede rise-3">Grade the material, estimate alumina digestion, screen lithium, gallium and
              scandium recovery — every result saved with its inputs and model version.</p>
            <div className="landing-hero__actions rise-4">
              <Link className="btn landing-btn" to="/register">Request access</Link>
              <a className="landing-btn landing-btn--outline" href="#tools">See how it works <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <ExampleCard />
        </div>
        <PhotoCredit name="bauxite" className="landing-hero__credit" />
      </section>

      <section className="facts-strip" aria-label="The workspace at a glance">
        <dl data-reveal="">
          <div><dt>3</dt><dd>Independent analyses — no mandatory order.</dd></div>
          <div><dt>8</dt><dd>Oxides in the material assay, each with explicit units.</dd></div>
          <div><dt>Li · Ga · Sc</dt><dd>Three trace metals, estimated together in one run.</dd></div>
          <div><dt>1</dt><dd>Immutable record per run: inputs, output, model version.</dd></div>
        </dl>
      </section>

      <section id="tools" className="landing-section landing-tools" aria-labelledby="tools-title">
        <div className="landing-tools__head" data-reveal="">
          <div className="landing-heading">
            <p className="eyebrow eyebrow--accent">Three tools</p>
            <h2 id="tools-title">Start with the question and the data you already have.</h2>
            <p className="landing-lede">You don’t need a Material result to run Digestion, and Metal recovery needs its own measured concentrations.</p>
          </div>
          <svg className="tools-flow" viewBox="0 0 560 160" aria-hidden="true">
            <line x1="60" y1="80" x2="500" y2="80" className="tools-flow__base" />
            <line x1="60" y1="80" x2="500" y2="80" className="tools-flow__dash" />
            {[[60, "wt %", "Material"], [280, "%", "Digestion"], [500, "µg/g", "Metal recovery"]].map(([x, unit, name]) => (
              <g key={name as string}>
                <circle cx={x} cy="80" r="34" className="tools-flow__node" />
                <text x={x} y="85" textAnchor="middle" className="tools-flow__unit">{unit}</text>
                <text x={x} y="140" textAnchor="middle" className="tools-flow__name">{name}</text>
              </g>
            ))}
            <text x="170" y="60" textAnchor="middle" className="tools-flow__note">optional copy</text>
            <text x="390" y="60" textAnchor="middle" className="tools-flow__note">independent</text>
          </svg>
        </div>
        <div className="hairline-grid tool-cards">
          {tools.map((tool, index) => (
            <article key={tool.index} className="tool-card" data-reveal="" style={{ transitionDelay: `${index * 0.12}s` }}>
              <span className="tool-card__index">{tool.index}</span>
              <h3>{tool.question}</h3>
              <dl>
                <div><dt>You bring</dt><dd>{tool.input}</dd></div>
                <div><dt>You get</dt><dd>{tool.output}</dd></div>
              </dl>
              <p className="tool-card__caveat">{tool.caveat}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-lab" aria-labelledby="lab-title">
        <figure className="landing-lab__photo" data-reveal="">
          <img src={`/images/${photographs.laboratory.file}`} alt={photographs.laboratory.alt} loading="lazy" />
          <span className="research-photo__tag">From laboratory to workspace</span>
          <figcaption><PhotoCredit name="laboratory" /></figcaption>
        </figure>
        <div className="landing-lab__copy" data-reveal="" style={{ transitionDelay: ".15s" }}>
          <h2 id="lab-title">Good analysis starts before you press Run.</h2>
          <p className="landing-lede">Bring measured chemistry from your assay, check the units, and choose the experimental
            conditions you actually used. A photograph gives context — it can’t replace an oxide or trace-metal measurement.</p>
          <ol className="numbered-list">
            <li><span>01</span><p><strong>Prepare the measurements.</strong> Oxides in wt %; trace metals in µg/g. Keep “absent” separate from zero.</p></li>
            <li><span>02</span><p><strong>Ask one clear question.</strong> Characterize the material, explore digestion, or estimate the three extractions.</p></li>
            <li><span>03</span><p><strong>Read the evidence.</strong> The estimate with its input snapshot, model identity and limitations.</p></li>
          </ol>
        </div>
      </section>

      <section className="landing-workflow" aria-labelledby="workflow-title">
        <div className="landing-workflow__photo" aria-hidden="true">
          <img src={`/images/${photographs.refinery.file}`} alt="" loading="lazy" />
        </div>
        <div className="landing-workflow__shade" aria-hidden="true" />
        <div className="landing-workflow__inner">
          <div className="landing-workflow__intro" data-reveal="">
            <p className="landing-hero__eyebrow">From access to comparison</p>
            <h2 id="workflow-title">Every estimate keeps its evidence.</h2>
            <p>Drafts live in your browser tab. A successful run becomes an immutable record. A scenario is just a name on
              that record — it never recalculates.</p>
          </div>
          <ol className="landing-workflow__steps">
            {steps.map((step, index) => (
              <li key={step.title} data-reveal="" style={{ transitionDelay: `${index * 0.1}s` }}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <PhotoCredit name="refinery" className="landing-workflow__credit" />
      </section>

      <section className="landing-section landing-honesty" aria-labelledby="honesty-title">
        <div className="landing-heading" data-reveal="">
          <p className="eyebrow eyebrow--accent">What this is not</p>
          <h2 id="honesty-title">Honest numbers, clearly labelled.</h2>
          <p className="landing-lede">The models were trained on small laboratory datasets. The interface shows their validation
            figures next to every result so you can judge how much weight to give them.</p>
        </div>
        <dl className="boundary-list" data-reveal="" style={{ transitionDelay: ".15s" }}>
          {boundaries.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
        </dl>
      </section>

      <section className="landing-cta" aria-labelledby="cta-title">
        <div className="landing-cta__inner" data-reveal="">
          <div>
            <h2 id="cta-title">Ready to work with your measurements?</h2>
            <p>Request an account. An administrator reviews it; then you sign in.</p>
          </div>
          <div className="landing-cta__actions">
            <Link className="landing-btn landing-btn--inverse" to="/register">Request access</Link>
            <Link className="landing-btn landing-btn--outline-light" to="/login">Sign in</Link>
          </div>
        </div>
      </section>
    </>
  );
}
