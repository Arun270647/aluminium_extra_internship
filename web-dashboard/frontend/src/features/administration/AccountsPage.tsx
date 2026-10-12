import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { utcDateTime, utcShortDate } from "../../services/research";
import { useSearchParams } from "react-router";
import { ConfirmDialog } from "../../components/ResearchControls";
import { Button, Input, Notice, PageHeader, Pagination, StatusChip, type ChipTone } from "../../components/primitives/Controls";
import { api, asApiError, type Account } from "../../services/api";
import "../../styles/admin.css";

type Page = { count: number; next: string | null; previous: string | null; results: Account[] };
type Counts = Record<AccountStatus, number>;
type Action = "approve" | "reject" | "suspend" | "reactivate";
type AccountStatus = Account["status"];

const statuses: { value: AccountStatus; label: string; tone: ChipTone }[] = [
  { value: "pending", label: "Pending review", tone: "warn" },
  { value: "approved", label: "Approved", tone: "ok" },
  { value: "suspended", label: "Suspended", tone: "bad" },
  { value: "rejected", label: "Rejected", tone: "muted" },
];
const validStatuses = new Set(statuses.map((status) => status.value));

function positivePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function accountName(account: Account) {
  return `${account.first_name} ${account.last_name}`.trim() || account.email;
}

function initials(account: Account) {
  return `${account.first_name.charAt(0)}${account.last_name.charAt(0)}`.toUpperCase() || account.email.charAt(0).toUpperCase();
}

function statusInfo(status: AccountStatus) {
  return statuses.find((item) => item.value === status) ?? { value: status, label: status, tone: "muted" as ChipTone };
}

function actionCopy(action: Action) {
  if (action === "approve") {
    return {
      title: "Approve this account?",
      detail: "This person will be able to sign in and use the analysis workspace.",
      button: "Approve access",
    };
  }
  if (action === "reject") {
    return {
      title: "Reject this request?",
      detail: "Rejected requests cannot be reopened from this screen.",
      button: "Reject request",
    };
  }
  if (action === "suspend") {
    return {
      title: "Suspend this account?",
      detail: "The account will lose access on its next request and must sign in again after reactivation.",
      button: "Suspend access",
    };
  }
  return {
    title: "Reactivate this account?",
    detail: "The person may sign in again. Previously issued sessions remain invalid.",
    button: "Reactivate access",
  };
}

function statusGuidance(status: AccountStatus) {
  if (status === "pending") return `${actionCopy("approve").detail} ${actionCopy("reject").detail}`;
  if (status === "approved") return actionCopy("suspend").detail;
  if (status === "suspended") return actionCopy("reactivate").detail;
  return "Rejected requests are terminal here. Reconsideration requires an operator procedure.";
}

function reasonLabel(status: AccountStatus) {
  if (status === "pending") return "Reason (required to reject, kept in audit log)";
  if (status === "approved") return "Reason (required to suspend, kept in audit log)";
  return "Reason (optional, kept in audit log)";
}

export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedStatus = validStatuses.has(searchParams.get("status") as AccountStatus)
    ? searchParams.get("status") as AccountStatus
    : "pending";
  const appliedSearch = searchParams.get("search") ?? "";
  const page = positivePage(searchParams.get("page"));

  const [search, setSearch] = useState(appliedSearch);
  const [data, setData] = useState<Page | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);
  const detail = useRef<HTMLElement>(null);
  const reasonInput = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setSearch(appliedSearch);
  }, [appliedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ status: appliedStatus, page: String(page) });
    if (appliedSearch) query.set("search", appliedSearch);

    setLoading(true);
    setData(null);
    setSelected(null);
    setAction(null);
    setReason("");
    setReasonError("");
    setError("");
    void api<Page>(`/admin/users/?${query.toString()}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(asApiError(caught).message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [appliedSearch, appliedStatus, page, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (appliedSearch) query.set("search", appliedSearch);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    setCounts(null);
    void api<{ counts: Counts }>(`/admin/users/counts/${suffix}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setCounts(result.counts); })
      .catch(() => { if (!controller.signal.aborted) setCounts(null); });
    return () => controller.abort();
  }, [appliedSearch, refresh]);

  useEffect(() => {
    if (selected) detail.current?.focus();
  }, [selected]);

  function clearFeedback() {
    setError("");
    setMessage("");
    setConflict("");
  }

  function selectStatus(value: AccountStatus) {
    clearFeedback();
    const next = new URLSearchParams();
    if (value !== "pending") next.set("status", value);
    if (appliedSearch) next.set("search", appliedSearch);
    setSearchParams(next);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = statuses.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowRight") target = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") target = index === 0 ? last : index - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    if (target === null) return;
    event.preventDefault();
    tabRefs.current[target]?.focus();
    selectStatus(statuses[target].value);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    const next = new URLSearchParams();
    if (appliedStatus !== "pending") next.set("status", appliedStatus);
    if (search.trim()) next.set("search", search.trim());
    setSearchParams(next);
  }

  function changePage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) next.set("page", String(nextPage));
    else next.delete("page");
    setSearchParams(next);
  }

  function requestAction(next: Action) {
    clearFeedback();
    if ((next === "reject" || next === "suspend") && !reason.trim()) {
      setReasonError("Enter a reason for this decision.");
      reasonInput.current?.focus();
      return;
    }
    setReasonError("");
    setAction(next);
  }

  async function confirmAction() {
    if (!selected || !action || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    clearFeedback();
    try {
      const body = action === "approve" || (action === "reactivate" && !reason.trim())
        ? {}
        : { reason: reason.trim() };
      await api<Account>(`/admin/users/${selected.id}/${action}/`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const result = action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : action === "suspend"
            ? "suspended"
            : "reactivated";
      setMessage(`${accountName(selected)} was ${result}.`);
      setReason("");
      setAction(null);
      setRefresh((value) => value + 1);
    } catch (caught) {
      const issue = asApiError(caught);
      if (issue.fields.reason?.length) setReasonError(issue.fields.reason.join(" "));
      else setError(issue.message);
      setAction(null);
      if (issue.code === "invalid_transition") {
        // keep the conflict message visible; user has to reselect the account
        setError("");
        setConflict(issue.message);
        setSelected(null);
        setRefresh((value) => value + 1);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const actionDetails = action ? actionCopy(action) : null;
  const current = statusInfo(appliedStatus);

  return (
    <section className="screen screen--wide admin-screen">
      <PageHeader
        eyebrow="Administration"
        title="Account review"
        lede="Approve or reject access requests. Approval is manual; no emails are sent."
      />

      <div className="admin-tabs" role="tablist" aria-label="Account status">
        {statuses.map((item, index) => {
          const active = item.value === appliedStatus;
          return (
            <button
              key={item.value}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              id={`account-tab-${item.value}`}
              aria-selected={active}
              aria-controls="account-review-panel"
              tabIndex={active ? 0 : -1}
              className={`admin-tab${active ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => selectStatus(item.value)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {item.label}{counts ? <span className="admin-tab__count"> · {counts[item.value]}</span> : null}
            </button>
          );
        })}
      </div>

      <div id="account-review-panel" role="tabpanel" aria-labelledby={`account-tab-${appliedStatus}`} className="admin-body">
        <form className="admin-search" role="search" onSubmit={applySearch}>
          <label className="field admin-search__field">
            <span>Find an account <span className="field__hint">(optional)</span></span>
            <Input
              type="search"
              maxLength={255}
              value={search}
              disabled={busy}
              placeholder="Name, email or organization"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="admin-search__actions">
            <Button type="submit" variant="quiet" disabled={busy}>Search</Button>
            {appliedSearch && (
              <Button variant="quiet" disabled={busy} onClick={() => {
                setSearch("");
                clearFeedback();
                const next = new URLSearchParams();
                if (appliedStatus !== "pending") next.set("status", appliedStatus);
                setSearchParams(next);
              }}>Clear</Button>
            )}
          </div>
        </form>

        <div aria-live="polite">
          {message && <Notice tone="ok" role="status">{message}</Notice>}
        </div>
        {conflict && (
          <Notice tone="bad" role="alert">
            <strong>{conflict}</strong> The queue has been refreshed; select the account again to review it.
          </Notice>
        )}
        {error && !conflict && <Notice tone="bad" role="alert">{error}</Notice>}

        <div className="admin-grid">
          <section className="admin-list" aria-label={`${current.label} accounts`}>
            {loading && <p className="admin-list__state" role="status">Loading accounts…</p>}
            {!loading && !data && error && (
              <div className="admin-list__state">
                <p>Accounts could not be loaded.</p>
                <Button variant="quiet" size="sm" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>
              </div>
            )}
            {!loading && data?.results.length === 0 && (
              <p className="admin-list__state">
                {appliedSearch
                  ? "No accounts match this search. Clear the search or choose another status."
                  : appliedStatus === "pending"
                    ? "No requests are waiting. New access requests will appear here for review."
                    : "No accounts have this status."}
              </p>
            )}
            {data && data.results.length > 0 && (
              <ul className="admin-list__items">
                {data.results.map((account) => {
                  const isSelected = selected?.id === account.id;
                  return (
                    <li key={account.id}>
                      <button
                        type="button"
                        className={`admin-row${isSelected ? " is-selected" : ""}`}
                        disabled={busy}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelected(account);
                          setAction(null);
                          setReason("");
                          setReasonError("");
                          clearFeedback();
                        }}
                      >
                        <span className="admin-initials" aria-hidden="true">{initials(account)}</span>
                        <span className="admin-row__copy">
                          <span className="admin-row__name">{accountName(account)}</span>
                          <span className="admin-row__meta">{account.email} · {account.organization}</span>
                        </span>
                        <span className="admin-row__date mono">{account.created_at ? utcShortDate(account.created_at) : statusInfo(account.status).label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {data && data.count > 0 && <Pagination page={page} data={data} onChange={changePage} />}
          </section>

          <aside className="admin-detail" ref={detail} tabIndex={-1} aria-label="Selected account">
            {selected ? (
              <>
                <div className="admin-detail__head">
                  <span className="eyebrow">Request</span>
                  <h2 className="admin-detail__name">{accountName(selected)}</h2>
                  <span className="admin-detail__email">{selected.email}</span>
                </div>
                <dl className="admin-detail__facts">
                  <dt>Organization</dt><dd>{selected.organization}</dd>
                  {selected.created_at && <><dt>Requested</dt><dd className="mono">{utcDateTime(selected.created_at)} UTC</dd></>}
                  {selected.role === "admin" && <><dt>Role</dt><dd>Administrator</dd></>}
                  <dt>Status</dt>
                  <dd><StatusChip tone={statusInfo(selected.status).tone}>{statusInfo(selected.status).label}</StatusChip></dd>
                </dl>
                <div className="admin-detail__actions">
                  {selected.role === "admin" ? (
                    <Notice tone="info">
                      Administrator accounts are managed by an operator. This screen cannot change their role or status.
                    </Notice>
                  ) : selected.status === "rejected" ? (
                    <p className="admin-detail__help">{statusGuidance("rejected")}</p>
                  ) : (
                    <>
                      <label className="field" htmlFor="account-reason">
                        <span>{reasonLabel(selected.status)}</span>
                        <input
                          id="account-reason"
                          ref={reasonInput}
                          className="input admin-reason"
                          maxLength={500}
                          value={reason}
                          disabled={busy}
                          placeholder="e.g. Verified with supervisor"
                          aria-invalid={reasonError ? true : undefined}
                          aria-describedby={reasonError ? "account-reason-error" : undefined}
                          onChange={(event) => { setReason(event.target.value); if (reasonError) setReasonError(""); }}
                        />
                        {reasonError && <span className="field__error" id="account-reason-error" role="alert">{reasonError}</span>}
                      </label>
                      <div className="admin-detail__buttons">
                        {selected.status === "pending" && (
                          <>
                            <Button disabled={busy} onClick={() => requestAction("approve")}>Approve access</Button>
                            <Button variant="danger" disabled={busy} onClick={() => requestAction("reject")}>Reject</Button>
                          </>
                        )}
                        {selected.status === "approved" && (
                          <Button variant="quiet" disabled={busy} onClick={() => requestAction("suspend")}>Suspend</Button>
                        )}
                        {selected.status === "suspended" && (
                          <Button disabled={busy} onClick={() => requestAction("reactivate")}>Reactivate access</Button>
                        )}
                      </div>
                      <p className="admin-detail__help">{statusGuidance(selected.status)}</p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="admin-detail__empty">
                <span className="eyebrow">Request</span>
                <h2 className="admin-detail__name">Select an account</h2>
                <p>Verify the person, organization and current status before making a decision.
                  Reject and suspend require a reason; every completed change is audited.</p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {selected && action && actionDetails && (
        <ConfirmDialog
          title={actionDetails.title}
          action={actionDetails.button}
          busy={busy}
          cancel={() => setAction(null)}
          confirm={() => void confirmAction()}
        >
          <p>{actionDetails.detail}</p>
          <p><strong>{accountName(selected)}</strong> · {selected.email}</p>
          {action !== "approve" && reason.trim() && <p>Reason: {reason.trim()}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
