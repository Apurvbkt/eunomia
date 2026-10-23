import { describe, expect, it } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { PUBNET, TESTNET, resolveNetwork } from "./networks";

const FACTORY = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const REGISTRY = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const MAINNET = {
  EUNOMIA_NETWORK: "pubnet",
  EUNOMIA_RPC_URL: "https://rpc.example.com",
  EUNOMIA_FACTORY_ID: FACTORY,
  EUNOMIA_REGISTRY_ID: REGISTRY,
  EUNOMIA_DEPOSIT_CAP: "100",
};

describe("the network tables", () => {
  it("pin each SAC to what its asset derives on that network", () => {
    // A wrong id here is a treasury created over a token nobody holds.
    expect(Asset.native().contractId(Networks.TESTNET)).toBe(TESTNET.xlmSac);
    expect(Asset.native().contractId(Networks.PUBLIC)).toBe(PUBNET.xlmSac);
    expect(new Asset("USDC", TESTNET.usdcIssuer).contractId(Networks.TESTNET)).toBe(TESTNET.usdcSac);
    expect(new Asset("USDC", PUBNET.usdcIssuer).contractId(Networks.PUBLIC)).toBe(PUBNET.usdcSac);
  });

  it("carry the passphrase the SDK knows each network by", () => {
    expect(TESTNET.passphrase).toBe(Networks.TESTNET);
    expect(PUBNET.passphrase).toBe(Networks.PUBLIC);
  });
});

describe("resolveNetwork", () => {
  it("builds for testnet unless told otherwise", () => {
    expect(resolveNetwork({})).toBe(TESTNET);
    expect(resolveNetwork({ EUNOMIA_NETWORK: " testnet " })).toBe(TESTNET);
  });

  it("refuses a network it does not know", () => {
    expect(() => resolveNetwork({ EUNOMIA_NETWORK: "mainnet" })).toThrow(/unknown/);
  });

  it("refuses a mainnet build with nothing set, naming every missing piece", () => {
    let message = "";
    try {
      resolveNetwork({ EUNOMIA_NETWORK: "pubnet" });
    } catch (e) {
      message = (e as Error).message;
    }
    for (const k of ["EUNOMIA_RPC_URL", "EUNOMIA_FACTORY_ID", "EUNOMIA_REGISTRY_ID", "EUNOMIA_DEPOSIT_CAP"]) {
      expect(message).toContain(k);
    }
  });

  it("takes the mainnet settings from the environment, the cap in whole units", () => {
    const net = resolveNetwork(MAINNET);
    expect(net.name).toBe("pubnet");
    expect(net.passphrase).toBe(Networks.PUBLIC);
    expect(net.rpcUrl).toBe("https://rpc.example.com");
    expect(net.factoryId).toBe(FACTORY);
    expect(net.registryId).toBe(REGISTRY);
    expect(net.depositCap).toBe("1000000000");
  });

  it("will not point a mainnet build at testnet", () => {
    expect(() => resolveNetwork({ ...MAINNET, EUNOMIA_RPC_URL: "https://soroban-testnet.stellar.org" })).toThrow(/testnet/);
    expect(() => resolveNetwork({ ...MAINNET, EUNOMIA_FACTORY_ID: TESTNET.factoryId })).toThrow(/testnet contract id/);
    expect(() => resolveNetwork({ ...MAINNET, EUNOMIA_REGISTRY_ID: TESTNET.registryId })).toThrow(/testnet contract id/);
  });

  it("refuses a plain-http RPC, a malformed id and a cap that is not a whole amount", () => {
    expect(() => resolveNetwork({ ...MAINNET, EUNOMIA_RPC_URL: "http://rpc.example.com" })).toThrow(/https/);
    expect(() => resolveNetwork({ ...MAINNET, EUNOMIA_FACTORY_ID: "G" + FACTORY.slice(1) })).toThrow(/FACTORY/);
    for (const cap of ["0", "12.5", "-3", "100 USDC"]) {
      expect(() => resolveNetwork({ ...MAINNET, EUNOMIA_DEPOSIT_CAP: cap })).toThrow(/DEPOSIT_CAP/);
    }
  });
});
