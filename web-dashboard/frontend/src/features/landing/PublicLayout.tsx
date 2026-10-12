import { useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ProductBrand } from "../../components/UI";
import { ThemeToggle } from "../theme/theme";
import { useReveal } from "./useReveal";
import "../../styles/public.css";
import "../../styles/learning.css";

const pages = [
  { to: "/", label: "Overview", end: true },
  { to: "/how-it-works", label: "How it works" },
  { to: "/project-scope", label: "Project scope" },
  { to: "/technical-flow", label: "Technical flow" },
];

export function PublicLayout() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  useReveal(main, pathname);
  return (
    <div className="public-site">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="public-header">
        <div className="public-header__inner">
          <ProductBrand />
          <nav className="public-navigation" aria-label="Public pages">
            {pages.map(page => <NavLink key={page.to} to={page.to} end={page.end}>{page.label}</NavLink>)}
          </nav>
          <div className="public-header__actions">
            <ThemeToggle />
            <Link className="btn public-header__cta" to="/login">Go to dashboard <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} ref={main}>
        <Outlet />
      </main>
      <footer className="public-footer">
        <div className="public-footer__inner">
          <span>Aluminum recovery workflow · internship proof of concept · 2026</span>
          <nav aria-label="Footer">
            <Link to="/how-it-works">How it works</Link>
            <Link to="/project-scope">Project scope</Link>
            <Link to="/technical-flow">Technical flow</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
