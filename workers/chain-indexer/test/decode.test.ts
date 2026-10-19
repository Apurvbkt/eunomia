import { describe, expect, it } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-base";
import { toEventRow, toRegistration, type RpcEvent } from "../src/decode";

const OWNER = "GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA";
const TREASURY = "CADUYW6CJ7QYEL5QMFT43YBOT2QJ2LBEA34UYHJYMHWQQUNUADGNP7QO";
const b64 = (v: xdr.ScVal) => v.toXDR("base64");
const sym = (s: string) => b64(xdr.ScVal.scvSymbol(s));
const addr = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

const event = (topic: string[], value: xdr.ScVal): RpcEvent => ({
  id: "0021794416406605824-0000000000",
  ledger: 5074408,
  ledgerClosedAt: "2026-10-09T10:00:00Z",
  txHash: "9d8e",
  contractId: TREASURY,
  topic,
  value: b64(value),
});

describe("toRegistration", () => {
  it("reads (regd, owner) -> treasury", () => {
    const r = toRegistration(event([sym("regd"), b64(addr(OWNER))], addr(TREASURY)), "testnet");
    expect(r).toEqual({
      network: "testnet",
      treasury_id: TREASURY,
      owner: OWNER,
      registered_at: "2026-10-09T10:00:00Z",
    });
  });

  it("ignores other registry topics", () => {
    expect(toRegistration(event([sym("other")], addr(TREASURY)), "testnet")).toBeNull();
  });
});

describe("toEventRow", () => {
  it("paid: (paid, task_id) -> (to, amount)", () => {
    const value = xdr.ScVal.scvVec([addr(OWNER), i128(50_000_000n)]);
    const row = toEventRow(event([sym("paid"), b64(nativeToScVal(7n, { type: "u64" }))], value), "testnet");
    expect(row).toMatchObject({ kind: "paid", counterparty: OWNER, amount: "50000000", contract_id: TREASURY });
  });

  it("session: (agent, valid_until, limit) keeps the agent and the limit", () => {
    const value = xdr.ScVal.scvVec([addr(OWNER), nativeToScVal(123n, { type: "u64" }), i128(10_000_000n)]);
    expect(toEventRow(event([sym("session")], value), "testnet")).toMatchObject({
      kind: "session",
      counterparty: OWNER,
      amount: "10000000",
    });
  });

  it("payee_add: a bare address payload", () => {
    expect(toEventRow(event([sym("payee_add")], addr(OWNER)), "testnet")).toMatchObject({
      kind: "payee_add",
      counterparty: OWNER,
      amount: null,
    });
  });

  it("v4 deposit: (deposit, from) -> amount", () => {
    expect(toEventRow(event([sym("deposit"), b64(addr(OWNER))], i128(250_000_000n)), "testnet")).toMatchObject({
      kind: "deposit",
      counterparty: OWNER,
      amount: "250000000",
    });
  });

  it("v4 payee_cap and monthly carry their limit as the amount", () => {
    expect(toEventRow(event([sym("payee_cap"), b64(addr(OWNER))], i128(9n)), "testnet")).toMatchObject({
      kind: "payee_cap",
      counterparty: OWNER,
      amount: "9",
    });
    expect(toEventRow(event([sym("monthly")], i128(7n)), "testnet")).toMatchObject({
      kind: "monthly",
      counterparty: null,
      amount: "7",
    });
  });

  it("v4 budget: (budget, agent) -> (valid_until, limit, payees) keeps the agent and the cap", () => {
    const value = xdr.ScVal.scvVec([
      nativeToScVal(1_800_000_000n, { type: "u64" }),
      i128(30_000_000n),
      xdr.ScVal.scvVec([addr(TREASURY)]),
    ]);
    expect(toEventRow(event([sym("budget"), b64(addr(OWNER))], value), "testnet")).toMatchObject({
      kind: "budget",
      counterparty: OWNER,
      amount: "30000000",
    });
  });

  it("paused: no counterparty, no amount", () => {
    expect(toEventRow(event([sym("paused")], xdr.ScVal.scvBool(true)), "testnet")).toMatchObject({
      kind: "paused",
      counterparty: null,
      amount: null,
    });
  });
});
