import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, asApiError, onAuthenticationLost, resetAccountRequests, type Account } from "../../services/api";

type Session = {
  user: Account | null; state: "loading" | "ready" | "error"; error: string;
  expiresAt: string | null;
  reload: () => Promise<void>; signedIn: (user: Account, expiresAt?: string | null) => void; signOut: () => Promise<void>;
};
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [state, setState] = useState<Session["state"]>("loading");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const revision = useRef(0);
  const clear = useCallback(() => {
    revision.current += 1; resetAccountRequests(); setUser(null); setError(""); setState("ready");
  }, []);
  const reload = useCallback(async () => {
    const current = ++revision.current;
    // don't unmount the page (and lose the draft) during a background check
    setState(previous => previous === "ready" ? "ready" : "loading"); setError("");
    try {
      const response = await api<{ user: Account; session_expires_at?: string }>("/auth/me/");
      if (revision.current !== current) return;
      setUser(response.user); setExpiresAt(response.session_expires_at ?? null); setState("ready");
    } catch (err) {
      if (revision.current !== current) return;
      const issue = asApiError(err);
      if (issue.code === "authentication_required") clear();
      else { setUser(null); setError(issue.message); setState("error"); }
    }
  }, [clear]);
  useEffect(() => {
    const unsubscribe = onAuthenticationLost(clear);
    void reload();
    return () => { revision.current += 1; unsubscribe(); };
  }, [clear, reload]);
  useEffect(() => {
    const recheck = () => { if (document.visibilityState === "visible" && user) void reload(); };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [user, reload]);
  const signedIn = (account: Account, expiry: string | null = null) => {
    setExpiresAt(expiry);
    revision.current += 1; resetAccountRequests();
    setUser(account); setError(""); setState("ready");
  };
  const signOut = async () => { await api("/auth/logout/", { method: "POST", body: "{}" }); clear(); };
  return <SessionContext.Provider value={{ user, state, error, expiresAt, reload, signedIn, signOut }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is required.");
  return session;
}
export function accountHome(user: Account) { return user.role === "admin" ? "/admin" : "/workspace"; }
