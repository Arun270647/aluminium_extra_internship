import { useId, type ComponentProps, type ReactNode } from "react";
import type { Kind, Page } from "../../services/research";
import { kindNames } from "../../services/research";

type ButtonVariant = "primary" | "strong" | "quiet" | "danger";

export function Button({ className = "", variant = "primary", size, block = false, type = "button", ...props }:
  ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "lg"; block?: boolean }) {
  const classes = ["btn", variant !== "primary" && `btn--${variant}`, size && `btn--${size}`, block && "btn--block", className]
    .filter(Boolean).join(" ");
  return <button data-slot="button" type={type} className={classes} {...props} />;
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={`input ${className}`} {...props} />;
}

export type ChipTone = "ok" | "warn" | "bad" | "info" | "muted";
export function StatusChip({ tone, pulse = false, children }: { tone: ChipTone; pulse?: boolean; children: ReactNode }) {
  return <span className={`chip chip--${tone}${pulse ? " chip--pulse" : ""}`}>{children}</span>;
}

export function Notice({ tone, size, children, role, id, tabIndex }: {
  tone: "warn" | "bad" | "ok" | "info"; size?: "sm" | "lg"; children: ReactNode;
  role?: "alert" | "status"; id?: string; tabIndex?: number;
}) {
  return <div id={id} role={role} tabIndex={tabIndex} className={`notice notice--${tone}${size ? ` notice--${size}` : ""}`}>{children}</div>;
}

export function KindTag({ kind }: { kind: Kind }) {
  return <span className="kind-tag">{kindNames[kind]}</span>;
}

export function Panel({ title, meta, children, footer, className = "", as: Tag = "section", labelledBy }: {
  title?: ReactNode; meta?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string;
  as?: "section" | "aside" | "div"; labelledBy?: string;
}) {
  const generated = useId();
  const titleId = labelledBy ?? generated;
  return <Tag className={`panel ${className}`} aria-labelledby={title ? titleId : undefined}>
    {title && <div className="panel__head"><h2 className="panel__title" id={titleId}>{title}</h2>{meta}</div>}
    {children}
    {footer && <div className="panel__foot">{footer}</div>}
  </Tag>;
}

export function PageHeader({ eyebrow, title, lede, actions, back }: {
  eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; actions?: ReactNode; back?: ReactNode;
}) {
  return <header className="page-head">
    <div className="page-head__copy">
      {back}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="page-head__title">{title}</h1>
      {lede && <p className="page-head__lede">{lede}</p>}
    </div>
    {actions && <div className="page-head__actions">{actions}</div>}
  </header>;
}

// value stays a raw string so blank is distinct from zero
export function MeasurementField({ id, symbol, name, unit, value, error, disabled, wide = false, onChange, describedBy }: {
  id: string; symbol: ReactNode; name: ReactNode; unit: string; value: string; error?: string;
  disabled?: boolean; wide?: boolean; onChange: (value: string) => void; describedBy?: string;
}) {
  const errorId = `${id}-error`;
  return <label className={`measure${wide ? " measure--wide" : ""}${error ? " is-invalid" : ""}${disabled ? " is-disabled" : ""}`} htmlFor={id}>
    <span className="measure__label">
      <span className="measure__symbol">{symbol}</span>
      {error ? <span className="measure__error" id={errorId}>{error}</span> : <span className="measure__name">{name}</span>}
    </span>
    <span className="measure__box">
      <input id={id} inputMode="decimal" autoComplete="off" value={value} disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined}
        onChange={event => onChange(event.target.value)} />
      <span className="measure__unit">{unit}</span>
    </span>
  </label>;
}

export function ChoiceCard({ name, value, checked, title, text, disabled, onChange }: {
  name: string; value: string; checked: boolean; title: ReactNode; text?: ReactNode; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <label className={`choice${checked ? " is-selected" : ""}`}>
    <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} />
    <span><span className="choice__title">{title}</span>{text && <span className="choice__text">{text}</span>}</span>
  </label>;
}

export function Pagination({ page, data, onChange }: { page: number; data: Page<unknown>; onChange: (page: number) => void }) {
  return <nav className="table-foot" aria-label="Pagination">
    <span>Page {page} · {data.count} {data.count === 1 ? "record" : "records"}</span>
    <span className="table-foot__actions">
      <Button variant="quiet" size="sm" disabled={!data.previous} onClick={() => onChange(page - 1)}>Previous</Button>
      <Button variant="quiet" size="sm" disabled={!data.next} onClick={() => onChange(page + 1)}>Next</Button>
    </span>
  </nav>;
}
