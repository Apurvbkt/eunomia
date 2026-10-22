import { describe, it, expect, vi } from "vitest";
import { Account, Address, Contract, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { makeWalletExecutor, makePasskeyExecutor } from "./executor";
import { AUTH_MISMATCH } from "./authCheck";

const G = "GBGHXQXR7BQZMZ3EPWXVMBNVFHXHVZQJPVWQGCTLPXQHRTFHXQXR7BQZ";
const C = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const TREASURY = "CCU3NHMJGYNFNGWH5IZ3RTE7PPETD7QVVWK2H6DIQCFJKGXGLKKRHWO7";
const SOURCE = "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6";

/** A contract client's assembled `pause()` on the treasury, carrying the auth entry
 *  simulation returned — for `authorised`, which is `pause` when the RPC is honest. */
function assembled(wallet: string, authorised = "pause") {
  const call = new Contract(TREASURY).call("pause").body().invokeHostFunctionOp().hostFunction();
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(wallet).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(TREASURY).toScAddress(),
          functionName: authorised,
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
  return new TransactionBuilder(new Account(SOURCE, "0"), { fee: "100", networkPassphrase: "Test SDF Network ; September 2015" })
    .addOperation(Operation.invokeHostFunction({ func: call, auth: [entry] }))
    .setTimeout(180)
    .build();
}

describe("makeWalletExecutor", () => {
  it("carries the address and marks itself as the wallet path", () => {
    const ex = makeWalletExecutor(G, { signTransaction: vi.fn() });
    expect(ex.address).toBe(G);
    expect(ex.kind).toBe("wallet");
  });

  it("hands the signer through untouched — the wallet path must not change behaviour", () => {
    const signer = { signTransaction: vi.fn() };
    expect(makeWalletExecutor(G, signer).signer).toBe(signer);
  });

  it("submits over the contract client's own RPC and reports the hash", async () => {
    const signAndSend = vi.fn().mockResolvedValue({ sendTransactionResponse: { hash: "abc123" } });
    const ex = makeWalletExecutor(G, { signTransaction: vi.fn() });

    await expect(ex.submit({ signAndSend })).resolves.toEqual({ hash: "abc123" });
    expect(signAndSend).toHaveBeenCalledTimes(1);
  });

  it("reports no hash rather than throwing when the response carries none", async () => {
    const ex = makeWalletExecutor(G, { signTransaction: vi.fn() });
    await expect(ex.submit({ signAndSend: vi.fn().mockResolvedValue({}) })).resolves.toEqual({
      hash: undefined,
    });
  });
});

describe("makePasskeyExecutor", () => {
  const wallet = () => ({
    create: vi.fn(),
    connect: vi.fn(),
    ensureConnected: vi.fn(),
    sign: vi.fn().mockImplementation((tx) => Promise.resolve({ ...tx, signed: true })),
    signAuthEntry: vi.fn(),
    createKey: vi.fn(),
    addRecoverySigner: vi.fn(),
    addPasskeyFromRecovery: vi.fn(),
    connectRecovered: vi.fn(),
  });

  it("uses the smart wallet address and marks the passkey path", () => {
    const ex = makePasskeyExecutor(C, wallet(), vi.fn(), vi.fn(), vi.fn());
    expect(ex.address).toBe(C);
    expect(ex.kind).toBe("passkey");
  });

  it("carries a deploy path, which is what tells the treasury code it cannot use a source account", () => {
    const deploy = vi.fn().mockResolvedValue(C);
    const ex = makePasskeyExecutor(C, wallet(), vi.fn(), deploy, vi.fn());

    expect(ex.deployContract).toBe(deploy);
    // The wallet executor deliberately has none — its presence is the branch condition.
    expect(makeWalletExecutor(G, { signTransaction: vi.fn() }).deployContract).toBeUndefined();
  });

  it("signs with the passkey and relays instead of touching RPC", async () => {
    const w = wallet();
    const signAndSend = vi.fn();
    const relay = vi.fn().mockResolvedValue({ hash: "relayed1" });
    const ex = makePasskeyExecutor(C, w, relay, vi.fn(), vi.fn());

    const built = assembled(C);
    await expect(ex.submit({ signAndSend, built })).resolves.toEqual({ hash: "relayed1" });

    expect(w.sign).toHaveBeenCalledWith({ signAndSend, built });
    expect(relay).toHaveBeenCalledWith({ signAndSend, built, signed: true });
    // The passkey wallet has no XLM of its own — going to RPC would fail on fees.
    expect(signAndSend).not.toHaveBeenCalled();
  });

  it("refuses to sign simulated auth that is not the call the client built (M1)", async () => {
    const w = wallet();
    const relay = vi.fn();
    const ex = makePasskeyExecutor(C, w, relay, vi.fn(), vi.fn());

    // The entry authorises a different function than the transaction calls.
    await expect(ex.submit({ signAndSend: vi.fn(), built: assembled(C, "withdraw") })).rejects.toThrow(AUTH_MISMATCH);
    // And an assembled transaction with no host function is not signed blind.
    await expect(ex.submit({ signAndSend: vi.fn(), built: { operations: [] } })).rejects.toThrow(AUTH_MISMATCH);
    expect(w.sign).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
  });

  it("exposes a signer that refuses the callback path", async () => {
    // Nothing should route a passkey session through the wallet-style XDR callback; failing
    // loudly here beats a confusing signature error deeper in the SDK.
    const ex = makePasskeyExecutor(C, wallet(), vi.fn(), vi.fn(), vi.fn());
    await expect(ex.signer.signTransaction("XDR")).rejects.toThrow(/passkey/i);
  });
});
