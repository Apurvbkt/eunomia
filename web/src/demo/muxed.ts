// Funding rail — Seyit's angle. One classic pool account, infinite zero-cost
// muxed sub-addresses. A client funds a specific agent budget by paying its
// M-address; the deposit lands in the pool and is attributed by `to_muxed_id`
// on-chain — no memos, no new accounts. This is the Stellar-unique primitive.

import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  MuxedAccount,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE } from "../config";
import { AGENT_SECRET, POOL_PK } from "./config";

const server = new Horizon.Server(HORIZON_URL);
const funder = Keypair.fromSecret(AGENT_SECRET); // a "client" wallet, for the demo

/** The zero-cost muxed (M...) sub-address that earmarks a deposit for a budget. */
export function muxedFor(id: bigint): string {
  return new MuxedAccount(new Account(POOL_PK, "0"), id.toString()).accountId();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Several judges may fund at the same instant from the one demo funder account,
 *  which collides on the account sequence. Detect that (and other transient
 *  network errors) so we can retry with a freshly-loaded sequence. */
function isTransientHorizon(e: unknown): boolean {
  const tc = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } } })
    ?.response?.data?.extras?.result_codes?.transaction;
  if (tc && /bad_seq|too_late|try_again/i.test(tc)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /bad_seq|sequence|too late|timeout|429|50\d\b|network|fetch|econn|unavailable|temporar/i.test(msg);
}

/** A client deposits XLM to a budget's muxed address (a real classic payment).
 *  Retries on stale-sequence / transient errors so concurrent funders don't fail. */
export async function sendDeposit(id: bigint, amount = "5"): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const src = await server.loadAccount(funder.publicKey()); // fresh sequence each attempt
      const tx = new TransactionBuilder(src, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: muxedFor(id),
            asset: Asset.native(),
            amount,
          }),
        )
        .setTimeout(60)
        .build();
      tx.sign(funder);
      const res = await server.submitTransaction(tx);
      return res.hash;
    } catch (e) {
      lastErr = e;
      if (attempt < 4 && isTransientHorizon(e)) {
        await sleep(220 * (attempt + 1) + Math.floor(Math.random() * 400));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export interface Deposit {
  budgetId: string;
  amount: string;
  from: string;
  hash: string;
}

/** Read deposits attributed per budget straight from Horizon's `to_muxed_id`. */
export async function readDeposits(): Promise<Deposit[]> {
  const page = await server.payments().forAccount(POOL_PK).order("desc").limit(30).call();
  return (page.records as unknown as Array<Record<string, unknown>>)
    .filter((r) => r.type === "payment" && r.asset_type === "native" && r.to_muxed_id != null)
    .map((r) => ({
      budgetId: String(r.to_muxed_id),
      amount: String(r.amount),
      from: String(r.from),
      hash: String(r.transaction_hash),
    }));
}
