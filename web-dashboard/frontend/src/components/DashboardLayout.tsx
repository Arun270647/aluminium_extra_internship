import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useSession } from "../features/auth/SessionProvider";
import { DraftProvider } from "../features/workspace/DraftProvider";
import { asApiError } from "../services/api";
import { ThemeToggle } from "../features/theme/theme";
import { Icon, ProductBrand, type IconName } from "./UI";

type NavigationItem = { to: string; label: string; icon: IconName; end?: boolean };

const overviewItems: NavigationItem[] = [
  { to: "/workspace", label: "Home", icon: "home", end: true },
];

const analysisItems: NavigationItem[] = [
  { to: "/workspace/material", label: "Material analysis", icon: "material" },
  { to: "/workspace/digestion", label: "Digestion", icon: "vessel" },
  { to: "/workspace/recovery", label: "Metal recovery", icon: "recovery" },
];

const recordItems: NavigationItem[] = [
  { to: "/scenarios", label: "Scenarios", icon: "scenarios", end: true },
  { to: "/history", label: "Analysis history", icon: "history" },
];

const adminItems: NavigationItem[] = [
  { to: "/admin", label: "Account review", icon: "users", end: true },
];

function NavigationGroup({ label, items }: { label: string; items: NavigationItem[] }) {
  return (
    <div className="sidebar-group">
      <p className="sidebar-group__label">{label}</p>
      {items.map(item => (
        <NavLink
          key={item.to}
          className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
          end={item.end}
          to={item.to}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

export function DashboardLayout() {
  const { user, signOut, expiresAt } = useSession();
  const sessionEnds = expiresAt ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(expiresAt)) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  useEffect(() => {
    setNavigationOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navigationOpen) return;
    const mobile = window.matchMedia("(max-width: 760px)");
    const closeNavigation = () => {
      setNavigationOpen(false);
      menuButton.current?.focus();
    };
    const focusable = () => Array.from(
      sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []
    );
    const focusFirst = () => {
      if (!mobile.matches) return;
      const firstLink = sidebar.current?.querySelector<HTMLElement>(".sidebar-link");
      (firstLink ?? focusable()[0])?.focus();
    };
    focusFirst();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNavigation();
        return;
      }
      if (!mobile.matches || event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (!mobile.matches) setNavigationOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    mobile.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mobile.removeEventListener("change", onResize);
    };
  }, [navigationOpen]);

  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try { await signOut(); navigate("/login", { replace: true }); }
    catch (err) { setError(asApiError(err).message); }
    finally { setBusy(false); }
  }
  const initials = `${user?.first_name?.slice(0, 1) ?? ""}${user?.last_name?.slice(0, 1) ?? ""}`;
  return <DraftProvider key={user!.id}>
    <div className="app-layout">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside ref={sidebar} className={`app-sidebar${navigationOpen ? " menu-open" : ""}`} aria-label="Workspace">
        <div className="sidebar-header">
          <ProductBrand app to={user?.role === "admin" ? "/admin" : "/workspace"} />
          <button
            ref={menuButton}
            className="mobile-menu-button"
            type="button"
            aria-label={navigationOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationOpen(open => !open)}
          >
            <Icon name={navigationOpen ? "close" : "menu"} />
            <span>{navigationOpen ? "Close" : "Menu"}</span>
          </button>
        </div>
        <div className="sidebar-drawer">
          <nav id="workspace-navigation" className="sidebar-navigation" aria-label="Main navigation">
            {user?.role === "user" && <>
              <NavigationGroup label="Overview" items={overviewItems} />
              <NavigationGroup label="Analysis" items={analysisItems} />
              <NavigationGroup label="Saved work" items={recordItems} />
            </>}
            {user?.role === "admin" && <NavigationGroup label="Administration" items={adminItems} />}
          </nav>
          <div className="sidebar-footer">
            <div className="sidebar-appearance">
              <span>Appearance</span>
              <ThemeToggle />
            </div>
            <div className="sidebar-user">
              <span className="sidebar-user__initials" aria-hidden="true">{initials}</span>
              <span className="sidebar-user__copy">
                <span className="sidebar-user__name">{user?.first_name} {user?.last_name}</span>
                <span className="sidebar-user__meta">{user?.role === "admin" ? "Administrator" : "Analyst"} · {sessionEnds ? `session ends ${sessionEnds}` : user?.organization}</span>
              </span>
            </div>
            {error && <p className="notice notice--bad notice--sm" role="alert">{error}</p>}
            <button className="btn btn--quiet btn--sm sidebar-signout" type="button" disabled={busy} onClick={() => void logout()}>
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </aside>
      {navigationOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation menu"
          tabIndex={-1}
          onClick={() => {
            setNavigationOpen(false);
            menuButton.current?.focus();
          }}
        />
      )}
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  </DraftProvider>;
}

