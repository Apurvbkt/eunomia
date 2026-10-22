// Fee sponsorship for passkey users, independent of where it is hosted. Vercel's api/relay.ts
// and the Cloudflare Pages function both call handleRelay with their own env; nothing in here
// reads process.env or any platform global.
//
// A smart wallet holds no XLM, so somebody else has to source the transaction. This does
// that — and nothing more. Authorisation stays with the user: the auth entries are signed by
// their passkey and bound to their wallet's address, so the account paying the fee has no
// say over what the transaction may do. The URL is public, so every request is admitted only
// after the server decodes what the call actually is; a caller's claim is never trusted.
//
// Mainnet differs from testnet in what it will pay for, not in how: no native-XLM transfers
// (a v4 treasury is funded through its own `deposit`, admitted by wasm), the factory comes
// from configuration, and the limiters and a daily fee budget are required — on mainnet the
// fee is real money. Every transaction is priced before it is sent and refused when it costs
// more than one call should, would take the day past its budget, or would leave the fee
// account below its floor.
//
// Explicit .js extensions throughout: see the note in relayGuard.ts.
import { Address, Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import { classifyHostFunction, hostFunctionFromEnvelope } from "./hostFunction.js";
import type { FeeBudget } from "./relayBudget.js";
import { allowedWasmHashes, authEntriesAreSafe, isRelayAllowed } from "./relayGuard.js";
import { submitEnvelope, submitHostFunction } from "./relaySubmit.js";
import { LEGACY_TREASURY_FACTORY_IDS, TREASURY_FACTORY_ID, TREASURY_WASM_HASH } from "./treasuryWasm.js";

export interface RelayEnv {
  /** testnet (default) | pubnet */
  RELAY_NETWORK?: string;
  /** the fee account; on testnet the faucet's dispenser key doubles as it */
  RELAY_SECRET?: string;
  DISPENSER_SECRET?: string;
  RELAY_RPC_URL?: string;
  RELAY_ALLOWED_CONTRACTS?: string;
  RELAY_ALLOWED_WASM?: string;
  /** pubnet: the treasury factory to admit (testnet's is built in) */
  RELAY_FACTORY_ID?: string;
  /** the most the relay spends on fees in one UTC day, in XLM; required on pubnet */
  RELAY_DAILY_BUDGET_XLM?: string;
  /** the most one transaction may cost, in XLM (default 1) */
  RELAY_MAX_FEE_XLM?: string;
  /** below this balance the fee account stops sponsoring, in XLM (pubnet default 5) */
  RELAY_MIN_BALANCE_XLM?: string;
}

/** Cloudflare's rate-limiting binding has this shape; anything with it will do. */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** What the host wires in around the handler. On pubnet all three are required. */
export interface RelayGuards {
  /** per client IP */
  limiter?: RateLimiter;
  /** per wallet: an IP is cheap to change, the wallet that signed is not hidden by it */
  walletLimiter?: RateLimiter;
  /** the day's total, shared by every instance */
  budget?: FeeBudget;
}

export interface RelayNetwork {
  name: "testnet" | "pubnet";
  passphrase: string;
  rpcUrl: string;
  /** contracts admitted by address */
  contracts: string[];
  /** whether the limiters and the budget must be present before anything is sponsored */
  requiresLimiter: boolean;
  /** stroops; null means no daily total (testnet only) */
  dailyBudget: bigint | null;
  /** stroops */
  maxTxFee: bigint;
  /** stroops; 0 means no floor */
  minBalance: bigint;
}

// Invisible characters smuggled into an env value have bitten this project twice (a BOM in
// the Supabase key, a BOM+CRLF in the WalletConnect id) — both times the symptom was a silent
// failure far from the cause. Strip anything non-printable before use; .trim() alone misses
// zero-width characters.
export const clean = (v: string | undefined): string => (v ?? "").replace(/[^\x20-\x7E]/g, "").trim();

const csv = (v: string | undefined): string[] =>
  clean(v).split(",").map((s) => s.trim()).filter(Boolean);

// The native XLM SAC on testnet. This is not configuration: a testnet treasury holds XLM, and
// both funding one and paying out of it are SAC calls, so a passkey session cannot do anything
// at all unless the relay admits it. The transfer's `from` is the user's own wallet and only
// their passkey can authorise it, so the worst a stranger can do is spend our testnet fee on
// moving their own funds.
const TESTNET_NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** An XLM amount from env as stroops; `fallback` when unset. Throws on anything that is not
 *  a plain positive decimal — a typo in a spending limit must not read as "no limit". */
export function xlmEnv(name: string, v: string | undefined, fallback: bigint | null): bigint | null {
  const s = clean(v);
  if (!s) return fallback;
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(s);
  if (!m) throw new Error(`${name} is not an XLM amount: "${s}"`);
  const stroops = BigInt(m[1]) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0"));
  if (stroops <= 0n) throw new Error(`${name} must be above zero`);
  return stroops;
}

const XLM = 10_000_000n;

/** What this deployment sponsors, from its env. Throws on a configuration that cannot be safe. */
export function relayNetwork(env: RelayEnv): RelayNetwork {
  const name = clean(env.RELAY_NETWORK) || "testnet";
  const listed = csv(env.RELAY_ALLOWED_CONTRACTS);
  // A factory create measures about 0.32 XLM of resource fee on testnet (0.42 padded); 1 XLM
  // leaves room for that and refuses anything an order of magnitude dearer.
  const maxTxFee = xlmEnv("RELAY_MAX_FEE_XLM", env.RELAY_MAX_FEE_XLM, XLM) as bigint;
  if (name === "testnet") {
    return {
      name,
      passphrase: "Test SDF Network ; September 2015",
      rpcUrl: clean(env.RELAY_RPC_URL) || "https://soroban-testnet.stellar.org",
      contracts: [...listed, TESTNET_NATIVE_SAC, TREASURY_FACTORY_ID, ...LEGACY_TREASURY_FACTORY_IDS],
      requiresLimiter: false,
      dailyBudget: xlmEnv("RELAY_DAILY_BUDGET_XLM", env.RELAY_DAILY_BUDGET_XLM, null),
      maxTxFee,
      minBalance: xlmEnv("RELAY_MIN_BALANCE_XLM", env.RELAY_MIN_BALANCE_XLM, null) ?? 0n,
    };
  }
  if (name === "pubnet") {
    const rpcUrl = clean(env.RELAY_RPC_URL);
    if (!rpcUrl) throw new Error("RELAY_RPC_URL is required on pubnet");
    const dailyBudget = xlmEnv("RELAY_DAILY_BUDGET_XLM", env.RELAY_DAILY_BUDGET_XLM, null);
    if (dailyBudget === null) throw new Error("RELAY_DAILY_BUDGET_XLM is required on pubnet");
    const factory = clean(env.RELAY_FACTORY_ID);
    return {
      name,
      passphrase: "Public Global Stellar Network ; September 2015",
      rpcUrl,
      contracts: factory ? [...listed, factory] : listed,
      requiresLimiter: true,
      dailyBudget,
      maxTxFee,
      minBalance: xlmEnv("RELAY_MIN_BALANCE_XLM", env.RELAY_MIN_BALANCE_XLM, 5n * XLM) as bigint,
    };
  }
  throw new Error(`unknown RELAY_NETWORK "${name}"`);
}

/** Why the relay will not pay for this one, as the caller should hear it. */
export class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every limit on money, checked against the priced transaction just before it is sent: the
 *  per-call cap first (free), then the fee account's floor, and the day's budget last, so a
 *  refusal on the way never spends budget. */
export function feeGate(
  net: Pick<RelayNetwork, "maxTxFee" | "minBalance" | "dailyBudget">,
  budget: FeeBudget | undefined,
  balance: () => Promise<bigint>,
): (stroops: bigint) => Promise<void> {
  return async (stroops) => {
    if (stroops > net.maxTxFee) {
      console.error(`[relay] refused a ${stroops}-stroop transaction (cap ${net.maxTxFee})`);
      throw new Refused(403, "Not allowed.");
    }
    if (net.minBalance > 0n) {
      const held = await balance();
      if (held - stroops < net.minBalance) {
        // The line to alert on: sponsorship is off until the account is topped up.
        console.error(`[relay] fee account below floor: ${held} stroops (floor ${net.minBalance})`);
        throw new Refused(503, "The relay is paused. Try again later.");
      }
    }
    if (net.dailyBudget !== null) {
      if (!budget || !(await budget.reserve(stroops, net.dailyBudget))) {
        console.error(`[relay] daily budget reached (${net.dailyBudget} stroops)`);
        throw new Refused(503, "The relay has reached today's limit. Try again tomorrow.");
      }
    }
  };
}

/** The addresses a call's auth entries sign as — on the func path, the wallets asking. */
function signingAddresses(entries: xdr.SorobanAuthorizationEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const c = e.credentials();
    const a = c.switch().name === "sorobanCredentialsAddress" ? c.address() : c.addressV2();
    out.add(Address.fromScAddress(a.address()).toString());
  }
  return [...out];
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The caller, as far as the edge can tell — the key requests are rate-limited by. */
export function clientKey(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function handleRelay(req: Request, env: RelayEnv, guards: RelayGuards = {}): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const { limiter, walletLimiter, budget } = guards;

  let net: RelayNetwork;
  try {
    net = relayNetwork(env);
  } catch (e) {
    console.error("relay misconfigured:", e instanceof Error ? e.message : String(e));
    return json({ error: "Relay is not configured." }, 503);
  }
  // Fails closed: a mainnet relay without its limiters and its daily total would pay real
  // fees for anyone, as fast and as often as they can ask.
  if (net.requiresLimiter && !(limiter && walletLimiter && budget)) {
    return json({ error: "Relay is not configured." }, 503);
  }
  if (net.dailyBudget !== null && !budget) return json({ error: "Relay is not configured." }, 503);
  if (limiter && !(await limiter.limit({ key: clientKey(req) })).success) {
    return json({ error: "Too many requests — wait a minute and try again." }, 429);
  }

  const secret = clean(env.RELAY_SECRET) || clean(env.DISPENSER_SECRET);
  let keypair: Keypair | null = null;
  try {
    if (secret) keypair = Keypair.fromSecret(secret);
  } catch {
    keypair = null;
  }
  if (!keypair) return json({ error: "Relay is not configured." }, 503);

  let body: { func?: unknown; auth?: unknown; xdr?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Malformed request." }, 400);
  }
  const { func, auth, xdr: envelope } = body;

  // Two shapes reach the relay. Treasury calls arrive decoded (func + auth entries), while
  // passkey-kit's wallet deployment arrives as a fully signed envelope. Both go through the
  // same admission gate — the envelope's host function is read out of it first.
  const isFuncCall =
    typeof func === "string" && Array.isArray(auth) && auth.every((a) => typeof a === "string");
  const isEnvelope = typeof envelope === "string" && envelope.length > 0;
  if (!isFuncCall && !isEnvelope) return json({ error: "Malformed request." }, 400);

  // Testnet carries every treasury version this app ever deployed there; mainnet starts at v4
  // and admits exactly what its env names besides it — no testnet-era code.
  const wasmHashes =
    net.name === "pubnet"
      ? [...new Set([...csv(env.RELAY_ALLOWED_WASM), TREASURY_WASM_HASH])]
      : allowedWasmHashes(clean(env.RELAY_ALLOWED_WASM));
  const readWasmHash = async (contractId: string): Promise<string | null> => {
    const entry = await new rpc.Server(net.rpcUrl).getContractData(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance(),
      rpc.Durability.Persistent,
    );
    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch().name !== "contractExecutableWasm") return null;
    return executable.wasmHash().toString("hex");
  };
  const admit = async (hostFunction: string): Promise<boolean> => {
    const call = classifyHostFunction(hostFunction);
    if (call.kind === "invoke") {
      return isRelayAllowed(call.contractId, { contracts: net.contracts, wasmHashes, readWasmHash });
    }
    if (call.kind === "deploy") {
      const seen = call.wasmHash.toLowerCase();
      return wasmHashes.some((h) => h.toLowerCase() === seen);
    }
    return false; // raw wasm uploads and anything unrecognised
  };

  const gated = isFuncCall ? (func as string) : hostFunctionFromEnvelope(envelope as string);
  if (!gated || !(await admit(gated))) return json({ error: "Not allowed." }, 403);

  let entries: xdr.SorobanAuthorizationEntry[] = [];
  if (isFuncCall) {
    try {
      entries = (auth as string[]).map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
    } catch {
      return json({ error: "Malformed request." }, 400);
    }
    if (!authEntriesAreSafe(entries, keypair.publicKey())) return json({ error: "Not allowed." }, 403);
    // A wallet asking from many addresses is still one wallet. The envelope path (creating a
    // wallet) has no wallet yet to key on; the IP limiter and the daily total cover it.
    if (walletLimiter) {
      for (const wallet of signingAddresses(entries)) {
        if (!(await walletLimiter.limit({ key: wallet })).success) {
          return json({ error: "Too many requests — wait a minute and try again." }, 429);
        }
      }
    }
  }

  const server = new rpc.Server(net.rpcUrl);
  const feeAccount = keypair.publicKey();
  const charge = feeGate(net, budget, async () =>
    BigInt((await server.getAccountEntry(feeAccount)).balance().toString()),
  );
  const deps = { server, keypair, networkPassphrase: net.passphrase, charge };

  try {
    const result = isFuncCall
      ? await submitHostFunction(deps, xdr.HostFunction.fromXDR(func as string, "base64"), entries)
      : await submitEnvelope(deps, envelope as string);
    return json({ hash: result.hash, status: result.status }, 200);
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("relay failed:", msg);
    return json({ error: "Relay failed." }, 502);
  }
}
