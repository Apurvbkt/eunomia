import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"InvalidAmount"},
  2: {message:"PayeeNotWhitelisted"},
  3: {message:"ExceedsTaskLimit"},
  4: {message:"ExceedsDailyLimit"},
  5: {message:"BelowReputationThreshold"},
  6: {message:"InsufficientFreeBalance"},
  7: {message:"EscrowNotFound"},
  8: {message:"DeadlineNotReached"},
  9: {message:"Paused"},
  10: {message:"ExceedsSessionLimit"},
  11: {message:"InvalidLimits"},
  12: {message:"InvalidDeadline"},
  14: {message:"ExceedsPayeeCap"},
  15: {message:"ExceedsMonthlyLimit"},
  16: {message:"ExceedsDepositCap"},
  17: {message:"PayeeOutsideTaskBudget"}
}


export interface Config {
  /**
 * Owner of the funds; the only one who can change the policy.
 */
admin: string;
  /**
 * The root agent allowed to trigger payments when no session is active.
 */
agent: string;
  /**
 * Max total spend allowed inside any rolling 24-hour window.
 */
daily_limit: i128;
  /**
 * Max spend allowed in a SINGLE payment (a per-PAYMENT cap, checked per call).
 * `TaskSpent` accumulates spend per `task_id` for attribution only — it is NOT
 * capped against this limit, so several sub-cap payments to the same task_id are
 * allowed; the real cumulative bound is the rolling 24h `daily_limit`.
 */
per_task_limit: i128;
  /**
 * SEP-41 / SAC token the treasury holds and spends (e.g. USDC).
 */
token: string;
}


/**
 * An outcome-bound payment: `amount` is reserved (locked) in the treasury for
 * `payee` against `task_id`, releasable on approval or refundable after `deadline`
 * (UNIX seconds). The funds never leave until release — refund just unlocks them.
 */
export interface Escrow {
  amount: i128;
  deadline: u64;
  payee: string;
  task_id: u64;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Payee", values: readonly [string]} | {tag: "HourSpent", values: readonly [u64]} | {tag: "TaskSpent", values: readonly [u64]} | {tag: "RepRegistry", values: void} | {tag: "MinReputation", values: void} | {tag: "WhitelistRoot", values: void} | {tag: "EscrowEntry", values: readonly [u64]} | {tag: "NextEscrowId", values: void} | {tag: "Locked", values: void} | {tag: "Session", values: void} | {tag: "Paused", values: void} | {tag: "DepositCap", values: void} | {tag: "MonthlyLimit", values: void} | {tag: "MonthSpent", values: readonly [u32]} | {tag: "PayeeCap", values: readonly [string]} | {tag: "PayeeSpent", values: readonly [string, u32]} | {tag: "SessionPayees", values: void};


/**
 * A time-bound, spend-capped agent credential. While a session is active
 * (`now < valid_until`) it is the ONLY spender — the root agent is replaced,
 * not complemented, so authorisation stays unambiguous and auditable. When it
 * expires or is revoked, spending falls back to `Config.agent`.
 */
export interface Session {
  agent: string;
  limit: i128;
  spent: i128;
  valid_until: u64;
}

export interface Client {
  /**
   * Construct and simulate a pay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The agent asks the treasury to pay `amount` to `to` for `task_id`.
   * The contract enforces the policy and rejects any violation on-chain.
   * Only the free (unlocked) balance is spendable — funds reserved by open
   * escrows cannot be paid out directly.
   */
  pay: ({task_id, to, amount}: {task_id: u64, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a locked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total funds currently reserved by open escrows (treasury balance minus this
   * is the spendable free balance).
   */
  locked: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Fund the treasury from `from`, refusing anything that would take its balance above the
   * deposit cap. The cap is the beta's exposure bound while the code is unaudited.
   * 
   * A plain token transfer to the treasury's address does not pass through here — no
   * contract can refuse incoming SAC transfers — so the cap binds the app, the factory and
   * every client that funds through `deposit`, not a sender determined to go around it.
   */
  deposit: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a is_payee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_payee: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_payee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whitelist a payee. Admin-only.
   */
  add_payee: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a day_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Spend inside the rolling 24-hour window (the "daily" allowance).
   */
  day_spent: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a payee_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The monthly cap on `payee`, or 0 when it has none.
   */
  payee_cap: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Rotate the root agent (the fallback spender when no session is active).
   * Admin-only — the recovery path if the root agent key is lost or leaked.
   */
  set_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Config>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Escrow>>>

  /**
   * Construct and simulate a set_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the spending limits, effective immediately. Admin-only. If the new
   * daily limit is below what the window already holds, spending resumes once
   * the window drains — that is the intended behaviour.
   */
  set_limits: ({daily_limit, per_task_limit}: {daily_limit: i128, per_task_limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Freeze/unfreeze spending (pay, create_escrow, release_escrow). Admin-only.
   * Exit paths — refund_escrow, admin_withdraw, and every admin setter — keep
   * working while paused, so an incident can always be unwound.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a task_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cumulative spend recorded against `task_id` — an attribution ledger, not a cap.
   * (The per-call limit is `Config.per_task_limit`; the cumulative bound is the daily window.)
   */
  task_spent: ({task_id}: {task_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a this_month transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The current UTC calendar month as `year * 12 + (month - 1)` — the key every monthly
   * figure is stored under, so clients never re-derive the calendar themselves.
   */
  this_month: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a deposit_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Most this treasury takes in through `deposit` (0 = uncapped). Fixed at deploy.
   */
  deposit_cap: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The stored session, if any — including an expired one (callers compare
   * `valid_until` to now; the contract itself ignores expired sessions).
   */
  get_session: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Session>>>

  /**
   * Construct and simulate a month_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agent-moved value in `month` (see `this_month`), escrow commitments included.
   */
  month_spent: ({month}: {month: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a payee_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What `payee` has been paid (or had committed in escrow) in `month`.
   */
  payee_spent: ({payee, month}: {payee: string, month: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Delegate spending to a session agent. Admin-only. While the session is
   * active it is the only spender (see `Session`); setting a new session
   * overwrites the old one and resets its spent counter (rotation).
   */
  set_session: ({agent, valid_until, limit}: {agent: string, valid_until: u64, limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a period_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total agent-moved value inside the closed UTC day `period_id`
   * (`period_id = timestamp / 86400`) — the figure a compliance proof commits to.
   * 
   * Deliberately NOT `day_spent`: the rolling window answers "how much allowance is
   * left right now" and changes every hour, so a proof could never bind to it. This
   * sums the 24 fixed buckets of one calendar day, giving a value that is final once
   * the day closes and reads identically forever after.
   * 
   * "Moved" includes escrow commitments, not just settled payments — `create_escrow`
   * charges the same buckets, because locking the balance is the agent exercising its
   * budget whether or not the funds ever leave.
   * 
   * 24 persistent reads, one fewer than `rolling_spent` already performs per spend.
   */
  period_spent: ({period_id}: {period_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a remove_payee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a payee from the whitelist. Admin-only.
   */
  remove_payee: ({payee}: {payee: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agent reserves `amount` for `payee` against a future-delivered task. The funds
   * stay in the treasury (locked, not transferred) until released on approval or
   * refunded after `deadline`. Subject to the same payee gate + per-task limit +
   * session cap as a direct payment; the rolling window is charged here, at
   * commitment time (see the reasoning inline below).
   */
  create_escrow: ({task_id, payee, amount, deadline}: {task_id: u64, payee: string, amount: i128, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a monthly_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  monthly_limit: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a refund_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After the deadline, the agent reclaims an undelivered escrow — the lock is
   * released back to the treasury's free balance. No transfer, no spend recorded,
   * and the session budget is NOT restored (conservative: the cap bounds what a
   * session may commit). Deliberately works while paused (exit path).
   */
  refund_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_payee_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Most `payee` may receive per UTC calendar month. Admin-only; 0 removes the cap. The cap
   * does not approve the payee — it narrows what an approved (or reputation-gated) payee
   * can be paid. Capping the agent's own float address is what bounds money that has left
   * the treasury's protection.
   */
  set_payee_cap: ({payee, cap}: {payee: string, cap: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a admin_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Owner reclaims free (unlocked) funds with their own signature. Deliberately
   * exempt from pause, the payee gate, and the rolling window: those bound
   * *delegated* agent spending, and the exit path must work exactly when limits
   * are exhausted or spending is frozen. Escrow-locked funds stay locked (the
   * commitment to payees survives; refund is the escape hatch for those).
   */
  admin_withdraw: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a release_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin (the owner / hirer) approves delivery → release the locked funds to the
   * payee. The rolling window was already charged when the escrow was created, so
   * release does not check or charge it again; the spend is accounted per task
   * exactly like a direct `pay`.
   */
  release_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Instantly revoke the session — spending falls back to the root agent.
   * Admin-only; deliberately works while paused (incident response).
   */
  revoke_session: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a session_payees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The payees the current Leash is restricted to; empty when it may pay any approved one.
   */
  session_payees: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a whitelist_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The payee-set Merkle root this treasury publishes, or `None` if the owner never
   * declared one (in which case no compliance proof can be checked against it).
   */
  whitelist_root: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_task_budget transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A Leash for one task: like `set_session`, but the agent may only pay the payees
   * listed here (each must still pass the whitelist / reputation gate). This is what the
   * owner signs when approving an agent's budget request — once, for the whole task.
   * Admin-only.
   */
  set_task_budget: ({agent, valid_until, limit, payees}: {agent: string, valid_until: u64, limit: i128, payees: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_monthly_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Most the agent may move per UTC calendar month, across every payee. Admin-only;
   * 0 removes the monthly limit. Like the daily limit, lowering it below what the month
   * already holds simply stops spending until the month turns.
   */
  set_monthly_limit: ({limit}: {limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_whitelist_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Publish the Merkle root of the payee set that compliance proofs are checked
   * against. Admin-only: the root IS the owner's policy statement, so an agent that
   * could write it would be choosing the payee set its own proof is verified against.
   * 
   * The root is not derived from `DataKey::Payee` — the whitelist is a key-per-payee
   * map with no on-chain enumeration, and the circuit's Poseidon hash has no host
   * implementation to rebuild it with. The owner computes it off-chain and anchors it
   * here; the event makes every change auditable.
   */
  set_whitelist_root: ({root}: {root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a admin_cancel_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin unilaterally cancels an open escrow — the lock returns to the free
   * balance, nothing is paid, no deadline needed. This is the incident-response
   * path: a compromised agent could otherwise tie up the whole treasury in
   * escrows it alone can refund. Deliberately works while paused (exit path);
   * the session budget is NOT restored (consistent with refund).
   */
  admin_cancel_escrow: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_reputation_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The active reputation gate, if any: `(registry, min_reputation)`.
   */
  get_reputation_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Option<readonly [string, i128]>>>

  /**
   * Construct and simulate a set_reputation_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set (or update) the reputation gate. Admin-only. With `min_reputation > 0`,
   * a payee that is NOT on the whitelist can still be paid when its score from
   * `registry` is >= `min_reputation` — turning the static allowlist into an
   * earned-trust gate. Set `min_reputation = 0` to disable (whitelist-only).
   */
  set_reputation_policy: ({registry, min_reputation}: {registry: string, min_reputation: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, agent, token, daily_limit, per_task_limit, deposit_cap}: {admin: string, agent: string, token: string, daily_limit: i128, per_task_limit: i128, deposit_cap: i128},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, agent, token, daily_limit, per_task_limit, deposit_cap}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEAAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAEAAAAAAAAAE1BheWVlTm90V2hpdGVsaXN0ZWQAAAAAAgAAAAAAAAAQRXhjZWVkc1Rhc2tMaW1pdAAAAAMAAAAAAAAAEUV4Y2VlZHNEYWlseUxpbWl0AAAAAAAABAAAAAAAAAAYQmVsb3dSZXB1dGF0aW9uVGhyZXNob2xkAAAABQAAAAAAAAAXSW5zdWZmaWNpZW50RnJlZUJhbGFuY2UAAAAABgAAAAAAAAAORXNjcm93Tm90Rm91bmQAAAAAAAcAAAAAAAAAEkRlYWRsaW5lTm90UmVhY2hlZAAAAAAACAAAAAAAAAAGUGF1c2VkAAAAAAAJAAAAAAAAABNFeGNlZWRzU2Vzc2lvbkxpbWl0AAAAAAoAAAAAAAAADUludmFsaWRMaW1pdHMAAAAAAAALAAAAAAAAAA9JbnZhbGlkRGVhZGxpbmUAAAAADAAAAAAAAAAPRXhjZWVkc1BheWVlQ2FwAAAAAA4AAAAAAAAAE0V4Y2VlZHNNb250aGx5TGltaXQAAAAADwAAAAAAAAARRXhjZWVkc0RlcG9zaXRDYXAAAAAAAAAQAAAAAAAAABZQYXllZU91dHNpZGVUYXNrQnVkZ2V0AAAAAAAR",
        "AAAAAAAAAPVUaGUgYWdlbnQgYXNrcyB0aGUgdHJlYXN1cnkgdG8gcGF5IGBhbW91bnRgIHRvIGB0b2AgZm9yIGB0YXNrX2lkYC4KVGhlIGNvbnRyYWN0IGVuZm9yY2VzIHRoZSBwb2xpY3kgYW5kIHJlamVjdHMgYW55IHZpb2xhdGlvbiBvbi1jaGFpbi4KT25seSB0aGUgZnJlZSAodW5sb2NrZWQpIGJhbGFuY2UgaXMgc3BlbmRhYmxlIOKAlCBmdW5kcyByZXNlcnZlZCBieSBvcGVuCmVzY3Jvd3MgY2Fubm90IGJlIHBhaWQgb3V0IGRpcmVjdGx5LgAAAAAAAANwYXkAAAAAAwAAAAAAAAAHdGFza19pZAAAAAAGAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABQAAADtPd25lciBvZiB0aGUgZnVuZHM7IHRoZSBvbmx5IG9uZSB3aG8gY2FuIGNoYW5nZSB0aGUgcG9saWN5LgAAAAAFYWRtaW4AAAAAAAATAAAARVRoZSByb290IGFnZW50IGFsbG93ZWQgdG8gdHJpZ2dlciBwYXltZW50cyB3aGVuIG5vIHNlc3Npb24gaXMgYWN0aXZlLgAAAAAAAAVhZ2VudAAAAAAAABMAAAA6TWF4IHRvdGFsIHNwZW5kIGFsbG93ZWQgaW5zaWRlIGFueSByb2xsaW5nIDI0LWhvdXIgd2luZG93LgAAAAAAC2RhaWx5X2xpbWl0AAAAAAsAAAEvTWF4IHNwZW5kIGFsbG93ZWQgaW4gYSBTSU5HTEUgcGF5bWVudCAoYSBwZXItUEFZTUVOVCBjYXAsIGNoZWNrZWQgcGVyIGNhbGwpLgpgVGFza1NwZW50YCBhY2N1bXVsYXRlcyBzcGVuZCBwZXIgYHRhc2tfaWRgIGZvciBhdHRyaWJ1dGlvbiBvbmx5IOKAlCBpdCBpcyBOT1QKY2FwcGVkIGFnYWluc3QgdGhpcyBsaW1pdCwgc28gc2V2ZXJhbCBzdWItY2FwIHBheW1lbnRzIHRvIHRoZSBzYW1lIHRhc2tfaWQgYXJlCmFsbG93ZWQ7IHRoZSByZWFsIGN1bXVsYXRpdmUgYm91bmQgaXMgdGhlIHJvbGxpbmcgMjRoIGBkYWlseV9saW1pdGAuAAAAAA5wZXJfdGFza19saW1pdAAAAAAACwAAAD1TRVAtNDEgLyBTQUMgdG9rZW4gdGhlIHRyZWFzdXJ5IGhvbGRzIGFuZCBzcGVuZHMgKGUuZy4gVVNEQykuAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAQAAAO5BbiBvdXRjb21lLWJvdW5kIHBheW1lbnQ6IGBhbW91bnRgIGlzIHJlc2VydmVkIChsb2NrZWQpIGluIHRoZSB0cmVhc3VyeSBmb3IKYHBheWVlYCBhZ2FpbnN0IGB0YXNrX2lkYCwgcmVsZWFzYWJsZSBvbiBhcHByb3ZhbCBvciByZWZ1bmRhYmxlIGFmdGVyIGBkZWFkbGluZWAKKFVOSVggc2Vjb25kcykuIFRoZSBmdW5kcyBuZXZlciBsZWF2ZSB1bnRpbCByZWxlYXNlIOKAlCByZWZ1bmQganVzdCB1bmxvY2tzIHRoZW0uAAAAAAAAAAAABkVzY3JvdwAAAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAHdGFza19pZAAAAAAG",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAEgAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAQAAAAAAAAAFUGF5ZWUAAAAAAAABAAAAEwAAAAEAAADcU3BlbmQgYnVja2V0ZWQgcGVyIGhvdXIgKGB0aW1lc3RhbXAgLyAzNjAwYCkg4oCUIHRoZSByb2xsaW5nIDI0aCB3aW5kb3cgc3Vtcwp0aGUgbGFzdCAyNCBidWNrZXRzLiBPbGQgYnVja2V0cyBhcmUgc2ltcGx5IG5ldmVyIHJlYWQgYWdhaW47IHBlcnNpc3RlbnQKbWluLVRUTCBmYXIgZXhjZWVkcyAyNGgsIHNvIGFuIGluLXdpbmRvdyBidWNrZXQgY2FuIG5ldmVyIGJlIGFyY2hpdmVkLgAAAAlIb3VyU3BlbnQAAAAAAAABAAAABgAAAAEAAAAAAAAACVRhc2tTcGVudAAAAAAAAAEAAAAGAAAAAAAAAAAAAAALUmVwUmVnaXN0cnkAAAAAAAAAAAAAAAANTWluUmVwdXRhdGlvbgAAAAAAAAAAAAD8UG9zZWlkb24gTWVya2xlIHJvb3Qgb3ZlciB0aGUgcGF5ZWUgc2V0IGEgY29tcGxpYW5jZSBwcm9vZiBpcyBjaGVja2VkIGFnYWluc3QuCk93bmVyLWRlY2xhcmVkICh0aGUgd2hpdGVsaXN0IGl0c2VsZiBpcyBub3QgZW51bWVyYWJsZSBvbi1jaGFpbiksIHNvIHRoZSBwcm9vZgphc3NlcnRzIG1lbWJlcnNoaXAgaW4gKnRoaXMqIHRyZWFzdXJ5J3MgcHVibGlzaGVkIHBheWVlIHNldCByYXRoZXIgdGhhbiBvbmUgdGhlCnByb3ZlciBwaWNrZWQuAAAADVdoaXRlbGlzdFJvb3QAAAAAAAABAAAAAAAAAAtFc2Nyb3dFbnRyeQAAAAABAAAABgAAAAAAAAAAAAAADE5leHRFc2Nyb3dJZAAAAAAAAAAAAAAABkxvY2tlZAAAAAAAAAAAAAAAAAAHU2Vzc2lvbgAAAAAAAAAAAAAAAAZQYXVzZWQAAAAAAAAAAABWTW9zdCB0aGlzIHRyZWFzdXJ5IG1heSBob2xkIGFmdGVyIGEgYGRlcG9zaXRgLiBTZXQgb25jZSBpbiB0aGUgY29uc3RydWN0b3IsIG5vIHNldHRlci4AAAAAAApEZXBvc2l0Q2FwAAAAAAAAAAAAUk1vc3QgdGhlIGFnZW50IG1heSBtb3ZlIGluIG9uZSBVVEMgY2FsZW5kYXIgbW9udGggKDAgLyBhYnNlbnQgPSBubyBtb250aGx5IGxpbWl0KS4AAAAAAAxNb250aGx5TGltaXQAAAABAAAAPEFnZW50LW1vdmVkIHZhbHVlIHBlciBtb250aCwga2V5ZWQgYnkgYG1vbnRoX29mKHRpbWVzdGFtcClgLgAAAApNb250aFNwZW50AAAAAAABAAAABAAAAAEAAABTTW9zdCBvbmUgcGF5ZWUgbWF5IHJlY2VpdmUgcGVyIFVUQyBjYWxlbmRhciBtb250aCAoYWJzZW50ID0gb25seSB0aGUgb3RoZXIgbGltaXRzKS4AAAAACFBheWVlQ2FwAAAAAQAAABMAAAABAAAAAAAAAApQYXllZVNwZW50AAAAAAACAAAAEwAAAAQAAAAAAAAASlRoZSBwYXllZXMgdGhlIGN1cnJlbnQgTGVhc2ggbWF5IHBheS4gRW1wdHkgLyBhYnNlbnQgPSBhbnkgYXBwcm92ZWQgcGF5ZWUuAAAAAAANU2Vzc2lvblBheWVlcwAAAA==",
        "AAAAAQAAAR1BIHRpbWUtYm91bmQsIHNwZW5kLWNhcHBlZCBhZ2VudCBjcmVkZW50aWFsLiBXaGlsZSBhIHNlc3Npb24gaXMgYWN0aXZlCihgbm93IDwgdmFsaWRfdW50aWxgKSBpdCBpcyB0aGUgT05MWSBzcGVuZGVyIOKAlCB0aGUgcm9vdCBhZ2VudCBpcyByZXBsYWNlZCwKbm90IGNvbXBsZW1lbnRlZCwgc28gYXV0aG9yaXNhdGlvbiBzdGF5cyB1bmFtYmlndW91cyBhbmQgYXVkaXRhYmxlLiBXaGVuIGl0CmV4cGlyZXMgb3IgaXMgcmV2b2tlZCwgc3BlbmRpbmcgZmFsbHMgYmFjayB0byBgQ29uZmlnLmFnZW50YC4AAAAAAAAAAAAAB1Nlc3Npb24AAAAABAAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAABXNwZW50AAAAAAAACwAAAAAAAAALdmFsaWRfdW50aWwAAAAABg==",
        "AAAAAAAAAGtUb3RhbCBmdW5kcyBjdXJyZW50bHkgcmVzZXJ2ZWQgYnkgb3BlbiBlc2Nyb3dzICh0cmVhc3VyeSBiYWxhbmNlIG1pbnVzIHRoaXMKaXMgdGhlIHNwZW5kYWJsZSBmcmVlIGJhbGFuY2UpLgAAAAAGbG9ja2VkAAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAaZGdW5kIHRoZSB0cmVhc3VyeSBmcm9tIGBmcm9tYCwgcmVmdXNpbmcgYW55dGhpbmcgdGhhdCB3b3VsZCB0YWtlIGl0cyBiYWxhbmNlIGFib3ZlIHRoZQpkZXBvc2l0IGNhcC4gVGhlIGNhcCBpcyB0aGUgYmV0YSdzIGV4cG9zdXJlIGJvdW5kIHdoaWxlIHRoZSBjb2RlIGlzIHVuYXVkaXRlZC4KCkEgcGxhaW4gdG9rZW4gdHJhbnNmZXIgdG8gdGhlIHRyZWFzdXJ5J3MgYWRkcmVzcyBkb2VzIG5vdCBwYXNzIHRocm91Z2ggaGVyZSDigJQgbm8KY29udHJhY3QgY2FuIHJlZnVzZSBpbmNvbWluZyBTQUMgdHJhbnNmZXJzIOKAlCBzbyB0aGUgY2FwIGJpbmRzIHRoZSBhcHAsIHRoZSBmYWN0b3J5IGFuZApldmVyeSBjbGllbnQgdGhhdCBmdW5kcyB0aHJvdWdoIGBkZXBvc2l0YCwgbm90IGEgc2VuZGVyIGRldGVybWluZWQgdG8gZ28gYXJvdW5kIGl0LgAAAAAAB2RlcG9zaXQAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAHdmVyc2lvbgAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAIaXNfcGF5ZWUAAAABAAAAAAAAAAVwYXllZQAAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAB5XaGl0ZWxpc3QgYSBwYXllZS4gQWRtaW4tb25seS4AAAAAAAlhZGRfcGF5ZWUAAAAAAAABAAAAAAAAAAVwYXllZQAAAAAAABMAAAAA",
        "AAAAAAAAAEBTcGVuZCBpbnNpZGUgdGhlIHJvbGxpbmcgMjQtaG91ciB3aW5kb3cgKHRoZSAiZGFpbHkiIGFsbG93YW5jZSkuAAAACWRheV9zcGVudAAAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAADJUaGUgbW9udGhseSBjYXAgb24gYHBheWVlYCwgb3IgMCB3aGVuIGl0IGhhcyBub25lLgAAAAAACXBheWVlX2NhcAAAAAAAAAEAAAAAAAAABXBheWVlAAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAJFSb3RhdGUgdGhlIHJvb3QgYWdlbnQgKHRoZSBmYWxsYmFjayBzcGVuZGVyIHdoZW4gbm8gc2Vzc2lvbiBpcyBhY3RpdmUpLgpBZG1pbi1vbmx5IOKAlCB0aGUgcmVjb3ZlcnkgcGF0aCBpZiB0aGUgcm9vdCBhZ2VudCBrZXkgaXMgbG9zdCBvciBsZWFrZWQuAAAAAAAACXNldF9hZ2VudAAAAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAABkNvbmZpZwAA",
        "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6AAAB9AAAAAGRXNjcm93AAA=",
        "AAAAAAAAAMlVcGRhdGUgdGhlIHNwZW5kaW5nIGxpbWl0cywgZWZmZWN0aXZlIGltbWVkaWF0ZWx5LiBBZG1pbi1vbmx5LiBJZiB0aGUgbmV3CmRhaWx5IGxpbWl0IGlzIGJlbG93IHdoYXQgdGhlIHdpbmRvdyBhbHJlYWR5IGhvbGRzLCBzcGVuZGluZyByZXN1bWVzIG9uY2UKdGhlIHdpbmRvdyBkcmFpbnMg4oCUIHRoYXQgaXMgdGhlIGludGVuZGVkIGJlaGF2aW91ci4AAAAAAAAKc2V0X2xpbWl0cwAAAAAAAgAAAAAAAAALZGFpbHlfbGltaXQAAAAACwAAAAAAAAAOcGVyX3Rhc2tfbGltaXQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAANRGcmVlemUvdW5mcmVlemUgc3BlbmRpbmcgKHBheSwgY3JlYXRlX2VzY3JvdywgcmVsZWFzZV9lc2Nyb3cpLiBBZG1pbi1vbmx5LgpFeGl0IHBhdGhzIOKAlCByZWZ1bmRfZXNjcm93LCBhZG1pbl93aXRoZHJhdywgYW5kIGV2ZXJ5IGFkbWluIHNldHRlciDigJQga2VlcAp3b3JraW5nIHdoaWxlIHBhdXNlZCwgc28gYW4gaW5jaWRlbnQgY2FuIGFsd2F5cyBiZSB1bndvdW5kLgAAAApzZXRfcGF1c2VkAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAAA",
        "AAAAAAAAAKxDdW11bGF0aXZlIHNwZW5kIHJlY29yZGVkIGFnYWluc3QgYHRhc2tfaWRgIOKAlCBhbiBhdHRyaWJ1dGlvbiBsZWRnZXIsIG5vdCBhIGNhcC4KKFRoZSBwZXItY2FsbCBsaW1pdCBpcyBgQ29uZmlnLnBlcl90YXNrX2xpbWl0YDsgdGhlIGN1bXVsYXRpdmUgYm91bmQgaXMgdGhlIGRhaWx5IHdpbmRvdy4pAAAACnRhc2tfc3BlbnQAAAAAAAEAAAAAAAAAB3Rhc2tfaWQAAAAABgAAAAEAAAAL",
        "AAAAAAAAAKFUaGUgY3VycmVudCBVVEMgY2FsZW5kYXIgbW9udGggYXMgYHllYXIgKiAxMiArIChtb250aCAtIDEpYCDigJQgdGhlIGtleSBldmVyeSBtb250aGx5CmZpZ3VyZSBpcyBzdG9yZWQgdW5kZXIsIHNvIGNsaWVudHMgbmV2ZXIgcmUtZGVyaXZlIHRoZSBjYWxlbmRhciB0aGVtc2VsdmVzLgAAAAAAAAp0aGlzX21vbnRoAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAE5Nb3N0IHRoaXMgdHJlYXN1cnkgdGFrZXMgaW4gdGhyb3VnaCBgZGVwb3NpdGAgKDAgPSB1bmNhcHBlZCkuIEZpeGVkIGF0IGRlcGxveS4AAAAAAAtkZXBvc2l0X2NhcAAAAAAAAAAAAQAAAAs=",
        "AAAAAAAAAI1UaGUgc3RvcmVkIHNlc3Npb24sIGlmIGFueSDigJQgaW5jbHVkaW5nIGFuIGV4cGlyZWQgb25lIChjYWxsZXJzIGNvbXBhcmUKYHZhbGlkX3VudGlsYCB0byBub3c7IHRoZSBjb250cmFjdCBpdHNlbGYgaWdub3JlcyBleHBpcmVkIHNlc3Npb25zKS4AAAAAAAALZ2V0X3Nlc3Npb24AAAAAAAAAAAEAAAPoAAAH0AAAAAdTZXNzaW9uAA==",
        "AAAAAAAAAE1BZ2VudC1tb3ZlZCB2YWx1ZSBpbiBgbW9udGhgIChzZWUgYHRoaXNfbW9udGhgKSwgZXNjcm93IGNvbW1pdG1lbnRzIGluY2x1ZGVkLgAAAAAAAAttb250aF9zcGVudAAAAAABAAAAAAAAAAVtb250aAAAAAAAAAQAAAABAAAACw==",
        "AAAAAAAAAENXaGF0IGBwYXllZWAgaGFzIGJlZW4gcGFpZCAob3IgaGFkIGNvbW1pdHRlZCBpbiBlc2Nyb3cpIGluIGBtb250aGAuAAAAAAtwYXllZV9zcGVudAAAAAACAAAAAAAAAAVwYXllZQAAAAAAABMAAAAAAAAABW1vbnRoAAAAAAAABAAAAAEAAAAL",
        "AAAAAAAAAMtEZWxlZ2F0ZSBzcGVuZGluZyB0byBhIHNlc3Npb24gYWdlbnQuIEFkbWluLW9ubHkuIFdoaWxlIHRoZSBzZXNzaW9uIGlzCmFjdGl2ZSBpdCBpcyB0aGUgb25seSBzcGVuZGVyIChzZWUgYFNlc3Npb25gKTsgc2V0dGluZyBhIG5ldyBzZXNzaW9uCm92ZXJ3cml0ZXMgdGhlIG9sZCBvbmUgYW5kIHJlc2V0cyBpdHMgc3BlbnQgY291bnRlciAocm90YXRpb24pLgAAAAALc2V0X3Nlc3Npb24AAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAt2YWxpZF91bnRpbAAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAtZUb3RhbCBhZ2VudC1tb3ZlZCB2YWx1ZSBpbnNpZGUgdGhlIGNsb3NlZCBVVEMgZGF5IGBwZXJpb2RfaWRgCihgcGVyaW9kX2lkID0gdGltZXN0YW1wIC8gODY0MDBgKSDigJQgdGhlIGZpZ3VyZSBhIGNvbXBsaWFuY2UgcHJvb2YgY29tbWl0cyB0by4KCkRlbGliZXJhdGVseSBOT1QgYGRheV9zcGVudGA6IHRoZSByb2xsaW5nIHdpbmRvdyBhbnN3ZXJzICJob3cgbXVjaCBhbGxvd2FuY2UgaXMKbGVmdCByaWdodCBub3ciIGFuZCBjaGFuZ2VzIGV2ZXJ5IGhvdXIsIHNvIGEgcHJvb2YgY291bGQgbmV2ZXIgYmluZCB0byBpdC4gVGhpcwpzdW1zIHRoZSAyNCBmaXhlZCBidWNrZXRzIG9mIG9uZSBjYWxlbmRhciBkYXksIGdpdmluZyBhIHZhbHVlIHRoYXQgaXMgZmluYWwgb25jZQp0aGUgZGF5IGNsb3NlcyBhbmQgcmVhZHMgaWRlbnRpY2FsbHkgZm9yZXZlciBhZnRlci4KCiJNb3ZlZCIgaW5jbHVkZXMgZXNjcm93IGNvbW1pdG1lbnRzLCBub3QganVzdCBzZXR0bGVkIHBheW1lbnRzIOKAlCBgY3JlYXRlX2VzY3Jvd2AKY2hhcmdlcyB0aGUgc2FtZSBidWNrZXRzLCBiZWNhdXNlIGxvY2tpbmcgdGhlIGJhbGFuY2UgaXMgdGhlIGFnZW50IGV4ZXJjaXNpbmcgaXRzCmJ1ZGdldCB3aGV0aGVyIG9yIG5vdCB0aGUgZnVuZHMgZXZlciBsZWF2ZS4KCjI0IHBlcnNpc3RlbnQgcmVhZHMsIG9uZSBmZXdlciB0aGFuIGByb2xsaW5nX3NwZW50YCBhbHJlYWR5IHBlcmZvcm1zIHBlciBzcGVuZC4AAAAAAAxwZXJpb2Rfc3BlbnQAAAABAAAAAAAAAAlwZXJpb2RfaWQAAAAAAAAGAAAAAQAAAAs=",
        "AAAAAAAAAC5SZW1vdmUgYSBwYXllZSBmcm9tIHRoZSB3aGl0ZWxpc3QuIEFkbWluLW9ubHkuAAAAAAAMcmVtb3ZlX3BheWVlAAAAAQAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAA==",
        "AAAAAAAAAWdBdG9taWMgaW5pdCBhdCBkZXBsb3kgdGltZSAobm8gZnJvbnQtcnVubmFibGUgYGluaXRpYWxpemVgKS4KTGltaXRzIGFyZSB2YWxpZGF0ZWQgaGVyZSBzbyBhIHRyZWFzdXJ5IGNhbiBuZXZlciBleGlzdCB3aXRoIGEgcG9saWN5CnRoYXQgY29udHJhZGljdHMgaXRzZWxmIChlLmcuIHBlci10YXNrIGFib3ZlIGRhaWx5KS4KCmBkZXBvc2l0X2NhcGAgKDAgPSBub25lKSBpcyBmaXhlZCBmb3IgdGhlIHRyZWFzdXJ5J3MgbGlmZTogbm90aGluZyBjYW4gcmFpc2UgaXQsIHNvIGEKZmFjdG9yeSB0aGF0IHBpbnMgb25lIGhhbmRzIG91dCB0cmVhc3VyaWVzIHRoZSBvd25lciBjYW5ub3Qgb3Zlci1mdW5kIHRocm91Z2ggYGRlcG9zaXRgLgAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAYAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAC2RhaWx5X2xpbWl0AAAAAAsAAAAAAAAADnBlcl90YXNrX2xpbWl0AAAAAAALAAAAAAAAAAtkZXBvc2l0X2NhcAAAAAALAAAAAA==",
        "AAAAAAAAAWJBZ2VudCByZXNlcnZlcyBgYW1vdW50YCBmb3IgYHBheWVlYCBhZ2FpbnN0IGEgZnV0dXJlLWRlbGl2ZXJlZCB0YXNrLiBUaGUgZnVuZHMKc3RheSBpbiB0aGUgdHJlYXN1cnkgKGxvY2tlZCwgbm90IHRyYW5zZmVycmVkKSB1bnRpbCByZWxlYXNlZCBvbiBhcHByb3ZhbCBvcgpyZWZ1bmRlZCBhZnRlciBgZGVhZGxpbmVgLiBTdWJqZWN0IHRvIHRoZSBzYW1lIHBheWVlIGdhdGUgKyBwZXItdGFzayBsaW1pdCArCnNlc3Npb24gY2FwIGFzIGEgZGlyZWN0IHBheW1lbnQ7IHRoZSByb2xsaW5nIHdpbmRvdyBpcyBjaGFyZ2VkIGhlcmUsIGF0CmNvbW1pdG1lbnQgdGltZSAoc2VlIHRoZSByZWFzb25pbmcgaW5saW5lIGJlbG93KS4AAAAAAA1jcmVhdGVfZXNjcm93AAAAAAAABAAAAAAAAAAHdGFza19pZAAAAAAGAAAAAAAAAAVwYXllZQAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAANbW9udGhseV9saW1pdAAAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAShBZnRlciB0aGUgZGVhZGxpbmUsIHRoZSBhZ2VudCByZWNsYWltcyBhbiB1bmRlbGl2ZXJlZCBlc2Nyb3cg4oCUIHRoZSBsb2NrIGlzCnJlbGVhc2VkIGJhY2sgdG8gdGhlIHRyZWFzdXJ5J3MgZnJlZSBiYWxhbmNlLiBObyB0cmFuc2Zlciwgbm8gc3BlbmQgcmVjb3JkZWQsCmFuZCB0aGUgc2Vzc2lvbiBidWRnZXQgaXMgTk9UIHJlc3RvcmVkIChjb25zZXJ2YXRpdmU6IHRoZSBjYXAgYm91bmRzIHdoYXQgYQpzZXNzaW9uIG1heSBjb21taXQpLiBEZWxpYmVyYXRlbHkgd29ya3Mgd2hpbGUgcGF1c2VkIChleGl0IHBhdGgpLgAAAA1yZWZ1bmRfZXNjcm93AAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAR9Nb3N0IGBwYXllZWAgbWF5IHJlY2VpdmUgcGVyIFVUQyBjYWxlbmRhciBtb250aC4gQWRtaW4tb25seTsgMCByZW1vdmVzIHRoZSBjYXAuIFRoZSBjYXAKZG9lcyBub3QgYXBwcm92ZSB0aGUgcGF5ZWUg4oCUIGl0IG5hcnJvd3Mgd2hhdCBhbiBhcHByb3ZlZCAob3IgcmVwdXRhdGlvbi1nYXRlZCkgcGF5ZWUKY2FuIGJlIHBhaWQuIENhcHBpbmcgdGhlIGFnZW50J3Mgb3duIGZsb2F0IGFkZHJlc3MgaXMgd2hhdCBib3VuZHMgbW9uZXkgdGhhdCBoYXMgbGVmdAp0aGUgdHJlYXN1cnkncyBwcm90ZWN0aW9uLgAAAAANc2V0X3BheWVlX2NhcAAAAAAAAAIAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAADY2FwAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAW5Pd25lciByZWNsYWltcyBmcmVlICh1bmxvY2tlZCkgZnVuZHMgd2l0aCB0aGVpciBvd24gc2lnbmF0dXJlLiBEZWxpYmVyYXRlbHkKZXhlbXB0IGZyb20gcGF1c2UsIHRoZSBwYXllZSBnYXRlLCBhbmQgdGhlIHJvbGxpbmcgd2luZG93OiB0aG9zZSBib3VuZAoqZGVsZWdhdGVkKiBhZ2VudCBzcGVuZGluZywgYW5kIHRoZSBleGl0IHBhdGggbXVzdCB3b3JrIGV4YWN0bHkgd2hlbiBsaW1pdHMKYXJlIGV4aGF1c3RlZCBvciBzcGVuZGluZyBpcyBmcm96ZW4uIEVzY3Jvdy1sb2NrZWQgZnVuZHMgc3RheSBsb2NrZWQgKHRoZQpjb21taXRtZW50IHRvIHBheWVlcyBzdXJ2aXZlczsgcmVmdW5kIGlzIHRoZSBlc2NhcGUgaGF0Y2ggZm9yIHRob3NlKS4AAAAAAA5hZG1pbl93aXRoZHJhdwAAAAAAAgAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAQVBZG1pbiAodGhlIG93bmVyIC8gaGlyZXIpIGFwcHJvdmVzIGRlbGl2ZXJ5IOKGkiByZWxlYXNlIHRoZSBsb2NrZWQgZnVuZHMgdG8gdGhlCnBheWVlLiBUaGUgcm9sbGluZyB3aW5kb3cgd2FzIGFscmVhZHkgY2hhcmdlZCB3aGVuIHRoZSBlc2Nyb3cgd2FzIGNyZWF0ZWQsIHNvCnJlbGVhc2UgZG9lcyBub3QgY2hlY2sgb3IgY2hhcmdlIGl0IGFnYWluOyB0aGUgc3BlbmQgaXMgYWNjb3VudGVkIHBlciB0YXNrCmV4YWN0bHkgbGlrZSBhIGRpcmVjdCBgcGF5YC4AAAAAAAAOcmVsZWFzZV9lc2Nyb3cAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAIhJbnN0YW50bHkgcmV2b2tlIHRoZSBzZXNzaW9uIOKAlCBzcGVuZGluZyBmYWxscyBiYWNrIHRvIHRoZSByb290IGFnZW50LgpBZG1pbi1vbmx5OyBkZWxpYmVyYXRlbHkgd29ya3Mgd2hpbGUgcGF1c2VkIChpbmNpZGVudCByZXNwb25zZSkuAAAADnJldm9rZV9zZXNzaW9uAAAAAAAAAAAAAA==",
        "AAAAAAAAAFZUaGUgcGF5ZWVzIHRoZSBjdXJyZW50IExlYXNoIGlzIHJlc3RyaWN0ZWQgdG87IGVtcHR5IHdoZW4gaXQgbWF5IHBheSBhbnkgYXBwcm92ZWQgb25lLgAAAAAADnNlc3Npb25fcGF5ZWVzAAAAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAAAAAJtUaGUgcGF5ZWUtc2V0IE1lcmtsZSByb290IHRoaXMgdHJlYXN1cnkgcHVibGlzaGVzLCBvciBgTm9uZWAgaWYgdGhlIG93bmVyIG5ldmVyCmRlY2xhcmVkIG9uZSAoaW4gd2hpY2ggY2FzZSBubyBjb21wbGlhbmNlIHByb29mIGNhbiBiZSBjaGVja2VkIGFnYWluc3QgaXQpLgAAAAAOd2hpdGVsaXN0X3Jvb3QAAAAAAAAAAAABAAAD6AAAA+4AAAAg",
        "AAAAAAAAAQNBIExlYXNoIGZvciBvbmUgdGFzazogbGlrZSBgc2V0X3Nlc3Npb25gLCBidXQgdGhlIGFnZW50IG1heSBvbmx5IHBheSB0aGUgcGF5ZWVzCmxpc3RlZCBoZXJlIChlYWNoIG11c3Qgc3RpbGwgcGFzcyB0aGUgd2hpdGVsaXN0IC8gcmVwdXRhdGlvbiBnYXRlKS4gVGhpcyBpcyB3aGF0IHRoZQpvd25lciBzaWducyB3aGVuIGFwcHJvdmluZyBhbiBhZ2VudCdzIGJ1ZGdldCByZXF1ZXN0IOKAlCBvbmNlLCBmb3IgdGhlIHdob2xlIHRhc2suCkFkbWluLW9ubHkuAAAAAA9zZXRfdGFza19idWRnZXQAAAAABAAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAt2YWxpZF91bnRpbAAAAAAGAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAABnBheWVlcwAAAAAD6gAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAN5Nb3N0IHRoZSBhZ2VudCBtYXkgbW92ZSBwZXIgVVRDIGNhbGVuZGFyIG1vbnRoLCBhY3Jvc3MgZXZlcnkgcGF5ZWUuIEFkbWluLW9ubHk7CjAgcmVtb3ZlcyB0aGUgbW9udGhseSBsaW1pdC4gTGlrZSB0aGUgZGFpbHkgbGltaXQsIGxvd2VyaW5nIGl0IGJlbG93IHdoYXQgdGhlIG1vbnRoCmFscmVhZHkgaG9sZHMgc2ltcGx5IHN0b3BzIHNwZW5kaW5nIHVudGlsIHRoZSBtb250aCB0dXJucy4AAAAAABFzZXRfbW9udGhseV9saW1pdAAAAAAAAAEAAAAAAAAABWxpbWl0AAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAg9QdWJsaXNoIHRoZSBNZXJrbGUgcm9vdCBvZiB0aGUgcGF5ZWUgc2V0IHRoYXQgY29tcGxpYW5jZSBwcm9vZnMgYXJlIGNoZWNrZWQKYWdhaW5zdC4gQWRtaW4tb25seTogdGhlIHJvb3QgSVMgdGhlIG93bmVyJ3MgcG9saWN5IHN0YXRlbWVudCwgc28gYW4gYWdlbnQgdGhhdApjb3VsZCB3cml0ZSBpdCB3b3VsZCBiZSBjaG9vc2luZyB0aGUgcGF5ZWUgc2V0IGl0cyBvd24gcHJvb2YgaXMgdmVyaWZpZWQgYWdhaW5zdC4KClRoZSByb290IGlzIG5vdCBkZXJpdmVkIGZyb20gYERhdGFLZXk6OlBheWVlYCDigJQgdGhlIHdoaXRlbGlzdCBpcyBhIGtleS1wZXItcGF5ZWUKbWFwIHdpdGggbm8gb24tY2hhaW4gZW51bWVyYXRpb24sIGFuZCB0aGUgY2lyY3VpdCdzIFBvc2VpZG9uIGhhc2ggaGFzIG5vIGhvc3QKaW1wbGVtZW50YXRpb24gdG8gcmVidWlsZCBpdCB3aXRoLiBUaGUgb3duZXIgY29tcHV0ZXMgaXQgb2ZmLWNoYWluIGFuZCBhbmNob3JzIGl0CmhlcmU7IHRoZSBldmVudCBtYWtlcyBldmVyeSBjaGFuZ2UgYXVkaXRhYmxlLgAAAAASc2V0X3doaXRlbGlzdF9yb290AAAAAAABAAAAAAAAAARyb290AAAD7gAAACAAAAAA",
        "AAAAAAAAAWRBZG1pbiB1bmlsYXRlcmFsbHkgY2FuY2VscyBhbiBvcGVuIGVzY3JvdyDigJQgdGhlIGxvY2sgcmV0dXJucyB0byB0aGUgZnJlZQpiYWxhbmNlLCBub3RoaW5nIGlzIHBhaWQsIG5vIGRlYWRsaW5lIG5lZWRlZC4gVGhpcyBpcyB0aGUgaW5jaWRlbnQtcmVzcG9uc2UKcGF0aDogYSBjb21wcm9taXNlZCBhZ2VudCBjb3VsZCBvdGhlcndpc2UgdGllIHVwIHRoZSB3aG9sZSB0cmVhc3VyeSBpbgplc2Nyb3dzIGl0IGFsb25lIGNhbiByZWZ1bmQuIERlbGliZXJhdGVseSB3b3JrcyB3aGlsZSBwYXVzZWQgKGV4aXQgcGF0aCk7CnRoZSBzZXNzaW9uIGJ1ZGdldCBpcyBOT1QgcmVzdG9yZWQgKGNvbnNpc3RlbnQgd2l0aCByZWZ1bmQpLgAAABNhZG1pbl9jYW5jZWxfZXNjcm93AAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEFUaGUgYWN0aXZlIHJlcHV0YXRpb24gZ2F0ZSwgaWYgYW55OiBgKHJlZ2lzdHJ5LCBtaW5fcmVwdXRhdGlvbilgLgAAAAAAABVnZXRfcmVwdXRhdGlvbl9wb2xpY3kAAAAAAAAAAAAAAQAAA+gAAAPtAAAAAgAAABMAAAAL",
        "AAAAAAAAASpTZXQgKG9yIHVwZGF0ZSkgdGhlIHJlcHV0YXRpb24gZ2F0ZS4gQWRtaW4tb25seS4gV2l0aCBgbWluX3JlcHV0YXRpb24gPiAwYCwKYSBwYXllZSB0aGF0IGlzIE5PVCBvbiB0aGUgd2hpdGVsaXN0IGNhbiBzdGlsbCBiZSBwYWlkIHdoZW4gaXRzIHNjb3JlIGZyb20KYHJlZ2lzdHJ5YCBpcyA+PSBgbWluX3JlcHV0YXRpb25gIOKAlCB0dXJuaW5nIHRoZSBzdGF0aWMgYWxsb3dsaXN0IGludG8gYW4KZWFybmVkLXRydXN0IGdhdGUuIFNldCBgbWluX3JlcHV0YXRpb24gPSAwYCB0byBkaXNhYmxlICh3aGl0ZWxpc3Qtb25seSkuAAAAAAAVc2V0X3JlcHV0YXRpb25fcG9saWN5AAAAAAAAAgAAAAAAAAAIcmVnaXN0cnkAAAATAAAAAAAAAA5taW5fcmVwdXRhdGlvbgAAAAAACwAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    pay: this.txFromJSON<Result<void>>,
        locked: this.txFromJSON<i128>,
        balance: this.txFromJSON<i128>,
        deposit: this.txFromJSON<Result<void>>,
        version: this.txFromJSON<u32>,
        is_payee: this.txFromJSON<boolean>,
        add_payee: this.txFromJSON<null>,
        day_spent: this.txFromJSON<i128>,
        is_paused: this.txFromJSON<boolean>,
        payee_cap: this.txFromJSON<i128>,
        set_agent: this.txFromJSON<null>,
        get_config: this.txFromJSON<Config>,
        get_escrow: this.txFromJSON<Option<Escrow>>,
        set_limits: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<null>,
        task_spent: this.txFromJSON<i128>,
        this_month: this.txFromJSON<u32>,
        deposit_cap: this.txFromJSON<i128>,
        get_session: this.txFromJSON<Option<Session>>,
        month_spent: this.txFromJSON<i128>,
        payee_spent: this.txFromJSON<i128>,
        set_session: this.txFromJSON<Result<void>>,
        period_spent: this.txFromJSON<i128>,
        remove_payee: this.txFromJSON<null>,
        create_escrow: this.txFromJSON<Result<u64>>,
        monthly_limit: this.txFromJSON<i128>,
        refund_escrow: this.txFromJSON<Result<void>>,
        set_payee_cap: this.txFromJSON<Result<void>>,
        admin_withdraw: this.txFromJSON<Result<void>>,
        release_escrow: this.txFromJSON<Result<void>>,
        revoke_session: this.txFromJSON<null>,
        session_payees: this.txFromJSON<Array<string>>,
        whitelist_root: this.txFromJSON<Option<Buffer>>,
        set_task_budget: this.txFromJSON<Result<void>>,
        set_monthly_limit: this.txFromJSON<Result<void>>,
        set_whitelist_root: this.txFromJSON<null>,
        admin_cancel_escrow: this.txFromJSON<Result<void>>,
        get_reputation_policy: this.txFromJSON<Option<readonly [string, i128]>>,
        set_reputation_policy: this.txFromJSON<null>
  }
}