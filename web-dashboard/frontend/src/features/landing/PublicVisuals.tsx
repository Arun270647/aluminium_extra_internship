import type { ReactNode } from "react";
import { Link } from "react-router";

export const photographs = {
  bauxite: {
    file: "bauxite-core.jpg",
    alt: "Bauxite specimen with rounded mineral grains",
    caption: "Bauxite: the material behind the measurements.",
    title: "Pisolitic bauxite",
    creator: "James St. John",
    license: "CC BY 2.0",
    source: "https://commons.wikimedia.org/wiki/File:Pisolitic_bauxite_(Alcoa_Bauxite_Mine,_Arkansas,_USA)_1.jpg",
  },
  laboratory: {
    file: "lab-sample-preparation.jpg",
    alt: "Rock samples being prepared for laboratory chemical analysis",
    caption: "Sample preparation comes before entering an assay.",
    title: "Sample preparation for XRF",
    creator: "Stephane Lesbats",
    license: "CC BY 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Pr%C3%A9paration_d%27%C3%A9chantillons_pour_l%27analyse_de_la_composition_chimique_de_roches_par_fluorescence_X_(Ifremer_00702-81381_-_33934).jpg",
  },
  refinery: {
    file: "alumina-refinery.jpg",
    alt: "Open fields and trees overlooking distant rectangular ponds beneath a cloudy sky",
    caption: "Refinery-area landscape. The application does not control industrial operations.",
    title: "Pinjarra Alumina Refinery",
    creator: "Calistemon",
    license: "CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Pinjarra_Alumina_Refinery,_September_2020_02.jpg",
  },
};
export type PhotoName = keyof typeof photographs;

export function PhotoCredit({ name, className = "" }: { name: PhotoName; className?: string }) {
  const photo = photographs[name];
  return <a className={`photo-credit ${className}`} href={photo.source}>{photo.title} · {photo.creator} · {photo.license}</a>;
}

export function ResearchPhoto({ name, tag }: { name: PhotoName; tag?: string }) {
  const photo = photographs[name];
  return (
    <figure className="research-photo">
      <div className="research-photo__frame">
        <img src={`/images/${photo.file}`} alt={photo.alt} loading="lazy" />
        {tag && <span className="research-photo__tag">{tag}</span>}
      </div>
      <figcaption>
        <span>{photo.caption}</span>
        <PhotoCredit name={name} />
      </figcaption>
    </figure>
  );
}

export function PageIntro({ label, title, children, visual }: {
  label: string; title: ReactNode; children: ReactNode; visual: ReactNode;
}) {
  return (
    <section className="public-hero" aria-labelledby="public-title">
      <div className="public-hero__inner">
        <div className="public-hero__copy">
          <p className="eyebrow eyebrow--accent">{label}</p>
          <h1 id="public-title">{title}</h1>
          <div className="public-lede">{children}</div>
        </div>
        <div className="public-hero__visual">{visual}</div>
      </div>
    </section>
  );
}

export function NextPage({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <aside className="public-next" data-reveal="">
      <div className="public-next__inner">
        <p>{children}</p>
        <Link className="btn btn--lg" to={to}>{label} <span aria-hidden="true">→</span></Link>
      </div>
    </aside>
  );
}

export type FlowStep = { title: string; text: string };

export function FlowDiagram({ steps, label }: { steps: FlowStep[]; label: string }) {
  return (
    <ol className="public-flow" aria-label={label}>
      {steps.map((step, index) => (
        <li key={step.title}>
          <span className="flow-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
