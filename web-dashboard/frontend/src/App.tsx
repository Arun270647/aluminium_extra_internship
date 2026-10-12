import { useEffect } from "react";
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from "react-router";
import { AppFrame } from "./components/AppFrame";
import { AccountsPage } from "./features/administration/AccountsPage";
import { AuthPage, PendingApproval } from "./features/auth/AuthPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { SessionProvider } from "./features/auth/SessionProvider";
import { Workspace } from "./features/workspace/Workspace";
import { HomePage } from "./features/home/HomePage";
import { DashboardLayout } from "./components/DashboardLayout";
import { HistoryPage } from "./features/records/HistoryPage";
import { ComparisonPage, ScenarioDetailPage, ScenariosPage } from "./features/records/ScenariosPage";
import { PublicLayout } from "./features/landing/PublicLayout";
import { OverviewPage } from "./features/landing/OverviewPage";
import { HowItWorksPage } from "./features/landing/HowItWorksPage";
import { ScopePage } from "./features/landing/ScopePage";
import { TechnicalFlowPage } from "./features/landing/TechnicalFlowPage";
import "./styles/auth.css";
import "./styles/dashboard.css";

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    const names: Record<string, string> = { "/": "Overview", "/login": "Sign in", "/register": "Request access",
      "/how-it-works": "How it works", "/project-scope": "Project scope", "/technical-flow": "Technical flow",
      "/pending-approval": "Pending approval", "/workspace": "Home", "/workspace/material": "Material analysis", "/workspace/digestion": "Digestion",
      "/workspace/recovery": "Metal recovery", "/scenarios": "Scenarios", "/scenarios/compare": "Compare scenarios", "/history": "Analysis history",
      "/admin": "Account review" };
    const name = names[pathname] ?? (pathname.startsWith("/scenarios/") ? "Scenario details" : pathname === "/" ? null : "Page not found");
    document.title = name ? `${name} · Aluminum recovery` : "Aluminum recovery · Bauxite research tools";
    // keep focus on the tab when switching between login and register
    if ((pathname === "/login" || pathname === "/register")
      && document.activeElement?.matches('.auth-tabs [role="tab"]')) return;
    window.scrollTo(0, 0);
    const frame = window.requestAnimationFrame(() => {
      const main = document.querySelector<HTMLElement>("#main-content");
      if (!main) return;
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);
  return null;
}

export default function App() {
  return <BrowserRouter><RouteEffects /><Routes>
    <Route element={<PublicLayout />}>
      <Route index element={<OverviewPage />} />
      <Route path="/how-it-works" element={<HowItWorksPage />} />
      <Route path="/project-scope" element={<ScopePage />} />
      <Route path="/technical-flow" element={<TechnicalFlowPage />} />
    </Route>
    <Route element={<SessionProvider><Outlet /></SessionProvider>}>
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/pending-approval" element={<PendingApproval />} />
    <Route element={<ProtectedRoute />}><Route element={<DashboardLayout />}>
      <Route element={<ProtectedRoute analyst />}>
        <Route path="/workspace" element={<HomePage />} />
        <Route path="/workspace/material" element={<Workspace key="ore" kind="ore" />} />
        <Route path="/workspace/digestion" element={<Workspace key="alumina" kind="alumina" />} />
        <Route path="/workspace/recovery" element={<Workspace key="metals" kind="secondary_metals" />} />
        <Route path="/scenarios" element={<ScenariosPage />} /><Route path="/scenarios/compare" element={<ComparisonPage />} />
        <Route path="/scenarios/:id" element={<ScenarioDetailPage />} /><Route path="/history" element={<HistoryPage />} />
      </Route>
      <Route element={<ProtectedRoute admin />}>
        <Route path="/admin" element={<AccountsPage />} />
      </Route>
    </Route></Route>
    <Route path="*" element={<AppFrame><section className="message-screen">
      <p className="eyebrow eyebrow--accent">404 · Not found</p>
      <h1>This page is not part of the workspace.</h1>
      <p>Check the address, or return to the public introduction.</p>
      <Link className="btn" to="/">Return to the platform</Link>
    </section></AppFrame>} />
    </Route>
  </Routes></BrowserRouter>;
}
