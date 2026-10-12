import { useEffect, useState } from "react";
import { api, asApiError } from "./api";

export type Kind = "ore" | "alumina" | "secondary_metals";
export const kindNames: Record<Kind, string> = { ore: "Material", alumina: "Digestion", secondary_metals: "Recovery" };
export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };
export type RecordSummary = { id: string; kind: Kind; created_at: string; model_version_id: string; schema_version: string;
  summary: string; result_summary?: string | null; result_detail?: string | null; scenario_name?: string | null;
  model_label?: string | null; user?: { id: string; name: string } };
export type Prediction = RecordSummary & { input_data: Record<string, unknown>; output_data: Record<string, unknown> };
export type Scenario = { id: string; name: string; description: string; kind: Kind; prediction_id: string;
  model_version_id: string; model_label?: string | null; schema_version: string; result_summary?: string | null;
  created_at: string; updated_at: string; prediction?: Prediction };
export type ComparisonRow = { key: string; label: string; unit: string; values: (string | number | boolean | null)[] };
export type Comparison = { scenarios: Scenario[]; parameter_rows: ComparisonRow[]; result_rows: ComparisonRow[]; warnings: string[] };

export type ModuleField = {
  key: string;
  label: string;
  unit?: string;
  type?: "number" | "enum";
  required?: boolean;
  min?: number;
  max?: number;
  options?: string[];
  group?: string;
};

export type ModuleMode = {
  value: string;
  label: string;
  fields: ModuleField[];
};

export type ModuleInputSchema = {
  fields?: ModuleField[];
  modes?: ModuleMode[] | null;
};

export type ModuleValidation =
  | string
  | Record<string, unknown>
  | Array<string | Record<string, unknown>>
  | null;

export type Module = {
  kind: Kind;
  available: boolean;
  limitations: string[];
  status: string;
  model_version_id: string | null;
  model_label?: string | null;
  schema_version?: string;
  input_schema: ModuleInputSchema | null;
  targets?: unknown[];
  validation?: ModuleValidation;
};

export function useResource<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string | null; data: T | null; error: string; loading: boolean }>({
    path, data: null, error: "", loading: !!path,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ path, data: null, error: "", loading: !!path });
    if (path) void api<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, data, error: "", loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ path, data: null, error: asApiError(error).message, loading: false });
    });
    return () => controller.abort();
  }, [path, version]);
  return { ...(result.path === path ? result : { data: null, error: "", loading: !!path }), reload: () => setVersion(v => v + 1) };
}

export async function downloadCSV(path: string, filename: string) {
  const blob = await api<Blob>(path, {}, "blob");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

const utcParts = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
// "4 Oct 2026, 13:41" (UTC)
export function utcDateTime(value: string) {
  const date = utcParts(value);
  if (!date) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit",
    minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date).replace(" at ", ", ");
}
// "6 Oct" (UTC)
export function utcShortDate(value: string) {
  const date = utcParts(value);
  return date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date) : "—";
}
// "Today 14:02" or "4 Oct 13:41" (local time)
export function localWhen(value: string) {
  const date = utcParts(value);
  if (!date) return "—";
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date)} ${time}`;
}
