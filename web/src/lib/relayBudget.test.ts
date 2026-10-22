import { describe, expect, it } from "vitest";
import { budgetDay, reserveIn, type BudgetStore } from "./relayBudget";
import { durableBudget, RelayBudget } from "../../worker/relayBudget";

const memory = (): BudgetStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v) };
};

describe("reserveIn", () => {
  it("adds charges up to the limit and refuses the one that would pass it", async () => {
    const store = memory();
    expect(await reserveIn(store, "2026-10-22", 60n, 100n)).toBe(true);
    expect(await reserveIn(store, "2026-10-22", 40n, 100n)).toBe(true);
    expect(await reserveIn(store, "2026-10-22", 1n, 100n)).toBe(false);
    // A refused charge is not recorded.
    expect(store.data.get("2026-10-22")).toBe("100");
  });

  it("starts each UTC day from zero", async () => {
    const store = memory();
    await reserveIn(store, "2026-10-22", 100n, 100n);
    expect(await reserveIn(store, "2026-10-23", 100n, 100n)).toBe(true);
  });
});

describe("budgetDay", () => {
  it("is the UTC date, whatever the server's zone", () => {
    expect(budgetDay(Date.UTC(2026, 9, 22, 23, 59, 59))).toBe("2026-10-22");
    expect(budgetDay(Date.UTC(2026, 9, 23, 0, 0, 0))).toBe("2026-10-23");
  });
});

describe("the Durable Object and its client", () => {
  it("carry a charge across the wire and refuse past the limit", async () => {
    const data = new Map<string, unknown>();
    const object = new RelayBudget({
      storage: { get: async <T,>(k: string) => data.get(k) as T | undefined, put: async (k, v) => void data.set(k, v) },
    });
    const ns = {
      idFromName: (n: string) => n,
      get: () => ({ fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)) }),
    };
    const budget = durableBudget(ns);
    expect(await budget.reserve(70n, 100n)).toBe(true);
    expect(await budget.reserve(31n, 100n)).toBe(false);
    expect(await budget.reserve(30n, 100n)).toBe(true);
  });

  it("refuses when the object cannot be reached", async () => {
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: () => Promise.reject(new Error("down")) }) };
    expect(await durableBudget(ns).reserve(1n, 100n)).toBe(false);
  });
});
