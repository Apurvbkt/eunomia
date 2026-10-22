// How much the relay may spend on fees in one UTC day, across every caller.
//
// The rate limiters slow one address or one wallet down; they do not bound the bill. Wallets
// and IPs are free to mint, so the only limit that holds against a determined caller is a
// total. Each transaction is charged at the most it may cost (its fee bid, resource fee
// included) before it is sent, so the day's spend can never pass the budget even if every
// transaction burns its whole bid. Soroban refunds what goes unused; the budget does not, which
// errs on the side of stopping early.
//
// The count has to be shared by every instance of the worker, so it lives in one Durable
// Object (worker/relayBudget.ts). This file is the host-neutral part: the interface the relay
// sees and the accounting, unit-tested without a runtime.

/** Charge `stroops` against today's spend; false when that would take it past `limit`. */
export interface FeeBudget {
  reserve(stroops: bigint, limit: bigint): Promise<boolean>;
}

/** The storage a budget needs: one counter per day. */
export interface BudgetStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
}

/** The UTC day a charge lands on. */
export const budgetDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/** Add `stroops` to `day` unless that passes `limit`. The read and the write must not be split
 *  by another charge, which a Durable Object's input gate guarantees for its storage calls. */
export async function reserveIn(store: BudgetStore, day: string, stroops: bigint, limit: bigint): Promise<boolean> {
  if (stroops <= 0n) return true;
  const spent = BigInt((await store.get(day)) ?? "0");
  if (spent + stroops > limit) return false;
  await store.put(day, (spent + stroops).toString());
  return true;
}
