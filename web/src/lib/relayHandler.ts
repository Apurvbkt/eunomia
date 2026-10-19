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
// from configuration, and a rate limiter is required — on mainnet the fee is real money.
//
// Explicit .js extensions throughout: see the note in relayGuard.ts.
import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import { classifyHostFunction, hostFunctionFromEnvelope } from "./hostFunction.js";
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
}

/** Cloudflare's rate-limiting binding has this shape; anything with it will do. */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface RelayNetwork {
  name: "testnet" | "pubnet";
  passphrase: string;
  rpcUrl: string;
  /** contracts admitted by address */
  contracts: string[];
  /** whether a rate limiter must be present before anything is sponsored */
  requiresLimiter: boolean;
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

/** What this deployment sponsors, from its env. Throws on a configuration that cannot be safe. */
export function relayNetwork(env: RelayEnv): RelayNetwork {
  const name = clean(env.RELAY_NETWORK) || "testnet";
  const listed = csv(env.RELAY_ALLOWED_CONTRACTS);
  if (name === "testnet") {
    return {
      name,
      passphrase: "Test SDF Network ; September 2015",
      rpcUrl: clean(env.RELAY_RPC_URL) || "https://soroban-testnet.stellar.org",
      contracts: [...listed, TESTNET_NATIVE_SAC, TREASURY_FACTORY_ID, ...LEGACY_TREASURY_FACTORY_IDS],
      requiresLimiter: false,
    };
  }
  if (name === "pubnet") {
    const rpcUrl = clean(env.RELAY_RPC_URL);
    if (!rpcUrl) throw new Error("RELAY_RPC_URL is required on pubnet");
    const factory = clean(env.RELAY_FACTORY_ID);
    return {
      name,
      passphrase: "Public Global Stellar Network ; September 2015",
      rpcUrl,
      contracts: factory ? [...listed, factory] : listed,
      requiresLimiter: true,
    };
  }
  throw new Error(`unknown RELAY_NETWORK "${name}"`);
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

export async function handleRelay(req: Request, env: RelayEnv, limiter?: RateLimiter): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let net: RelayNetwork;
  try {
    net = relayNetwork(env);
  } catch (e) {
    console.error("relay misconfigured:", e instanceof Error ? e.message : String(e));
    return json({ error: "Relay is not configured." }, 503);
  }
  // Fails closed: a mainnet relay without a limiter would pay real fees for anyone, as fast
  // as they can ask.
  if (net.requiresLimiter && !limiter) return json({ error: "Relay is not configured." }, 503);
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

  const deps = { server: new rpc.Server(net.rpcUrl), keypair, networkPassphrase: net.passphrase };

  let entries: xdr.SorobanAuthorizationEntry[] = [];
  if (isFuncCall) {
    try {
      entries = (auth as string[]).map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64"));
    } catch {
      return json({ error: "Malformed request." }, 400);
    }
    if (!authEntriesAreSafe(entries, keypair.publicKey())) return json({ error: "Not allowed." }, 403);
  }

  try {
    const result = isFuncCall
      ? await submitHostFunction(deps, xdr.HostFunction.fromXDR(func as string, "base64"), entries)
      : await submitEnvelope(deps, envelope as string);
    return json({ hash: result.hash, status: result.status }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("relay failed:", msg);
    return json({ error: "Relay failed." }, 502);
  }
}
