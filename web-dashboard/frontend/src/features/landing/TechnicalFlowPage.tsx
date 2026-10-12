import { FlowDiagram, NextPage, PageIntro, ResearchPhoto } from "./PublicVisuals";
import { FAQ, ImageStory, RequestExplorer, SystemExplorer } from "./LearningExplorers";

export function TechnicalFlowPage() {
  return (
    <>
      <PageIntro label="Technical flow" title={<>One request. <em>A traceable result.</em></>}
        visual={<ResearchPhoto name="refinery" />}>
        <p>React presents the workspace, Django checks and executes requests, and PostgreSQL stores account and research records.
          Model files stay on the server.</p>
      </PageIntro>
      <section data-reveal="" className="public-block" aria-labelledby="system-explorer-title">
        <p className="eyebrow">Explore the architecture</p>
        <h2 id="system-explorer-title">Four components. Clear responsibilities.</h2>
        <p className="public-section-lede">Select a component to see what it handles and where its responsibility ends.
          The browser never bypasses the API to reach models or records.</p>
        <SystemExplorer />
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="request-title">
        <p className="eyebrow">Inside an analysis request</p>
        <h2 id="request-title">From authenticated input to a committed prediction.</h2>
        <FlowDiagram label="Server request lifecycle" steps={[
          { title: "Authorize", text: "Check the session, approved analyst role and CSRF token before accepting a prediction request." },
          { title: "Bind a version", text: "Select an enabled model identity and validate meaningful scientific fields against its adapter contract." },
          { title: "Run and validate", text: "Build the feature vector, execute the verified artifact and check all outputs for valid shape and range." },
          { title: "Commit and return", text: "Recheck account and model status, save the immutable prediction, then return the recorded result to React." },
        ]} />
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="request-explorer-title">
        <p className="eyebrow">Success is more than a number</p>
        <h2 id="request-explorer-title">Follow a request—and its possible stopping points.</h2>
        <p className="public-section-lede">A valid request, unsupported input, a version change and an identical retry take different paths.
          Select one to see whether a new record is created.</p>
        <RequestExplorer />
      </section>
      <ImageStory photo="laboratory" label="From the bench to a durable record" title="The context travels with the result.">
        <p>A percentage without its inputs is difficult to interpret. Each committed prediction connects the measured values,
          the validated output and the exact model version at the time of analysis.</p>
        <dl className="evidence-list">
          <div><dt>Input snapshot</dt><dd>The normalized scientific fields—not a later, edited draft.</dd></div>
          <div><dt>Version identity</dt><dd>The artifact digest, adapter and output schema associated with the bound model.</dd></div>
          <div><dt>Owned record</dt><dd>The authenticated owner and server completion time, with backend-enforced access.</dd></div>
        </dl>
      </ImageStory>
      <section data-reveal="" className="public-block public-split" aria-labelledby="records-model-title">
        <div>
          <p className="eyebrow">The record relationship</p>
          <h2 id="records-model-title">A scenario names an existing prediction.</h2>
          <p>Opening History or a scenario reads stored evidence. It does not rerun inference or require
            that the historical model is still enabled.</p>
        </div>
        <div className="record-relationship" aria-label="Scenario references a prediction which references its model version">
          <div><strong>Scenario</strong><span>Name and description</span></div>
          <span aria-hidden="true">↓</span>
          <div><strong>Prediction</strong><span>Owner, input, output and timestamp</span></div>
          <span aria-hidden="true">↓</span>
          <div><strong>Model version</strong><span>Artifact, adapter and output schema identity</span></div>
        </div>
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="integrity-title">
        <p className="eyebrow">At the failure boundaries</p>
        <h2 id="integrity-title">What protects the integrity of a result.</h2>
        <div className="scope-register">
          <article><h3>Uncertain network response</h3><p>A retry with the same request key and payload returns
            the existing completed prediction. Reusing that key for different input produces a conflict.</p></article>
          <article><h3>A model changes during execution</h3><p>The server checks the bound version before saving.
            A disabled version cannot commit a new prediction; already completed results remain readable.</p></article>
          <article><h3>One recovery output fails</h3><p>Li, Ga and Sc must all pass output validation.
            The bundle is rejected if any result fails; no partial success is saved.</p></article>
        </div>
      </section>
      <section data-reveal="" className="public-block" aria-labelledby="technical-faq-title">
        <p className="eyebrow">Behind the interface</p><h2 id="technical-faq-title">What happens when conditions change?</h2>
        <FAQ items={[
          { question: "Can an old scenario be opened after a model is disabled?", answer: <p>Yes. Opening a saved scenario reads its existing prediction snapshot. It does not rerun inference or require that historical model to remain enabled.</p> },
          { question: "Does an administrator have access to the analyst workspace?", answer: <p>No. The current administrator interface is limited to the review queue and current-access management. Analyst routes and research APIs require an approved standard user.</p> },
          { question: "What prevents one account from reading another account’s records?", answer: <p>Django enforces role, approval and ownership on protected requests. Hiding a link in React is only a navigation aid; it is not the security boundary.</p> },
          { question: "Why not retry every failed request with a new key?", answer: <p>A lost response may hide an already committed prediction. Retrying the same input with its original key allows that result to be replayed without creating a duplicate. A deliberate new analysis gets a new key.</p> },
        ]} />
      </section>
      <NextPage to="/login" label="Go to dashboard">Use the workflow with your own measured inputs after administrator approval.</NextPage>
    </>
  );
}
