// Eunomia — app configuration. Holds no secrets: everything here is public and every
// network-dependent value comes from the network the build was made for (see networks.ts).
// The guided demo's agent key lives in demo/config.ts, which only a testnet build includes.
import { TESTNET, type NetworkConfig } from "./networks";

// Injected by vite.config.ts (build-env.d.ts). Absent when this module is loaded outside Vite
// (Playwright config and specs), which only ever run against testnet.
const NET: NetworkConfig = typeof __EUNOMIA_NET__ === "undefined" ? TESTNET : __EUNOMIA_NET__;

/** Folds to a constant inside this module, so the testnet-only values below drop out of a
 *  mainnet bundle. The bundler does not carry that folding into other modules: anything
 *  there that must vanish from a mainnet build (a lazy chunk, a literal) is decided here, or
 *  tested against `__EUNOMIA_NETWORK__` directly, never against this. */
export const IS_TESTNET: boolean =
  (typeof __EUNOMIA_NETWORK__ === "undefined" ? "testnet" : __EUNOMIA_NETWORK__) === "testnet";

export const NETWORK_LABEL = NET.label;
export const NETWORK_PASSPHRASE = NET.passphrase;
export const RPC_URL = NET.rpcUrl;
export const HORIZON_URL = NET.horizonUrl;
export const EXPLORER = NET.explorer;

/** The native XLM SAC — the token an XLM treasury holds and spends. */
export const XLM_SAC = NET.xlmSac;
/** The USDC SAC a USDC treasury holds, and its classic issuer. */
export const USDC_TOKEN = NET.usdcSac;
export const USDC_ISSUER = NET.usdcIssuer;

/** The treasury factory: one owner signature deploys a treasury with its policy, payees,
 *  Leash, funding and registry entry. */
export const FACTORY_ID = NET.factoryId;
/** The deposit cap the factory above pins on every treasury. Mirrored only so the app can
 *  say so before the owner signs; the contract is what enforces it. */
export const DEPOSIT_CAP_STROOPS = BigInt(NET.depositCap);

// Eunomia Treasury Registry — permissionless wallet → treasury discovery index,
// used for cross-device recovery of per-user treasuries.
export const REGISTRY_ID = NET.registryId;

/** Source account for read-only simulations. Nothing is ever signed or sent from it. */
export const SIMULATION_SOURCE = NET.simulationSource;

// --- Testnet fixtures ---------------------------------------------------------------
// Public addresses the guided demo and the testnet onboarding run on. Addresses only.
export const DEMO_TREASURY_ID = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
// ZK compliance verifier. Multi-tenant: it holds no policy of its own and re-reads every
// claim — limits, payee root, and the period's actual total — from the treasury named in
// the call, which is what makes an attestation mean something. Emits `attested`.
// 2026-08-07: rebuilt for the 16-slot batch (21 public signals). Proofs are not portable
// across this change — the previous verifier CCZKA3K4… expects 13 and rejects them.
export const DEMO_VERIFIER_ID = "CD3TB3F4VQF2H56IQC4KV3YLA6QRIF272W5D6PK2SWVTYPXHS4NFDYZ3";
export const DEMO_VENDOR = "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT";
export const DEMO_STRANGER = "GAKSMBN6TRMF4M4PL3FJSDMQRD6XBQCJFLECLYTNAXZYMRIWXT6ADYTC";

/** A payee a new owner can try a payment against. Testnet only: on mainnet a "sample
 *  vendor" would be someone's real address receiving real money. */
export const SAMPLE_VENDOR: string | null = IS_TESTNET ? DEMO_VENDOR : null;
/** An address the agent loop tries to pay so the contract can refuse it. On mainnet the loop
 *  uses a fresh key instead, which is certainly on no one's payee list. */
export const SAMPLE_STRANGER: string | null = IS_TESTNET ? DEMO_STRANGER : null;
/** Contracts the public activity feed follows besides the user's own treasury. */
export const DEMO_CONTRACTS: string[] = IS_TESTNET ? [DEMO_TREASURY_ID, DEMO_VERIFIER_ID] : [];
/** The contracts the landing footer lists for anyone who wants to check the chain. */
export const LISTED_CONTRACTS: { label: string; id: string }[] = IS_TESTNET
  ? [
      { label: "Treasury contract", id: DEMO_TREASURY_ID },
      { label: "Proof verifier", id: DEMO_VERIFIER_ID },
      { label: "Treasury registry", id: NET.registryId },
    ]
  : [
      { label: "Treasury factory", id: NET.factoryId },
      { label: "Treasury registry", id: NET.registryId },
    ];

// --- Passkey (smart wallet) --------------------------------------------------------
// The smart-wallet WASM passkey-kit deploys for each new passkey user. The same code is
// installed on testnet and mainnet.
export const WALLET_WASM_HASH =
  "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0";
// WebAuthn Relying Party id. A passkey is bound to this domain: change it and every passkey
// created before the change stops resolving. Left undefined in dev so the kit falls back to
// the current origin (localhost), which is the only value that works there.
// Read defensively: this module is also loaded outside Vite (Playwright config), where
// import.meta.env does not exist at all.
const IS_PROD = (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;
export const RP_ID: string | undefined = IS_PROD ? "eunomia.finance" : undefined;

export const USDC_UNIT = 10_000_000n; // 1 USDC (7 decimals)

export function fmtUSDC(stroops: bigint, maxFrac = 2): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const whole = v / USDC_UNIT;
  const frac = v % USDC_UNIT;
  const fracStr = frac.toString().padStart(7, "0").slice(0, maxFrac).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + wholeStr + (fracStr ? "." + fracStr : "");
}

/** XLM and USDC are both 7-decimal; fmtUSDC is pure math, so reuse it and label XLM. */
export const fmtXlm = (stroops: bigint) => fmtUSDC(stroops, 4);

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

export function contractUrl(id: string): string {
  return `${EXPLORER}/contract/${id}`;
}
