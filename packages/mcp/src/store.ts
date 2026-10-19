// Exception requests this agent filed, so `pay` can close the one it just satisfied and
// `check_exception` can name requests without a chain scan. The chain (the agent account's
// data entries) stays the source of truth; this is a bookmark list.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ExceptionRecord {
  /** `<treasury8>.<ts36>` — the data-entry name without the `eunomia.x.` prefix */
  id: string;
  to: string;
  /** stroops, decimal string */
  amount: string;
  taskId: string;
  reasonCodes: number[];
  /** unix seconds */
  requestedAt: number;
  txHash: string;
}

export interface ExceptionStore {
  load(treasuryId: string): ExceptionRecord[];
  save(treasuryId: string, records: ExceptionRecord[]): void;
}

export function memoryExceptionStore(): ExceptionStore {
  const m = new Map<string, ExceptionRecord[]>();
  return {
    load: (id) => [...(m.get(id) ?? [])],
    save: (id, r) => void m.set(id, [...r]),
  };
}

export function fileExceptionStore(dir: string): ExceptionStore {
  const file = (id: string) => join(dir, `${id}.exceptions.json`);
  return {
    load(id) {
      try {
        if (!existsSync(file(id))) return [];
        const parsed: unknown = JSON.parse(readFileSync(file(id), "utf8"));
        return Array.isArray(parsed)
          ? (parsed as ExceptionRecord[]).filter((r) => r && typeof r.id === "string")
          : [];
      } catch {
        return [];
      }
    },
    save(id, records) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(id), JSON.stringify(records, null, 2));
    },
  };
}

/** What the agent bought through call_service — the part of "what did it spend on" the chain
 *  cannot answer: a float payment on-chain names only the address paid, never the service. */
export interface PurchaseRecord {
  /** unix seconds */
  at: number;
  /** catalog id when the call came from find_services, else null */
  service: string | null;
  url: string;
  /** stroops, decimal string */
  amount: string;
  payTo: string;
  txHash: string | null;
  /** HTTP status of the paid request */
  status: number;
}

export interface PurchaseLog {
  load(treasuryId: string): PurchaseRecord[];
  append(treasuryId: string, record: PurchaseRecord): void;
}

export function memoryPurchaseLog(): PurchaseLog {
  const m = new Map<string, PurchaseRecord[]>();
  return {
    load: (id) => [...(m.get(id) ?? [])],
    append: (id, r) => void m.set(id, [...(m.get(id) ?? []), r]),
  };
}

export function filePurchaseLog(dir: string): PurchaseLog {
  const file = (id: string) => join(dir, `${id}.purchases.json`);
  const load = (id: string): PurchaseRecord[] => {
    try {
      if (!existsSync(file(id))) return [];
      const parsed: unknown = JSON.parse(readFileSync(file(id), "utf8"));
      return Array.isArray(parsed) ? (parsed as PurchaseRecord[]) : [];
    } catch {
      return [];
    }
  };
  return {
    load,
    append(id, record) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(id), JSON.stringify([...load(id), record], null, 2));
    },
  };
}
