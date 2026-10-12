import { Navigate, Outlet } from "react-router";
import { AppFrame } from "../../components/AppFrame";
import { Button } from "../../components/primitives/Controls";
import { useSession } from "./SessionProvider";

export function ProtectedRoute({ admin = false, analyst = false }: { admin?: boolean; analyst?: boolean }) {
  const session = useSession();
  if (session.state === "loading") return <AppFrame><div className="message-screen" role="status"><p>Checking your session…</p></div></AppFrame>;
  if (session.state === "error") return <AppFrame><section className="message-screen">
    <h1>We couldn’t check your session.</h1><p role="alert">{session.error}</p>
    <Button variant="quiet" onClick={() => void session.reload()}>Try again</Button></section></AppFrame>;
  if (!session.user) return <Navigate to="/login" replace />;
  if (admin && session.user.role !== "admin") return <section className="message-screen">
    <p className="eyebrow">Access</p><h1>Administrator access required</h1><p>Your account does not have access to this page.</p></section>;
  if (analyst && session.user.role !== "user") return <section className="message-screen">
    <p className="eyebrow">Access</p><h1>Analyst access required</h1><p>Your account does not have access to this page.</p></section>;
  return <Outlet key={session.user.id} />;
}
