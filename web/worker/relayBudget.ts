// The relay's daily fee budget as a Durable Object: one instance, so every worker instance
// charges the same counter. The accounting is src/lib/relayBudget.ts; this is only the
// storage and the wire format between the worker and the object.
import { budgetDay, reserveIn, type FeeBudget } from "../src/lib/relayBudget";

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

export interface BudgetNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> };
}

export class RelayBudget {
  private readonly state: DurableObjectState;
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const { stroops, limit } = (await req.json()) as { stroops: string; limit: string };
    const ok = await reserveIn(
      { get: (k) => this.state.storage.get<string>(k), put: (k, v) => this.state.storage.put(k, v) },
      budgetDay(Date.now()),
      BigInt(stroops),
      BigInt(limit),
    );
    return Response.json({ ok });
  }
}

/** The budget the relay sees, backed by the single `relay` instance of the object. A failed
 *  call to the object counts as a refusal: an unreachable budget is no budget. */
export function durableBudget(ns: BudgetNamespace): FeeBudget {
  const stub = ns.get(ns.idFromName("relay"));
  return {
    async reserve(stroops, limit) {
      try {
        const res = await stub.fetch("https://relay-budget/reserve", {
          method: "POST",
          body: JSON.stringify({ stroops: stroops.toString(), limit: limit.toString() }),
        });
        return ((await res.json()) as { ok?: boolean }).ok === true;
      } catch (e) {
        console.error("[relay] budget unreachable:", e instanceof Error ? e.message : String(e));
        return false;
      }
    },
  };
}
