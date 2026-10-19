// The single migration surface for fee sponsorship.
//
// The app posts to our own /api/relay, which sources, fee-pays and submits the transaction
// (api/relay.ts). The app never holds the fee key; moving the relay changes the URL and
// nothing here.
//
// A relay answer is not a ledger answer. The relay waits a few seconds for a verdict and then
// hands back whatever it last saw — PENDING or NOT_FOUND included — with a 200. Every caller
// here goes on to tell the user something happened ("Treasury created ✓"), so a submission
// only resolves once the ledger itself says SUCCESS. Anything else throws, which is what
// closes the 08-07 failure where the app announced a treasury that was never on chain.
//
// fetch and the ledger lookup are injected so the whole thing unit-tests offline.

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Ask the ledger for a transaction's final status — SUCCESS, FAILED, or still NOT_FOUND. */
export type Confirm = (hash: string) => Promise<string>;

const GENERIC_MSG = "Couldn't submit that transaction. Try again.";
const UNBUILT_MSG = "That transaction could not be prepared — try again.";
// A refusal is not a hiccup: the relay will answer the same way however many times it is
// asked. Saying "try again" there sends people in circles — a live user spent an evening
// retrying a deploy the relay was never going to sponsor.
const REFUSED_MSG = "We're not cleared to sponsor that transaction — that's on our side, not you. Retrying won't help.";
const UNCONFIGURED_MSG = "Fee sponsorship isn't configured right now, so we can't cover this transaction.";
const FAILED_MSG = "The network ran that transaction and it failed — nothing changed.";

/** Submitted, but the ledger has not confirmed it yet. Not a failure and not a success: the
 *  hash is carried so the UI can link to it instead of claiming either outcome. */
export class RelayPendingError extends Error {
  constructor(readonly hash: string) {
    super("Sent to the network but not confirmed yet — check again in a minute before retrying.");
    this.name = "RelayPendingError";
  }
}

interface XdrLike {
  toXDR: (format?: string) => string;
}

/** An assembled contract-client transaction, narrowed to the parts the relay reads. */
export interface AssembledLike {
  signAndSend?: () => Promise<unknown>;
  built?: { operations?: Array<{ func?: XdrLike; auth?: XdrLike[] }> };
}

/** Sign-free extraction of what the relay needs: the host function and its auth entries.
 *  The passkey has already filled the auth entries in by the time this runs. */
function decode(tx: AssembledLike): { func: string; auth: string[] } {
  const op = tx.built?.operations?.[0];
  if (!op?.func) throw new Error(UNBUILT_MSG);
  return {
    func: op.func.toXDR("base64"),
    auth: (op.auth ?? []).map((entry) => entry.toXDR("base64")),
  };
}

/** Poll the ledger until a transaction leaves NOT_FOUND/PENDING, or give up and report the
 *  last status seen. Stellar closes a ledger about every five seconds, so the default thirty
 *  one-second looks cover several ledgers past the relay's own short wait. */
export function ledgerConfirm(
  server: { getTransaction(hash: string): Promise<{ status: string }> },
  attempts = 30,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Confirm {
  return async (hash) => {
    let seen = "NOT_FOUND";
    for (let i = 0; i < attempts; i++) {
      seen = (await server.getTransaction(hash)).status;
      if (seen !== "NOT_FOUND" && seen !== "PENDING") return seen;
      await wait(1000);
    }
    return seen;
  };
}

async function post(fetchImpl: FetchLike, payload: unknown, confirm?: Confirm): Promise<{ hash: string }> {
  const res = await fetchImpl("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as { hash?: string; status?: string; error?: string };

  if (!res.ok) {
    // The endpoint keeps its reasons to itself on purpose (its URL is public), but the status
    // and whatever it did say belong in the console — otherwise every relay failure looks the
    // same from here, which is how one live failure cost a whole round.
    console.error(`[relay] ${res.status}:`, body.error ?? "(no detail)");
    if (res.status === 403) throw new Error(REFUSED_MSG);
    if (res.status === 503) throw new Error(UNCONFIGURED_MSG);
    throw new Error(GENERIC_MSG);
  }
  if (!body.hash) {
    console.error("[relay] 200 without a transaction hash:", body);
    throw new Error(GENERIC_MSG);
  }

  let status = body.status ?? "NOT_FOUND";
  if (status !== "SUCCESS" && confirm) status = await confirm(body.hash);
  if (status === "SUCCESS") return { hash: body.hash };

  console.error(`[relay] ${body.hash} ended ${status}`);
  if (status === "FAILED") throw new Error(FAILED_MSG);
  throw new RelayPendingError(body.hash);
}

/** Submit a passkey-signed transaction through our relay proxy. Resolves only once the
 *  ledger confirms it. */
export async function relayTx(
  fetchImpl: FetchLike,
  tx: AssembledLike,
  confirm?: Confirm,
): Promise<{ hash: string }> {
  return post(fetchImpl, decode(tx), confirm);
}

/** Submit a host function and its signed auth entries directly. Deploying a treasury from a
 *  smart wallet builds its own operation rather than going through a contract client, so
 *  there is no assembled transaction here to decode. */
export async function relayHostFunction(
  fetchImpl: FetchLike,
  func: string,
  auth: string[],
  confirm?: Confirm,
): Promise<{ hash: string }> {
  return post(fetchImpl, { func, auth }, confirm);
}

/** Submit an already-signed transaction envelope — what passkey-kit hands back when it
 *  registers a passkey and deploys the smart wallet. */
export async function relayEnvelope(
  fetchImpl: FetchLike,
  xdr: string,
  confirm?: Confirm,
): Promise<{ hash: string }> {
  return post(fetchImpl, { xdr }, confirm);
}
