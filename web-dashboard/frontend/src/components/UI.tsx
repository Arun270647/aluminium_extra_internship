import type { ReactNode } from "react";
import { Link } from "react-router";

export type IconName =
  | "activity"
  | "audit"
  | "chevron"
  | "close"
  | "database"
  | "history"
  | "home"
  | "material"
  | "menu"
  | "recovery"
  | "scenarios"
  | "users"
  | "vessel";

const paths: Record<IconName, ReactNode> = {
  activity: <><path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" /></>,
  audit: <><path d="M8 3h8l1 3h3v15H4V6h3l1-3Z" /><path d="M9 12h6M9 16h4" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
  home: <><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3 4v5h5M12 7v5l3 2" /></>,
  material: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  recovery: <><path d="M8 3h8M10 3v5l-5 9a2.7 2.7 0 0 0 2.4 4h9.2a2.7 2.7 0 0 0 2.4-4l-5-9V3" /><path d="M8 15h8" /></>,
  scenarios: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /><path d="M11 7.5h5a2 2 0 0 1 2 2V13M13 16.5H8a2 2 0 0 1-2-2V11" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  vessel: <><path d="M7 3h10M9 3v5l-4 9a3 3 0 0 0 2.7 4h8.6a3 3 0 0 0 2.7-4l-4-9V3" /><path d="M7 16h10" /></>,
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function ProductBrand({ app = false, to = "/" }: { app?: boolean; to?: string }) {
  return (
    <Link className={`brand${app ? " brand--app" : ""}`} to={to} aria-label="Aluminum research workspace home">
      <span className="brand__mark" aria-hidden="true">Al</span>
      <span className="brand__text">
        <span className="brand__name">Aluminum</span>
        <span className="brand__sub">Research workspace</span>
      </span>
    </Link>
  );
}
