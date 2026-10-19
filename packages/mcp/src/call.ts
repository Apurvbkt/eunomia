// Buy one call to a paid HTTP service: request → 402 → checks → sign → retry → answer.
//
// The payment comes out of the agent's float (float.ts), signed by the agent's own key with
// the official x402 client. Before anything is signed, every option the 402 offers is held
// to the same rules the treasury would apply if it could pay directly, so the float cannot
// become the way around them:
//   - exact scheme, this network, the treasury's own token
//   - no more than the caller's `maxPrice`, the treasury's per-payment cap and the float
//   - paid to an address the treasury approves (is_payee), and inside the task budget's
//     payee list when the Leash has one
// An option that fails any of them is never offered to the signer.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { computeBudget } from "./budget.js";
import { tokenBalance } from "./float.js";
import { requireTreasury } from "./pay.js";
import type { ServerContext } from "./server.js";
import { isPayee, makeClient, readTreasury } from "./treasury.js";
import { caip2, type PaymentRequirements } from "./x402.js";

export interface CallArgs {
  url: string;
  method?: string;
  /** JSON body (sent as application/json) */
  body?: unknown;
  /** most the caller will pay for this one call, in stroops */
  maxPrice: bigint;
}

export interface OptionVerdict {
  payTo: string;
  amount: string;
  asset: string;
  network: string;
  problems: string[];
}

export type CallOutcome =
  | {
      paid: boolean;
      status: number;
      /** response body: parsed JSON when it is JSON, otherwise text (truncated) */
      body: unknown;
      amount?: bigint;
      payTo?: string;
      txHash?: string;
      options?: OptionVerdict[];
    }
  | { paid: false; status: 402; refused: true; options: OptionVerdict[]; message: string };

export interface CallDeps {
  fetchImpl?: typeof fetch;
  /** the float's balance of the treasury token; injected for tests */
  floatBalance?: () => Promise<bigint>;
  /** resolves a host to its addresses; injected for tests */
  resolve?: (host: string) => Promise<string[]>;
  /** builds the payment header for the chosen option; injected for tests */
  sign?: (paymentRequired: unknown, chosen: PaymentRequirements) => Promise<Record<string, string>>;
  readClient?: ReturnType<typeof makeClient>;
  now?: () => number;
}

const MAX_BODY_CHARS = 20_000;

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  const clipped = text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… [truncated]` : text;
  try {
    return JSON.parse(text);
  } catch {
    return clipped;
  }
}

/** Loopback, private, link-local (cloud metadata), CGNAT and unspecified ranges — what an
 *  agent talked into "calling a service" must never reach on the machine it runs on. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  const l = ip.toLowerCase();
  return l === "::" || l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

/** Why the agent may not call this URL, or null. https only, to a public host; plain http and
 *  local hosts only on testnet, where the local test sellers live. */
export async function urlProblem(
  raw: string,
  network: "testnet" | "pubnet",
  resolve: (host: string) => Promise<string[]>,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "https:" && !(network === "testnet" && url.protocol === "http:")) {
    return `${url.protocol} is not allowed — https only`;
  }
  if (network === "testnet") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "local hosts are not allowed";
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (addrs.length === 0) return `${host} does not resolve`;
  if (addrs.some(isPrivateAddress)) return `${host} resolves to a private address`;
  return null;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

const keyOf = (r: PaymentRequirements) => `${r.network}|${r.asset}|${r.payTo}|${r.amount}`;

export async function callService(ctx: ServerContext, args: CallArgs, deps: CallDeps = {}): Promise<CallOutcome> {
  const treasuryId = requireTreasury(ctx);
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const method = (args.method ?? "POST").toUpperCase();
  const bad = await urlProblem(args.url, ctx.net.name, deps.resolve ?? defaultResolve);
  if (bad) throw new Error(`refusing to call ${args.url}: ${bad}`);
  const init: RequestInit = {
    method,
    // A redirect is never followed: it would take the request — and on the second leg the
    // payment header — to a host nobody checked.
    redirect: "manual",
    headers: { accept: "application/json", ...(args.body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(args.body !== undefined && method !== "GET" ? { body: JSON.stringify(args.body) } : {}),
  };

  const first = await fetchImpl(args.url, init);
  if (first.status !== 402) return { paid: false, status: first.status, body: await readBody(first) };

  const http = new x402HTTPClient(new x402Client());
  const firstBody = await readBody(first);
  const paymentRequired = http.getPaymentRequiredResponse((n) => first.headers.get(n), firstBody);

  // The rules, read from the chain once for this call.
  const client = deps.readClient ?? makeClient(ctx.net, treasuryId);
  const now = deps.now ?? ctx.now ?? (() => Math.floor(Date.now() / 1000));
  const snap = await readTreasury(client, treasuryId);
  const budget = computeBudget(snap, ctx.credential.agentPublicKey, now());
  const float = await (deps.floatBalance ?? (() => tokenBalance(ctx.net, snap.config.token, ctx.credential!.agentPublicKey)))();
  const approved = new Map<string, boolean>();
  for (const r of paymentRequired.accepts) {
    if (!approved.has(r.payTo)) approved.set(r.payTo, await isPayee(client, r.payTo).catch(() => false));
  }

  const options: OptionVerdict[] = paymentRequired.accepts.map((r) => {
    const problems: string[] = [];
    const amount = /^\d+$/.test(r.amount ?? "") ? BigInt(r.amount) : -1n;
    if (r.scheme !== "exact") problems.push(`scheme "${r.scheme}" is not "exact"`);
    if (r.network !== caip2(ctx.net.name)) problems.push(`network ${r.network} is not ${caip2(ctx.net.name)}`);
    if (r.asset !== snap.config.token) problems.push(`asset ${r.asset} is not the treasury's token`);
    if (amount <= 0n) problems.push(`amount "${r.amount}" is not a positive integer`);
    if (amount > args.maxPrice) problems.push(`price ${amount} is above maxPrice ${args.maxPrice}`);
    if (amount > snap.config.per_task_limit) problems.push(`price ${amount} is above the treasury's per-payment cap`);
    if (amount > float) problems.push(`price ${amount} is more than the float holds (${float}) — fund_float first`);
    if (!approved.get(r.payTo)) problems.push(`${r.payTo} is not a payee the treasury approves`);
    if (budget.taskPayees.length > 0 && !budget.taskPayees.includes(r.payTo)) {
      problems.push(`${r.payTo} is outside the task budget the owner approved`);
    }
    return { payTo: r.payTo, amount: r.amount, asset: r.asset, network: r.network, problems };
  });

  const acceptable = paymentRequired.accepts.filter((_, i) => options[i].problems.length === 0);
  if (acceptable.length === 0) {
    return {
      paid: false,
      status: 402,
      refused: true,
      options,
      message: "No payment option this service offers is inside the treasury's rules — nothing was signed.",
    };
  }
  // The cheapest acceptable option, and only that one, is handed to the signer.
  const chosen = acceptable.reduce((a, b) => (BigInt(b.amount) < BigInt(a.amount) ? b : a));

  const sign =
    deps.sign ??
    (async (pr: unknown, pick: PaymentRequirements) => {
      const signer = createEd25519Signer(ctx.credential!.agentSecret, caip2(ctx.net.name) as `${string}:${string}`);
      const payer = x402Client.fromConfig({
        schemes: [{ network: caip2(ctx.net.name) as `${string}:${string}`, client: new ExactStellarScheme(signer, { url: ctx.net.rpcUrl }) }],
        policies: [(_v, reqs) => reqs.filter((r) => keyOf(r as PaymentRequirements) === keyOf(pick))],
        // Our own checks above are stricter than the client's default USD cap, and the
        // treasury's token may not be one the client recognises.
        spendControls: false,
      });
      const httpPayer = new x402HTTPClient(payer);
      return httpPayer.encodePaymentSignatureHeader(await payer.createPaymentPayload(pr as never));
    });

  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await sign(paymentRequired, chosen as PaymentRequirements))) headers.set(k, v);
  const second = await fetchImpl(args.url, { ...init, headers });

  let txHash: string | undefined;
  try {
    const settled = http.getPaymentSettleResponse((n) => second.headers.get(n));
    txHash = settled.transaction || undefined;
  } catch {
    /* no PAYMENT-RESPONSE header: the service did not report a settlement */
  }
  return {
    paid: second.ok && txHash !== undefined,
    status: second.status,
    body: await readBody(second),
    amount: BigInt(chosen.amount),
    payTo: chosen.payTo,
    ...(txHash ? { txHash } : {}),
    options,
  };
}
