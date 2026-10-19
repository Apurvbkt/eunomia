import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { clientKey, handleRelay, relayNetwork } from "./relayHandler";
import { TREASURY_FACTORY_ID } from "./treasuryWasm";

const TESTNET_NATIVE = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const MAINNET_NATIVE = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const FACTORY = "CAP7SNLZZT6VGC7ULSBTGPIGTC5EBAFSDMA37YFYTIROJUTIYXTMANFK";

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
    const n = relayNetwork({ RELAY_NETWORK: "pubnet", RELAY_RPC_URL: "https://rpc.example", RELAY_FACTORY_ID: FACTORY });
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

  it("turns a caller away once the limiter says so, keyed by their address", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const res = await handleRelay(post({ func: "x", auth: [] }, { "cf-connecting-ip": "203.0.113.7" }), { RELAY_SECRET: secret }, { limit });
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
