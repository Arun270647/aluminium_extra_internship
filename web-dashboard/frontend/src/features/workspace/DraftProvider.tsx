import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Kind, Prediction } from "../../services/research";

type PendingRetry = {
  payload: string;
  id: string;
};

export type Draft = {
  name: string;
  values: Record<Kind, Record<string, string>>;
  results: Partial<Record<Kind, Prediction>>;
  pendingRetries: Partial<Record<Kind, PendingRetry>>;
};

const blankValues = (): Record<Kind, Record<string, string>> => ({
  ore: {},
  alumina: {},
  secondary_metals: {},
});

const blank = (): Draft => ({ name: "", values: blankValues(), results: {}, pendingRetries: {} });

const DraftContext = createContext<{
  draft: Draft;
  setName: (name: string) => void;
  setValue: (kind: Kind, key: string, value: string) => void;
  copyChemistry: () => void;
  reset: () => void;
  resetKind: (kind: Kind) => void;
  setResult: (kind: Kind, result: Prediction) => void;
  getPendingRetry: (kind: Kind) => PendingRetry | null;
  rememberPendingRetry: (kind: Kind, pendingRetry: PendingRetry) => void;
  clearPendingRetry: (kind: Kind) => void;
} | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(blank);
  const dirty = draft.name.trim() !== "" ||
    Object.values(draft.values).some(values => Object.values(values).some(value => value.trim() !== ""));

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const value = useMemo(() => ({
    draft,
    setName: (name: string) => setDraft(current => ({ ...current, name })),
    setValue: (kind: Kind, key: string, fieldValue: string) => setDraft(current => ({
      ...current,
      values: {
        ...current.values,
        [kind]: { ...current.values[kind], [key]: fieldValue },
      },
    })),
    copyChemistry: () => setDraft(current => ({
      ...current,
      values: {
        ...current.values,
        alumina: {
          ...current.values.alumina,
          al2o3_pct: current.values.ore.al2o3_pct ?? "",
          sio2_pct: current.values.ore.sio2_pct ?? "",
        },
      },
    })),
    reset: () => setDraft(blank()),
    resetKind: (kind: Kind) => setDraft(current => {
      const results = { ...current.results };
      const pendingRetries = { ...current.pendingRetries };
      delete results[kind];
      delete pendingRetries[kind];
      return {
        ...current,
        values: { ...current.values, [kind]: {} },
        results,
        pendingRetries,
      };
    }),
    setResult: (kind: Kind, result: Prediction) => setDraft(current => ({
      ...current,
      results: { ...current.results, [kind]: result },
    })),
    getPendingRetry: (kind: Kind) => draft.pendingRetries[kind] ?? null,
    rememberPendingRetry: (kind: Kind, pendingRetry: PendingRetry) => setDraft(current => ({
      ...current,
      pendingRetries: { ...current.pendingRetries, [kind]: pendingRetry },
    })),
    clearPendingRetry: (kind: Kind) => setDraft(current => {
      const pendingRetries = { ...current.pendingRetries };
      delete pendingRetries[kind];
      return { ...current, pendingRetries };
    }),
  }), [draft]);

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft() {
  const context = useContext(DraftContext);
  if (!context) throw new Error("DraftProvider is required.");
  return context;
}
