import { NextPage, PageIntro, ResearchPhoto } from "./PublicVisuals";
import { EvidenceExplorer, GlossaryExplorer, ImageStory } from "./LearningExplorers";

export function ScopePage() {
  return (
    <>
      <PageIntro label="Project scope" title={<>Research estimates with <em>clear boundaries.</em></>}
        visual={<ResearchPhoto name="refinery" />}>
        <p>The platform supports laboratory study and discussion. A result describes a model estimate;
          deciding how to use it requires understanding the source data, experimental conditions and validation limits.</p>
      </PageIntro>
      <section data-reveal="" className="public-block" aria-labelledby="interpretation-title">
        <p className="eyebrow">Read the target, not just the number</p>
        <h2 id="interpretation-title">What each result can tell you.</h2>
        <div className="scope-register">
          <article><h3>Material grade</h3><p>A geochemical classification with alumina-to-silica context.
            Classifier accuracy reflects learning a chemistry-based rule; it does not establish ore value or profitability.</p></article>
          <article><h3>Digestion efficiency</h3><p>An estimated percentage from a small laboratory dataset.
            Recorded validation shows limited generalization to new experimental conditions. It is not a prediction of recovered kilograms.</p></article>
          <article><h3>Metal extraction</h3><p>Experimental Li, Ga and Sc efficiency estimates with weak recorded predictive performance.
            They do not establish product purity, processing costs or commercial recovery potential.</p></article>
        </div>
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="evidence-reader-title">
        <p className="eyebrow">Look past the headline score</p>
        <h2 id="evidence-reader-title">Different models need different evidence.</h2>
        <p className="public-section-lede">Select a model to see its recorded training context and the limitations behind its results.
          These figures come from the project’s saved model cards; they were not recomputed for this website.</p>
        <EvidenceExplorer />
      </section>
      <ImageStory photo="laboratory" label="A research decision, not an automatic recommendation" title="Keep the experiment in the conversation.">
        <p>Before comparing estimates, check that the experiments ask a comparable question. Read the units,
          selected mode and model version—not just the largest percentage.</p>
        <ol className="editorial-list">
          <li><strong>Compare like with like.</strong><span>Choose two or three owned scenarios with compatible analysis types and result schemas.</span></li>
          <li><strong>Check what changed.</strong><span>A new measurement or a different model version can change how a result should be interpreted.</span></li>
          <li><strong>Keep uncertainty honest.</strong><span>Average evaluation error is not a guaranteed interval for an individual prediction.</span></li>
        </ol>
      </ImageStory>
      <section data-reveal="" className="public-block scope-columns" aria-labelledby="boundary-title">
        <div>
          <p className="eyebrow">Software boundary</p>
          <h2 id="boundary-title">A research workspace, with a defined scope.</h2>
          <ul className="scope-list">
            <li>Measured-input analysis using independently enabled models.</li>
            <li>Private prediction history and named scenarios.</li>
            <li>Compatible scenario comparison and CSV export.</li>
            <li>Manual account review and access management.</li>
          </ul>
        </div>
        <div className="boundary-panel">
          <h3>Outside the application</h3>
          <ul className="scope-list">
            <li>Operating a refinery or controlling plant equipment.</li>
            <li>Investment advice, profit estimates or automatic recovery recommendations.</li>
            <li>Guaranteed yields or confidence intervals inferred from an error metric.</li>
            <li>Uploading training data or retraining models through the interface.</li>
          </ul>
        </div>
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="glossary-title">
        <p className="eyebrow">A plain-language field guide</p>
        <h2 id="glossary-title">Make the terminology useful.</h2>
        <p className="public-section-lede">Search a term or choose a topic. Open an entry for the meaning it has in this application.</p>
        <GlossaryExplorer />
      </section>
      <section data-reveal="" className="public-block public-split" aria-labelledby="roles-title">
        <div>
          <p className="eyebrow">Two distinct roles</p>
          <h2 id="roles-title">Research access and account review stay separate.</h2>
          <p>Approval opens the analyst workspace. Administrator accounts are limited to the review queue
            and current-access management.</p>
        </div>
        <dl className="evidence-list">
          <div><dt>Analyst</dt><dd>Run analyses and manage, compare and export your own records.</dd></div>
          <div><dt>Administrator</dt><dd>Review requests and approve, reject, suspend or reactivate eligible user accounts.</dd></div>
          <div><dt>Model availability</dt><dd>An unavailable model returns no substitute estimate. Other available analyses can still be used.</dd></div>
        </dl>
      </section>
      <NextPage to="/technical-flow" label="Explore the technical flow">See how the application keeps inputs, model execution and records connected.</NextPage>
    </>
  );
}
