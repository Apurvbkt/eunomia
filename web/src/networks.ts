// Which Stellar network a build talks to, and everything that differs between the two.
//
// The network is chosen when the app is BUILT, not edited into source: `npm run build` is
// testnet, `npm run build:mainnet` is pubnet (vite.config.ts resolves it and injects the
// result). A mainnet cutover is therefore a different command, not a change to a file that
// also carries the demo's key.
//
// Dependency-free on purpose: vite.config.ts imports this in Node to validate the target
// before anything is bundled, and the app reads the same table at runtime.
import { TREASURY_FACTORY_ID, DEPOSIT_CAP_STROOPS } from "./lib/treasuryWasm";

export type NetworkName = "testnet" | "pubnet";

export interface NetworkConfig {
  name: NetworkName;
  /** what the UI calls it */
  label: "Testnet" | "Mainnet";
  passphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  explorer: string;
  /** the native XLM Stellar Asset Contract */
  xlmSac: string;
  /** the USDC a treasury may hold, and the classic issuer a G… payee must trust to receive it */
  usdcSac: string;
  usdcIssuer: string;
  /** the treasury factory and registry this app creates and finds treasuries through */
  factoryId: string;
  registryId: string;
  /** the deposit cap the factory pins on every treasury, in stroops (a string: it crosses JSON) */
  depositCap: string;
  /** any existing account: simulations need a source, and nothing is signed or sent from it */
  simulationSource: string;
}

export const TESTNET: NetworkConfig = {
  name: "testnet",
  label: "Testnet",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  explorer: "https://stellar.expert/explorer/testnet",
  xlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  // USDC of the TRY anchor sandbox (tr-mock-anchor.fly.dev), the only USDC a testnet
  // treasury can be funded with.
  usdcSac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  factoryId: TREASURY_FACTORY_ID,
  registryId: "CBEPVXK6BN2FZ3IYHV5KQUGROFHNBWBYHKHRZ5U3O7UWGIOPFOFE4ZE7",
  depositCap: DEPOSIT_CAP_STROOPS.toString(),
  // The demo treasury's admin, funded since the first testnet deploy.
  simulationSource: "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6",
};

/** Mainnet. The empty fields are not defaults: a build refuses to run until each is set,
 *  here once the contracts are deployed, or from the environment (EUNOMIA_RPC_URL,
 *  EUNOMIA_FACTORY_ID, EUNOMIA_REGISTRY_ID, EUNOMIA_DEPOSIT_CAP). */
export const PUBNET: NetworkConfig = {
  name: "pubnet",
  label: "Mainnet",
  passphrase: "Public Global Stellar Network ; September 2015",
  // A provider we trust, never a public default: the RPC's simulation decides what the
  // passkey is asked to sign over, and its latest ledger sets when that signature expires.
  rpcUrl: "",
  horizonUrl: "https://horizon.stellar.org",
  explorer: "https://stellar.expert/explorer/public",
  xlmSac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  // Circle's USDC.
  usdcSac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  factoryId: "",
  registryId: "",
  depositCap: "",
  // Circle's USDC issuer: an account that exists for as long as the USDC this app holds does.
  simulationSource: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const WHOLE_UNITS = /^[1-9][0-9]*$/;

/** The build's network from its environment. Throws, listing everything missing, rather than
 *  build a mainnet bundle with a hole in it. */
export function resolveNetwork(env: Record<string, string | undefined>): NetworkConfig {
  const pick = (k: string) => env[k]?.trim() || undefined;
  const name = pick("EUNOMIA_NETWORK") ?? "testnet";
  if (name === "testnet") return TESTNET;
  if (name !== "pubnet") throw new Error(`EUNOMIA_NETWORK "${name}" is unknown — testnet or pubnet.`);

  const cap = pick("EUNOMIA_DEPOSIT_CAP");
  const net: NetworkConfig = {
    ...PUBNET,
    rpcUrl: pick("EUNOMIA_RPC_URL") ?? PUBNET.rpcUrl,
    factoryId: pick("EUNOMIA_FACTORY_ID") ?? PUBNET.factoryId,
    registryId: pick("EUNOMIA_REGISTRY_ID") ?? PUBNET.registryId,
    depositCap: cap && WHOLE_UNITS.test(cap) ? (BigInt(cap) * 10_000_000n).toString() : PUBNET.depositCap,
  };

  const problems: string[] = [];
  if (!/^https:\/\/\S+$/.test(net.rpcUrl)) problems.push("EUNOMIA_RPC_URL: a trusted https RPC");
  if (/testnet/i.test(net.rpcUrl)) problems.push("EUNOMIA_RPC_URL: points at testnet");
  if (!CONTRACT_ID.test(net.factoryId)) problems.push("EUNOMIA_FACTORY_ID: the mainnet treasury factory (C…)");
  if (!CONTRACT_ID.test(net.registryId)) problems.push("EUNOMIA_REGISTRY_ID: the mainnet registry (C…)");
  if (net.factoryId === TESTNET.factoryId || net.registryId === TESTNET.registryId) {
    problems.push("a testnet contract id was given for mainnet");
  }
  if (cap !== undefined && !WHOLE_UNITS.test(cap)) problems.push(`EUNOMIA_DEPOSIT_CAP "${cap}": whole token units, above zero`);
  else if (!net.depositCap) problems.push("EUNOMIA_DEPOSIT_CAP: the cap the mainnet factory pins, in whole token units");
  if (problems.length) {
    throw new Error(`Refusing a mainnet build with missing or wrong settings:\n  ${problems.join("\n  ")}`);
  }
  return net;
}
