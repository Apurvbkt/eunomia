import { describe, expect, it, vi } from "vitest";
import { Address, Contract, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { clientKey, feeGate, handleRelay, Refused, relayNetwork, xlmEnv } from "./relayHandler";
import { TREASURY_FACTORY_ID } from "./treasuryWasm";

const TESTNET_NATIVE = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const MAINNET_NATIVE = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const FACTORY = "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK";
const WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";

/** A testnet XLM transfer out of WALLET: admitted by address, no network needed to classify. */
const sacTransfer = () =>
  new Contract(TESTNET_NATIVE)
    .call("transfer", new Address(WALLET).toScVal(), new Address(FACTORY).toScVal(), nativeToScVal(1n, { type: "i128" }))
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .toXDR("base64");

const walletEntry = () =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(WALLET).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(TESTNET_NATIVE).toScAddress(), functionName: "transfer", args: [] }),
      ),
      subInvocations: [],
    }),
  }).toXDR("base64");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://eunomia.finance/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("relayNetwork", () => {
  it("defaults to testnet, which sponsors native XLM moves and our factory", () => {
    const n = relayNetwork({});
    expect(n.name).toBe("testnet");
    expect(n.contracts).toContain(TESTNET_NATIVE);
    expect(n.contracts).toContain(TREASURY_FACTORY_ID);
    expect(n.requiresLimiter).toBe(false);
  });

  it("on pubnet admits only the configured factory and never native XLM", () => {
    const n = relayNetwork({
      RELAY_NETWORK: "pubnet",
      RELAY_RPC_URL: "https://rpc.example",
      RELAY_FACTORY_ID: FACTORY,
      RELAY_DAILY_BUDGET_XLM: "50",
    });
    expect(n.passphrase).toMatch(/^Public Global/);
    expect(n.contracts).toEqual([FACTORY]);
    expect(n.contracts).not.toContain(MAINNET_NATIVE);
    expect(n.contracts).not.toContain(TESTNET_NATIVE);
    expect(n.requiresLimiter).toBe(true);
  });

  it("refuses a pubnet relay with no RPC and an unknown network", () => {
    expect(() => relayNetwork({ RELAY_NETWORK: "pubnet" })).toThrow(/RELAY_RPC_URL/);
    expect(() => relayNetwork({ RELAY_NETWORK: "futurenet" })).toThrow(/unknown/);
  });

  it("refuses a pubnet relay with no daily budget, and keeps a floor under the fee account", () => {
    const base = { RELAY_NETWORK: "pubnet", RELAY_RPC_URL: "https://rpc.example" };
    expect(() => relayNetwork(base)).toThrow(/RELAY_DAILY_BUDGET_XLM/);
    const n = relayNetwork({ ...base, RELAY_DAILY_BUDGET_XLM: "50" });
    expect(n.dailyBudget).toBe(500_000_000n);
    expect(n.minBalance).toBe(50_000_000n);
    expect(n.maxTxFee).toBe(10_000_000n);
  });
});

describe("xlmEnv", () => {
  it("reads XLM to the stroop and falls back only when unset", () => {
    expect(xlmEnv("X", "12.5", null)).toBe(125_000_000n);
    expect(xlmEnv("X", "0.0000001", null)).toBe(1n);
    expect(xlmEnv("X", undefined, 7n)).toBe(7n);
    expect(xlmEnv("X", " ​", 7n)).toBe(7n);
  });

  it("throws on a typo or zero rather than reading it as no limit", () => {
    expect(() => xlmEnv("X", "50 XLM", null)).toThrow(/not an XLM amount/);
    expect(() => xlmEnv("X", "-5", null)).toThrow(/not an XLM amount/);
    expect(() => xlmEnv("X", "1.12345678", null)).toThrow(/not an XLM amount/);
    expect(() => xlmEnv("X", "0", null)).toThrow(/above zero/);
  });
});

describe("feeGate", () => {
  const net = { maxTxFee: 10_000_000n, minBalance: 50_000_000n, dailyBudget: 500_000_000n };

  it("lets a priced transaction through and charges it to the day", async () => {
    const budget = { reserve: vi.fn().mockResolvedValue(true) };
    await expect(feeGate(net, budget, async () => 100_000_000n)(4_200_000n)).resolves.toBeUndefined();
    expect(budget.reserve).toHaveBeenCalledWith(4_200_000n, 500_000_000n);
  });

  it("refuses a transaction dearer than one call should be, before touching anything", async () => {
    const budget = { reserve: vi.fn() };
    const balance = vi.fn();
    await expect(feeGate(net, budget, balance)(10_000_001n)).rejects.toMatchObject({ status: 403 });
    expect(balance).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it("stops at the floor without spending budget", async () => {
    const budget = { reserve: vi.fn() };
    await expect(feeGate(net, budget, async () => 52_000_000n)(4_200_000n)).rejects.toBeInstanceOf(Refused);
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it("stops when the day's budget is spent, or the counter cannot be reached", async () => {
    await expect(
      feeGate(net, { reserve: vi.fn().mockResolvedValue(false) }, async () => 100_000_000n)(1n),
    ).rejects.toMatchObject({ status: 503 });
    await expect(feeGate(net, undefined, async () => 100_000_000n)(1n)).rejects.toMatchObject({ status: 503 });
  });

  it("on testnet with no budget configured, checks only the per-call cap", async () => {
    const gate = feeGate({ maxTxFee: 10_000_000n, minBalance: 0n, dailyBudget: null }, undefined, vi.fn());
    await expect(gate(4_200_000n)).resolves.toBeUndefined();
  });
});

describe("handleRelay gates before it spends", () => {
  const secret = Keypair.random().secret();

  it("answers only POST", async () => {
    const res = await handleRelay(new Request("https://x/api/relay"), { DISPENSER_SECRET: secret });
    expect(res.status).toBe(405);
  });

  it("will not run on pubnet without a rate limiter", async () => {
    const env = { RELAY_NETWORK: "pubnet", RELAY_RPC_URL: "https://rpc.example", RELAY_SECRET: secret };
    expect((await handleRelay(post({ func: "x", auth: [] }), env)).status).toBe(503);
  });

  it("will not run on pubnet without the wallet limiter and the daily budget (M2)", async () => {
    const env = {
      RELAY_NETWORK: "pubnet",
      RELAY_RPC_URL: "https://rpc.example",
      RELAY_DAILY_BUDGET_XLM: "50",
      RELAY_SECRET: secret,
    };
    const ok = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const budget = { reserve: vi.fn().mockResolvedValue(true) };
    expect((await handleRelay(post({ func: "x", auth: [] }), env, { limiter: ok, budget })).status).toBe(503);
    expect((await handleRelay(post({ func: "x", auth: [] }), env, { limiter: ok, walletLimiter: ok })).status).toBe(503);
    // With all three it gets as far as admission, which refuses this garbage host function.
    expect((await handleRelay(post({ func: "AAAA", auth: [] }), env, { limiter: ok, walletLimiter: ok, budget })).status).toBe(403);
  });

  it("will not run with a daily budget configured but no counter to hold it", async () => {
    const env = { RELAY_DAILY_BUDGET_XLM: "50", RELAY_SECRET: secret };
    expect((await handleRelay(post({ func: "AAAA", auth: [] }), env)).status).toBe(503);
  });

  it("turns a wallet away once its own limit is reached, whatever IP it asks from", async () => {
    const walletLimit = vi.fn().mockResolvedValue({ success: false });
    const res = await handleRelay(post({ func: sacTransfer(), auth: [walletEntry()] }), { RELAY_SECRET: secret }, {
      walletLimiter: { limit: walletLimit },
    });
    expect(res.status).toBe(429);
    expect(walletLimit).toHaveBeenCalledWith({ key: WALLET });
  });

  it("turns a caller away once the limiter says so, keyed by their address", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const res = await handleRelay(post({ func: "x", auth: [] }, { "cf-connecting-ip": "203.0.113.7" }), { RELAY_SECRET: secret }, { limiter: { limit } });
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("says it is unconfigured without a fee key, and rejects malformed bodies", async () => {
    expect((await handleRelay(post({ func: "x", auth: [] }), {})).status).toBe(503);
    expect((await handleRelay(post({ nope: 1 }), { RELAY_SECRET: secret })).status).toBe(400);
  });

  it("refuses a host function it cannot classify, without touching the network", async () => {
    const res = await handleRelay(post({ func: "AAAA", auth: [] }), { RELAY_SECRET: secret });
    expect(res.status).toBe(403);
  });
});

describe("clientKey", () => {
  it("prefers the edge's own header over anything the client could forward", () => {
    const req = new Request("https://x", { headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 8.8.8.8" } });
    expect(clientKey(req)).toBe("1.1.1.1");
    expect(clientKey(new Request("https://x", { headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8" } }))).toBe("9.9.9.9");
  });
});
