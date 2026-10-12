import { FlowDiagram, NextPage, PageIntro, ResearchPhoto } from "./PublicVisuals";
import { FAQ, ImageStory, ModelExplorer, RatioLab } from "./LearningExplorers";

const steps = [
  { title: "Enter measurements", text: "Choose one analysis and enter its required measurements. Unsaved values remain a temporary draft." },
  { title: "Run the analysis", text: "The server checks the inputs and runs an enabled model. Unsupported inputs or invalid outputs are rejected." },
  { title: "Record in History", text: "A successful prediction is stored with its inputs and exact model version before it is shown to you." },
  { title: "Review the result", text: "Read the target, units and limitations together. Editing measurements marks the earlier result as out of date." },
  { title: "Name a scenario", text: "Optionally add a name and description to the recorded analysis. Naming does not run the model again." },
];

export function HowItWorksPage() {
  return (
    <>
      <PageIntro label="How it works" title={<>See what happens <em>inside the models.</em></>}
        visual={<ResearchPhoto name="laboratory" />}>
        <p>A model is only one part of an analysis. Explore how your measured inputs become features,
          how each estimator uses them, and what the final result actually means.</p>
        <p className="public-note">Choose a model below, then move through its four steps. No account is needed to explore.</p>
      </PageIntro>
      <section data-reveal="" className="public-block" aria-labelledby="model-explorer-title">
        <p className="eyebrow">The model, made visible</p>
        <h2 id="model-explorer-title">Three analyses. Three different paths.</h2>
        <p className="public-section-lede">Pick a tool and follow the path from measurements to a validated result.
          These are explanations of the saved artifacts, not a live prediction simulator.</p>
        <ModelExplorer />
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="training-title">
        <p className="eyebrow">Learning versus using</p>
        <h2 id="training-title">Training happens before your request.</h2>
        <div className="training-comparison">
          <article><span className="learning-tag">Offline · model development</span><h3>Learn from recorded observations.</h3>
            <ol className="editorial-list">
              <li><strong>Prepare source data</strong><span>Reconstruct measurements, units and experimental groups.</span></li>
              <li><strong>Fit and evaluate</strong><span>Learn the scaler and estimator; evaluate against held-out observations.</span></li>
              <li><strong>Save a version</strong><span>Retain the artifact, adapter contract, validation evidence and limitations.</span></li>
            </ol></article>
          <article><span className="learning-tag">Online · your analysis</span><h3>Apply the saved model to new inputs.</h3>
            <ol className="editorial-list">
              <li><strong>Validate your measurements</strong><span>Accept only the selected model’s supported input structure.</span></li>
              <li><strong>Reuse the learned transformation</strong><span>Run the existing scaler and estimator without fitting them again.</span></li>
              <li><strong>Validate and record</strong><span>Check the output and save the exact version with your result.</span></li>
            </ol></article>
        </div>
        <p className="learning-caution">The serving workflow is implemented. Source-data reconstruction and fresh scientific evaluation remain open;
          being able to run an artifact does not establish its accuracy for a new experiment.</p>
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="ratio-lab-title">
        <p className="eyebrow">A small, transparent example</p><h2 id="ratio-lab-title">One calculation you can inspect yourself.</h2>
        <RatioLab />
      </section>
      <ImageStory photo="bauxite" label="Why the input matters" title="The model sees measurements—not the rock itself.">
        <p>The same-looking samples can have different measured compositions. Material analysis uses eight oxide values,
          while Metal recovery needs the separate Li, Ga and Sc assay.</p>
        <p>A model can only use the factors encoded by its adapter. For example, Recovery’s roasting mode has no continuous
          roasting-time or roasting-temperature feature. Adding those controls to a diagram would imply a capability it does not have.</p>
      </ImageStory>
      <section data-reveal="" className="public-block" aria-labelledby="access-title">
        <p className="eyebrow">Before your first analysis</p>
        <h2 id="access-title">Request access, then sign in after approval.</h2>
        <ol className="access-sequence">
          <li><strong>Request an account</strong><p>Submit your identity, organization and password on the registration page.</p></li>
          <li><strong>Administrator review</strong><p>An administrator reviews the request. Registration alone does not grant access.</p></li>
          <li><strong>Sign in to your workspace</strong><p>Once approved, sign in and choose Material, Digestion or Metal recovery.</p></li>
        </ol>
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="model-faq-title">
        <p className="eyebrow">Common model questions</p><h2 id="model-faq-title">Understand the limits of the calculation.</h2>
        <FAQ items={[
          { question: "Why can the two Material grades disagree?", answer: <p>The threshold grade is a direct A/S calculation. The Random Forest predicts a grade from all eight oxides. Those are different operations, so the application reports both and explicitly flags disagreement.</p> },
          { question: "Does a cluster number mean the ore is better?", answer: <p>No. K-means returns an identifier for one of four groups in scaled chemistry space. The IDs are not ranked quality levels and do not have reviewed ore-type names.</p> },
          { question: "Why does a measured zero differ from an absent factor?", answer: <p>The Digestion adapter records presence separately from value. A measured zero lime addition is represented as present; a lime factor absent from another experimental mode is not. That distinction preserves the experimental structure.</p> },
          { question: "What happens if the model returns an impossible percentage?", answer: <p>A nonfinite or out-of-range output is rejected. The server does not clip it to 0 or 100%, and it does not save a successful prediction. Recovery requires all three element outputs to pass.</p> },
        ]} />
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="journey-title">
        <p className="eyebrow">The analysis journey</p>
        <h2 id="journey-title">Five steps, with a permanent record before review.</h2>
        <FlowDiagram steps={steps} label="Analysis workflow from draft to optional scenario" />
      </section>
      <section data-reveal="" className="public-block public-split" aria-labelledby="changes-title">
        <div>
          <p className="eyebrow">When you change your mind</p>
          <h2 id="changes-title">A new measurement means a new analysis.</h2>
          <p>Changing the form never rewrites an earlier prediction. Run it again to record a new result.
            Drafts stay in the current tab while you navigate the workspace; refreshing or signing out clears them.</p>
        </div>
        <dl className="evidence-list">
          <div><dt>Copy chemistry</dt><dd>Optionally reuse Material chemistry in Digestion after confirming the replacement.</dd></div>
          <div><dt>Rename or remove a scenario</dt><dd>Change its label or remove the scenario. The underlying prediction remains in History.</dd></div>
          <div><dt>Compare fairly</dt><dd>Select two or three scenarios of the same analysis type with compatible results and units.</dd></div>
        </dl>
      </section>
      <NextPage to="/project-scope" label="Understand the scope">Know how far the results can support your research.</NextPage>
    </>
  );
}
