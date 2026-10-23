// The guided demo — testnet only. It drives one shared treasury with an agent key embedded
// in the bundle, so a visitor can watch an *autonomous* agent sign its own payments (no
// wallet popup): the whole point is that the contract, not a human click, is the safety.
//
// The key is a throwaway TESTNET key with no real value. That is only true on testnet, so
// this module is reachable from nothing but the demo view, and a mainnet build drops that
// view entirely (config.ts IS_TESTNET). Two independent checks keep it that way:
//   * the guard below refuses to load this module on any other network;
//   * `npm run check:no-secrets` reads the finished bundle and fails a mainnet build that
//     contains this key, any other secret seed, or the demo's addresses.
import {
  DEMO_STRANGER,
  DEMO_TREASURY_ID,
  DEMO_VENDOR,
  DEMO_VERIFIER_ID,
  IS_TESTNET,
  USDC_UNIT,
} from "../config";

if (!IS_TESTNET) {
  throw new Error(
    "Eunomia: the guided demo embeds a testnet-only agent key and cannot load on another network.",
  );
}

export const TREASURY_ID = DEMO_TREASURY_ID;
export const VERIFIER_ID = DEMO_VERIFIER_ID;
// Live on-chain compliance attestation — the verify() tx that emitted `attested`.
// Periods only move forward, so this one cannot be re-run; it is shown, not repeated.
export const ATTESTED_TX = "426e55d6ce0a9157c156190cee39dc2a1d302cf4c7f4f98cc930da5ad63b4606";
export const USDC_SAC = "CDCEHPK4OJXVRA4JV7N56GR5SRD5KGGZ55BDSHKODGR72Y4KGS6A3Y2W";

export const AGENT_PK = "GDAOXABLEOFZP2M4PRM7N6YKOKXWMPFOSLU35WL5ZQY4PQFHF3VCIDS6";
export const AGENT_SECRET = "SC6F5K7IPNX6MMN2JAV766FU7WKWYQ3M34W3MOLCPXTU55HSKS2BT2XV";

export const SERVICE = DEMO_VENDOR;
export const ATTACKER = DEMO_STRANGER;
// Funding pool — one classic G-account whose zero-cost muxed sub-addresses
// attribute incoming deposits to individual agent budgets (no memos, no new accounts).
export const POOL_PK = "GD2NZKSMQW367OIFXRM4NP7RIW6YLDZLJ4C7253MDOKCFC4Q4IOO3427";

// 8004 (trionlabs/stellar-8004) testnet registries — the agent trust layer.
export const REG_IDENTITY = "CDE3K4COIAGWNNJQQLL26SYI3KBJF5FUDHXG5FA6GYDJCG7T5V7FIWZH";
export const REG_REPUTATION = "CBZEAGIEI3HXMDRLF44KLQJQQOH6LCYWWSGJVSYQYQO2HQ6DDGZ7HT55";
export const AGENT_8004_ID = 1; // the agent is registered as #1 on testnet

export interface AgentTask {
  taskId: bigint;
  name: string;
  vendor: string;
  payee: string;
  amount: bigint;
}

// The legitimate jobs the autonomous agent runs (all within policy limits) — the
// real things an AI agent pays for: inference, data, and compute (pay-per-use).
export const TASKS: AgentTask[] = [
  { taskId: 101n, name: "LLM inference · 4.2M tokens", vendor: "Inference API", payee: SERVICE, amount: 3n * USDC_UNIT },
  { taskId: 102n, name: "Real-time market data", vendor: "Data feed", payee: SERVICE, amount: 2n * USDC_UNIT },
  { taskId: 103n, name: "GPU compute · 2.5 hrs", vendor: "Compute cloud", payee: SERVICE, amount: 4n * USDC_UNIT },
];

// The prompt-injection / rogue scenario: agent told to send funds to an unapproved wallet.
export const ROGUE: AgentTask = {
  taskId: 666n,
  name: "Drain to attacker wallet",
  vendor: "Unapproved wallet (prompt-injection)",
  payee: ATTACKER,
  amount: 5n * USDC_UNIT,
};

export interface Budget {
  id: bigint;
  name: string;
}

// Each budget is a zero-cost muxed sub-address of the same pool account.
export const BUDGETS: Budget[] = [
  { id: 1n, name: "Research agent" },
  { id: 2n, name: "Marketing agent" },
  { id: 3n, name: "Ops agent" },
];
