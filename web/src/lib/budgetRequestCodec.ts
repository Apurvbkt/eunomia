// A task budget the agent asks for, carried to the owner as a link. The owner's app shows it
// and, on approval, signs exactly this as `set_task_budget` — one passkey prompt for the
// whole task, no prompt per payment after that.
//
// The agent signs the request with its Leash key, so a link edited on the way (a bigger
// limit, an extra payee, a longer window) no longer verifies. That proves which key asked,
// not that the asker deserves it: anyone can sign a request with a key of their own. The app
// therefore approves an unfamiliar key only after the owner pastes the key their own agent
// printed (see BudgetRequestCard).
//
// This file is copied verbatim into web/src/lib/budgetRequestCodec.ts (CI keeps the two
// byte-identical) — keep it browser-safe.
import { Keypair, StrKey } from "@stellar/stellar-sdk";

// v2 (2026-10-20): the request expires. A v1 link, once made, could be presented forever.
export const BUDGET_REQUEST_VERSION = "2";
/** A task budget names at most this many payees (the contract's MAX_TASK_PAYEES). */
export const MAX_REQUEST_PAYEES = 16;
/** Longest budget an agent may ask for: 30 days. Longer work is a standing Leash. */
export const MAX_REQUEST_HOURS = 720;
export const MAX_TASK_CHARS = 200;
/** How long a request link stays approvable. */
export const REQUEST_TTL_SEC = 24 * 3600;

export interface BudgetRequest {
  network: "testnet" | "pubnet";
  treasury: string;
  agent: string;
  /** stroops */
  limit: bigint;
  hours: number;
  payees: string[];
  /** what the budget is for, in the agent's words */
  task: string;
  /** unix seconds after which the link no longer approves anything */
  expires: number;
}

const isAddress = (a: string) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a);

/** Everything wrong with a request, before any signature is looked at. */
export function budgetRequestProblems(r: BudgetRequest): string[] {
  const p: string[] = [];
  if (r.network !== "testnet" && r.network !== "pubnet") p.push(`unknown network "${r.network}"`);
  if (!StrKey.isValidContract(r.treasury)) p.push("treasury is not a contract id");
  if (!StrKey.isValidEd25519PublicKey(r.agent)) p.push("agent is not a G… key");
  if (r.limit <= 0n) p.push("limit must be positive");
  if (!Number.isInteger(r.hours) || r.hours < 1 || r.hours > MAX_REQUEST_HOURS) {
    p.push(`hours must be a whole number from 1 to ${MAX_REQUEST_HOURS}`);
  }
  if (r.payees.length === 0 || r.payees.length > MAX_REQUEST_PAYEES) {
    p.push(`name 1 to ${MAX_REQUEST_PAYEES} payees`);
  }
  for (const payee of r.payees) if (!isAddress(payee)) p.push(`payee ${payee} is not a Stellar address`);
  if (new Set(r.payees).size !== r.payees.length) p.push("payees repeat");
  if (r.task.length === 0 || r.task.length > MAX_TASK_CHARS) p.push(`task must be 1 to ${MAX_TASK_CHARS} characters`);
  if (!Number.isInteger(r.expires) || r.expires <= 0) p.push("expires must be a unix time");
  return p;
}

/** The exact bytes the agent signs: every field, in a fixed order, one per line. */
export function budgetRequestMessage(r: BudgetRequest): Buffer {
  return Buffer.from(
    [
      `eunomia budget request v${BUDGET_REQUEST_VERSION}`,
      r.network,
      r.treasury,
      r.agent,
      r.limit.toString(),
      String(r.hours),
      r.payees.join(","),
      r.task,
      String(r.expires),
    ].join("\n"),
    "utf8",
  );
}

/** The request as link parameters, signed by the agent's key. */
export function encodeBudgetRequest(r: BudgetRequest, agent: Keypair): URLSearchParams {
  const problems = budgetRequestProblems(r);
  if (problems.length > 0) throw new Error(`budget request: ${problems.join("; ")}`);
  if (agent.publicKey() !== r.agent) throw new Error("budget request: signed by a key that is not the agent's");
  return new URLSearchParams({
    v: BUDGET_REQUEST_VERSION,
    net: r.network,
    t: r.treasury,
    a: r.agent,
    l: r.limit.toString(),
    h: String(r.hours),
    p: r.payees.join(","),
    task: r.task,
    exp: String(r.expires),
    sig: agent.sign(budgetRequestMessage(r)).toString("base64"),
  });
}

/** Read a request back from link parameters. `verified` is true only when every field is
 *  well-formed, the agent's signature covers them all and — given `nowSec` — the link has
 *  not expired. */
export function decodeBudgetRequest(
  params: URLSearchParams,
  nowSec?: number,
): { request: BudgetRequest | null; verified: boolean; problems: string[] } {
  if (params.get("v") !== BUDGET_REQUEST_VERSION) {
    return { request: null, verified: false, problems: [`unsupported request version "${params.get("v")}"`] };
  }
  const limit = params.get("l") ?? "";
  const request: BudgetRequest = {
    network: (params.get("net") ?? "") as BudgetRequest["network"],
    treasury: params.get("t") ?? "",
    agent: params.get("a") ?? "",
    limit: /^\d+$/.test(limit) ? BigInt(limit) : 0n,
    hours: Number(params.get("h") ?? ""),
    payees: (params.get("p") ?? "").split(",").filter(Boolean),
    task: params.get("task") ?? "",
    expires: Number(params.get("exp") ?? ""),
  };
  const problems = budgetRequestProblems(request);
  if (problems.length > 0) return { request, verified: false, problems };
  if (!signatureHolds(request, params.get("sig") ?? "")) {
    return { request, verified: false, problems: ["the agent's signature does not match this request"] };
  }
  if (nowSec !== undefined && request.expires <= nowSec) {
    return { request, verified: false, problems: ["this request has expired — ask the agent for a new link"] };
  }
  return { request, verified: true, problems: [] };
}

function signatureHolds(r: BudgetRequest, sig: string): boolean {
  try {
    return Keypair.fromPublicKey(r.agent).verify(budgetRequestMessage(r), Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
