import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { AppFrame } from "../../components/AppFrame";
import { Button, Input } from "../../components/primitives/Controls";
import { api, ApiError, asApiError, type Account } from "../../services/api";
import { accountHome, useSession } from "./SessionProvider";

type Values = { first_name: string; last_name: string; organization: string; email: string; password: string; password_confirm: string };
const emptyValues: Values = { first_name: "", last_name: "", organization: "", email: "", password: "", password_confirm: "" };
const fieldLabels: Record<keyof Values, string> = {
  first_name: "First name", last_name: "Last name", organization: "Organization",
  email: "Email address", password: "Password", password_confirm: "Confirm password",
};
type AuthMode = "login" | "register";
const accessTabs: { mode: AuthMode; label: string }[] = [
  { mode: "login", label: "Sign in" },
  { mode: "register", label: "Request access" },
];

export function AuthPage({ mode }: { mode: AuthMode }) {
  const session = useSession();
  const navigate = useNavigate();
  const tabs = useRef<HTMLDivElement>(null);
  if (session.state === "ready" && session.user) return <Navigate to={accountHome(session.user)} replace />;
  return <AppFrame accessPage><div className="auth-layout">
    <section className="auth-introduction" aria-labelledby="auth-heading">
      <p className="eyebrow eyebrow--accent">Dashboard access</p>
      <h1 id="auth-heading">Your research.<br /> <em>One workspace.</em></h1>
      <p className="auth-lede">Sign in to your dashboard, or request an account to start working with your measurements,
        recorded analyses and saved scenarios.</p>
      <ol className="access-steps">
        <li><span>01</span><p>Request an account with your details.</p></li>
        <li><span>02</span><p>An administrator reviews your request.</p></li>
        <li><span>03</span><p>Sign in to your dashboard after approval.</p></li>
      </ol>
      <p className="notice notice--warn access-note">Approval is manual. The platform does not send approval or verification emails.</p>
    </section>
    <section className="auth-panel" aria-label="Dashboard access">
      <div ref={tabs} className="auth-tabs" role="tablist" aria-label="Account access">
        {accessTabs.map((tab, index) => <button key={tab.mode} id={`auth-tab-${tab.mode}`} type="button"
          role="tab" aria-selected={mode === tab.mode} aria-controls={`auth-panel-${tab.mode}`}
          tabIndex={mode === tab.mode ? 0 : -1} onClick={() => { if (mode !== tab.mode) navigate(`/${tab.mode}`); }}
          onKeyDown={event => {
            let next: number;
            if (event.key === "ArrowRight") next = (index + 1) % accessTabs.length;
            else if (event.key === "ArrowLeft") next = (index + accessTabs.length - 1) % accessTabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = accessTabs.length - 1;
            else return;
            event.preventDefault();
            tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            if (mode !== accessTabs[next].mode) navigate(`/${accessTabs[next].mode}`);
          }}>{tab.label}</button>)}
      </div>
      {accessTabs.map(tab => <div key={tab.mode} role="tabpanel" id={`auth-panel-${tab.mode}`}
        aria-labelledby={`auth-tab-${tab.mode}`} hidden={mode !== tab.mode}>
        {mode === tab.mode && <AuthForm key={mode} mode={mode} />}
      </div>)}
    </section>
  </div></AppFrame>;
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const registration = mode === "register";
  const session = useSession();
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>(emptyValues);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<ApiError | null>(null);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (issue) {
      const first = Object.keys(issue.fields)[0];
      const control = first && form.current?.elements.namedItem(first);
      if (control instanceof HTMLInputElement) control.focus();
      else notice.current?.focus();
    }
  }, [issue]);
  const field = (name: keyof Values, label: string, type = "text", autoComplete: string = name, hint?: string) => {
    const errors = issue?.fields[name];
    return <div className={`auth-field${errors ? " is-invalid" : ""}`}><label htmlFor={name}>{label}</label>
      <div className={name === "password" ? "password-control" : "auth-control"}>
        <Input id={name} name={name} type={type} value={values[name]} required autoComplete={autoComplete}
          maxLength={name.includes("password") ? 128 : name === "organization" ? 255 : name === "email" ? 254 : 100}
          minLength={registration && name === "password" ? 12 : undefined} aria-invalid={Boolean(errors)}
          aria-describedby={[hint ? `${name}-hint` : "", errors ? `${name}-error` : ""].filter(Boolean).join(" ") || undefined}
          onChange={event => setValues(previous => ({ ...previous, [name]: event.target.value }))} />
        {name === "password" && <button className="password-toggle" type="button"
          aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
          onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button>}
      </div>
      {hint && <p className="field-hint" id={`${name}-hint`}>{hint}</p>}
      {errors && <p className="field-error" id={`${name}-error`}>{errors.join(" ")}</p>}
    </div>;
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setIssue(null);
    const fields: Record<string, string[]> = {};
    const required: (keyof Values)[] = registration
      ? ["first_name", "last_name", "organization", "email", "password", "password_confirm"] : ["email", "password"];
    required.forEach(key => {
      if (!(key.includes("password") ? values[key] : values[key].trim())) fields[key] = ["This field is required."];
    });
    const email = form.current?.elements.namedItem("email") as HTMLInputElement | null;
    if (email?.validity.typeMismatch) fields.email = ["Enter a valid email address."];
    if (registration && values.password.length < 12) fields.password = ["Use at least 12 characters."];
    if (registration && values.password !== values.password_confirm) fields.password_confirm = ["Passwords do not match."];
    if (Object.keys(fields).length) { setIssue(new ApiError("validation_error", "Check the highlighted fields.", fields)); return; }
    submitting.current = true; setBusy(true); request.current = new AbortController();
    try {
      if (registration) {
        await api("/auth/register/", { method: "POST", body: JSON.stringify(values), signal: request.current.signal });
        setValues(emptyValues); navigate("/pending-approval", { replace: true });
      } else {
        const result = await api<{ user: Account; session_expires_at?: string }>("/auth/login/", { method: "POST",
          body: JSON.stringify({ email: values.email, password: values.password }), signal: request.current.signal });
        setValues(emptyValues); session.signedIn(result.user, result.session_expires_at ?? null); navigate(accountHome(result.user), { replace: true });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setIssue(asApiError(err));
    } finally { submitting.current = false; setBusy(false); }
  }
  return <>
      <form ref={form} className="auth-form" noValidate aria-busy={busy} onSubmit={event => void submit(event)}
        aria-label={registration ? "Request access" : "Sign in"}>
        {issue && <div ref={notice} tabIndex={-1} className="notice notice--bad auth-error" role="alert"><p><strong>{issue.message}</strong></p>
          {Object.keys(issue.fields).some(key => key in fieldLabels) && <ul className="auth-error-links">
            {Object.keys(issue.fields).filter(key => key in fieldLabels).map(key => <li key={key}>
              <a href={`#${key}`} onClick={event => {
                event.preventDefault();
                const control = form.current?.elements.namedItem(key);
                if (control instanceof HTMLInputElement) control.focus();
              }}>{fieldLabels[key as keyof Values]}</a>
            </li>)}
          </ul>}
          {issue.requestId && issue.code === "internal_error" && <small>Reference: {issue.requestId}</small>}</div>}
        <fieldset disabled={busy} className="auth-fields"><legend className="sr-only">{registration ? "Registration details" : "Sign-in details"}</legend>
          {registration && <div className="name-fields">{field("first_name", "First name", "text", "given-name")}
            {field("last_name", "Last name", "text", "family-name")}</div>}
          {registration && field("organization", "Organization", "text", "organization")}
          {field("email", "Email address", "email", "username")}
          {field("password", "Password", showPassword ? "text" : "password", registration ? "new-password" : "current-password",
            registration ? "At least 12 characters." : undefined)}
          {registration && field("password_confirm", "Confirm password", showPassword ? "text" : "password", "new-password")}
          <Button type="submit" size="lg" block className="auth-submit">{busy ? registration ? "Submitting request…" : "Signing in…"
            : registration ? "Request access" : "Sign in"}</Button>
        </fieldset>
        <p className="sr-only" role="status">{busy ? registration ? "Submitting your access request." : "Signing in." : ""}</p>
        <p className="form-footnote">{registration ? "This creates a pending account, not a signed-in session."
          : "Sessions expire eight hours after sign-in. Pending accounts cannot sign in yet."}</p>
        {!registration && <p className="form-footnote">Forgot your password? Contact your administrator for help resetting it.</p>}
      </form>
  </>;
}
export function PendingApproval() {
  const session = useSession();
  if (session.state === "ready" && session.user) return <Navigate to={accountHome(session.user)} replace />;
  return <AppFrame accessPage><section className="confirmation-page" aria-labelledby="pending-heading">
    <p className="eyebrow eyebrow--accent">Request received</p>
    <h1 id="pending-heading">Your account is waiting for <em>review.</em></h1>
    <p className="auth-lede">An administrator must approve the request before you can sign in to the workspace.</p>
    <ol className="access-steps" aria-label="Access process">
      <li className="is-complete"><span>01</span><p>Request submitted.</p></li>
      <li><span>02</span><p>Administrator review.</p></li>
      <li><span>03</span><p>Sign in to your dashboard after approval.</p></li>
    </ol>
    <p className="notice notice--warn">You are not signed in. The platform does not send approval emails or promise a review time. Contact your administrator for an update.</p>
    <div className="confirmation-actions"><Link className="btn btn--lg" to="/login">Go to sign in <span aria-hidden="true">→</span></Link>
      <Link className="link-action" to="/">Back to the platform</Link></div>
  </section></AppFrame>;
}
