import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useSession } from "../features/auth/SessionProvider";
import { asApiError } from "../services/api";
import { Button } from "./primitives/Controls";
import { ProductBrand } from "./UI";

export function AppFrame({ children, accessPage = false }: { children: ReactNode; accessPage?: boolean }) {
  const { user, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try { await signOut(); navigate("/login", { replace: true }); }
    catch (err) { setError(asApiError(err).message); }
    finally { setBusy(false); }
  }
  return <div className="app-frame">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="app-frame__header">
      <div className="app-frame__inner">
        <ProductBrand />
        {user ? <div className="app-frame__account"><span className="app-frame__name">{user.first_name} {user.last_name}</span>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void logout()}>{busy ? "Signing out…" : "Sign out"}</Button>
        </div> : accessPage ? <Link className="app-frame__back" to="/"><span aria-hidden="true">←</span> Back to the platform</Link>
          : <nav className="app-frame__nav" aria-label="Account"><NavLink to="/login">Sign in</NavLink><NavLink to="/register">Request access</NavLink></nav>}
      </div>
    </header>
    {error && <p className="notice notice--bad app-frame__error" role="alert">{error}</p>}
    <main id="main-content" tabIndex={-1} className="app-frame__main">{children}</main>
    <footer className="app-frame__footer">
      <div className="app-frame__inner">
        <span>Aluminum recovery workflow · internship proof of concept</span>
        <Link to="/">About the platform</Link>
      </div>
    </footer>
  </div>;
}
