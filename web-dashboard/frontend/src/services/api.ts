export type Account = {
  id: string; email: string; first_name: string; last_name: string; organization: string;
  role: "user" | "admin"; status: "pending" | "approved" | "rejected" | "suspended"; created_at?: string;
};

export class ApiError extends Error {
  constructor(public code: string, message: string, public fields: Record<string, string[]> = {}, public requestId = "") {
    super(message);
  }
}
let csrf: Promise<string> | null = null;
let accountGeneration = 0;
const expiredListeners = new Set<() => void>();
export function resetAccountRequests() { accountGeneration += 1; csrf = null; }
export function onAuthenticationLost(listener: () => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}
async function fetchJSON<T>(path: string, options: RequestInit = {}, format: "json" | "blob" = "json"): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json", ...options.headers },
    });
    if (response.status === 204) return undefined as T;
    if (response.ok && format === "blob") return await response.blob() as T;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = data?.error;
      const retry = response.headers.get("Retry-After");
      throw new ApiError(error?.code ?? "service_unavailable",
        response.status === 429 ? `Too many attempts. Try again${retry ? ` in ${retry} seconds` : " shortly"}.`
          : error?.message ?? "The service is unavailable. Please try again.",
        error?.fields, error?.request_id);
    }
    if (data === null) throw new ApiError("service_unavailable", "The service returned an unexpected response.");
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
    throw new ApiError("network_error", "Could not reach the service. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
export function refreshCSRF() {
  csrf = fetchJSON<{ csrf_token: string }>("/auth/csrf/").then(data => data.csrf_token)
    .catch(error => { csrf = null; throw error; });
  return csrf;
}
export async function api<T>(path: string, options: RequestInit = {}, format: "json" | "blob" = "json"): Promise<T> {
  const generation = accountGeneration;
  try {
    const unsafe = options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method);
    const token = unsafe ? await (csrf ?? refreshCSRF()) : null;
    if (generation !== accountGeneration) throw new DOMException("Session changed.", "AbortError");
    const result = await fetchJSON<T>(path, {
      ...options, headers: { ...(unsafe ? { "Content-Type": "application/json", "X-CSRFToken": token! } : {}), ...options.headers },
    }, format);
    if (generation !== accountGeneration) throw new DOMException("Session changed.", "AbortError");
    return result;
  } catch (error) {
    if (generation !== accountGeneration) throw new DOMException("Session changed.", "AbortError");
    if (error instanceof ApiError) {
      if (error.code === "csrf_failed") {
        csrf = null; void refreshCSRF().catch(() => {});
        error.message = "Your security token changed. Please try the action again.";
      }
      if (!path.startsWith("/auth/login") &&
          ["authentication_required", "account_pending", "account_rejected", "account_suspended"].includes(error.code)) {
        expiredListeners.forEach(listener => listener());
      }
    }
    throw error;
  }
}
export function asApiError(error: unknown) {
  return error instanceof ApiError ? error : new ApiError("unexpected_error", "Something went wrong. Please try again.");
}
